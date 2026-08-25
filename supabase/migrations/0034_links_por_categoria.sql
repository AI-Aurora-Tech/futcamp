-- ===========================================================================
-- Tabelaço — link de inscrição com escopo de categoria
--
-- Com cada categoria virando uma competição (0033), um link só para o
-- campeonato inteiro deixou de bastar. O organizador precisa poder mandar:
--
--   • um link ABERTO — o responsável escolhe em quais categorias inscreve o
--     clube (é o link "para todas");
--   • um link JÁ DIRECIONADO — "este é o do Sub-13", e o clube entra só nela.
--
-- A diferença não é de comodidade. O link direcionado é o que permite mandar
-- o convite certo para o time certo: quem só tem equipe de Sub-13 não deveria
-- nem ver a opção de se inscrever no Sub-17.
--
-- `champ_team_invites` deixa de ter um token por campeonato e passa a ter
-- quantos forem precisos, cada um com o seu escopo. O link antigo continua
-- valendo: ele vira o link aberto, sem escopo.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Mais de um link por campeonato.
--
-- A chave primária era o campeonato — um token e acabou. Passa a ser o token,
-- que já era único; o campeonato vira só um índice.
-- ---------------------------------------------------------------------------
alter table public.champ_team_invites
  add column if not exists categories text[];

alter table public.champ_team_invites
  add column if not exists label text;

do $$
declare v_pk text;
begin
  select conname into v_pk
    from pg_constraint
   where conrelid = 'public.champ_team_invites'::regclass
     and contype = 'p'
     and pg_get_constraintdef(oid) like '%championship_id%';

  if v_pk is not null then
    execute format('alter table public.champ_team_invites drop constraint %I', v_pk);
    alter table public.champ_team_invites add primary key (token);
  end if;
end
$$;

create index if not exists champ_team_invites_champ_idx
  on public.champ_team_invites (championship_id);

-- Um link ABERTO por campeonato — o "para todas as categorias". Escopos
-- diferentes podem repetir à vontade.
create unique index if not exists champ_team_invites_aberto_idx
  on public.champ_team_invites (championship_id) where categories is null;

comment on column public.champ_team_invites.categories is
  'Categorias que este link libera. NULL = todas (o responsável escolhe).';

