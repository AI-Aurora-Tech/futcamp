-- ===========================================================================
-- 0064 — Limite de partidas para inscrever atletas (por categoria)
-- ===========================================================================
-- Nova regra de CATEGORIA: `maxMatchesToRegister` (dentro de
-- `championships.categories`). Depois que o time DISPUTA esse número de
-- partidas na categoria (jogos encerrados, W.O. conta), ele não inscreve mais
-- atletas nela. Só o administrador master pode. Cada categoria tem o seu
-- limite; vazio/0 = sem limite (padrão — nada muda para quem não configurar).
--
-- Vale para todos os caminhos (portal do time, painel do organizador,
-- importação). Também barra trocar nome, CPF, nascimento, categoria ou time de
-- um atleta já inscrito — senão bastaria "editar" um atleta para pôr outro no
-- lugar. Número, posição e foto continuam editáveis; remover também.
--
-- Atleta ou partida sem categoria contam para a primeira (mesma regra do app).
-- O portal do time já recebe as categorias (com o limite) pela
-- `team_registration`, então ela não muda.
--
-- Requer a 0062 (`chamada_do_servidor`). Idempotente.
-- ===========================================================================

create or replace function public.limite_de_partidas_atingido(p_champ uuid, p_team uuid, p_cat text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max   int;
  v_first text;
  v_cat   text;
  v_jogos int;
begin
  select case when jsonb_typeof(c.categories) = 'array' then c.categories -> 0 ->> 'id' end
    into v_first
    from public.championships c
   where c.id = p_champ;

  v_cat := coalesce(nullif(p_cat, ''), v_first);

  select case when (e ->> 'maxMatchesToRegister') ~ '^\d+$' then (e ->> 'maxMatchesToRegister')::int else 0 end
    into v_max
    from public.championships c,
         jsonb_array_elements(case when jsonb_typeof(c.categories) = 'array' then c.categories else '[]'::jsonb end) e
   where c.id = p_champ
     and e ->> 'id' = v_cat
   limit 1;

  if coalesce(v_max, 0) <= 0 then
    return false;
  end if;

  select count(*) into v_jogos
    from public.matches m
   where m.championship_id = p_champ
     and m.status = 'finished'
     and (m.home_team_id = p_team or m.away_team_id = p_team)
     and coalesce(m.category_id, v_first, '') is not distinct from coalesce(v_cat, '');

  return v_jogos >= v_max;
end;
$$;

create or replace function public.players_block_match_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_master() or public.chamada_do_servidor() then
    return new;
  end if;

  -- Editar sem trocar quem é o atleta (número, posição, foto): liberado.
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name
     and new.cpf is not distinct from old.cpf
     and new.birthdate is not distinct from old.birthdate
     and new.category_id is not distinct from old.category_id
     and new.team_id is not distinct from old.team_id then
    return new;
  end if;

  if public.limite_de_partidas_atingido(new.championship_id, new.team_id, new.category_id) then
    raise exception 'Este time já atingiu o limite de partidas desta categoria: a inscrição de atletas está encerrada. Só o administrador master pode inscrever agora.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists players_block_match_limit on public.players;
create trigger players_block_match_limit
  before insert or update on public.players
  for each row execute function public.players_block_match_limit();

