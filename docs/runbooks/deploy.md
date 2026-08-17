# Runbook — Deploy em produção (VPS)

O caminho normal de deploy **não constrói nada na VPS**: o CI publica a imagem no
GHCR e a VPS só puxa. Construir localmente é exceção de emergência, e tem custo —
está documentado no fim.

---

## 1. O comando

```bash
cd /var/www/crm
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

### Os DOIS `-f` são obrigatórios. Sempre.

Esta é a pegadinha que já derrubou o site inteiro em produção (2026-08-05).

A VPS (Hostinger) vem com um **Traefik próprio** ocupando as portas 80/443.
`docker-compose.traefik.yml` é o ÚNICO lugar que:

- coloca no contêiner `app` as labels de roteamento
  (`traefik.http.routers.deskcomm.rule=Host(...)`);
- associa o contêiner à rede que o Traefik enxerga (`TRAEFIK_DOCKER_NETWORK`);
- desliga o `caddy` do compose base por profile (senão dois processos brigam
  pela mesma porta).

Rodar só com `-f docker-compose.prod.yml` recria o contêiner **sem labels
nenhuma**. O Traefik deixa de enxergá-lo e o domínio inteiro passa a responder
`404 page not found` — não é erro do Next, é o 404 genérico do Traefik. A app
está no ar, saudável, e inalcançável.

---

## 2. Verificação pós-deploy (não pule)

`healthy` no `docker ps` **não prova que o site está acessível** — o healthcheck
é um probe TCP interno e passa mesmo com o roteamento quebrado. Verifique as
duas coisas:

```bash
# 1) as labels do Traefik existem?
#    O nome do contêiner é <pasta-do-projeto>-app-1, então pergunte ao compose
#    em vez de chutar. Aqui um -f só basta: o `ps -q` resolve pelo nome do
#    projeto + serviço, não pelo conteúdo do arquivo (medido: com um -f ou com
#    os dois, devolve o MESMO contêiner). Quem precisa dos dois é o `up -d`.
docker inspect "$(docker compose -f docker-compose.prod.yml ps -q app)" \
  --format '{{.Config.Labels}}' | grep -o 'traefik.enable:[^ ]*'
# esperado: traefik.enable:true   (vazio = roteamento quebrado)

# 2) o domínio responde?
curl -s -o /dev/null -w "%{http_code}\n" https://<DOMAIN>/
# esperado: 307 (redireciona pro login)
# 404      = labels perdidas, refaça o deploy com os dois -f
```

---

## 3. Fluxo completo (do código à produção)

```
commit → push → PR → merge na main → CI publica imagem → VPS puxa
```

1. **Commit + push** numa branch de feature. Trabalho que fica só no disco da
   VPS não existe: o CI não o vê, some se a VPS for reconstruída, e é invisível
   pra qualquer outra pessoa.
2. **PR e merge na `main`.** `publish-image.yml` dispara em push na `main` (ou
   tag `v*`) e publica `ghcr.io/<repo>:latest`. O build pesado (~6min) roda nos
   runners do GitHub, nunca na VPS do usuário.
3. **Deploy na VPS** com o comando da seção 1. Como o `.env` tem
   `APP_PULL_POLICY='always'`, o `up -d` já puxa a imagem nova sozinho.

---

## 4. Exceção: imagem construída na VPS

Só quando é preciso validar algo em produção **antes** de a imagem oficial
existir (ex.: CI ainda rodando e um bug bloqueando o usuário).

```bash
APP_IMAGE=deskcomm-app:local docker compose \
  -f docker-compose.prod.yml -f docker-compose.build.yml --env-file .env build app

APP_IMAGE=deskcomm-app:local APP_PULL_POLICY=never docker compose \
  -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app
```

**Isto é dívida, não um caminho paralelo.** A imagem existe só no disco daquela
VPS: não está no registry, não está no git, e qualquer `docker compose up -d`
sem `APP_PULL_POLICY=never` a substitui pela do GHCR — silenciosamente, sem erro
nenhum, revertendo o que você acabou de subir.

Requisitos: >= 4 GB de RAM **ou** swap (medido: ~4min num VPS de 3.8 GB com 4 GB
de swap). Ao terminar, feche o ciclo — merge na `main` e volte a VPS pra imagem
oficial.

---

## 5. Templates de e-mail do Supabase Auth (não pule em projeto novo)

**Sintoma:** link de "Redefinir senha" (ou de confirmação de cadastro) sempre
cai em "Link inválido ou expirado" na `/login`, mesmo clicando direto no
e-mail, na primeira vez, sem demora (2026-08-09).

**Causa raiz:** `supabase/templates/recovery.html` (e `confirmation.html`) só
são aplicados automaticamente em instância **local** (`supabase start`) ou se
alguém rodar `supabase config push` pra sincronizar `config.toml` com o
projeto Cloud. Um projeto Supabase Cloud novo (`*.supabase.co`) nasce com o
template padrão do Supabase, que usa `{{ .ConfirmationURL }}` — um link pro
próprio endpoint do GoTrue (`/auth/v1/verify?token=pkce_...`), formato PKCE.
`app/auth/confirm/route.ts` só sabe ler `token_hash` + `type` da query string
(o formato do template customizado, com `{{ .TokenHash }}`). Os dois formatos
são incompatíveis — o handler recebe `token_hash=null` e redireciona pra
`link_invalido` mesmo com um token do GoTrue válido.

**Fix, uma vez por projeto Supabase Cloud (dashboard, não tem como automatizar
via CI hoje):**

1. **Authentication → Email Templates → Reset Password** (e **Confirm signup**)
   — cole o conteúdo de [`supabase/templates/recovery.html`](../../supabase/templates/recovery.html)
   (e `confirmation.html`) no lugar do template padrão.
2. **Authentication → URL Configuration → Redirect URLs** — confirme que o
   domínio de produção + `/auth/confirm` está na allowlist
   (ex.: `https://SEU-DOMINIO/auth/confirm`), senão `{{ .RedirectTo }}` sai
   vazio/errado mesmo com o template certo.
3. Links **já enviados antes do fix continuam quebrados** — peça um link novo
   pra testar.

**Prevenção:** todo setup de projeto Supabase Cloud novo (produção, staging,
ou clone de self-hoster que optou por Cloud em vez de GoTrue self-host) deve
passar por este passo antes de considerar o auth "pronto". Adicionar ao
checklist de onboarding de projeto novo se/quando ele existir.
