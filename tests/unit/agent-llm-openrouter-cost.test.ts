import { describe, expect, it } from "vitest";

import { openrouterCostCents } from "@/lib/agent-engine/edge/llm/pricing";

describe("openrouterCostCents", () => {
  it("lê o custo real em USD de providerMetadata.openrouter.usage.cost e converte pra cents", () => {
    const providerMetadata = { openrouter: { usage: { cost: 0.0123 } } };
    expect(openrouterCostCents(providerMetadata)).toBeCloseTo(1.23);
  });
  it("providerMetadata ausente/vazio → null (não inventa custo)", () => {
    expect(openrouterCostCents(undefined)).toBeNull();
    expect(openrouterCostCents(null)).toBeNull();
    expect(openrouterCostCents({})).toBeNull();
  });
  it("shape inesperado (sem openrouter, sem usage, cost não-numérico) → null", () => {
    expect(openrouterCostCents({ anthropic: {} })).toBeNull();
    expect(openrouterCostCents({ openrouter: {} })).toBeNull();
    expect(openrouterCostCents({ openrouter: { usage: {} } })).toBeNull();
    expect(openrouterCostCents({ openrouter: { usage: { cost: "0.01" } } })).toBeNull();
  });
});
