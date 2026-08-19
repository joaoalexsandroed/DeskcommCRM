# Atribuição de campanhas Meta Ads no DeskcommCRM

## Contexto

O usuário quer saber de qual campanha do Meta Ads (Facebook/Instagram) cada lead
veio, com essa informação visível nos "campos do cliente" (contato/lead) dentro
do CRM. Confirmou que precisa cobrir os 3 formatos de anúncio que o Meta Ads
oferece:

- **(A) Landing page com formulário** — clique no anúncio leva a uma página
  externa com form.
- **(B) Lead Ads nativo** — formulário preenchido dentro do próprio
  Facebook/Instagram, sem sair do app.
- **(C) Click-to-WhatsApp (CTWA)** — clique abre uma conversa de WhatsApp.

Esta instalação usa **WAHA** (WhatsApp self-hosted via QR code) — confirmado
pela ausência de qualquer `META_*` no `.env`. Isso importa porque a API
**oficial** do WhatsApp (Cloud API) manda um objeto `referral` limpo e
estruturado quando uma conversa nasce de um clique em anúncio, mas essa
instalação não usa a Cloud API — então esse caminho limpo não está disponível
aqui sem migrar de canal (fora de escopo). Para CTWA via WAHA, o usuário pediu
explicitamente para **investigar antes de implementar**, já que não há
confirmação de que o dado de atribuição do anúncio chega no payload do WAHA.

O objetivo desta rodada é só **avaliar o plano** — nenhuma implementação
começa agora.

## O que já existe (reaproveitar, não reimplementar)

- **Ingestão genérica de formulário**: `lib/webhooks/inbound.ts`
  (`mapInboundPayload`) já extrai qualquer chave `utm_*` do payload de um
  webhook externo para `source_metadata` (chaves fora desse prefixo caem em
  `custom_fields`). Roteado por `app/api/v1/webhooks/in/[token]/route.ts` +
  tabela `webhook_sources` (URL própria por fonte, criada pela UI em
  `app/app/webhooks/_components/`). Testado ponta a ponta em
  `tests/invariants/webhooks-inbound.test.ts:313-352`.
- **Motor de automação genérico por path**: `lib/automation/conditions.ts`
  (`resolveField`) navega qualquer `lead.source_metadata.<chave>` sem precisar
  de mudança de código — `buildContext()` em `lib/automation/engine.ts`
  já expõe a linha inteira do lead/contato. `RuleEditor.tsx` já cura
  `lead.source_metadata.utm_source` como condição na UI (com um modo
  "avançado" de path livre para qualquer outra chave).
- **Schema**: `contacts.source_metadata jsonb` e `crm_leads.source_metadata
  jsonb` já existem (default `{}`), sem coluna dedicada de campanha em
  nenhuma tabela — é o "balde" certo para o novo dado, mesmo padrão que
  Nuvemshop já usa para gravar `order_id`. **`crm_leads.custom_fields`**
  existe com schema declarativo (`pipeline.settings.fields`, UI em
  `components/contacts/CustomFieldsEditor.tsx`) — **`contacts` não tem
  `custom_fields`**, só `source_metadata`.
- **`source_metadata` já vem pela API** (`app/api/v1/contacts/_handler.ts`
  `SELECT_COLS` já inclui a coluna) — falta só **exibi-lo em alguma tela**,
  hoje é write-only.
- **Padrão de integração OAuth de terceiro**: Nuvemshop (`lib/nuvemshop/`,
  `tenant_integrations` com token cifrado via `fn_encrypt_oauth`, webhook por
  evento autenticado por HMAC do segredo do tenant, materialização
  assíncrona via `emit_event` → `event_log` → cron de drain) — é o template a
  clonar para qualquer integração nova que "puxa dado de plataforma
  terceira", incluindo Meta Ads.
- **`tenant_integrations.webhook_path_token`** já existe no schema
  (`supabase/baseline.sql:1836`) — dá roteamento por-org pronto para uma
  rota de webhook nova, sem migration extra para isso especificamente.
- Hub de integrações já existe: `app/app/integrations/nuvemshop/` +
  `app/api/v1/integrations/nuvemshop/callback/route.ts` — path exato
  confirmado, é o molde de onde a tela/rota do Meta Ads nasceria.

## Plano faseado

### Fase 0 — Descoberta CTWA (pré-requisito do formato C)

Decidir, com o menor gasto possível, se o WAHA expõe alguma atribuição de
anúncio antes de escrever qualquer código.

