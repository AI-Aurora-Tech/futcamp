-- ===========================================================================
-- Tabelaço — administrador MASTER + mata-mata automático
--
--  1. master_admins : quem é o administrador master da plataforma.
--     • administra QUALQUER campeonato (times, elencos, jogos, mesários…);
--     • é o ÚNICO que pode EXCLUIR um campeonato — nem mesmo o dono pode.
--  2. championships : critérios de desempate, chaveamento do mata-mata,
--     disputa de 3º lugar e criação automática da fase eliminatória.
--  3. matches : posição no chaveamento e classificado definido manualmente
--     (pênaltis / W.O.).
--  4. ensure_knockout_stage / advance_bracket : criam a fase de mata-mata e
--     levam os vencedores adiante mesmo quando quem encerra o jogo é o
--     mesário (que não tem escrita direta na tabela de partidas).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Administrador master
-- ---------------------------------------------------------------------------
create table if not exists public.master_admins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users on delete cascade,
  email      text,
  created_at timestamptz not null default now(),
  constraint master_admins_identity check (user_id is not null or email is not null)
);

create unique index if not exists master_admins_email_idx
  on public.master_admins (lower(email)) where email is not null;
create unique index if not exists master_admins_user_idx
  on public.master_admins (user_id) where user_id is not null;

-- >>> CADASTRE AQUI O ADMINISTRADOR MASTER (troque pelo e-mail real) <<<
-- Rode este insert com o e-mail da conta que será master. Pode repetir para
-- ter mais de um master.
--
--   insert into public.master_admins (email) values ('master@exemplo.com')
--     on conflict do nothing;

/** O usuário atual é administrador master? */
create or replace function public.is_master()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.master_admins m
    where m.user_id = auth.uid()
       or lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.master_admins enable row level security;