-- ---------------------------------------------------------------------------
-- 2. Garantir um link — aberto ou com escopo.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_champ_team_invite(p_champ uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_token text;
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  select token into v_token
    from public.champ_team_invites
   where championship_id = p_champ and categories is null;
  if v_token is null then
    v_token := encode(gen_random_bytes(16), 'hex');
    insert into public.champ_team_invites (championship_id, token, categories)
    values (p_champ, v_token, null);
  end if;
  return v_token;
end;
$$;

/*
 * Link direcionado a uma ou mais categorias.
 *
 * O mesmo conjunto de categorias devolve sempre o MESMO token: o organizador
 * que clica duas vezes em "link do Sub-13" manda o mesmo endereço, e não dois
 * links vivos para a mesma coisa.
 */
create or replace function public.ensure_champ_category_invite(
  p_champ uuid,
  p_categories text[]
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_cats  text[];
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  if p_categories is null or array_length(p_categories, 1) is null then
    return public.ensure_champ_team_invite(p_champ);
  end if;

  -- Ordena para que {s13,s11} e {s11,s13} sejam o mesmo escopo.
  select array_agg(c order by c) into v_cats
    from unnest(p_categories) c
   where c is not null and c <> '';

  -- Só categorias que existem no campeonato.
  if exists (
    select 1 from unnest(v_cats) c
     where not exists (
       select 1 from public.championships ch,
              lateral jsonb_array_elements(coalesce(ch.categories, '[]'::jsonb)) cat
        where ch.id = p_champ and cat->>'id' = c
     )
  ) then
    raise exception 'Categoria inexistente neste campeonato.';
  end if;

  select token into v_token
    from public.champ_team_invites
   where championship_id = p_champ and categories = v_cats;

  if v_token is null then
    v_token := encode(gen_random_bytes(16), 'hex');
    insert into public.champ_team_invites (championship_id, token, categories)
    values (p_champ, v_token, v_cats);
  end if;
  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. O que o link libera.
--
-- Devolve as categorias do escopo, ou TODAS as do campeonato quando o link é
-- aberto — é o que a página de criação de time mostra para o responsável
-- escolher. Token inválido devolve nulo, e a página trata como link expirado.
-- ---------------------------------------------------------------------------
create or replace function public.champ_invite_scope(p_champ uuid, p_token text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select case
    when i.categories is null then
      coalesce((
        select jsonb_agg(cat->>'id' order by ord)
          from public.championships ch,
               lateral jsonb_array_elements(coalesce(ch.categories, '[]'::jsonb))
                 with ordinality as t(cat, ord)
         where ch.id = p_champ
      ), '[]'::jsonb)
    else to_jsonb(i.categories)
  end
  from public.champ_team_invites i
  where i.championship_id = p_champ and i.token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- 4. Criar o time JÁ inscrito nas categorias escolhidas.
--
-- O responsável marca as categorias na página; o banco confere que elas cabem
-- no escopo do link. Sem essa conferência, bastaria trocar o parâmetro no
-- navegador para entrar numa categoria que o organizador não abriu.
-- ---------------------------------------------------------------------------
-- A versão de 9 parâmetros (0012) precisa SAIR. Com ela viva, uma chamada com
-- 9 argumentos ficaria ambígua entre as duas — o Postgres recusa, e quem
-- chamasse pela assinatura antiga levaria "function is not unique".
drop function if exists public.create_team_via_invite(uuid, text, text, text, text, text, text, text, text);

create or replace function public.create_team_via_invite(
  p_champ uuid, p_token text,
  p_name text, p_short text, p_logo text, p_color text, p_coach text, p_phone text, p_group text,
  p_categories text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team    uuid;
  v_invite  text;
  v_escopo  text[];
  v_cats    text[];
begin
  if not public.champ_invite_valid(p_champ, p_token) then
    raise exception 'Link de criação inválido';
  end if;
  if coalesce(nullif(btrim(p_name), ''), '') = '' then
    raise exception 'Informe o nome do time';
  end if;

  -- O que este link libera.
  select array_agg(value::text) into v_escopo
    from jsonb_array_elements_text(public.champ_invite_scope(p_champ, p_token)) value;

  -- O que o responsável escolheu — sem escolha, entra em tudo o que o link
  -- libera (é o caso do link direcionado a uma categoria só).
  if p_categories is null or array_length(p_categories, 1) is null then
    v_cats := v_escopo;
  else
    select array_agg(c order by c) into v_cats
      from unnest(p_categories) c
     where c is not null and c <> '';

    if exists (select 1 from unnest(v_cats) c where not (c = any (coalesce(v_escopo, '{}')))) then
      raise exception 'Este link não dá acesso a essa categoria.';
    end if;
  end if;

  insert into public.teams (championship_id, name, short_name, logo, color, coach, phone, "group")
  values (
    p_champ, btrim(p_name),
    nullif(p_short, ''), nullif(p_logo, ''), nullif(p_color, ''),
    nullif(p_coach, ''), nullif(p_phone, ''), nullif(p_group, '')
  )
  returning id into v_team;

  if v_cats is not null then
    insert into public.team_categories (team_id, championship_id, category_id, "group")
    select v_team, p_champ, c, nullif(p_group, '')
      from unnest(v_cats) c
    on conflict (team_id, category_id) do nothing;
  end if;

  v_invite := encode(gen_random_bytes(16), 'hex');
  insert into public.team_invites (team_id, championship_id, token)
  values (v_team, p_champ, v_invite);

  return jsonb_build_object(
    'team_id', v_team,
    'token', v_invite,
    'categories', coalesce(to_jsonb(v_cats), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
grant execute on function public.ensure_champ_team_invite(uuid)                  to authenticated;
grant execute on function public.ensure_champ_category_invite(uuid, text[])      to authenticated;
grant execute on function public.champ_invite_scope(uuid, text)                  to anon, authenticated;
grant execute on function public.create_team_via_invite(uuid, text, text, text, text, text, text, text, text, text[])
  to anon, authenticated;
