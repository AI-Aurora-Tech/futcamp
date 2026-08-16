-- ===========================================================================
-- Tabelaço — campeão em cartaz depois do encerramento
--
-- O campeonato encerrado sai da vitrine pública e, com ele, some o campeão.
-- Agora o encerramento é carimbado em championships.finished_at e o app
-- mantém esses campeonatos na vitrine por 10 dias (PUBLIC_FINISHED_DAYS).
--
-- O carimbo é feito por gatilho: vale para qualquer caminho de escrita
-- (app, painel do Supabase, RPC).
-- ===========================================================================

alter table public.championships add column if not exists finished_at timestamptz;

-- ---------------------------------------------------------------------------
-- Carimba na troca de status; limpa se o campeonato for reaberto.
-- ---------------------------------------------------------------------------
create or replace function public.stamp_championship_finished_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'finished' then
    if tg_op = 'INSERT' or old.status is distinct from 'finished' then
      new.finished_at := coalesce(new.finished_at, now());
    end if;
  else
    new.finished_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists championships_finished_at on public.championships;
create trigger championships_finished_at
before insert or update on public.championships
for each row execute function public.stamp_championship_finished_at();

-- Campeonatos já encerrados antes desta migration não têm a data: recebem
-- agora, ou seja, ficam em cartaz pelos próximos 10 dias.
update public.championships
   set finished_at = now()
 where status = 'finished' and finished_at is null;

-- A vitrine pública consulta por status + data.
create index if not exists championships_finished_at_idx
  on public.championships (status, finished_at desc);