-- Cada usuário só enxerga a PRÓPRIA linha (é o que o app usa para saber se é
-- master). A manutenção da lista é feita pelo painel do Supabase / service role.
drop policy if exists master_admins_read_self on public.master_admins;
create policy master_admins_read_self on public.master_admins
  for select using (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ---------------------------------------------------------------------------
-- 2. O master administra qualquer campeonato
-- `owns_championship` é a base das políticas de times/elencos/partidas/eventos:
-- estendê-la dá ao master escrita em todos os campeonatos.
-- ---------------------------------------------------------------------------
create or replace function public.owns_championship(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_master() or exists (
    select 1 from public.championships c
    where c.id = cid and c.owner_id = auth.uid()
  );
$$;

drop policy if exists championships_update on public.championships;
create policy championships_update on public.championships
  for update using (auth.uid() = owner_id or public.is_master())
  with check (auth.uid() = owner_id or public.is_master());

-- EXCLUSÃO: exclusiva do administrador master (o dono NÃO pode excluir).
drop policy if exists championships_delete on public.championships;
create policy championships_delete on public.championships
  for delete using (public.is_master());

-- ---------------------------------------------------------------------------
-- 3. Colunas novas
-- ---------------------------------------------------------------------------
alter table public.championships add column if not exists tiebreakers  jsonb;
alter table public.championships add column if not exists bracket      jsonb;
alter table public.championships add column if not exists third_place  boolean not null default false;
alter table public.championships add column if not exists auto_knockout boolean not null default true;

alter table public.matches add column if not exists bracket_pos     int;
alter table public.matches add column if not exists winner_team_id  uuid references public.teams on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Mata-mata: criação da fase e avanço dos vencedores
-- ---------------------------------------------------------------------------

/** Ordem das fases eliminatórias (0 = fase de grupos / disputa de 3º). */
create or replace function public.phase_index(p text)
returns int
language sql
immutable
as $$
  select case p
    when 'round_of_32' then 1
    when 'round_of_16' then 2
    when 'quarter'     then 3
    when 'semi'        then 4
    when 'final'       then 5
    else 0
  end;
$$;

/** Classificado do confronto: escolha manual, bye ou placar. */
create or replace function public.match_winner(m public.matches)
returns uuid
language sql
stable
as $$
  select case
    when m.winner_team_id is not null then m.winner_team_id
    when m.home_team_id is not null and m.away_team_id is null then m.home_team_id
    when m.away_team_id is not null and m.home_team_id is null then m.away_team_id
    when m.status = 'finished'
     and m.home_score is not null and m.away_score is not null
     and m.home_score > m.away_score then m.home_team_id
    when m.status = 'finished'
     and m.home_score is not null and m.away_score is not null
     and m.home_score < m.away_score then m.away_team_id
    else null
  end;
$$;

/**
 * Cria a fase de mata-mata do campeonato a partir de um plano montado pelo
 * app (fases, posições no chaveamento e times classificados).
 *
 * Só executa quando TODOS os jogos da primeira fase estão encerrados e ainda
 * não existe nenhum jogo de mata-mata — por isso pode ser chamada com
 * segurança por qualquer perfil (inclusive o mesário, que não escreve
 * diretamente na tabela de partidas). Devolve quantos jogos foram criados.
 */
create or replace function public.ensure_knockout_stage(p_champ uuid, p_matches jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r        jsonb;
  v_home   uuid;
  v_away   uuid;
  v_phase  text;
  v_count  int := 0;
begin
  if p_matches is null or jsonb_typeof(p_matches) <> 'array' then return 0; end if;
  if jsonb_array_length(p_matches) = 0 or jsonb_array_length(p_matches) > 128 then return 0; end if;

  -- Serializa por campeonato: duas chamadas simultâneas não criam a fase em
  -- dobro (a segunda espera e encontra os jogos já criados).
  perform pg_advisory_xact_lock(hashtext(p_champ::text));

  -- Já existe mata-mata? Nada a fazer.
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase <> 'group') then
    return 0;
  end if;

  -- A primeira fase precisa existir e estar 100% encerrada.
  if not exists (select 1 from public.matches
                  where championship_id = p_champ and phase = 'group') then
    return 0;
  end if;
  if exists (select 1 from public.matches
              where championship_id = p_champ and phase = 'group' and status <> 'finished') then
    return 0;
  end if;

  for r in select * from jsonb_array_elements(p_matches) loop
    v_phase := r ->> 'phase';
    if public.phase_index(v_phase) = 0 and v_phase <> 'third_place' then
      raise exception 'Fase inválida: %', v_phase;
    end if;

    v_home := nullif(r ->> 'home_team_id', '')::uuid;
    v_away := nullif(r ->> 'away_team_id', '')::uuid;

    if v_home is not null and not exists (
      select 1 from public.teams where id = v_home and championship_id = p_champ
    ) then
      raise exception 'Time fora do campeonato';
    end if;
    if v_away is not null and not exists (
      select 1 from public.teams where id = v_away and championship_id = p_champ
    ) then
      raise exception 'Time fora do campeonato';
    end if;

    insert into public.matches
      (championship_id, round, phase, home_team_id, away_team_id, status, bracket_pos)
    values
      (p_champ,
       coalesce((r ->> 'round')::int, 100),
       v_phase,
       v_home,
       v_away,
       'scheduled',
       coalesce((r ->> 'bracket_pos')::int, 0));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/**
 * Leva os classificados para a fase seguinte do chaveamento (e os perdedores
 * das semifinais para a disputa de 3º lugar). Devolve quantos confrontos foram
 * atualizados.
 */
create or replace function public.advance_bracket(p_champ uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  src      public.matches;
  v_next   text;
  v_win    uuid;
  v_loser  uuid;
  v_rows   int;
  v_total  int := 0;
begin
  for src in
    select * from public.matches
     where championship_id = p_champ
       and public.phase_index(phase) between 1 and 4
     order by public.phase_index(phase), coalesce(bracket_pos, 0)
  loop
    v_win := public.match_winner(src);
    continue when v_win is null;

    select phase into v_next
      from public.matches
     where championship_id = p_champ
       and public.phase_index(phase) > public.phase_index(src.phase)
       and public.phase_index(phase) between 1 and 5
     order by public.phase_index(phase)
     limit 1;
    continue when v_next is null;

    if coalesce(src.bracket_pos, 0) % 2 = 0 then
      update public.matches
         set home_team_id = v_win
       where championship_id = p_champ
         and phase = v_next
         and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
         and status = 'scheduled'
         and home_team_id is distinct from v_win;
    else
      update public.matches
         set away_team_id = v_win
       where championship_id = p_champ
         and phase = v_next
         and coalesce(bracket_pos, 0) = coalesce(src.bracket_pos, 0) / 2
         and status = 'scheduled'
         and away_team_id is distinct from v_win;
    end if;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;

  -- Disputa de 3º lugar: perdedores das semifinais.
  for src in
    select * from public.matches
     where championship_id = p_champ and phase = 'semi' and status = 'finished'
     order by coalesce(bracket_pos, 0)
  loop
    v_win := public.match_winner(src);
    continue when v_win is null or src.home_team_id is null or src.away_team_id is null;
    v_loser := case when v_win = src.home_team_id then src.away_team_id else src.home_team_id end;

    if coalesce(src.bracket_pos, 0) = 0 then
      update public.matches
         set home_team_id = v_loser
       where championship_id = p_champ and phase = 'third_place'
         and status = 'scheduled' and home_team_id is distinct from v_loser;
    else
      update public.matches
         set away_team_id = v_loser
       where championship_id = p_champ and phase = 'third_place'
         and status = 'scheduled' and away_team_id is distinct from v_loser;
    end if;
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
  end loop;

  return v_total;
end;
$$;

grant execute on function public.is_master() to anon, authenticated;
grant execute on function public.phase_index(text) to anon, authenticated;
grant execute on function public.match_winner(public.matches) to anon, authenticated;
grant execute on function public.ensure_knockout_stage(uuid, jsonb) to anon, authenticated;
grant execute on function public.advance_bracket(uuid) to anon, authenticated;
