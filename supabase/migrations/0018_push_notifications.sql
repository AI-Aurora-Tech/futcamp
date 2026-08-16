-- ===========================================================================
-- Tabelaço — notificações push
--
--  • Responsável do time: recebe aviso de GOL nas partidas do grupo em que o
--    time dele está jogando (mesma fase e mesmo grupo).
--  • Organizador (dono do campeonato) e administrador master: recebem aviso
--    quando um time altera o elenco ou os próprios dados.
--
-- Estrutura:
--   push_subscriptions — inscrições do navegador (endpoint + chaves), com o
--     papel (organizer/team) e o campeonato a que se referem.
--   push_outbox        — fila de avisos gerada por gatilhos. A Edge Function
--     `send-push` consome a fila e entrega via Web Push (VAPID).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Inscrições
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  role            text not null check (role in ('organizer', 'team')),
  team_id         uuid references public.teams on delete cascade,
  endpoint        text not null,
  p256dh          text not null,
  auth            text not null,
  created_at      timestamptz not null default now(),
  constraint push_team_required check (role <> 'team' or team_id is not null)
);

create unique index if not exists push_subscriptions_unique
  on public.push_subscriptions (
    endpoint,
    championship_id,
    role,
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists push_subscriptions_champ_idx
  on public.push_subscriptions (championship_id, role);

alter table public.push_subscriptions enable row level security;

-- Sem acesso direto: tudo passa pelas RPCs abaixo (SECURITY DEFINER), que
-- validam o token do time ou a posse do campeonato.
drop policy if exists push_subscriptions_owner_read on public.push_subscriptions;
create policy push_subscriptions_owner_read on public.push_subscriptions
  for select using (public.owns_championship(championship_id));

-- ---------------------------------------------------------------------------
-- Fila de envio
-- ---------------------------------------------------------------------------
create table if not exists public.push_outbox (
  id              bigserial primary key,
  championship_id uuid not null references public.championships on delete cascade,
  /** Para quem: 'organizer' ou 'team'. */
  audience        text not null check (audience in ('organizer', 'team')),
  /** Quando audience='team': times que devem receber (null = todos). */
  target_teams    uuid[],
  /** Agrupa avisos repetidos (ex.: 'roster:<team_id>'). */
  dedupe_key      text,
  title           text not null,
  body            text not null,
  url             text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists push_outbox_pending_idx
  on public.push_outbox (championship_id, created_at) where sent_at is null;

alter table public.push_outbox enable row level security;
-- Só a service role (Edge Function) lê a fila; ninguém mais precisa.

-- ---------------------------------------------------------------------------
-- Inscrever / cancelar (chamado pelo app)
-- ---------------------------------------------------------------------------

/**
 * Registra o navegador para receber avisos.
 *  • role='team'      → exige o token do link de inscrição do time.
 *  • role='organizer' → exige ser o dono do campeonato (ou o master).
 */
create or replace function public.push_subscribe(
  p_championship uuid,
  p_role text,
  p_team uuid,
  p_token text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'Inscrição de push incompleta';
  end if;

  if p_role = 'team' then
    if p_team is null or not public.invite_valid(p_team, p_token) then
      raise exception 'Token inválido para este time';
    end if;
    if not exists (
      select 1 from public.teams
       where id = p_team and championship_id = p_championship
    ) then
      raise exception 'Time fora do campeonato';
    end if;
  elsif p_role = 'organizer' then
    if not public.owns_championship(p_championship) then
      raise exception 'Sem permissão para este campeonato';
    end if;
  else
    raise exception 'Papel inválido: %', p_role;
  end if;

  insert into public.push_subscriptions
    (championship_id, role, team_id, endpoint, p256dh, auth)
  values
    (p_championship, p_role, case when p_role = 'team' then p_team end, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint, championship_id, role, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

/** Cancela os avisos deste navegador no campeonato. */
create or replace function public.push_unsubscribe(p_championship uuid, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions
   where championship_id = p_championship and endpoint = p_endpoint;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gatilho 1 — GOL: avisa os times do mesmo grupo/fase da partida
-- ---------------------------------------------------------------------------
create or replace function public.push_on_goal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match   public.matches;
  v_teams   uuid[];
  v_scorer  text;
  v_team    text;
  v_home    text;
  v_away    text;
  v_group   text;
begin
  if new.type not in ('goal', 'own_goal') then return new; end if;

  select * into v_match from public.matches where id = new.match_id;
  if v_match.id is null then return new; end if;

  -- Times que jogam no MESMO grupo e na mesma fase desta partida.
  select array_agg(distinct t.id) into v_teams
    from public.matches m
    join public.teams t on t.id in (m.home_team_id, m.away_team_id)
   where m.championship_id = v_match.championship_id
     and m.phase = v_match.phase
     and coalesce(m.stage, 1) = coalesce(v_match.stage, 1)
     and coalesce(m."group", '') = coalesce(v_match."group", '');

  if v_teams is null or array_length(v_teams, 1) is null then return new; end if;

  select name into v_scorer from public.players where id = new.player_id;
  select name into v_team   from public.teams   where id = new.team_id;
  select name into v_home   from public.teams   where id = v_match.home_team_id;
  select name into v_away   from public.teams   where id = v_match.away_team_id;
  v_group := nullif(v_match."group", '');

  insert into public.push_outbox
    (championship_id, audience, target_teams, title, body, url)
  values (
    v_match.championship_id,
    'team',
    v_teams,
    case when v_group is null then '⚽ Gol!' else format('⚽ Gol no grupo %s', v_group) end,
    format(
      '%s %s × %s %s%s',
      coalesce(v_home, 'Mandante'),
      coalesce(v_match.home_score, 0),
      coalesce(v_match.away_score, 0),
      coalesce(v_away, 'Visitante'),
      case
        when new.type = 'own_goal' then format(' — gol contra (%s)', coalesce(v_team, ''))
        when v_scorer is not null then format(' — gol de %s', v_scorer)
        else ''
      end
    ),
    format('#/c/%s', v_match.championship_id)
  );
  return new;
end;
$$;

drop trigger if exists push_on_goal on public.match_events;
create trigger push_on_goal
  after insert on public.match_events
  for each row execute function public.push_on_goal();

-- ---------------------------------------------------------------------------
-- Gatilho 2 — ALTERAÇÕES DO TIME: avisa o organizador
-- Avisos do mesmo time são agrupados enquanto não forem entregues, para uma
-- importação de 30 atletas não virar 30 notificações.
-- ---------------------------------------------------------------------------
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

drop trigger if exists push_on_player_change on public.players;
create trigger push_on_player_change
  after insert or update or delete on public.players
  for each row execute function public.push_on_team_change();

drop trigger if exists push_on_team_update on public.teams;
create trigger push_on_team_update
  after update on public.teams
  for each row execute function public.push_on_team_change();

grant execute on function public.push_subscribe(uuid, text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.push_unsubscribe(uuid, text) to anon, authenticated;
