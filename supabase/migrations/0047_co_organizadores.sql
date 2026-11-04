-- ===========================================================================
-- Co-organizadores: outras pessoas que administram o MESMO campeonato.
--
-- O dono (championships.owner_id) convida pelo e-mail. A pessoa entra com a
-- própria conta e passa a ter, nesse campeonato, o mesmo acesso do dono a
-- times, elencos, partidas, mesários e cadastros — porque `owns_championship`
-- (base de todas essas políticas) passa a reconhecê-la.
--
-- O que continua só do dono (ou do master): trocar de plano, pagar, assinar e
-- excluir o campeonato — essas regras comparam `owner_id` diretamente.
--
-- O convite vale pelo e-mail: não exige que a pessoa já tenha conta. Quando ela
-- criar a conta com esse e-mail, o campeonato aparece no painel dela.
-- ===========================================================================

create table if not exists public.championship_organizers (
  id              uuid primary key default gen_random_uuid(),
  championship_id uuid not null references public.championships on delete cascade,
  email           text not null,
  name            text not null default '',
  invited_by      uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  constraint championship_organizers_email_lower check (email = lower(email))
);

create unique index if not exists championship_organizers_champ_email
  on public.championship_organizers (championship_id, email);
create index if not exists championship_organizers_email_idx
  on public.championship_organizers (email);

-- O usuário logado é co-organizador do campeonato?
create or replace function public.is_co_organizer(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.championship_organizers o
    where o.championship_id = cid
      and o.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Dono, co-organizador ou master.
create or replace function public.owns_championship(cid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_master()
      or public.is_co_organizer(cid)
      or exists (
        select 1 from public.championships c
        where c.id = cid and c.owner_id = auth.uid()
      );
$$;

-- Co-organizador também edita os dados do campeonato (nome, regras, datas…).
drop policy if exists championships_update on public.championships;
create policy championships_update on public.championships
  for update using (auth.uid() = owner_id or public.is_master() or public.is_co_organizer(id))
  with check (auth.uid() = owner_id or public.is_master() or public.is_co_organizer(id));

-- ...mas não passa o campeonato para outra pessoa: só o dono ou o master trocam
-- o `owner_id`.
create or replace function public.protect_championship_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and auth.role() is distinct from 'service_role'
     and not public.is_master()
     and auth.uid() is distinct from old.owner_id then
    new.owner_id := old.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists championships_protect_owner on public.championships;
create trigger championships_protect_owner
before update on public.championships
for each row execute function public.protect_championship_owner();

-- ---------------------------------------------------------------------------
-- RLS: quem administra o campeonato enxerga a lista. Escrever, só pelas RPCs.
-- ---------------------------------------------------------------------------
alter table public.championship_organizers enable row level security;

drop policy if exists championship_organizers_read on public.championship_organizers;
create policy championship_organizers_read on public.championship_organizers
  for select using (public.owns_championship(championship_id));

-- ---------------------------------------------------------------------------
-- Convidar
-- ---------------------------------------------------------------------------
create or replace function public.add_co_organizer(p_champ uuid, p_email text, p_name text default '')
returns public.championship_organizers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_owner_email text;
  v_row public.championship_organizers;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para convidar organizadores.';
  end if;
  if not public.owns_championship(p_champ) then
    raise exception 'Só quem organiza este campeonato pode convidar outros organizadores.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;

  select lower(u.email) into v_owner_email
    from public.championships c
    join auth.users u on u.id = c.owner_id
   where c.id = p_champ;
  if v_email = v_owner_email then
    raise exception 'Este e-mail é do dono do campeonato.';
  end if;

  if exists (select 1 from public.championship_organizers
              where championship_id = p_champ and email = v_email) then
    raise exception 'Este e-mail já organiza o campeonato.';
  end if;

  insert into public.championship_organizers (championship_id, email, name, invited_by)
  values (p_champ, v_email, trim(coalesce(p_name, '')), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Remover. O dono e o master removem qualquer um; o co-organizador pode sair.
-- ---------------------------------------------------------------------------
create or replace function public.remove_co_organizer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.championship_organizers;
  v_owner uuid;
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

  delete from public.championship_organizers where id = p_id;
end;
$$;

-- Campeonatos em que o usuário logado é co-organizador (para o painel).
create or replace function public.my_co_organized_championships()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select o.championship_id from public.championship_organizers o
   where o.email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

grant execute on function public.add_co_organizer(uuid, text, text) to authenticated;
grant execute on function public.remove_co_organizer(uuid) to authenticated;
grant execute on function public.my_co_organized_championships() to authenticated;
grant execute on function public.is_co_organizer(uuid) to anon, authenticated;
