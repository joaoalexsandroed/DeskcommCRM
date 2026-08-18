/**
 * Filtro do board — busca geral (agora inclui `custom_fields`) e filtro
 * estruturado por campo (schema declarativo em `pipeline.settings.fields`).
 */
import { describe, it, expect } from "vitest";

import { applyFilters, filtersFromParams, filtersToParams, type LeadFilters } from "./filters";
import type { CustomFieldDef } from "@/components/contacts/CustomFieldsEditor";
import type { Lead } from "@/lib/types/leads";

const lead = (over: Partial<Lead> & Pick<Lead, "id" | "title">): Lead => ({
  organization_id: "org-1",
  pipeline_id: "pipe-1",
  stage_id: "stage-1",
  contact_id: null,
  description: null,
  status: "open",
  lost_reason: null,
  position_in_stage: 0,
  value_cents: null,
  currency: "BRL",
  owner_user_id: null,
  owner_kind: null,
  owner_agent_id: null,
  assigned_at: null,
  last_activity_at: null,
  expected_close_date: null,
  closed_at: null,
  source: "manual",
  source_metadata: {},
  external_id: null,
  custom_fields: {},
  tags: [],
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  created_by_user_id: null,
  ...over,
});

describe("applyFilters — busca geral inclui custom_fields", () => {
  it("acha pelo valor de um campo customizado, não só título/descrição", () => {
    const leads = [
      lead({ id: "l-1", title: "Sem relação", custom_fields: { observacao: "Cliente pediu retorno em outubro" } }),
      lead({ id: "l-2", title: "Outro lead", custom_fields: { observacao: "nada a ver" } }),
    ];
    const result = applyFilters(leads, { search: "outubro" });
    expect(result.map((l) => l.id)).toEqual(["l-1"]);
  });

  it("ignora valores não-escalares (array/objeto/null) na busca — não quebra, não bate por engano", () => {
    const leads = [lead({ id: "l-1", title: "x", custom_fields: { tags_internas: ["outubro"] } })];
    expect(applyFilters(leads, { search: "outubro" })).toEqual([]);
  });
});

describe("applyFilters — filtro estruturado por campo", () => {
  const fields: CustomFieldDef[] = [
    { key: "observacao", label: "Observação", type: "textarea" },
    { key: "tipo_seguro", label: "Tipo de seguro", type: "select", options: [{ value: "auto", label: "Automóvel" }] },
    { key: "renovavel", label: "Renovável", type: "boolean" },
    { key: "coberturas", label: "Coberturas", type: "multiselect", options: [{ value: "roubo", label: "Roubo" }] },
    { key: "franquia", label: "Franquia", type: "number" },
    { key: "vencimento", label: "Vencimento", type: "date" },
  ];

  it("texto: substring, sem diferenciar maiúsculas", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { observacao: "Ligar semana que vem" } }),
      lead({ id: "l-2", title: "b", custom_fields: { observacao: "Fechado" } }),
    ];
    const f: LeadFilters = { customFields: { observacao: "ligar" } };
    expect(applyFilters(leads, f, fields).map((l) => l.id)).toEqual(["l-1"]);
  });

  it("select: igualdade exata", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { tipo_seguro: "auto" } }),
      lead({ id: "l-2", title: "b", custom_fields: { tipo_seguro: "vida" } }),
    ];
    const f: LeadFilters = { customFields: { tipo_seguro: "auto" } };
    expect(applyFilters(leads, f, fields).map((l) => l.id)).toEqual(["l-1"]);
  });

  it("boolean: compara contra a string que o <select> de filtro manda, não um boolean real", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { renovavel: true } }),
      lead({ id: "l-2", title: "b", custom_fields: { renovavel: false } }),
    ];
    expect(
      applyFilters(leads, { customFields: { renovavel: "true" } }, fields).map((l) => l.id),
    ).toEqual(["l-1"]);
  });

  it("multiselect: o array precisa CONTER o valor pedido", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { coberturas: ["roubo", "incendio"] } }),
      lead({ id: "l-2", title: "b", custom_fields: { coberturas: ["incendio"] } }),
    ];
    expect(
      applyFilters(leads, { customFields: { coberturas: "roubo" } }, fields).map((l) => l.id),
    ).toEqual(["l-1"]);
  });

  it("number: igualdade exata (string do input vira número antes de comparar)", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { franquia: 1500 } }),
      lead({ id: "l-2", title: "b", custom_fields: { franquia: 2000 } }),
    ];
    expect(
      applyFilters(leads, { customFields: { franquia: "1500" } }, fields).map((l) => l.id),
    ).toEqual(["l-1"]);
  });

  it("date: igualdade exata na string ISO", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { vencimento: "2026-10-01" } }),
      lead({ id: "l-2", title: "b", custom_fields: { vencimento: "2026-11-01" } }),
    ];
    expect(
      applyFilters(leads, { customFields: { vencimento: "2026-10-01" } }, fields).map((l) => l.id),
    ).toEqual(["l-1"]);
  });

  it("campo removido do schema desde que a URL foi salva: ignora em vez de zerar o board", () => {
    const leads = [lead({ id: "l-1", title: "a", custom_fields: { campo_extinto: "x" } })];
    // `fields` não tem `campo_extinto` — o filtro não pode derrubar o lead por
    // uma chave que o schema atual não conhece mais.
    expect(
      applyFilters(leads, { customFields: { campo_extinto: "x" } }, fields).map((l) => l.id),
    ).toEqual(["l-1"]);
  });

  it("dois filtros de campo combinam com E, não OU", () => {
    const leads = [
      lead({ id: "l-1", title: "a", custom_fields: { tipo_seguro: "auto", renovavel: true } }),
      lead({ id: "l-2", title: "b", custom_fields: { tipo_seguro: "auto", renovavel: false } }),
    ];
    const f: LeadFilters = { customFields: { tipo_seguro: "auto", renovavel: "true" } };
    expect(applyFilters(leads, f, fields).map((l) => l.id)).toEqual(["l-1"]);
  });
});

describe("filtersToParams / filtersFromParams — round-trip de custom_fields", () => {
  it("serializa só as chaves preenchidas, ida e volta preserva o valor", () => {
    const f: LeadFilters = { customFields: { observacao: "ligar", vazio: "", nulo: null, undef: undefined } };
    const qs = filtersToParams(f);
    const sp = new URLSearchParams(qs);
    const back = filtersFromParams(sp);
    expect(back.customFields).toEqual({ observacao: "ligar" });
  });

  it("URL adulterada em `cf` não quebra o parse do resto dos filtros", () => {
    const sp = new URLSearchParams("cf=%7Bnao-e-json");
    expect(filtersFromParams(sp).customFields).toBeUndefined();
  });

  it("sem custom_fields nenhum, o param `cf` nem aparece na URL", () => {
    expect(filtersToParams({ search: "x" })).not.toContain("cf=");
  });
});
