# Changelog

Todas as mudanças relevantes deste projeto são documentadas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

Se você roda o DeskcommCRM numa VPS, **leia a seção da versão para a qual está atualizando antes de rodar `bash update.sh`**. Mudanças que exigem ação manual aparecem sob **⚠️ Requer atenção**.

## [Não lançado]

## [1.3.1] — 2026-08-10

### Corrigido

- **`sync-model-catalog` (cron diário do catálogo da OpenRouter) rejeitava com 401 toda
  instalação que define `INTERNAL_CRON_SECRET` e `INTERNAL_SECRET` com valores diferentes**
  (o `.env.example` documenta as duas). A rota usava `||` para escolher uma só antes de
  comparar, diferente de todo o resto dos crons (que aceitam qualquer uma das duas). O
  crontab agenda com `INTERNAL_SECRET`, então o sync nunca autenticava sozinho.

## [1.3.0] — 2026-08-10

Integração com o repositório oficial (`melgarafael/DeskcommCRM`): 193 commits que este fork
não tinha, reconciliados com o que já era específico daqui (OpenRouter, papéis do agente).

### Adicionado

- **Configuração de IA por ponto do sistema.** Tela nova (Agente de IA → Provedores) que
  mostra, para cada um dos pontos que chamam modelo (atendimento, classificação de
  sentimento, embeddings etc.), qual provider/modelo está valendo hoje e por quê — e deixa
  trocar por ponto, com recusa explícita se o modelo escolhido não tem as capacidades que o
  ponto exige (ex.: sem tool calling num ponto que precisa criar lead).
- **Índice de Atrito.** O sistema passa a medir o próprio propósito: abandono, repetição e
  espera do lado do cliente, não só volume de atividade.
- **Demanda como entidade de primeira classe.** A conversa vira lead automaticamente no ponto
  de entrada; o card carrega a demanda, não só a atividade solta.
- **Confirmação de dado ouvido em conversa.** Quando a IA entende um e-mail ou telefone dito
  pelo cliente, a mudança fica pendente até um humano confirmar — nunca sobrescreve sozinha.
- **Terceiro canal (BSP intermediário)**, além de WAHA e WhatsApp oficial.
- **Colar imagem no composer** com Ctrl+V; aba "Minhas" da inbox para de mostrar conversa já
  fechada; filtro por tag na inbox.
- **Tela de execuções de IA** — o que cada chamada fez, quanto custou e por que falhou.

### Corrigido

- **Vazamento de dado entre organizações** em dois caminhos: listagem de negócios e agente
  de uma organização alcançando negócio de outra.
- **Mídia que o agente não conseguia ler** (foto/áudio) falhava em silêncio — agora aparece
  marcador no texto derivado e aviso na Central.
- **`update.sh` inventava gasto de IA** — trigger de orçamento contava linha de mês passado
  durante o backfill de unificação de telemetria.
- **Rotacionar uma credencial de IA apagava a configuração dos pontos** que a usavam, em vez
  de voltar ao padrão da organização.
- Bug próprio achado durante a integração: script de medição de vazamento lia um campo morto
  do catálogo de tools (nenhum consumidor real o lê) — 48 de 51 capacidades divergiam do
  texto que de fato chega ao modelo.

### Segurança

- **Função nova criada por migration nascia exposta à chave `anon`** em quem já tinha o
  produto instalado (o `ALTER DEFAULT PRIVILEGES` do baseline persiste no catálogo do banco
  entre atualizações). Varredura auto-curativa no fim do apêndice, que revoga de toda
  `security definer` de `public` e devolve só o que cada função de fato precisava.

**⚠️ Requer atenção**

Esta versão traz mudanças de banco (migrations 0122 a 0142) além das já cobertas pela 1.2.x.
O `update.sh` aplica tudo sozinho e faz backup antes.

## [1.2.3] — 2026-08-10

### Corrigido

- **Painel "Testar agente" mostrava "Erro inesperado." em qualquer turno que passasse de 10s**
  (ex.: quando o modelo chama uma tool). A chamada ao endpoint de teste usava o timeout padrão
  do cliente HTTP (10s) — um turno real do agent-engine já leva ~6s numa resposta simples sem
  tool call, e qualquer chamada de tool estoura esse limite. O erro chegava como `AbortError`,
  que o painel não sabia traduzir pra mensagem específica, então caía no toast genérico em vez
  de mostrar o motivo real. Agora essa chamada usa `timeoutMs: 60_000`.

## [1.2.1] — 2026-08-07

### Corrigido

- **Confirmação de e-mail não voltava pro onboarding atrás de proxy reverso self-host**
  (Traefik/Coolify/Dokploy). `/auth/confirm` montava o redirect final com `url.origin` (o Host
  visto pelo container, ex.: `0.0.0.0:3000`) em vez do domínio público — o `verifyOtp` completava
  com sucesso, mas o navegador era jogado pro endereço interno. Agora usa
  `env.NEXT_PUBLIC_APP_URL`, como os demais links públicos (convites) já faziam.

