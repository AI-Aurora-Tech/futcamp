-- ===========================================================================
-- Tabelaço — WhatsApp pela Evolution API
--
-- Uma segunda via de avisos, agora no WhatsApp do RESPONSÁVEL do time (e, em
-- cópia, do organizador). Os avisos do push (0018/0035) continuam como estão;
-- esta migration NÃO mexe em nada do que já existe — nem no modelo de criação
-- do campeonato, nem nos campeonatos ativos. Ela só ACRESCENTA:
--
--   • uma coluna opcional `notify_whatsapp` no campeonato (o número que o
--     organizador recebe em cópia — nulo por padrão, então campeonato antigo
--     segue sem cópia);
--   • uma fila `whatsapp_outbox` (uma linha por destinatário, já com o texto
--     pronto e o telefone), drenada pela Edge Function `whatsapp-evolution`;
--   • um relógio de envio `whatsapp_throttle`, para respeitar os 10 s entre um
--     envio e o outro;
--   • gatilhos para: partida MARCADA / REMARCADA (com campo e endereço),
--     partida ENCERRADA (resultado + classificação) e uma RPC de partida
--     CANCELADA (chamada pelo app antes de excluir a partida);
--   • `wa_gerar_prazos()`, que enfileira o aviso 18 h antes do prazo final de
--     inscrição — como o lembrete de 2 dias do push, ele não nasce de gatilho
--     (ninguém escreve no banco quando o relógio chega lá), então quem o gera é
--     a Edge Function agendada.
--
-- TODAS as mensagens começam pelo NOME do campeonato.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. O número do organizador (cópia dos avisos). Opcional e aditivo.
-- ---------------------------------------------------------------------------
alter table public.championships
  add column if not exists notify_whatsapp text;

comment on column public.championships.notify_whatsapp is
  'WhatsApp do organizador que recebe CÓPIA dos avisos do campeonato. Nulo = sem cópia.';

-- ---------------------------------------------------------------------------
-- 1. A fila e o relógio
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_outbox (
  id              bigserial primary key,
  championship_id uuid not null references public.championships on delete cascade,
  /** Telefone de destino, já normalizado (só dígitos, com DDI). */
  to_phone        text not null,
  /** Texto pronto da mensagem (já com o nome do campeonato no topo). */
  body            text not null,
  /** Agrupa avisos repetidos do mesmo assunto (ex.: 'jogo:<id>'). */
  dedupe_key      text,
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- Auto-cura: se a tabela já existia de uma tentativa anterior num formato
-- diferente, o `create table if not exists` acima vira no-op e as colunas
-- poderiam faltar — o que quebraria os índices logo abaixo. Garantimos cada
-- coluna antes de indexar (mesmo padrão idempotente da migration 0035).
alter table public.whatsapp_outbox add column if not exists to_phone   text;
alter table public.whatsapp_outbox add column if not exists body       text;
alter table public.whatsapp_outbox add column if not exists dedupe_key text;
alter table public.whatsapp_outbox add column if not exists attempts   int not null default 0;
alter table public.whatsapp_outbox add column if not exists last_error text;
alter table public.whatsapp_outbox add column if not exists created_at timestamptz not null default now();
alter table public.whatsapp_outbox add column if not exists sent_at    timestamptz;

create index if not exists whatsapp_outbox_pending_idx
  on public.whatsapp_outbox (created_at) where sent_at is null;

-- Um aviso PENDENTE por assunto e telefone: remarcar o jogo três vezes antes
-- da entrega deixa um aviso só, com os dados mais recentes. Aviso já entregue
-- sai do caminho — se o mesmo assunto voltar a acontecer, é fato novo.
create unique index if not exists whatsapp_outbox_dedupe_idx
  on public.whatsapp_outbox (championship_id, dedupe_key, to_phone)
  where dedupe_key is not null and sent_at is null;

alter table public.whatsapp_outbox enable row level security;
-- Só a service role (Edge Function) lê e escreve a fila; ninguém mais precisa.

/*
 * Relógio de um registro só: guarda QUANDO saiu o último envio, para a Edge
 * Function respeitar os 10 s mesmo entre execuções diferentes.
 */
create table if not exists public.whatsapp_throttle (
  id           boolean primary key default true check (id),
  last_sent_at timestamptz
);
insert into public.whatsapp_throttle (id, last_sent_at)
  values (true, null)
  on conflict (id) do nothing;

alter table public.whatsapp_throttle enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Auxiliares
-- ---------------------------------------------------------------------------

/*
 * Normaliza um telefone para o formato que a Evolution espera (só dígitos,
 * com DDI). Número brasileiro sem DDI (10 ou 11 dígitos) ganha o 55; número
 * que já vem com 55 é mantido. Vazio/curto vira nulo (não dá para enviar).
 */
create or replace function public.wa_fone(p text)
returns text
language sql
immutable
as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x)
  select case
    when length(x) = 0 then null
    when length(x) in (10, 11) then '55' || x
    when length(x) between 12 and 13 and left(x, 2) = '55' then x
    else nullif(x, '')
  end
  from d;
