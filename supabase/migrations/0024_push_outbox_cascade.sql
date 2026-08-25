-- ===========================================================================
-- Tabelaço — corrige a exclusão de campeonato com notificações ligadas
--
-- Sintoma:
--   insert or update on table "push_outbox" violates foreign key constraint
--   "push_outbox_championship_id_fkey"
--
-- Causa: excluir um campeonato apaga em cascata times e atletas, e o gatilho
-- `push_on_team_change` (migration 0018) dispara em cada atleta removido,
-- tentando enfileirar "o time removeu Fulano". Só que o campeonato já saiu na
-- mesma transação — e a fila aponta para ele. O banco recusa, e a exclusão
-- inteira falha.
--
-- Correção: antes de enfileirar, conferir se o campeonato ainda existe. Numa
-- exclusão em cascata ele já não existe, e o aviso é justamente o que ninguém
-- quer receber ("o time removeu Fulano" de um campeonato que acabou de ser
-- apagado). Numa remoção normal de atleta o campeonato está lá, e o aviso
-- segue igual.
-- ===========================================================================

create or replace function public.push_on_team_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_champ uuid;
  v_team  uuid;
  v_name  text;
  v_what  text;
  v_key   text;
  v_rows  int;
begin
  if tg_table_name = 'players' then
    v_champ := coalesce(new.championship_id, old.championship_id);
    v_team  := coalesce(new.team_id, old.team_id);
    v_what  := case tg_op
                 when 'INSERT' then format('inscreveu %s', new.name)
                 when 'UPDATE' then format('atualizou %s', new.name)
                 else format('removeu %s', old.name)
               end;
  else -- teams
    v_champ := coalesce(new.championship_id, old.championship_id);
    v_team  := coalesce(new.id, old.id);
    v_what  := 'atualizou os dados do time';
  end if;

  -- O campeonato ainda existe? Numa exclusão em cascata, não — e insistir na
  -- fila quebraria a exclusão inteira por violação de chave estrangeira.
  if v_champ is null
     or not exists (select 1 from public.championships where id = v_champ) then
    return coalesce(new, old);
  end if;

  select name into v_name from public.teams where id = v_team;
  v_key := format('team-change:%s', v_team);

  -- Junta com um aviso ainda não enviado do mesmo time.
  update public.push_outbox
     set body = format('%s e mais alterações no elenco', coalesce(v_name, 'O time')),
         created_at = now()
   where championship_id = v_champ
     and audience = 'organizer'
     and dedupe_key = v_key
     and sent_at is null;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then return coalesce(new, old); end if;

  insert into public.push_outbox
    (championship_id, audience, dedupe_key, title, body, url)
  values (
    v_champ,
    'organizer',
    v_key,
    '🛡️ Alteração de um time',
    format('%s %s', coalesce(v_name, 'Um time'), v_what),
    format('#/c/%s', v_champ)
  );

  return coalesce(new, old);
end;
$$;

-- O aviso de gol (`push_on_goal`) não precisa da mesma proteção: ele só
-- dispara em INSERT de `match_events`, e cascata de exclusão nunca insere.
