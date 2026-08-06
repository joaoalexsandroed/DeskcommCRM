-- 0111 — Backfill de channel_sessions.status='REMOVED' + fecha a constraint
--
-- *(branch `vps-orion`, não faz parte do upstream)* Forward-fix da fusão com o
-- upstream: a 0101 original desta branch (renomeada 0094→0101, depois
-- descartada no rebase — ver PATCH-ORION.md) adicionava `'REMOVED'` ao CHECK
-- de `channel_sessions.status` como soft-delete. O upstream resolveu o mesmo
-- problema de forma mais completa via `archived_at` (migrations 0106/0107,
-- delete-vs-archive), e o rebase adotou a versão dele — mas o CHECK antigo já
-- tinha sido aplicado numa instalação real (esta VPS) e linhas já existiam com
-- `status='REMOVED'`. Sem este backfill, essas linhas ficam com `archived_at`
-- nulo — a tela nova filtra por `archived_at`, não por `status` — e um canal
-- que o operador já tinha excluído REAPARECERIA na Central de Conexões.
--
-- Mesma regra do `loadDeletionImpact` da rota DELETE: canal sem NADA
-- pendurado (conversations/messages/agent_versions/routers/knobs/traces) é
-- apagado de verdade; canal com histórico é arquivado, preservando tudo.
-- Idempotente: reaplicar não encontra mais nenhuma linha 'REMOVED' (o DELETE
-- da linha ou o UPDATE do status já resolveu na primeira passada).

do $$
declare
  v_id uuid;
  v_tem_algo boolean;
begin
  for v_id in select id from public.channel_sessions where status = 'REMOVED' loop
    select exists (
      select 1 from public.conversations where channel_session_id = v_id
      union all select 1 from public.messages where channel_session_id = v_id
      union all select 1 from public.ai_agent_versions where channel_session_id = v_id
      union all select 1 from public.ai_routers where channel_session_id = v_id
      union all select 1 from public.channel_knobs where channel_session_id = v_id
      union all select 1 from public.before_send_traces where channel_session_id = v_id
    ) into v_tem_algo;

    if v_tem_algo then
      update public.channel_sessions
         set archived_at = now(),
             status = 'STOPPED',
             last_status_change_at = now()
       where id = v_id;
    else
      delete from public.channel_sessions where id = v_id;
    end if;
  end loop;
end $$;

alter table public.channel_sessions
  drop constraint if exists channel_sessions_status_check;
alter table public.channel_sessions
  add constraint channel_sessions_status_check check (
    status = any (array['STARTING', 'SCAN_QR_CODE', 'WORKING', 'STOPPED', 'FAILED']::text[])
  );