$$;

/** O nome do campeonato com a temporada, para o topo de toda mensagem. */
create or replace function public.wa_champ_nome(p_champ uuid)
returns text
language sql
stable
set search_path = public
as $$
  select btrim(c.name || coalesce(' ' || nullif(btrim(c.season), ''), ''))
    from public.championships c where c.id = p_champ;
$$;

/*
 * Os telefones que devem receber um aviso da partida: o responsável de cada
 * time em campo e, em cópia, o organizador (`notify_whatsapp`). Já normalizados
 * e sem repetições/vazios.
 */
create or replace function public.wa_fones_do_jogo(p_champ uuid, p_home uuid, p_away uuid)
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct f), '{}'::text[])
  from (
    select public.wa_fone(t.phone) as f
      from public.teams t where t.id in (p_home, p_away)
    union all
    select public.wa_fone(c.notify_whatsapp)
      from public.championships c where c.id = p_champ
  ) s
  where f is not null;
$$;

/** O campo e o endereço: "Estádio Municipal — Av. Brasil, 1000". */
create or replace function public.wa_local(p_champ uuid, p_venue text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_venue, '')), '') is null then null
    else p_venue || coalesce(
      ' — ' || nullif(btrim((
        select v->>'address'
          from public.championships c,
               lateral jsonb_array_elements(coalesce(c.venues, '[]'::jsonb)) v
         where c.id = p_champ and v->>'name' = p_venue
         limit 1
      )), ''), '')
  end;
$$;

/** O árbitro escalado, pelo id em `championships.referees`. */
create or replace function public.wa_arbitro(p_champ uuid, p_ref text)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(btrim((
    select r->>'name'
      from public.championships c,
           lateral jsonb_array_elements(coalesce(c.referees, '[]'::jsonb)) r
     where c.id = p_champ and r->>'id' = p_ref
     limit 1
  )), '');
$$;

/*
 * A linha da competição: "Sub-15 · Rodada 3" (grupos/pontos corridos) ou
 * "Sub-15 · Semifinal" (mata-mata). A categoria só entra quando o campeonato
 * tem mais de uma. Reaproveita `push_categoria_nome` (migration 0035).
 */
create or replace function public.wa_comp_linha(
  p_champ uuid, p_cat text, p_phase text, p_round int
)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' · ',
    nullif(public.push_categoria_nome(p_champ, p_cat), ''),
    case p_phase
      when 'group'       then 'Rodada ' || p_round
      when 'round_of_32' then '32-avos de final'
      when 'round_of_16' then 'Oitavas de final'
      when 'quarter'     then 'Quartas de final'
      when 'semi'        then 'Semifinal'
      when 'final'       then 'Final'
      when 'third_place' then 'Disputa de 3º lugar'
      else 'Rodada ' || p_round
    end
  );
$$;

/*
 * Enfileira uma mensagem para vários telefones (uma linha por telefone). O
 * `dedupe_key` é o que impede a repetição enquanto o aviso não saiu.
 */