1. Rodar 1 campanha Meta Ads de teste, objetivo "Mensagens" (WhatsApp),
   orçamento mínimo (R$5-10/dia), só o suficiente para gerar 1-2 cliques
   reais de um celular de teste (não usar o preview do Ads Manager — não
   carrega o contexto de referral).
2. Clicar no anúncio de um celular real e mandar mensagem para o número WAHA.
3. Localizar o payload cru em `webhook_events_log` (a tabela já grava tudo):
   ```sql
   select id, received_at, payload_parsed
   from public.webhook_events_log
   where provider = 'waha'
     and received_at > now() - interval '2 hours'
   order by received_at desc
   limit 20;
   ```
4. Procurar no JSON, em ordem de probabilidade: `_data.message.*.contextInfo`
   (`conversionData`, `conversionSource`, `ctwaClid`, `externalAdReplyInfo` —
   mecanismo do próprio protocolo Baileys/NOWEB); `_data.key`; qualquer chave
   em `_data` contendo `"conversion"`, `"ctwa"`, `"ad"`, `"referral"`,
   `"campaign"`, `"biz"` (case-insensitive); e se `body` porventura carrega
   um texto pré-preenchido configurável por anúncio.
5. **Comparação de controle**: gerar também um payload de mensagem orgânica
   (sem vir de anúncio) e comparar chave-a-chave — só assim confirma que um
   campo extra foi *causado* pelo clique, não ruído normal do NOWEB.
6. **Decisão**: prosseguir com C só se algo diferenciar os dois payloads com
   um identificador estável; documentar o resultado (payload sanitizado) em
   `docs/research/ctwa-waha-payload.md` para não repetir a investigação numa
   sessão futura, mesmo que a resposta seja "não dá".

Não toca código de produção.

### Fase 1 — Visibilidade de `source_metadata` (pré-requisito de tudo)

Sem isto, qualquer dado que as fases seguintes gravarem continua invisível
para quem usa o CRM.

- Seção genérica **"Origem"**, não um formulário estruturado — `source_metadata`
  é jsonb livre por desenho (webhooks genéricos, Nuvemshop, UTM, e Meta Ads
  no futuro gravam ali com chaves diferentes); um componente por integração
  divergiria rápido. Dicionário de rótulos amigáveis (`utm_source`→"Origem",
  `utm_campaign`→"Campanha", `fbclid`→"Clique do Facebook") com fallback de
  formatação (`snake_case`→"Snake Case") para chave desconhecida.
- **Ficha do contato** (`app/app/contacts/[id]/_client.tsx`, `<dl>` de visão
  geral ~linha 119-169, já mostra `contact.source` isolado): adiciona bloco
  condicional logo abaixo.
- **Dossiê do lead** (`components/kanban/LeadDossier.tsx`): nova seção perto
  do cabeçalho (é a pergunta "de onde veio isso" que quem abre o card
  responde primeiro).
- Componente compartilhado novo (evita duplicar lógica entre contato e
  lead): `components/shared/OrigemLead.tsx` + dicionário em
  `lib/source-metadata/labels.ts`.
- Expandir `LEAD_FIELDS` em `RuleEditor.tsx` (~linha 57-62) com mais
  condições curadas (`utm_campaign`, `utm_medium`, `fbclid` — a Fase 2 passa
  a popular esses).
- Teste e2e novo provando a tela (`tests/e2e/contact-source-metadata.spec.ts`
  ou similar) — doutrina de QA Visual do projeto exige prova pela tela, não
  só unit.

Nenhuma migration — coluna já existe nas duas tabelas.

### Fase 2 — Landing page / UTM estendido (formato A)

- Estender `mapInboundPayload` (`lib/webhooks/inbound.ts:79`) com uma lista
  fixa de nomes de parâmetro de atribuição de anúncio, além do prefixo
  `utm_*` já tratado: `fbclid` (gerado automaticamente pelo Facebook em
  qualquer clique de link externo) e um conjunto pequeno e defensável de
  aliases comuns dos parâmetros dinâmicos que o Meta Ads permite anexar na
  URL (`campaign_id`, `adset_id`, `ad_id`, `ad_name`, `placement`) — só
  quando o anunciante os nomear exatamente assim (comportamento inofensivo
  se não bater: cai em `custom_fields` como hoje, não perde dado).
  A maioria dos anunciantes já usa `utm_*` para isso, então o ganho real
  aqui é cobrir quem usa os parâmetros fora de um wrapper `utm_`.
- Lista fixa (não configurável via `field_map`) — é vocabulário estável e
  público definido pela própria Meta, não algo que o usuário final
  precisaria customizar por cliente; tornar configurável seria
  over-engineering para este caso.
