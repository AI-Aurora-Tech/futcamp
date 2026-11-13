-- ===========================================================================
-- 0063 — Time eliminado: todo jogo novo dele já nasce com W.O.
-- ===========================================================================
-- Ao eliminar um time, o app dá W.O. (3 × 0 para o adversário) nos jogos dele
-- ainda não encerrados e cria os que faltavam na fase. Os jogos já disputados
-- continuam valendo.
--
-- Faltava o que vem DEPOIS: um jogo criado mais tarde com o time eliminado
-- (gerar a tabela de novo, adicionar jogo à mão, próxima fase de grupos, vaga
-- do mata-mata preenchida) nascia como jogo normal. Agora o gatilho aplica o
-- W.O. na hora — por qualquer caminho, inclusive as funções do banco que
-- montam fases.
--
-- Eliminado = perdeu um jogo da MESMA categoria marcado com
-- "W.O. — equipe eliminada" por 0 × 3 (mesma regra de `timesEliminados` no
-- app, src/lib/eliminacao.ts).
--
-- Só age ao CRIAR o jogo ou ao TROCAR os times dele. Mudar o status ou o
-- placar à mão não dispara nada — o organizador continua podendo corrigir.
-- Jogo já encerrado nunca muda. Os dois times eliminados: fica como está.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.time_eliminado_na_categoria(
  p_champ uuid, p_cat text, p_team uuid, p_ignorar uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.matches x
     where x.championship_id = p_champ
       and coalesce(x.category_id, '') = coalesce(p_cat, '')
       and x.id is distinct from p_ignorar
       and x.status = 'finished'
       and position('W.O. — equipe eliminada' in coalesce(x.incidents, '')) > 0
       and (
         (x.home_team_id = p_team and x.home_score = 0 and x.away_score = 3)
         or (x.away_team_id = p_team and x.away_score = 0 and x.home_score = 3)
       )
  );
$$;

create or replace function public.matches_wo_eliminado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_casa boolean;
  v_fora boolean;
  v_elim uuid;
  v_adv  uuid;
  v_nome text;
  v_linha text;
begin
  if new.status = 'finished' or new.home_team_id is null or new.away_team_id is null then
    return new;
  end if;
  -- No UPDATE, só quando os times mudam (ex.: vaga do mata-mata preenchida).
  if tg_op = 'UPDATE'
     and new.home_team_id is not distinct from old.home_team_id
     and new.away_team_id is not distinct from old.away_team_id then
    return new;
  end if;

  v_casa := public.time_eliminado_na_categoria(new.championship_id, new.category_id, new.home_team_id, new.id);
  v_fora := public.time_eliminado_na_categoria(new.championship_id, new.category_id, new.away_team_id, new.id);
  if v_casa = v_fora then
    return new;  -- nenhum (jogo normal) ou os dois eliminados
  end if;

  v_elim := case when v_casa then new.home_team_id else new.away_team_id end;
  v_adv  := case when v_casa then new.away_team_id else new.home_team_id end;
  select name into v_nome from public.teams where id = v_elim;
  v_linha := format('W.O. — equipe eliminada: %s (derrota por 3 × 0).', coalesce(v_nome, 'equipe'));

  new.home_score := case when v_casa then 0 else 3 end;
  new.away_score := case when v_casa then 3 else 0 end;
  new.status := 'finished';
  new.incidents := case when coalesce(btrim(new.incidents), '') = '' then v_linha
                        else btrim(new.incidents) || E'\n' || v_linha end;
  if coalesce(new.phase, 'group') <> 'group' then
    new.winner_team_id := v_adv;
  end if;
  return new;
end;
$$;

drop trigger if exists matches_wo_eliminado on public.matches;
create trigger matches_wo_eliminado
  before insert or update of home_team_id, away_team_id on public.matches
  for each row execute function public.matches_wo_eliminado();