## [1.2.0] — 2026-08-06

Versão grande: 122 correções e 62 novidades desde a 1.1.0. O tema é o agente de IA deixar de
ser um respondedor e virar parte da operação — com papel próprio, capacidades declaradas e
lugar na tela —, e o sistema parar de mentir quando algo dá errado.

### Adicionado

- **O agente publicado ganha papel próprio**, entre atendente e gerente: ele assume o lead,
  devolve para uma pessoa quando precisa, e a volta aparece na linha do tempo em vez de sumir.
- **Roteador de intenção por número.** Um WhatsApp só passa a atender vários assuntos: o
  roteador entende o que o cliente quer e entrega para o agente certo.
- **Fila de leads por atendente, com rodízio.** A distribuição deixa de ser combinada por fora
  e vira porta na tela. Reforços no CRM vivo (linha do tempo/atividade dos leads).
- **Capacidades do agente.** Você escolhe o que ele pode fazer, vê quantas vezes usou cada uma,
  e ele avisa quando falta uma capacidade em vez de falhar calado.
- **Catálogo de modelos atualizado** nos três provedores — quem instala não escolhe mais entre
  modelos de duas gerações atrás, pagando mais caro por pior.
- **Suporte a OpenRouter como provedor de IA.** Catálogo de 300+ modelos buscado ao vivo na API
  (não curado como os demais provedores), conectado às telas de credenciais e de agentes — BYOK
  atrás de uma chave só.
- **Aviso de mensagem presa.** Uma tarefa automática detecta mensagem que ficou "enviando" e
  abre um aviso na Central, em vez de deixar o cliente sem resposta em silêncio.
- **Foto de perfil no inbox** e revisão do composer para conversas longas no WhatsApp.
- **Suporte a proxy reverso externo já existente na VPS** (Traefik/Coolify/Dokploy) reconhecido
  automaticamente pelo instalador.

### Alterado

- CI: cobertura de E2E expandida e mais estável; correções de setup (Node, Buildx) e de colisão de
  timestamp entre migrations.

### Corrigido

- **Duas partes do sistema respondiam à mesma mensagem do cliente.** Agora há um dono só.
- **"O WhatsApp está fora do ar" quando o serviço estava de pé.** Toda falha de rede caía na
  mesma frase, mandando reiniciar um container que nunca havia caído. Agora a mensagem
  distingue endereço errado de serviço parado e diz onde mexer.
- **O roteador recusava um número que existia**, com a mensagem "não encontrado nesta
  organização", quando na verdade a consulta é que havia falhado.
- **A tela de funis misturava organizações** do mesmo usuário.
- **Excluir um canal** apagava o roteador junto, sem avisar, e deixava a Meta ainda entregando
  mensagens. Reconectar dizia "conectado" com a linha ainda arquivada.
- **Erro ao publicar o agente no onboarding criava um agente novo a cada clique.**
- **O custo de IA sem agente dono sumia da auditoria** — as telas de consumo mostravam zero
  numa instalação com tráfego real e provedor pago.
- Mensagem enviada pelo próprio celular deixava de aparecer no CRM.
- **O `update.sh`/`install.sh` do kit de instalação sempre buscavam a imagem em
  `ghcr.io/melgarafael/deskcommcrm`**, mesmo numa instalação com `REPO_URL`/`origin` apontando para
  um fork — o registro do fork nunca era consultado. Agora a imagem é derivada do remote `origin`
  do próprio checkout.

### Segurança

- **8 de 25 funções internas do banco estavam executáveis pela chave pública** que vai para o
  navegador, incluindo uma que escreve recebendo a organização por parâmetro, sem checar se
  você pertence a ela. Todas fechadas, com uma varredura que reprova a próxima.
- Endurecimento de segurança adicional: teto de tentativas de login por IP, fechamento de
  vazamentos de dado entre tenants.

**⚠️ Requer atenção**

Esta versão traz mudanças de banco (migrations 0100 a 0117). O `update.sh` aplica tudo sozinho
e faz backup antes — você não precisa rodar nada à mão. Se a sua instalação está há muito tempo
sem atualizar, é normal a etapa do banco demorar mais e imprimir vários avisos de "já existe":
eles são esperados e o script só destaca o que não for.

Se a sua instalação usa `REPO_URL`/`origin` apontando para um **fork** (não o repositório
oficial `melgarafael/DeskcommCRM`), a próxima atualização passa a puxar a imagem publicada pelo
**seu** fork em vez da do repositório oficial. Confirme que o CI do seu fork já publicou a tag
correspondente no GHCR antes de atualizar.

## [1.1.0] — 2026-07-30

### Adicionado

- **Atualização pela própria tela.** O dono da instalação vê a versão instalada no rodapé do menu
  e, quando há versão nova, atualiza com um clique — sem abrir terminal. A tela mostra o que muda,
  avisa quanto tempo o sistema fica fora do ar e faz uma cópia de segurança antes.

