/**
 * GET /api/v1/ai/providers/:provider/models
 *
 * anthropic/openai/google: lê do catálogo curado `ai_models` (tabela GLOBAL,
 * RLS read-all). openrouter: NÃO tem catálogo curado (migration 0093 — são
 * 300+ modelos de dezenas de vendors, curar a mão a cada lançamento novo
 * quebraria o propósito do provider) — busca ao vivo de
 * `https://openrouter.ai/api/v1/models` (endpoint público, sem chave) e
 * cacheia em memória do processo por 1h.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { ehProvedorSuportado } from "@/lib/ai/pontos/provedores";

export const dynamic = "force-dynamic";

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";

interface ModelOption {
  id: string;
  provider: string;
  model_id: string;
  display_name: string;
  description: string | null;
  context_window: number | null;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
  supports_tools: boolean;
  is_default_for_provider: boolean;
  deprecated_at: string | null;
  released_at: string | null;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const OPENROUTER_TIMEOUT_MS = 8000;
const OPENROUTER_CATALOG_TTL_MS = 60 * 60 * 1000;
let openRouterCatalogCache: { fetchedAt: number; models: ModelOption[] } | null = null;

/** USD/token (string da API) → cents por MILHÃO de tokens, mesma unidade de ai_models. */
function centsPerMillion(perToken: string | undefined): number | null {
  if (!perToken) return null;
  const n = Number(perToken);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1_000_000 * 100);
}

async function fetchOpenRouterModels(): Promise<ModelOption[]> {
  const now = Date.now();
  if (openRouterCatalogCache && now - openRouterCatalogCache.fetchedAt < OPENROUTER_CATALOG_TTL_MS) {
    return openRouterCatalogCache.models;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OPENROUTER_TIMEOUT_MS);
  let json: { data?: OpenRouterModel[] };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: ctrl.signal });
    if (!res.ok) {
      throw new Error(`openrouter_status_${res.status}`);
    }
    json = (await res.json()) as { data?: OpenRouterModel[] };
  } finally {
    clearTimeout(timer);
  }

  const models: ModelOption[] = (json.data ?? []).map((m) => ({
    id: m.id,
    provider: "openrouter",
    model_id: m.id,
    display_name: m.name ?? m.id,
    description: m.description ?? null,
    context_window: m.context_length ?? null,
    input_price_per_million_cents: centsPerMillion(m.pricing?.prompt),
    output_price_per_million_cents: centsPerMillion(m.pricing?.completion),
    supports_tools: (m.supported_parameters ?? []).includes("tools"),
    // Sem conceito de "default" no catálogo agregado — escolher um seria
    // curadoria disfarçada. Ordenação por preço abaixo cobre a mesma UX.
    is_default_for_provider: false,
    deprecated_at: null,
    released_at: m.created ? new Date(m.created * 1000).toISOString() : null,
  }));

  models.sort(
    (a, b) =>
      (a.input_price_per_million_cents ?? Number.POSITIVE_INFINITY) -
      (b.input_price_per_million_cents ?? Number.POSITIVE_INFINITY),
  );

  openRouterCatalogCache = { fetchedAt: now, models };
  return models;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { provider } = await ctx.params;

  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  }

  if (provider === "openrouter") {
    try {
      const models = await fetchOpenRouterModels();
      return ok({ models }, { requestId });
    } catch {
      return fail("internal_error", "Erro ao listar modelos do OpenRouter.", 500, { requestId });
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  return ok({ models: data ?? [] }, { requestId });
}
