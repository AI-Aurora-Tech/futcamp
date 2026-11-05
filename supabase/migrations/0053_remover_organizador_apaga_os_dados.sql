-- ===========================================================================
-- Tabelaço — remover um organizador apaga os dados dele no campeonato
--
-- Ao remover (ou sair), `remove_co_organizer` apagava só o convite. Sobrava o
-- que a pessoa deixou ligado ao campeonato:
--
--   • AVISOS NO CELULAR (push): a inscrição do organizador guardava só o
--     aparelho (endpoint), sem dizer de quem era — então o aparelho de quem
--     foi removido continuava recebendo os avisos do campeonato.
--   • O vínculo "convidado por" nos organizadores que ela convidou.
--
-- Agora a inscrição de push guarda quem assinou (`user_id`) e a remoção apaga
-- tudo isso.
--
-- O QUE NÃO É APAGADO, de propósito: o que a pessoa ajudou a construir
-- (times, elencos, partidas, mesários, cadastros) é do CAMPEONATO — apagar
-- derrubaria o campeonato por causa de quem saiu. Os organizadores que ela
-- convidou continuam. A conta dela também fica: pode organizar outros
-- campeonatos.
--
-- Inscrições de push criadas ANTES desta migration não dizem de quem são
-- (`user_id` nulo) e não são apagadas na remoção: apagar todas tiraria os
-- avisos do dono e dos demais, que precisariam reativar à mão.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

alter table public.push_subscriptions
  add column if not exists user_id uuid references auth.users on delete cascade;

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (championship_id, user_id)
  where user_id is not null;

-- A inscrição do organizador passa a registrar quem é. O aparelho é de quem
-- assinou por último (a mesma chave do aparelho/campeonato/papel).
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
    (championship_id, role, team_id, endpoint, p256dh, auth, user_id)
  values
    (p_championship, p_role, case when p_role = 'team' then p_team end, p_endpoint, p_p256dh, p_auth,
     case when p_role = 'organizer' then auth.uid() end)
  on conflict (endpoint, championship_id, role, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id;
end;
$$;

grant execute on function public.push_subscribe(uuid, text, uuid, text, text, text, text) to anon, authenticated;

-- Remover: tira o acesso e apaga o que a pessoa deixou ligado ao campeonato.
create or replace function public.remove_co_organizer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.championship_organizers;
  v_owner uuid;
  v_uid uuid;
begin
  select * into o from public.championship_organizers where id = p_id;
  if not found then
    return;
  end if;
  select owner_id into v_owner from public.championships where id = o.championship_id;

  if not (
    public.is_master()
    or v_owner = auth.uid()
    or o.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) then
    raise exception 'Só o dono do campeonato remove outros organizadores.';
  end if;

  -- A conta (se já existe) — o convite pode ser de quem nunca entrou.
  select u.id into v_uid from auth.users u where lower(u.email) = o.email limit 1;

  if v_uid is not null then
    -- Avisos no celular deste organizador, neste campeonato.
    delete from public.push_subscriptions
     where championship_id = o.championship_id
       and role = 'organizer'
       and user_id = v_uid;

    -- Quem ela convidou continua; só some o vínculo com ela.
    update public.championship_organizers
       set invited_by = null
     where championship_id = o.championship_id
       and invited_by = v_uid
       and id <> p_id;
  end if;

  delete from public.championship_organizers where id = p_id;
end;
$$;

grant execute on function public.remove_co_organizer(uuid) to authenticated;
