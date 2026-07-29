# Patch ORION — integração com Traefik/Docker Swarm já existentes

> Branch `vps-orion`. Existe só nesta VPS (fork `joaoalexsandroed/DeskcommCRM`),
> não faz parte do projeto upstream (`melgarafael/DeskcommCRM`).

## Por quê

Esta VPS já roda um Docker Swarm com Traefik como proxy único, ocupando as
portas 80/443 (setup tipo "SetupOrion": n8n, WordPress, Baserow, etc., todos
roteados pelo mesmo Traefik na rede overlay `JANet`). O `docker-compose.prod.yml`
original do DeskcommCRM sobe seu próprio `caddy` nas portas 80/443 — conflito
direto. Este patch remove o `caddy` e conecta o `app` na rede `JANet` já
existente, com labels do Traefik equivalentes ao que as outras apps desta VPS
já usam.

## O que mudou (tudo neste branch, nada no upstream)

- **`docker-compose.prod.yml`**
  - Serviço `caddy` removido (e os volumes `caddy-data`/`caddy-config`).
  - `app` ganhou a rede externa `janet` (→ `JANet`) e labels `deploy.labels` de
    roteamento Traefik (`Host(${DOMAIN})`, TLS via `letsencryptresolver` — o
    mesmo resolver que as outras apps da VPS já usam). Inclui uma rota extra
    de alta prioridade pra `/api/internal/agents/run*` com timeout maior (via
    `serversTransport`), equivalente ao `read_timeout`/`write_timeout=320s`
    que o `Caddyfile` original tinha pra essa rota.
  - `worker` trocou `build:` isolado por também ter `image:
    ${WORKER_IMAGE:-deskcommcrm-worker:local}` — Docker Swarm **não builda**
    (`docker stack deploy` ignora `build:`), então a imagem precisa existir
    localmente antes do deploy (o `stack_up()` do kit já faz isso).
  - Todo serviço ganhou `deploy.restart_policy` (Swarm ignora o `restart:` de
    compose clássico).
  - Nova rede `janet: { external: true, name: JANet }` — precisa já existir no
    host (é criada pelo Traefik/SetupOrion, não por este stack).
- **`hostgator-setup-kit/_common.sh`** — novos helpers:
  - `is_orion_vps()` — detecta a variante checando se a rede `JANet` existe.
  - `stack_up()` — builda a imagem do worker + `docker stack deploy` quando
    `is_orion_vps`, senão cai no `docker compose pull && up -d` de sempre.
  - `swarm_container` / `app_exec` — acham/rodam comando no container do app,
    nos dois modos.
- **`install.sh` / `update.sh` / `healthcheck.sh` / `backup.sh` / `restore.sh`**
  — trocaram as chamadas diretas a `docker compose ... up/exec/ps/restart`
  pelos helpers acima. Mesmos scripts funcionam em VPS com ou sem
  Traefik/Swarm prévio — detectam sozinhos qual caminho seguir.
- **`ACME_EMAIL`** vira opcional no instalador nesta VPS (quem emite o SSL
  agora é o Traefik já existente, com o e-mail dele próprio).

## Como instalar (primeira vez)

```bash
cd /root/deskcommcrm
bash hostgator-setup-kit/install.sh
```

Mesmo fluxo de sempre (pede domínio, chaves do Supabase, Anthropic, etc.) — só
que ao chegar no passo de subir a stack, detecta a rede `JANet` e usa
`docker stack deploy` sozinho, sem tocar em nada que já roda nesta VPS
(Traefik, n8n, WordPress, ...).

## Como atualizar (buscar novidades do projeto)

Duas coisas por trás: **código do projeto** (upstream) e **este patch**
(as poucas mudanças acima). São atualizadas em momentos diferentes:

**1. Trazer o código novo do projeto pra dentro do patch:**

```bash
cd /root/deskcommcrm
git checkout main
git pull --ff-only origin main      # main nunca tem commit seu — sempre limpo
git checkout vps-orion
git rebase main                     # reaplica o patch ORION em cima do código novo
```

Se o rebase parar em conflito, é quase sempre nos mesmos poucos trechos que
este patch toca (o bloco do `app`/`worker`/`caddy` no compose, ou as poucas
linhas trocadas nos scripts do kit) — o Git aponta exatamente a linha, não
precisa comparar o arquivo inteiro.

**2. Aplicar a atualização na stack rodando (banco + imagem):**

```bash
bash hostgator-setup-kit/update.sh
```

Faz backup, atualiza o schema do Supabase e sobe a imagem nova — já detecta
sozinho que esta VPS usa Swarm e rebuilda o `worker` antes de redeployar.

**3. Publicar o patch atualizado no seu fork** (opcional, mas recomendado —
mantém `github.com/joaoalexsandroed/DeskcommCRM` como backup do patch):

```bash
git push origin vps-orion --force-with-lease
```

(`--force-with-lease` porque o rebase reescreve o histórico da branch; é seguro
aqui porque `vps-orion` é sua, ninguém mais commita nela.)

## Comandos do dia a dia nesta VPS

```bash
docker service logs -f deskcommcrm_app        # logs do app
docker service update --force deskcommcrm_app # reiniciar o app
docker stack ps deskcommcrm --no-trunc        # status de todos os serviços
bash hostgator-setup-kit/healthcheck.sh       # diagnóstico completo
bash hostgator-setup-kit/backup.sh            # backup manual
```