create or replace function public.wa_enfileirar(
  p_champ   uuid,
  p_targets text[],
  p_dedupe  text,
  p_body    text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fone text;
begin
  if p_targets is null or array_length(p_targets, 1) is null then return; end if;

  foreach v_fone in array p_targets loop
    insert into public.whatsapp_outbox (championship_id, to_phone, dedupe_key, body)
    values (p_champ, v_fone, p_dedupe, p_body)
    on conflict (championship_id, dedupe_key, to_phone)
      where dedupe_key is not null and sent_at is null
    do update set body = excluded.body, created_at = now();
  end loop;
end;
$$;

/*
 * A classificação atual da categoria (todas as equipes), na ordem clássica do
 * futebol: pontos, saldo, gols marcados. Quando o jogo é de fase de grupos com
 * grupos separados, a tabela é a DO grupo do confronto. `[[LINK]]` é trocado
 * pela Edge Function pelo endereço público do campeonato.
 */
create or replace function public.wa_classificacao(p_match uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  m       public.matches;
  v_cat   text;
  v_grp   text;
  v_pv    int;
  v_pe    int;
  v_lista text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return null; end if;

  v_cat := public.push_categoria(m.championship_id, m.category_id);
  v_grp := nullif(m."group", '');
  select points_win, points_draw into v_pv, v_pe
    from public.championships where id = m.championship_id;

  with jogos as (
    select x.home_team_id as time, x."group" as grp,
           x.home_score as pro, x.away_score as contra
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.home_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
    union all
    select x.away_team_id, x."group", x.away_score, x.home_score
      from public.matches x
     where x.championship_id = m.championship_id and x.phase = 'group'
       and x.status = 'finished' and x.away_team_id is not null
       and public.push_categoria(x.championship_id, x.category_id) = v_cat
  ),
  filtrado as (
    select * from jogos j
     where v_grp is null or coalesce(j.grp, '') = v_grp
  ),
  tabela as (
    select j.time,
           count(*) filter (where coalesce(j.pro,0) >  coalesce(j.contra,0)) as v,
           count(*) filter (where coalesce(j.pro,0) =  coalesce(j.contra,0)) as e,
           count(*) filter (where coalesce(j.pro,0) <  coalesce(j.contra,0)) as d,
           sum(case when coalesce(j.pro,0) > coalesce(j.contra,0) then coalesce(v_pv,3)
                    when coalesce(j.pro,0) = coalesce(j.contra,0) then coalesce(v_pe,1)
                    else 0 end)                          as pontos,
           sum(coalesce(j.pro,0) - coalesce(j.contra,0)) as saldo,
           sum(coalesce(j.pro,0))                        as feitos
      from filtrado j
     group by j.time
  ),
  ranked as (
    select row_number() over (order by t.pontos desc, t.saldo desc, t.feitos desc, e2.name) as pos,
           e2.name, t.pontos, t.v, t.e, t.d, t.saldo
      from tabela t join public.teams e2 on e2.id = t.time
  )
  select string_agg(
           format('%sº %s — %s pts (%sV %sE %sD, SG %s%s)',
                  pos, name, pontos, v, e, d,
                  case when saldo >= 0 then '+' else '' end, saldo),
           E'\n' order by pos)
    into v_lista from ranked;

  return v_lista;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Partida MARCADA ou REMARCADA — com data, hora, campo, endereço e árbitro
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home  text;
  v_away  text;
  v_local text;
  v_ref   text;
  v_novo  boolean;
  v_fones text[];
  v_corpo text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  if tg_op = 'UPDATE' then
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue
       and new.referee_id is not distinct from old.referee_id then
      return new;  -- nada relevante mudou
    end if;
    v_novo := old.scheduled_at is null;
  else
    v_novo := true;
  end if;

  v_fones := public.wa_fones_do_jogo(new.championship_id, new.home_team_id, new.away_team_id);
  if array_length(v_fones, 1) is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_local := public.wa_local(new.championship_id, new.venue);
  v_ref   := public.wa_arbitro(new.championship_id, new.referee_id);

  v_corpo := format(
    E'🏆 *%s*\n%s\n\n⚽ %s x %s\n🏅 %s\n🗓️ %s%s%s%s\n\n%s',
    public.wa_champ_nome(new.championship_id),
    case when v_novo then '📅 *Partida marcada*' else '🔄 *Partida remarcada*' end,
    coalesce(v_home, 'Mandante'), coalesce(v_away, 'Visitante'),
    public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
    case when not v_novo and tg_op = 'UPDATE' and old.scheduled_at is not null
              and old.scheduled_at is distinct from new.scheduled_at
         then 'Antes: ' || public.push_quando(old.scheduled_at) || E'\n🗓️ Agora: '
         else '' end,
    public.push_quando(new.scheduled_at),
    case when v_local is null then '' else E'\n📍 ' || v_local end,
    case when v_ref   is null then '' else E'\n🧑‍⚖️ Árbitro: ' || v_ref end,
    case when v_novo then 'Bom jogo! ⚽' else '⚠️ Anote a mudança!' end
  );

  perform public.wa_enfileirar(
    new.championship_id, v_fones, format('jogo:%s', new.id), v_corpo
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_scheduled on public.matches;
create trigger wa_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.wa_on_match_scheduled();

-- ---------------------------------------------------------------------------
-- 4. Partida ENCERRADA — resultado e classificação atual
--
-- Fase de grupos/pontos corridos: resultado + a tabela da categoria (ou do
-- grupo). Mata-mata: resultado, pênaltis e quem avança (ou o campeão), que é o
-- que faz sentido onde não há tabela de pontos.
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home  text;
  v_away  text;
  v_gh    int;
  v_ga    int;
  v_fones text[];
  v_pen   text;
  v_win   uuid;
  v_wname text;
  v_class text;
  v_corpo text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  v_fones := public.wa_fones_do_jogo(new.championship_id, new.home_team_id, new.away_team_id);
  if array_length(v_fones, 1) is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_gh := coalesce(new.home_score, 0);
  v_ga := coalesce(new.away_score, 0);

  if new.phase = 'group' then
    v_class := public.wa_classificacao(new.id);
    v_corpo := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s%s\n\n📊 *Classificação*\n%s\n\nTabela completa: [[LINK]]',
      public.wa_champ_nome(new.championship_id),
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home, 'Mandante'), v_gh, v_ga, coalesce(v_away, 'Visitante'),
      '',
      coalesce(v_class, 'Classificação indisponível.')
    );
  else
    -- Quem venceu: classificado manual → pênaltis → placar.
    v_pen := case
      when new.penalty_home is not null and new.penalty_away is not null
      then format(E'\n🥅 Pênaltis: %s x %s', new.penalty_home, new.penalty_away)
      else '' end;
    v_win := coalesce(
      new.winner_team_id,
      case when new.penalty_home is not null and new.penalty_away is not null
                and new.penalty_home <> new.penalty_away
           then case when new.penalty_home > new.penalty_away
                     then new.home_team_id else new.away_team_id end
           when v_gh <> v_ga
           then case when v_gh > v_ga then new.home_team_id else new.away_team_id end
      end
    );
    select name into v_wname from public.teams where id = v_win;

    v_corpo := format(
      E'🏆 *%s*\n🏁 *Fim de jogo* · %s\n\n⚽ %s %s x %s %s%s%s\n\nChaveamento: [[LINK]]',
      public.wa_champ_nome(new.championship_id),
      public.wa_comp_linha(new.championship_id, new.category_id, new.phase, new.round),
      coalesce(v_home, 'Mandante'), v_gh, v_ga, coalesce(v_away, 'Visitante'),
      v_pen,
      case
        when v_wname is null then ''
        when new.phase = 'final' then format(E'\n🏆 %s é campeão!', v_wname)
        else format(E'\n✅ %s avança de fase', v_wname)
      end
    );
  end if;

  perform public.wa_enfileirar(
    new.championship_id, v_fones, format('fim:%s', new.id), v_corpo
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_finished on public.matches;
create trigger wa_on_match_finished
  after insert or update on public.matches
  for each row execute function public.wa_on_match_finished();

-- ---------------------------------------------------------------------------
-- 5. Partida CANCELADA
--
-- Não é gatilho de DELETE: excluir um campeonato apaga as partidas em cascata,
-- e enfileirar ali (referenciando um campeonato que está sendo apagado)
-- derrubaria a exclusão pela chave estrangeira. Então quem chama é o APP, só
-- quando o organizador exclui UMA partida — antes de apagá-la, para os dados
-- ainda existirem. Valida a posse do campeonato.
-- ---------------------------------------------------------------------------
create or replace function public.wa_cancelar_partida(p_match uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m       public.matches;
  v_home  text;
  v_away  text;
  v_fones text[];
  v_corpo text;
begin
  select * into m from public.matches where id = p_match;
  if m.id is null then return; end if;
  if not public.owns_championship(m.championship_id) then
    raise exception 'Sem permissão para este campeonato';
  end if;
  if m.home_team_id is null or m.away_team_id is null then return; end if;

  v_fones := public.wa_fones_do_jogo(m.championship_id, m.home_team_id, m.away_team_id);
  if array_length(v_fones, 1) is null then return; end if;

  select name into v_home from public.teams where id = m.home_team_id;
  select name into v_away from public.teams where id = m.away_team_id;

  v_corpo := format(
    E'🏆 *%s*\n❌ *Partida cancelada*\n\n⚽ %s x %s\n🏅 %s%s\n\nEsta partida foi removida da tabela. Aguarde novas informações do organizador.',
    public.wa_champ_nome(m.championship_id),
    coalesce(v_home, 'Mandante'), coalesce(v_away, 'Visitante'),
    public.wa_comp_linha(m.championship_id, m.category_id, m.phase, m.round),
    case when m.scheduled_at is null then ''
         else E'\n🗓️ Estava marcada para ' || public.push_quando(m.scheduled_at) end
  );

  -- `cancel:<id>` com o horário — evita repetir se o app chamar duas vezes.
  perform public.wa_enfileirar(
    m.championship_id, v_fones, format('cancel:%s', p_match), v_corpo
  );
end;
$$;

grant execute on function public.wa_cancelar_partida(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Aviso 18 h ANTES do prazo final de inscrição
--
-- O prazo final de inscrição de um jogo é `scheduled_at - cutoff` (o mesmo
-- `registration_cutoff_hours` que o app usa para travar as inscrições). Este
-- aviso sai 18 h antes desse prazo. Como o lembrete de 2 dias do push, ele não
-- nasce de gatilho — quem o gera é a Edge Function agendada, chamando esta
-- função antes de drenar a fila.
--
-- Entra na fila quando o relógio já passou de (prazo - 18h) e o prazo ainda não
-- chegou, e não há aviso `prazo:<id>` para o jogo. Cutoff 0 = sem prazo próprio:
-- o "prazo final" é o próprio horário do jogo.
-- ---------------------------------------------------------------------------
create or replace function public.wa_gerar_prazos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_qtd   int := 0;
  v_cutoff int;
  v_prazo timestamptz;
  v_fones text[];
  v_local text;
  v_corpo text;
begin
  for r in
    select m.*, h.name as home_name, a.name as away_name,
           coalesce(c.registration_cutoff_hours, 0) as cutoff
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.championships c on c.id = m.championship_id
     where m.status = 'scheduled'
       and m.scheduled_at is not null
       and m.scheduled_at > now()
  loop
    v_cutoff := r.cutoff;
    v_prazo  := r.scheduled_at - make_interval(hours => v_cutoff);

    -- Janela: já passou de (prazo - 18h) e o prazo ainda não chegou.
    if now() < v_prazo - interval '18 hours' then continue; end if;
    if now() >= v_prazo then continue; end if;

    if exists (
      select 1 from public.whatsapp_outbox o
       where o.championship_id = r.championship_id
         and o.dedupe_key = format('prazo:%s', r.id)
    ) then
      continue;
    end if;

    v_fones := public.wa_fones_do_jogo(r.championship_id, r.home_team_id, r.away_team_id);
    if array_length(v_fones, 1) is null then continue; end if;

    v_local := public.wa_local(r.championship_id, r.venue);

    v_corpo := format(
      E'🏆 *%s*\n⏰ *Inscrições encerrando*\n\nAs inscrições de atletas para o seu próximo jogo encerram em 18 horas.\n\n⚽ %s x %s\n🏅 %s\n🗓️ Jogo: %s%s\n🔒 Prazo final de inscrição: %s\n\nConfira seu elenco antes que feche.',
      public.wa_champ_nome(r.championship_id),
      r.home_name, r.away_name,
      public.wa_comp_linha(r.championship_id, r.category_id, r.phase, r.round),
      public.push_quando(r.scheduled_at),
      case when v_local is null then '' else E'\n📍 ' || v_local end,
      public.push_quando(v_prazo)
    );

    perform public.wa_enfileirar(
      r.championship_id, v_fones, format('prazo:%s', r.id), v_corpo
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
--
-- `wa_gerar_prazos` só é chamada pela Edge Function `whatsapp-evolution`, com a
-- service role. Fechada para o navegador de propósito: enfileirar prazo não é
-- coisa que o app peça.
-- ---------------------------------------------------------------------------
revoke all on function public.wa_gerar_prazos() from public, anon, authenticated;
grant execute on function public.wa_gerar_prazos() to service_role;
