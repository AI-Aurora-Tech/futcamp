-- ===========================================================================
-- Tabelaço — com as inscrições encerradas, o organizador continua inscrevendo
--
-- Regra: quando as inscrições estão encerradas, SÓ o organizador (dono do
-- campeonato) ou o master inscreve atletas.
--
-- Um gatilho aplicado no banco (`players_block_closed_registration`, vindo de
-- outra versão das migrations) recusava a inscrição de QUALQUER pessoa depois
-- do encerramento, inclusive do organizador, com a frase "As inscrições deste
-- campeonato estão encerradas.". Esta migration mantém o gatilho para o time e
-- libera o organizador e o master.
--
-- Funciona tenha ou não o gatilho sido aplicado: a função é recriada e o
-- gatilho só é religado se já existia.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.players_block_closed_registration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_champ uuid;
begin
  v_champ := coalesce(
    new.championship_id,
    (select championship_id from public.teams where id = new.team_id)
  );

  -- Organizador (dono do campeonato) ou master: inscreve a qualquer momento.
  if v_champ is null or public.owns_championship(v_champ) then
    return new;
  end if;

  -- `registration_closed` só existe se a outra versão foi aplicada.
  if to_regprocedure('public.registration_closed(uuid)') is not null then
    if public.registration_closed(v_champ) then
      raise exception 'As inscrições deste campeonato estão encerradas. Só o organizador pode inscrever atletas agora.';
    end if;
  end if;

  return new;
end;
$$;

-- `assert_registration_open` (usada pelas RPCs do link do time) também libera
-- o organizador — vale qualquer que seja a versão que está no banco.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.assert_registration_open(uuid)'::regprocedure) into v_def;
  if v_def is not null and position('owns_championship' in v_def) = 0 then
    -- Versão sem a liberação do organizador: envolve a original.
    execute 'alter function public.assert_registration_open(uuid) rename to assert_registration_open_time';
    execute $f$
      create function public.assert_registration_open(p_team uuid)
      returns void
      language plpgsql
      security definer
      stable
      set search_path = public
      as $b$
      declare v_champ uuid;
      begin
        select championship_id into v_champ from public.teams where id = p_team;
        if v_champ is not null and public.owns_championship(v_champ) then
          return;
        end if;
        perform public.assert_registration_open_time(p_team);
      end;
      $b$
    $f$;
    execute 'revoke all on function public.assert_registration_open(uuid) from public, anon, authenticated';
    execute 'revoke all on function public.assert_registration_open_time(uuid) from public, anon, authenticated';
  end if;
exception when undefined_function then
  null; -- a função não existe neste banco: nada a liberar
end $$;
