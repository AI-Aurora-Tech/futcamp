-- ===========================================================================
-- Tabelaço — endereço do campo no aviso de jogo marcado/remarcado (WhatsApp)
--
-- Até aqui o aviso trazia só o NOME do local (`matches.venue`). O endereço fica
-- separado, no cadastro de locais do campeonato (`championships.venues`, um
-- array de {id, name, address}). Esta migration passa a incluir também o
-- endereço, quando houver — "📍 Nome — Endereço" — para o responsável saber
-- para onde ir sem procurar.
--
-- Só o aviso de jogo marcado/remarcado muda. Idempotente. Requer 0039–0041.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. O endereço de um local, pelo nome, dentro do campeonato
-- ---------------------------------------------------------------------------
create or replace function public.wa_endereco_do_local(p_champ uuid, p_venue text)
returns text
language sql
stable
security definer
set search_path = public
as $wa_end$
  select nullif(btrim(v->>'address'), '')
    from public.championships c,
         lateral jsonb_array_elements(coalesce(c.venues, '[]'::jsonb)) v
   where c.id = p_champ
     and v->>'name' = p_venue
   limit 1;
$wa_end$;

-- ---------------------------------------------------------------------------
-- 2. Jogo marcado / remarcado, agora com o endereço do campo
-- ---------------------------------------------------------------------------
create or replace function public.wa_on_match_scheduled()
returns trigger
language plpgsql
security definer
set search_path = public
as $wa_sched$
declare
  v_camp  text;
  v_home  text;
  v_away  text;
  v_cat   text;
  v_onde  text;
  v_addr  text;
  v_local text;
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

  select name into v_camp from public.championships where id = new.championship_id;
  select name into v_home from public.teams where id = new.home_team_id;
  select name into v_away from public.teams where id = new.away_team_id;
  v_cat  := public.push_categoria_nome(new.championship_id, new.category_id);

  -- Local: nome + endereço (quando o local está cadastrado com endereço).
  v_onde := nullif(btrim(coalesce(new.venue, '')), '');
  if v_onde is not null then
    v_addr  := public.wa_endereco_do_local(new.championship_id, v_onde);
    v_local := E'\n📍 ' || v_onde || case when v_addr is null then '' else ' — ' || v_addr end;
  else
    v_local := '';
  end if;

  perform public.wa_enfileirar(
    new.championship_id,
    new.category_id,
    array[new.home_team_id, new.away_team_id],
    format('jogo:%s', new.id),
    format(
      '🏆 *%s*' || E'\n%s%s × %s%s%s',
      coalesce(v_camp, 'Campeonato'),
      case when v_verbo = 'marcado' then '📅 *Jogo marcado*' || E'\n' else '📅 *Jogo remarcado*' || E'\n' end
        || case when v_cat = '' then '' else v_cat || ' · ' end,
      coalesce(v_home, 'Mandante'),
      coalesce(v_away, 'Visitante'),
      E'\n🕓 ' || public.push_quando(new.scheduled_at),
      v_local
    )
  );
  return new;
end;
$wa_sched$;

drop trigger if exists wa_on_match_scheduled on public.matches;
create trigger wa_on_match_scheduled
  after insert or update on public.matches
  for each row execute function public.wa_on_match_scheduled();