- Casos novos em `lib/webhooks/inbound.test.ts` e
  `tests/invariants/webhooks-inbound.test.ts` (querystring típica de landing
  page de Meta Ads).
- Depende da Fase 1 já estar pronta (senão o dado gravado continua
  invisível).

Nenhuma migration.

### Fase 2.5 — Threading do CTWA (só se a Fase 0 confirmar viabilidade)

Se a Fase 0 achar um campo utilizável:

- Estender `DadosDoNascimento` (`lib/leads/nascimento-do-lead.ts:65-72`, hoje
  fechado com 4 campos) para carregar `source_metadata`.
- Plugar a extração na cadeia `lib/waha/ingest.ts` (`handleInbound`) →
  `lib/channels/pos-entrada.ts` → `garantirLeadDaConversa` — hoje o INSERT em
  `crm_leads` (linhas ~185-196) não passa `source_metadata` nenhum, fica no
  default `{}`.
- `fn_upsert_wa_contact` já só grava `source_metadata` do contato no
  INSERT (comportamento "primeiro toque" — favorece atribuição correta,
  não precisa mudar).

### Fase 3 — Meta Lead Ads nativo (formato B)

A fase mais cara — única com integração OAuth nova completa.

- **Rota nova, não estender o webhook de WhatsApp Cloud API.** Lead Ads é
  domínio de integração de marketing (`tenant_integrations`), não de canal
  de conversa (`channel_sessions`) — misturar violaria a separação que o
  projeto já reforça (`lint-channels`). Nova rota:
  `app/api/v1/webhooks/meta-ads/[token]/route.ts`, resolvendo o tenant via
  `tenant_integrations.webhook_path_token` (coluna já existe). Cada org
  conecta o **próprio** Facebook App dela (mesmo modelo BYOK do WAHA), então
  não há conflito de "1 callback por app" entre orgs diferentes.
- **Fluxo OAuth** (clonar `lib/nuvemshop/oauth.ts` + `config.ts`):
  `lib/meta-ads/config.ts` (env opcional, build nunca quebra sem ela),
  `lib/meta-ads/oauth.ts` (Facebook Login for Business, escopos
  `leads_retrieval`/`pages_show_list`/`pages_manage_metadata`/`pages_manage_ads`
  — confirmar nomes exatos na implementação, a Meta muda com frequência),
  troca por **token de página** de longa duração (não o de usuário).
  Callback: `app/api/v1/integrations/meta-ads/callback/route.ts` (path
  confirmado contra o padrão real do Nuvemshop). Após conectar, assinar o
  app à página via Graph API (`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`).
- **Webhook `leadgen`**: `object: "page"`, `field: "leadgen"`, payload só
  com IDs (`leadgen_id`, `page_id`, `form_id`, `ad_id`, `campaign_id`) — as
  respostas do formulário **não** vêm no webhook, precisam de uma chamada
  separada à Graph API. Grava cru em `webhook_events_log` (`provider:
  "meta_ads"`), idempotência por `leadgen_id`, emite evento via `emit_event`
  e responde rápido — nunca busca a Graph API dentro do request.
- **Worker** (`workers/meta-ads-leadgen-worker.ts`, consumido pelo cron
  genérico de drain do `event_log`, mesmo mecanismo que já existe — não
  criar infra de worker nova): descriptografa o token de página, chama
  `GET /{leadgen_id}?fields=field_data,ad_id,ad_name,campaign_id,campaign_name,form_id`,
  mapeia `field_data` para `crm_leads.custom_fields` (perguntas do
  formulário) e `source_metadata` (ad_id/campaign_id/form_id — o que a Fase
  1 já sabe exibir). Reaproveita `normalizePhoneBR` de `lib/webhooks/inbound.ts`
  para o telefone, não duplica.
- **Mapeamento pergunta→campo**: tabela nova pequena, tenant-scoped —
  ```sql
  create table meta_ads_form_field_map (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references organizations(id) on delete cascade,
    tenant_integration_id uuid not null references tenant_integrations(id) on delete cascade,
    form_id text not null,
    field_map jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (organization_id, tenant_integration_id, form_id)
  );
  ```
  Sem mapeamento configurado: perguntas `full_name`/`email`/`phone_number`
  (nomes padrão da Meta) vão pros campos nativos; o resto cai em
  `custom_fields` com a chave crua — mesma degradação segura que
  `mapInboundPayload` já usa.
- **Data Deletion Callback** (obrigatório para qualquer app Meta com Login):
  `app/api/v1/webhooks/meta-ads/data-deletion/route.ts`, decodifica
  `signed_request`, dispara o fluxo de LGPD/anonimização já existente
  (reaproveitar, não recriar).
