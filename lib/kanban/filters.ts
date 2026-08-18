import type { Lead } from "@/lib/types/leads";
import type { CustomFieldDef, CustomFieldType } from "@/components/contacts/CustomFieldsEditor";

/**
 * Prefixo que marca um dono AGENTE no filtro (0070). O param de URL continua
 * sendo `owner=` — humano é o uuid puro, agente é `agent:<uuid>`, e o board
 * não precisa de dois seletores para a mesma pergunta ("de quem é isto?").
 */
export const AGENT_OWNER_PREFIX = "agent:";

export function agentOwnerFilter(agentId: string): string {
  return `${AGENT_OWNER_PREFIX}${agentId}`;
}

export function parseAgentOwnerFilter(value: string | undefined): string | null {
  if (!value?.startsWith(AGENT_OWNER_PREFIX)) return null;
  return value.slice(AGENT_OWNER_PREFIX.length) || null;
}

export interface LeadFilters {
  /** userId | `agent:<uuid>` | "any" | "unassigned" */
  owner?: string | "any" | "unassigned";
  status?: "all" | "open" | "won" | "lost";
  tag?: string;
  search?: string;
  valueCentsMin?: number | null;
  valueCentsMax?: number | null;
  overdueOnly?: boolean;
  /**
   * Filtro estruturado por campo customizado — chave do schema
   * (`pipeline.settings.fields[].key`) → valor exigido. Ausente/`""` numa
   * chave é "não filtra por ela", não "exige vazio".
   */
  customFields?: Record<string, unknown>;
}

/**
 * Serializa/deserializa os filtros do board em query params (deep-linkável).
 * Só os controles expostos na FilterBar: owner, status, tag, busca, atrasados.
 */
export function filtersFromParams(
  sp: { get(key: string): string | null },
): LeadFilters {
  const owner = sp.get("owner");
  const status = sp.get("status");
  const tag = sp.get("tag");
  const search = sp.get("q");
  // JSON num param só: schema é livre (até 50 campos por pipeline), então um
  // param por campo poluiria a URL sem necessidade — e nada aqui exige um
  // param legível individualmente, diferente de owner/status/tag.
  const cfRaw = sp.get("cf");
  let customFields: Record<string, unknown> | undefined;
  if (cfRaw) {
    try {
      const parsed: unknown = JSON.parse(cfRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        customFields = parsed as Record<string, unknown>;
      }
    } catch {
      // URL adulterada/truncada: ignora em vez de quebrar o board inteiro.
      customFields = undefined;
    }
  }
  return {
    owner: owner ?? undefined,
    status:
      status === "open" || status === "won" || status === "lost" || status === "all"
        ? status
        : "all",
    tag: tag ?? undefined,
    search: search ?? undefined,
    overdueOnly: sp.get("overdue") === "1" || undefined,
    customFields,
  };
}

export function filtersToParams(f: LeadFilters): string {
  const p = new URLSearchParams();
  if (f.owner && f.owner !== "any") p.set("owner", f.owner);
  if (f.status && f.status !== "all") p.set("status", f.status);
  if (f.tag) p.set("tag", f.tag);
  if (f.search?.trim()) p.set("q", f.search.trim());
  if (f.overdueOnly) p.set("overdue", "1");
  const cfEntries = Object.entries(f.customFields ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (cfEntries.length > 0) p.set("cf", JSON.stringify(Object.fromEntries(cfEntries)));
  return p.toString();
}

/** Valores escalares de `custom_fields` viram texto pesquisável; array/objeto/null ficam de fora. */
function customFieldsSearchText(cf: Record<string, unknown> | undefined): string {
  if (!cf) return "";
  return Object.values(cf)
    .filter((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .join(" ");
}

/**
 * Um valor de campo customizado bate o filtro pedido pra ESSE campo.
 *
 * Tipo-consciente: `select`/`date`/`número` são igualdade exata (mesmo
 * contrato dos outros filtros de enum do board — owner/status/tag); texto
 * livre é substring (mesmo contrato da busca geral); `multiselect` é
 * "o array contém"; `boolean` compara contra `"true"`/`"false"` (o valor que
 * sai de um <select> de filtro, nunca um boolean real vindo do DOM).
 */
function customFieldMatches(
  fieldValue: unknown,
  filterValue: unknown,
  type: CustomFieldType,
): boolean {
  switch (type) {
    case "boolean":
      return Boolean(fieldValue) === (filterValue === "true" || filterValue === true);
    case "multiselect":
      return Array.isArray(fieldValue) && fieldValue.includes(filterValue);
    case "select":
    case "date":
      return fieldValue === filterValue;
    case "number":
      return typeof fieldValue === "number" && fieldValue === Number(filterValue);
    default:
      return (
        typeof fieldValue === "string" &&
        fieldValue.toLowerCase().includes(String(filterValue).toLowerCase())
      );
  }
}

export function applyFilters(
  leads: Lead[],
  f: LeadFilters,
  /** Schema do pipeline — só precisa pra saber o TIPO de cada chave filtrada. */
  pipelineFields?: CustomFieldDef[],
): Lead[] {
  const today = new Date().toISOString().slice(0, 10);
  const search = f.search?.trim().toLowerCase() ?? "";
  const cfFilters = Object.entries(f.customFields ?? {}).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  const fieldByKey = new Map((pipelineFields ?? []).map((def) => [def.key, def]));

  return leads.filter((l) => {
    // "Sem responsável" é sem dono NENHUM — lead de dono agente tem dono.
    if (
      f.owner === "unassigned" &&
      (l.owner_user_id !== null || l.owner_agent_id !== null)
    )
      return false;
    if (f.owner && f.owner !== "any" && f.owner !== "unassigned") {
      const agentId = parseAgentOwnerFilter(f.owner);
      if (agentId) {
        if (l.owner_agent_id !== agentId) return false;
      } else if (l.owner_user_id !== f.owner) {
        return false;
      }
    }
    if (f.status && f.status !== "all" && l.status !== f.status) return false;
    if (f.tag && !l.tags.includes(f.tag)) return false;
    if (
      search &&
      !`${l.title} ${l.description ?? ""} ${customFieldsSearchText(l.custom_fields)}`
        .toLowerCase()
        .includes(search)
    )
      return false;
    if (typeof f.valueCentsMin === "number" && (l.value_cents ?? 0) < f.valueCentsMin)
      return false;
    if (typeof f.valueCentsMax === "number" && (l.value_cents ?? 0) > f.valueCentsMax)
      return false;
    if (f.overdueOnly) {
      if (l.status !== "open") return false;
      if (!l.expected_close_date || l.expected_close_date >= today) return false;
    }
    for (const [key, filterValue] of cfFilters) {
      const def = fieldByKey.get(key);
      if (!def) continue; // campo removido do schema desde que a URL foi salva — ignora, não quebra
      if (!customFieldMatches(l.custom_fields?.[key], filterValue, def.type)) return false;
    }
    return true;
  });
}
