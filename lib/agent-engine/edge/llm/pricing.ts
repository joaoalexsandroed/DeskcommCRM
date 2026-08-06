/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo.
 *
 * Fonte: https://docs.claude.com/en/docs/about-claude/pricing (conferida 2026-07);
 * cache write cotado no TTL 1h (2× input) — o TTL adotado pela doutrina de caching
 * (CLAUDE.md regra 15); cache read = 0.1× input.
 *
 * Modelo fora da tabela → custo NULL (desconhecido): mais honesto que inventar 0 —
 * o budget soma coalesce(cost_cents, 0), então modelo sem preço não consome teto;
 * quem habilitar um modelo novo para uma org adiciona a linha de preço aqui.
 */

/** USD por MILHÃO de tokens; match por prefixo do id (cobre sufixo de data do vendor). */
const USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite1h: number }> = {
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite1h: 30 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache.
 */
export function costCents(model: string, usage: TokenUsage): number | null {
  const priceKey = Object.keys(USD_PER_MTOK).find((prefix) => model.startsWith(prefix));
  if (priceKey === undefined) {
    return null;
  }
  const p = USD_PER_MTOK[priceKey];
  if (p === undefined) {
    return null; // inalcançável (key veio de Object.keys); satisfaz noUncheckedIndexedAccess
  }
  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite1h +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}

/**
 * OpenRouter é a EXCEÇÃO à tabela acima: agrega 300+ modelos de dezenas de
 * vendors (migration 0093) — manter uma linha por modelo aqui não escala e
 * ficaria desatualizado a cada modelo novo do catálogo. Em vez de tabela,
 * pedimos o custo REAL de volta na própria resposta (`usage: {include: true}`
 * no factory de providers.ts) e lemos aqui. Shape documentado pelo
 * `@openrouter/ai-sdk-provider`: `providerMetadata.openrouter.usage.cost` em
 * USD. Ausente/shape inesperado → null (mesmo contrato de "modelo sem preço
 * conhecido não consome teto" do costCents acima).
 */
export function openrouterCostCents(providerMetadata: unknown): number | null {
  if (providerMetadata === null || typeof providerMetadata !== 'object') {
    return null;
  }
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (openrouter === null || typeof openrouter !== 'object') {
    return null;
  }
  const usage = (openrouter as Record<string, unknown>).usage;
  if (usage === null || typeof usage !== 'object') {
    return null;
  }
  const cost = (usage as Record<string, unknown>).cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) {
    return null;
  }
  return cost * 100;
}