- **Env vars**: `.env.example` ganha `META_ADS_ENABLED`, `META_ADS_APP_ID`,
  `META_ADS_APP_SECRET` (padrão `NUVEMSHOP_*`); `lib/env.ts` opcional.
- **Migrations necessárias**:
  1. `tenant_integrations_provider_check` — adicionar `'meta_ads'` ao array
     (`supabase/baseline.sql:1846`).
  2. `webhook_events_log_provider_check` — adicionar `'meta_ads'` ao array
     (`supabase/baseline.sql:1909`) — o baseline já tem precedente de alterar
     esse CHECK de forma idempotente no apêndice (linhas ~13524-13526).
  3. `create table meta_ads_form_field_map` com RLS
     (`tenant_isolation_meta_ads_form_field_map_all`).
  4. Arquivo versionado em `supabase/migrations/` + apêndice idempotente em
     `supabase/baseline.sql` + linha no `MANIFEST.md` — doutrina não
     negociável do projeto para qualquer mudança de schema.
- **Tela de conexão** (`app/app/integrations/meta-ads/page.tsx` +
  `_components/`, mesmo molde do Nuvemshop) precisa de entrada em
  `lib/navigation/registry.ts` — senão o teste de completude de navegação do
  projeto reprova ("tela nova tem porta").

## Riscos e trade-offs

| Fase | Risco | Trade-off |
|---|---|---|
| 0 | Pode não haver nada útil em `_data` do WAHA. Custo baixo (R$5-10 + ~1h manual). | Só investigação, sem custo de engenharia. |
| 1 | Baixo risco técnico; risco de UX se o dicionário de rótulos ficar incompleto — mitigado com fallback de formatação. | Puro ganho — sem isto nada mais faz sentido visível. |
| 2 | Lista fixa pode não cobrir a nomenclatura que um anunciante específico escolheu — sem solução geral sem tornar configurável (decidido que não vale agora). | Reaproveita quase 100% do código existente; menor custo depois da Fase 1. |
| 3 | **App Review da Meta para `leads_retrieval`** pode levar semanas em produção (vídeo de demonstração, justificativa de caso de uso) — risco de prazo, não de engenharia. Cada self-hoster também precisa criar e manter a própria Facebook App. | Único formato com atribuição 100% garantida e estruturada, sem depender de UTM bem configurado nem de incerteza de payload como em C. |

## Sequenciamento recomendado

Fase 0 (barata, desbloqueia decisão sobre C) → Fase 1 (pré-requisito de
tudo, barata) → Fase 2 (barata, ganho imediato em A) → Fase 2.5 (só se Fase 0
confirmar algo em C) → Fase 3 por último (mais cara, maior prazo por causa
de App Review).

## Verificação (quando for implementar)

- Fase 0: sem código — só query SQL e inspeção manual, documentar achado.
- Fase 1: `pnpm typecheck && pnpm lint && pnpm test:unit`; prova pela tela
  via Playwright (contato com `source_metadata` populado mostrando a seção
  "Origem"; dossiê do lead idem) — doutrina de QA Visual do projeto.
- Fase 2: `pnpm test:unit` cobrindo os casos novos de `inbound.test.ts`;
  `pnpm test:db` para o invariante ponta a ponta de webhooks.
- Fase 3: `pnpm test:db` (RLS da tabela nova + os dois CHECK alterados);
  fluxo OAuth provado pela tela com uma Facebook App de teste real (sandbox);
  `pnpm test:shell` se algo tocar o kit de instalação.

## Arquivos críticos citados neste plano

- `lib/webhooks/inbound.ts` — ponto central da Fase 2
- `app/app/contacts/[id]/_client.tsx`, `components/kanban/LeadDossier.tsx` —
  pontos centrais da Fase 1
- `app/api/v1/webhooks/nuvemshop/[event]/route.ts`,
  `lib/nuvemshop/oauth.ts`, `lib/nuvemshop/config.ts` — templates a clonar
  na Fase 3
- `supabase/baseline.sql` (linhas 1846 e 1909) — os dois CHECK constraints
  que a Fase 3 precisa migrar
- `lib/leads/nascimento-do-lead.ts` (`DadosDoNascimento`, linha 65) — ponto
  de extensão da Fase 2.5
- `lib/automation/conditions.ts`, `app/app/webhooks/_components/RuleEditor.tsx`
  — motor de automação já pronto para condicionar em qualquer campo novo de
  `source_metadata`, sem mudança de código no motor em si
