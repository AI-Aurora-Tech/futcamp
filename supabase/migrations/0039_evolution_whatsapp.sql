-- ===========================================================================
-- Tabelaço — avisos por WhatsApp (Evolution API) para os RESPONSÁVEIS dos times
--
-- O push (0018/0035) já avisa quem instalou o app e ligou as notificações do
-- navegador. Mas o responsável do time nem sempre está com o app aberto — o
-- canal que ele lê é o WhatsApp. Esta migration cria a fila que a Edge Function
-- `send-whatsapp` entrega, e os três avisos pedidos:
--
--   1. o jogo foi marcado (ou remarcado) — data, hora e local;
--   2. o jogo foi encerrado — com o placar final;
--   3. faltam 6 horas para o fim do prazo de inscrição de atletas da rodada.
--
-- O destinatário é o telefone do responsável (teams.phone, migration 0012). A
-- fila guarda os TIMES; a Edge Function resolve os telefones na hora de enviar,
-- para um número trocado no cadastro valer no próximo aviso sem reescrever nada.
--
-- Reaproveita os auxiliares do push (`push_quando`, `push_categoria_nome`,
-- `push_categoria`), que já formatam data/categoria do jeito do app — um canal
-- novo não é motivo para uma segunda régua de formatação.
--
-- O item 3 é o único que não nasce de gatilho: ninguém escreve no banco quando
-- o relógio cruza a marca das 6 horas. Ele nasce de
-- `wa_gerar_lembretes_inscricao()`, que a Edge Function chama antes de esvaziar
-- a fila (a mesma mecânica de `push_gerar_lembretes`).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Fila de envio
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_outbox (
  id              bigserial primary key,
  championship_id uuid not null references public.championships on delete cascade,
  /** Categoria a que o aviso se refere (só para rastrear/depurar). */
  category_id     text,
  /** Times cujos responsáveis devem receber. A função resolve os telefones. */
  target_teams    uuid[] not null,
  /** Agrupa avisos repetidos ainda não enviados (ex.: 'jogo:<match_id>'). */
  dedupe_key      text,
  message         text not null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  /** Tentativas de entrega e o último erro — a Edge Function preenche. */
  attempts        int not null default 0,
  last_error      text
);

create index if not exists whatsapp_outbox_pending_idx
  on public.whatsapp_outbox (championship_id, created_at) where sent_at is null;

-- Um aviso PENDENTE por chave: remarcar o jogo três vezes antes da entrega
-- deixa um aviso só, com o texto mais recente. Já entregue sai do caminho — se
-- o mesmo fato voltar a acontecer, é um aviso novo.
create unique index if not exists whatsapp_outbox_dedupe_idx
  on public.whatsapp_outbox (championship_id, dedupe_key)
  where dedupe_key is not null and sent_at is null;

alter table public.whatsapp_outbox enable row level security;
-- Só a service role (Edge Function) lê e escreve a fila; ninguém mais precisa.

-- ---------------------------------------------------------------------------
-- 2. Enfileirar um aviso
--
-- Recorta os times para os que têm telefone cadastrado: sem número, não há
-- para onde enviar, e uma linha na fila que nunca sai só atrapalha o diagnós-
-- tico. Se sobrar ninguém com telefone, não enfileira.
-- ---------------------------------------------------------------------------
create or replace function public.wa_enfileirar(
  p_champ   uuid,
  p_cat     text,
  p_targets uuid[],
  p_dedupe  text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_com_fone uuid[];
begin
  if p_targets is null or array_length(p_targets, 1) is null then return; end if;

  -- O campeonato ainda existe? Numa exclusão em cascata, não — e insistir na
  -- fila quebraria a exclusão inteira por violação de chave estrangeira (a
  -- mesma armadilha corrigida no push pela migration 0024).
  if not exists (select 1 from public.championships where id = p_champ) then
    return;
  end if;

  select array_agg(t.id) into v_com_fone
    from public.teams t
   where t.id = any(p_targets)
     and coalesce(btrim(t.phone), '') <> '';

  if v_com_fone is null or array_length(v_com_fone, 1) is null then return; end if;

  insert into public.whatsapp_outbox
    (championship_id, category_id, target_teams, dedupe_key, message)
  values (
    p_champ, public.push_categoria(p_champ, p_cat), v_com_fone, p_dedupe, p_message
  )
  on conflict (championship_id, dedupe_key) where dedupe_key is not null and sent_at is null
  do update set
    message      = excluded.message,
    target_teams = excluded.target_teams,
    category_id  = excluded.category_id,
    created_at   = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. AVISO 1 — jogo marcado ou remarcado
--
-- Espelha `push_on_match_scheduled` (0035): só dispara quando a partida ganha
-- (ou muda) data ou local, nunca na geração da tabela, quando o jogo nasce sem
-- data e o aviso sairia sem o que é o motivo dele existir.
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
  v_cat   text;
  v_onde  text;
  v_verbo text;
begin
  if new.scheduled_at is null then return new; end if;
  if new.status <> 'scheduled' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  if tg_op = 'UPDATE' then
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.venue is not distinct from old.venue then
      return new;
    end if;
    v_verbo := case when old.scheduled_at is null then 'marcado' else 'remarcado' end;
  else
    v_verbo := 'marcado';
  end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat  := public.push_categoria_nome(new.championship_id, new.category_id);
  v_onde := nullif(btrim(coalesce(new.venue, '')), '');

  perform public.wa_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('jogo:%s', new.id),
    format(
      '%s%s × %s%s%s',
      case when v_verbo = 'marcado' then '📅 *Jogo marcado*' || E'\n' else '📅 *Jogo remarcado*' || E'\n' end
        || case when v_cat = '' then '' else v_cat || ' · ' end,
      coalesce(v_home, 'Mandante'),
      coalesce(v_away, 'Visitante'),
      E'\n🕓 ' || public.push_quando(new.scheduled_at),
      case when v_onde is null then '' else E'\n📍 ' || v_onde end
    )
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_scheduled on public.matches;
create trigger wa_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.wa_on_match_scheduled();

-- ---------------------------------------------------------------------------
-- 4. AVISO 2 — jogo encerrado, com o placar final
--
-- Um aviso só, para os dois times: o placar é o mesmo fato para os dois, e
-- "resultado da partida" é uma informação neutra (o resumo com vitória/derrota
-- por equipe já sai pelo push, 0035). Dispara no apito final.
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_home text;
  v_away text;
  v_cat  text;
begin
  if new.status <> 'finished' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'finished' then return new; end if;
  if new.home_team_id is null or new.away_team_id is null then return new; end if;

  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat := public.push_categoria_nome(new.championship_id, new.category_id);

  perform public.wa_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('fim:%s', new.id),
    format(
      '🏁 *Fim de jogo*' || E'\n%s*%s %s × %s %s*',
      case when v_cat = '' then '' else v_cat || E'\n' end,
      coalesce(v_home, 'Mandante'),
      coalesce(new.home_score, 0),
      coalesce(new.away_score, 0),
      coalesce(v_away, 'Visitante')
    )
  );
  return new;
