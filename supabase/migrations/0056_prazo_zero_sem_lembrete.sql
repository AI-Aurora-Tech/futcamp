-- ===========================================================================
-- 0056 — Prazo de inscrição 0 = inscrições abertas o tempo todo
-- ===========================================================================
-- Com prazo 0 o app não trava a inscrição em momento nenhum, mas o lembrete de
-- WhatsApp (0042) calculava "prazo final = horário do jogo" e mandava aos times
-- "⏰ Inscrições encerrando" 18 h antes da partida. O responsável lia isso,
-- achava que a inscrição tinha fechado e deixava de inscrever.
--
-- Agora o lembrete só sai quando o campeonato tem prazo (> 0).
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.wa_gerar_lembretes_inscricao()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; v_qtd int := 0; v_cutoff int; v_prazo timestamptz; v_local text; v_msg text;
begin
  for r in
    select m.*, h.name as home_name, a.name as away_name,
           coalesce(c.registration_cutoff_hours, 0) as cutoff
      from public.matches m
      join public.teams h on h.id = m.home_team_id
      join public.teams a on a.id = m.away_team_id
      join public.championships c on c.id = m.championship_id
     where m.status = 'scheduled' and m.scheduled_at is not null and m.scheduled_at > now()
       -- Prazo 0 = sem prazo: não há o que lembrar.
       and coalesce(c.registration_cutoff_hours, 0) > 0
  loop
    v_cutoff := r.cutoff;
    v_prazo  := r.scheduled_at - make_interval(hours => v_cutoff);
    if now() < v_prazo - interval '18 hours' then continue; end if;
    if now() >= v_prazo then continue; end if;
    if exists (
      select 1 from public.whatsapp_outbox o
       where o.championship_id = r.championship_id
         and o.dedupe_key = format('prazo:%s', r.id)
    ) then continue; end if;

    v_local := public.wa_local(r.championship_id, r.venue);
    v_msg := format(
      E'🏆 *%s*\n⏰ *Inscrições encerrando*\n\nAs inscrições de atletas para o seu próximo jogo encerram em 18 horas.\n\n⚽ %s x %s\n🏅 %s\n🗓️ Jogo: %s%s\n🔒 Prazo final de inscrição: %s\n\nConfira seu elenco antes que feche.',
      public.wa_champ_nome(r.championship_id),
      r.home_name, r.away_name,
      public.wa_comp_linha(r.championship_id, r.category_id, r.phase, r.round),
      public.push_quando(r.scheduled_at),
      case when v_local is null then '' else E'\n📍 ' || v_local end,
      public.push_quando(v_prazo)
    );

    perform public.wa_enfileirar(
      r.championship_id, r.category_id,
      array[r.home_team_id, r.away_team_id]::uuid[],
      format('prazo:%s', r.id), v_msg
    );
    v_qtd := v_qtd + 1;
  end loop;
  return v_qtd;
end;
$$;

revoke all on function public.wa_gerar_lembretes_inscricao() from public, anon, authenticated;
grant execute on function public.wa_gerar_lembretes_inscricao() to service_role;