### Alterado

- **A atualização passa a instalar a última versão publicada, não o topo do código em
  desenvolvimento.** O `update.sh` recusa instalar uma versão anterior à que já está no servidor
  (voltar no tempo continua possível com `--force`) e grava a imagem escolhida no `.env` — assim um
  `docker compose up -d` rodado depois não traz o app de volta para a `latest`.

**⚠️ Requer atenção**

Quem já tem o CRM instalado precisa rodar `bash hostgator-setup-kit/update.sh` **duas vezes** pelo
terminal para ativar o botão. Não é engano: a primeira execução ainda é a do programa antigo, que
baixa o novo mas não sabe ligar o agente da tela; a segunda já roda o programa atualizado e liga.
Depois disso, nunca mais é preciso o terminal.

## [1.0.0] — 2026-07-27

Primeira versão marcada do DeskcommCRM. O projeto vinha sendo desenvolvido publicamente desde abril de 2026 sem tags; esta release estabelece o ponto a partir do qual toda mudança passa a ser versionada e descrita — porque quem hospeda o próprio sistema precisa saber o que muda antes de atualizar.

### Plataforma

- Multi-tenancy com RLS em toda tabela tenant-aware, resolvida por `fn_user_org_ids()`.
- RBAC de 4 papéis (`viewer` < `agent` < `manager` < `admin`), aplicado no servidor.
- Autenticação via Supabase Auth com MFA TOTP obrigatório para administradores.
- Log de auditoria append-only com retenção de 5 anos.
- Onboarding de organização e ciclo completo de convite de membros.

### Atendimento WhatsApp

- Inbox de 3 painéis em tempo real, com múltiplos números via WAHA.
- Mídia servida por Storage com URLs assinadas; transcrição de áudio.
- Proteção anti-banimento: ritmo com variação, teto por número, janela de horário, aquecimento gradual e variação de texto.
- Detecção de pedido de descadastro (STOP) no inbound, com bloqueio automático.

### CRM

- Funil kanban com indexação fracionária de posição.
- Vocabulário configurável por funil — o mesmo núcleo atende e-commerce, clínica, imobiliária, infoproduto e serviços.
- Customer 360, contatos, etiquetas e linha do tempo unificada.
- Integração com Nuvemshop para a vertical de e-commerce.

### Agentes de IA

- Agentes com RAG por organização (pgvector), análise de sentimento e controle de orçamento por organização.
- IA como responsável de primeira classe, sujeita às mesmas regras de governança de um humano.
- Handoff IA→humano auditado, entregando resumo contextual (não a conversa crua).
- Cadeia de 7 verificações antes de cada envio, em ordem fixa: descadastro, LGPD, anti-banimento, variação de texto, promessa determinística, promessa semântica e disclosure. Cada avaliação vira registro durável e auditável — inclusive as que barram o envio.
- Servidor MCP interno.

### Governança de atendimento

- Atribuição e transferência auditadas, fila com posição e roteamento automático.
- Escopo de visualização por papel, aplicado via RLS.
- Métricas por atendente.

### Automação

- Fontes de captação: endpoint público por organização que recebe leads de landing pages, formulários e ferramentas externas.
- Regras QUANDO/SE/ENTÃO, que nascem pausadas até revisão.
- Webhooks de saída com proteção contra SSRF.
- Nenhum trigger de banco faz HTTP: eventos vão para `event_log` e são drenados por rota agendada.

### LGPD

- Exportação e anonimização em cascata via workers, com anonimização preferida sobre exclusão.
- Consentimento auditado.

### Self-host

- `hostgator-setup-kit`: instalação completa (app + WAHA + banco) com um comando.
- `baseline.sql` idempotente e auto-curativo — atualização não quebra clone com dados legados.
- 8 scripts de operação: `install`, `update`, `backup`, `restore`, `reset-password`, `reset-mfa`, `healthcheck` e o assistente de instalação em IA.
- Imagem publicada em `ghcr.io/melgarafael/deskcommcrm` — a VPS não compila nada.

### Qualidade

- CI com dois portões obrigatórios: `verify` (typecheck, lint, testes unitários) e `invariants`.
- O portão `invariants` sobe um Postgres limpo, aplica o `baseline.sql` em modo install e update, e roda **364 testes de invariante** em 56 arquivos — incluindo o teste de isolamento entre organizações, que prova que um usuário de uma organização não enxerga nenhuma linha de outra.
- Suíte end-to-end em Playwright dirigindo o frontend.

### ⚠️ Requer atenção

- **Node 22 é obrigatório para desenvolvimento.** A suíte de invariantes instancia o cliente do Supabase, que exige o `WebSocket` global — nativo apenas a partir do Node 22. Isso não afeta quem apenas hospeda: a VPS roda a imagem pronta.

[Não lançado]: https://github.com/melgarafael/DeskcommCRM/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/melgarafael/DeskcommCRM/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.0.0
