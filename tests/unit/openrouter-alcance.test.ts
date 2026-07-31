/**
 * Invariante de ALCANCE: o que a `OPENROUTER_API_KEY` (env) roteia — e o que
 * ela não roteia.
 *
 * Por que este arquivo existe: o `.env.example` afirma ao self-hoster quais
 * caminhos passam a usar a OpenRouter quando ele preenche a chave. Afirmação em
 * comentário não se defende sozinha — a primeira pessoa que ligar o resolver a
 * um caminho novo não vai lembrar de reescrever o aviso, e o usuário decide a
 * configuração da instalação lendo justamente esse aviso.
 *
 * O alcance real hoje, medido: `resolveLanguageModel()` é chamado por
 * `ai-sentiment-worker` (classificação de sentimento) e `ai-response-worker`
 * (bot de resposta). NENHUM dos dois passa `tools` ao SDK — o alcance da
 * variável de AMBIENTE `OPENROUTER_API_KEY` fica restrito a esses dois.
 *
 * Decisão de produto (branch `vps-orion`, diverge do upstream): o agente do
 * CRM, que opera por ferramentas, aceita OpenRouter como provider — via
 * credencial BYOK cadastrada por organização (tela de Agentes), não via esta
 * variável de ambiente. `lib/agent-engine/edge/llm/providers.ts` CONHECE a
 * OpenRouter de propósito. Quem escolhe OpenRouter para o agente na tela
 * aceita conscientemente o risco descrito no `.env.example`: modelo sem tool
 * calling sólido não dá erro, responde texto plausível e nunca cria o lead
 * nem move o card. Ver PATCH-ORION.md.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");

/** Arquivos de produção que importam o resolver (exclui testes e o próprio módulo). */
function chamadoresDoResolver(): string[] {
  const saida = execFileSync(
    "git",
    ["grep", "-l", "resolveLanguageModel", "--", "lib", "workers", "app", "scripts"],
    { cwd: RAIZ, encoding: "utf8" },
  );
  return saida
    .split("\n")
    .filter(Boolean)
    .filter((f) => !f.includes(".test.") && f !== "lib/ai/gateway.ts" && f !== "lib/env.ts");
}

describe("alcance da OPENROUTER_API_KEY", () => {
  it("o resolver tem chamadores — senão o invariante estaria passando por vacuidade", () => {
    // Sem esta asserção, apagar o resolver deixaria o teste abaixo verde e o
    // aviso do .env.example desprotegido.
    expect(chamadoresDoResolver().length).toBeGreaterThan(0);
  });

  it("nenhum caminho roteado pela OpenRouter passa FERRAMENTAS ao modelo", () => {
    const comFerramentas = chamadoresDoResolver().filter((arquivo) =>
      /\btools\s*:/.test(readFileSync(resolve(RAIZ, arquivo), "utf8")),
    );

    expect(
      comFerramentas,
      comFerramentas.length
        ? `${comFerramentas.join(", ")} passa(m) ferramentas ao modelo E resolve(m) pela OpenRouter ` +
            "via `resolveLanguageModel()` (env `OPENROUTER_API_KEY`). O aviso sobre tool calling em " +
            ".env.example / .env.hostgator.example foi escrito quando isso NÃO acontecia por essa via " +
            "e agora está desatualizado: reescreva-o antes de liberar este caminho. (O agente do CRM " +
            "aceitar OpenRouter por credencial BYOK — lib/agent-engine/edge/llm/providers.ts — é " +
            "decisão de produto separada, coberta por outro aviso; ver o cabeçalho deste arquivo.)"
        : undefined,
    ).toEqual([]);
  });
});
