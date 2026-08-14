-- ===========================================================================
-- Tabelaço — responsável do time com telefone
--
--  • O antigo "técnico" passa a ser o "responsável"; adiciona-se o telefone.
--  • Nova coluna teams.phone.
--  • RPCs de inscrição/criação de time via link passam a aceitar o telefone.
--
-- Idempotente.
-- ===========================================================================

alter table public.teams add column if not exists phone text;

-- Atualização dos dados do time pelo link de inscrição (agora com telefone).
drop function if exists public.reg_update_team(uuid, text, text, text, text, text, text);
create or replace function public.reg_update_team(
  p_team uuid, p_token text,
  p_name text, p_short text, p_logo text, p_color text, p_coach text, p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;
  update public.teams set
    name       = coalesce(nullif(p_name, ''), name),
    short_name = coalesce(p_short, short_name),
    logo       = coalesce(p_logo, logo),
    color      = coalesce(p_color, color),
    coach      = coalesce(p_coach, coach),
    phone      = coalesce(p_phone, phone)
  where id = p_team;
end;
$$;

-- Criação de time via link (agora com telefone do responsável).
drop function if exists public.create_team_via_invite(uuid, text, text, text, text, text, text, text);
create or replace function public.create_team_via_invite(
  p_champ uuid, p_token text,
  p_name text, p_short text, p_logo text, p_color text, p_coach text, p_phone text, p_group text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team   uuid;
  v_invite text;
begin
  if not public.champ_invite_valid(p_champ, p_token) then
    raise exception 'Link de criação inválido';
  end if;
  if coalesce(nullif(btrim(p_name), ''), '') = '' then
    raise exception 'Informe o nome do time';
  end if;

  insert into public.teams (championship_id, name, short_name, logo, color, coach, phone, "group")
  values (
    p_champ, btrim(p_name),
    nullif(p_short, ''), nullif(p_logo, ''), nullif(p_color, ''),
    nullif(p_coach, ''), nullif(p_phone, ''), nullif(p_group, '')
  )
  returning id into v_team;

  v_invite := encode(gen_random_bytes(16), 'hex');
  insert into public.team_invites (team_id, championship_id, token)
  values (v_team, p_champ, v_invite);

  return jsonb_build_object('team_id', v_team, 'token', v_invite);
end;
$$;

grant execute on function public.reg_update_team(uuid, text, text, text, text, text, text, text)                 to anon, authenticated;
grant execute on function public.create_team_via_invite(uuid, text, text, text, text, text, text, text, text)    to anon, authenticated;
