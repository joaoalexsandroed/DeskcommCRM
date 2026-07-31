/**
 * Pings síncronos para validar API keys BYO de provedores LLM.
 *
 * Uso:
 *   const result = await validateProviderKey("anthropic", apiKey);
 *   if (result.ok) → grava `validated_at = now()`, `models_available = result.models`
 *   else → grava `validation_error = result.error`
 *
 * Timeout 5s, sem retry. Erros 401 são distintos de erros de rede.
 */

export type Provider = "anthropic" | "openai" | "google" | "openrouter";

export interface ValidationOk {
  ok: true;
  models: string[];
}

export interface ValidationFail {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

const TIMEOUT_MS = 5000;

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
  try {
    const res = await timedFetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (!res.ok) {
      return { ok: false, error: `provider_status_${res.status}` };
    }
    const json = (await res.json()) as { data?: { id: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}

export async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  try {
    const res = await timedFetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (!res.ok) {
      return { ok: false, error: `provider_status_${res.status}` };
    }
    const json = (await res.json()) as { data?: { id: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}

export async function validateGoogleKey(apiKey: string): Promise<ValidationResult> {
  // Google Generative Language API — listModels com api key em query string é o
  // único endpoint público de discovery. A key permanece server-side, nunca
  // chega ao browser, e este request não é logado pelo nosso edge.
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      apiKey,
    )}`;
    const res = await timedFetch(url, { method: "GET" });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (!res.ok) {
      return { ok: false, error: `provider_status_${res.status}` };
    }
    const json = (await res.json()) as { models?: { name?: string }[] };
    const models = (json.models ?? [])
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}

/**
 * OpenRouter não tem um endpoint de "listar modelos autenticado" que também
 * valide a chave: `/api/v1/models` é público (200 mesmo com chave inválida) e
 * `/api/v1/auth/key` valida a chave mas não devolve catálogo. Por isso são DUAS
 * chamadas — a 1ª só confirma 401/403, a 2ª busca o catálogo pra popular
 * `models_available` do mesmo jeito que os outros 3 providers.
 */
export async function validateOpenRouterKey(apiKey: string): Promise<ValidationResult> {
  try {
    const authRes = await timedFetch("https://openrouter.ai/api/v1/auth/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (authRes.status === 401 || authRes.status === 403) {
      return { ok: false, error: "auth_failed_401" };
    }
    if (!authRes.ok) {
      return { ok: false, error: `provider_status_${authRes.status}` };
    }

    const modelsRes = await timedFetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!modelsRes.ok) {
      return { ok: false, error: `provider_status_${modelsRes.status}` };
    }
    const json = (await modelsRes.json()) as { data?: { id: string }[] };
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name : "network_error" };
  }
}

export function validateProviderKey(
  provider: Provider,
  apiKey: string,
): Promise<ValidationResult> {
  switch (provider) {
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAIKey(apiKey);
    case "google":
      return validateGoogleKey(apiKey);
    case "openrouter":
      return validateOpenRouterKey(apiKey);
    default: {
      const exhaustive: never = provider;
      return Promise.resolve({ ok: false, error: `unknown_provider:${exhaustive}` });
    }
  }
}
