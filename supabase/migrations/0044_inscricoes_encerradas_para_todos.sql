-- ===========================================================================
-- Tabelaço — inscrições encerradas valem para TODOS, inclusive o organizador
--
-- A 0043 travou só o link do time (reg_add_player). O painel do organizador
-- grava direto em `players` e continuava inscrevendo depois do encerramento.
--
-- Agora a trava mora na própria tabela: depois que `registration_closed`
-- (0043) diz que o campeonato encerrou as inscrições, NINGUÉM insere atleta —
-- time, organizador ou master, por qualquer caminho (tela, importação, RPC).
-- Editar quem já está inscrito continua possível para o organizador
-- (correções); para o time, a 0043 já barra a troca de identidade.
--
-- Mesma regra no app: registrationLock (src/lib/matchWindow.ts).
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
  if v_champ is not null and public.registration_closed(v_champ) then
    -- Mesma frase do app (REGISTRATION_CLOSED_MSG).
    raise exception 'As inscrições deste campeonato estão encerradas.';
  end if;
  return new;
end;
$$;

drop trigger if exists players_block_closed_registration on public.players;
create trigger players_block_closed_registration
  before insert on public.players
  for each row execute function public.players_block_closed_registration();