end;
$$;

drop trigger if exists wa_on_match_finished on public.matches;
create trigger wa_on_match_finished
  after insert or update on public.matches
  for each row execute function public.wa_on_match_finished();

-- ---------------------------------------------------------------------------
-- 5. AVISO 3 — faltam 6 horas para o fim do prazo de inscrição da rodada
--
-- O prazo de inscrição fecha `registration_cutoff_hours` antes do jogo
-- (migration 0005; é a mesma conta que o app faz em `registrationLockForTeam`).
-- O aviso deve sair 6 horas ANTES desse prazo, ou seja quando:
--
--     agora >= scheduled_at - (cutoff + 6h)   e o prazo ainda não fechou.
--
-- Só vale quando há prazo por tempo (cutoff > 0): o fechamento manual de rodada
-- não tem horário, então não há "6 horas antes" a calcular.
--
-- Como o push (`push_gerar_lembretes`), nasce do relógio, não de gatilho: quem
-- chama é a Edge Function `send-whatsapp`, antes de esvaziar a fila. Um dedupe
-- por partida garante um aviso só, mesmo que a função rode a cada 15 minutos.
-- ---------------------------------------------------------------------------
create or replace function public.wa_gerar_lembretes_inscricao()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_qtd    int := 0;
  v_cat    text;
  v_prazo  timestamptz;
begin
  for r in
    select m.*,
           h.name as home_name,
           a.name as away_name,
           c.registration_cutoff_hours as cutoff
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.championships c on c.id = m.championship_id
     where m.status = 'scheduled'
       and m.scheduled_at is not null
       and coalesce(c.registration_cutoff_hours, 0) > 0
       -- A rodada não pode ter sido fechada manualmente pelo organizador: aí o
       -- prazo já não é por tempo, e o aviso enganaria.
       and not (c.closed_rounds @> to_jsonb(m.round))
       -- Dentro da janela: já entrou nas 6h que antecedem o prazo, e o prazo
       -- ainda não chegou.
       and now() >= m.scheduled_at - make_interval(hours => c.registration_cutoff_hours) - interval '6 hours'
       and now() <  m.scheduled_at - make_interval(hours => c.registration_cutoff_hours)
       and not exists (
         select 1 from public.whatsapp_outbox o
          where o.championship_id = m.championship_id
            and o.dedupe_key = format('insc:%s', m.id)
       )
  loop
    v_cat   := public.push_categoria_nome(r.championship_id, r.category_id);
    v_prazo := r.scheduled_at - make_interval(hours => r.cutoff);

    perform public.wa_enfileirar(
      r.championship_id,
      r.category_id,
      array[r.home_team_id, r.away_team_id],
      format('insc:%s', r.id),
      format(
        '⏰ *Faltam 6 horas para o fim das inscrições da rodada*' || E'\n%s%s × %s'
          || E'\n🗓️ Jogo: %s'
          || E'\n⛔ Prazo para inscrever/ajustar atletas: %s'
          || E'\n\nRevise sua escalação antes do prazo.',
        case when v_cat = '' then '' else v_cat || ' · ' end,
        r.home_name, r.away_name,
        public.push_quando(r.scheduled_at),
        public.push_quando(v_prazo)
      )
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Permissões
--
-- Fila e geradores são coisa da service role (Edge Function). O navegador nunca
-- enfileira nem gera lembrete direto — ele só dispara as ações (marcar jogo,
-- encerrar partida) que fazem os gatilhos escreverem, e pede a entrega chamando
-- a função. Enfileirar é SECURITY DEFINER e roda dentro dos gatilhos.
-- ---------------------------------------------------------------------------
revoke all on function public.wa_gerar_lembretes_inscricao() from public, anon, authenticated;
grant  execute on function public.wa_gerar_lembretes_inscricao() to service_role;
