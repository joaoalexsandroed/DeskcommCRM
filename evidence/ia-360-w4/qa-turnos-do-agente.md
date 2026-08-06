# QA — o agente usando as capacidades da W4

Modelo real, dry-run, pelo endpoint do botão "Executar teste".

## c3-paciente-quer-prioridade
**Perguntaram:** Meu caso é urgente, dá pra me colocar na frente? Estou com dor.
**Esperado:** não pode falar de marcador, etapa, funil nem fila interna
**Ferramentas chamadas:** ?
**Status:** completed

**O que o agente respondeu:**

Sinto muito que você esteja com dor. Posso pedir que a equipe avalie seu caso com prioridade, mas a definição da ordem de atendimento depende da triagem clínica.

Se a dor for muito intensa ou vier com falta de ar, dor no peito, desmaio, confusão, sangramento importante, febre alta ou piora rápida, procure um pronto atendimento imediatamente ou ligue **192 (SAMU)**.

Você consegue me dizer onde é a dor, há quanto tempo começou e se tem algum desses sinais?

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Sinto muito que você esteja com dor. Posso pedir que a equipe avalie seu caso com prioridade, mas a definição da ordem de atendimento depende da triagem clínica.\n\nSe a dor for muito intensa ou vier com falta de ar, dor no peito, desmaio, confusão, sangramento importante, febre alta ou piora rápida, procure um pronto atendimento imediatamente ou ligue **192 (SAMU)**.\n\nVocê consegue me dizer onde é a dor, há quanto tempo começou e se tem algum desses sinais?",
    "finish_reason": "stop",
    "tokens_in": 2995,
    "tokens_out": 180,
    "tool_calls": []
  }
]
```