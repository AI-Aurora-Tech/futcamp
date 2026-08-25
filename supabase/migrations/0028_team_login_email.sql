-- ===========================================================================
-- Tabelaço — o gestor do time entra pela página inicial
--
-- Como era: o responsável criava um "usuário" qualquer (leoes.fc) pelo link do
-- organizador, e esse usuário só servia DENTRO daquele link. Perdeu o link,
-- perdeu o acesso — tinha que pedir outro.
--
-- Como fica: a conta continua nascendo do mesmo link, mas o login passa a ser
-- um E-MAIL. Com e-mail e senha o gestor entra pela página inicial do
-- Tabelaço, sem link nenhum, e o app o leva para o time (ou para a lista, se
-- ele gerir mais de um).
--
-- O que NÃO muda: a criação da conta (só pelo link do organizador), os 2
-- gestores por time e a recuperação de senha pelo administrador.
--
-- Contas antigas, com usuário que não é e-mail, continuam entrando pelo link
-- como sempre entraram — nada é apagado nem migrado à força. Só não é possível
-- criar contas novas assim.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Índices para a busca por e-mail.
--
-- O login pela página inicial não sabe de qual time é a pessoa: procura o
-- e-mail em `team_invites` inteira. Sem índice isso é varredura de tabela a
-- cada tentativa de login.
-- ---------------------------------------------------------------------------
create index if not exists team_invites_username_lower_idx
  on public.team_invites (lower(username));
create index if not exists team_invites_username2_lower_idx
  on public.team_invites (lower(username2));

-- ---------------------------------------------------------------------------
-- 1. O que conta como e-mail.
--
-- Deliberadamente frouxa: barra o que claramente não é e-mail (o "leoes.fc"
-- de antigamente, espaços, duas arrobas) sem tentar reimplementar a RFC 5322,
-- que rejeitaria endereços válidos de verdade. Quem confere se a caixa existe
-- é o mundo real — o dia em que o gestor precisar receber alguma coisa.
-- ---------------------------------------------------------------------------
create or replace function public.email_plausivel(p_email text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_email, '') ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$';
$$;

-- ---------------------------------------------------------------------------
-- 2. Criar a conta do gestor — agora com e-mail.
--
-- O e-mail é guardado em minúsculas e sem espaços nas pontas. É o mesmo campo
-- `username` de antes: um só lugar para o login do time, sem coluna nova e sem
-- duas verdades sobre quem é o gestor.
-- ---------------------------------------------------------------------------
create or replace function public.create_team_account(
  p_team uuid, p_token text, p_username text, p_password text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_username, '')));
  v_u1 text;
  v_u2 text;
begin
  if not public.invite_valid(p_team, p_token) then
    raise exception 'Link inválido';
  end if;

  if not public.email_plausivel(v_email) then
    raise exception 'Informe um e-mail válido para o gestor do time (ex.: nome@email.com).';
  end if;

  if length(coalesce(p_password, '')) < 4 then
    raise exception 'A senha precisa ter pelo menos 4 caracteres.';
  end if;

  select username, username2 into v_u1, v_u2
    from public.team_invites where team_id = p_team;

  if v_u1 is not null and v_u2 is not null then
    raise exception 'Este time já possui 2 gestores';
  end if;
  if lower(trim(v_u1)) = v_email or lower(trim(v_u2)) = v_email then
    raise exception 'Este e-mail já é gestor deste time';
  end if;

  if v_u1 is null then
    update public.team_invites
       set username = v_email,
           password_hash = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  else
    update public.team_invites
       set username2 = v_email,
           password_hash2 = crypt(p_password, gen_salt('bf'))
     where team_id = p_team;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Login pelo link: comparação sem diferenciar maiúsculas.
--
-- E-mail não tem caixa. Quem cadastrou "Joao@Email.com" e digita
-- "joao@email.com" no celular (que capitaliza sozinho) é a mesma pessoa.
-- ---------------------------------------------------------------------------
create or replace function public.team_login(
  p_team uuid, p_token text, p_username text, p_password text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  r record;
  v_login text := lower(trim(coalesce(p_username, '')));
begin
  select username, password_hash, username2, password_hash2 into r
    from public.team_invites where team_id = p_team and token = p_token;
  if not found then return false; end if;

  if r.password_hash is not null and r.password_hash <> ''
     and lower(trim(r.username)) = v_login
     and r.password_hash = crypt(p_password, r.password_hash) then
    return true;
  end if;
  if r.password_hash2 is not null and r.password_hash2 <> ''
     and lower(trim(r.username2)) = v_login
     and r.password_hash2 = crypt(p_password, r.password_hash2) then
    return true;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Login pela PÁGINA INICIAL: e-mail + senha, sem link.
--
-- Devolve TODOS os times que aquele par abre — a mesma pessoa costuma gerir o
-- time do filho em dois campeonatos, e não faz sentido obrigá-la a lembrar de
-- qual link é qual.
--
-- O token do time vai junto porque é ele que abre o portal de inscrição. Não é
-- vazamento: quem acertou e-mail e senha do gestor já é o gestor.
--
-- Quando nada casa, devolve a lista vazia — sem dizer se o e-mail existe, se a
-- senha errou ou se a conta está zerada. Esta função responde para qualquer um
-- na internet; ela não vai ajudar quem está adivinhando.
-- ---------------------------------------------------------------------------
create or replace function public.team_login_email(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v jsonb;
begin
  if v_email = '' or coalesce(p_password, '') = '' then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(x order by x->>'championship_name'), '[]'::jsonb)
    into v
  from (
    select jsonb_build_object(
             'team_id', t.id,
             'token', i.token,
             'team_name', t.name,
             'team_logo', t.logo,
             'team_color', t.color,
             'championship_id', c.id,
             'championship_name', c.name,
             'championship_logo', c.logo,
             'championship_status', c.status
           ) as x
      from public.team_invites i
      join public.teams t on t.id = i.team_id
      join public.championships c on c.id = t.championship_id
     where (
             i.password_hash is not null and i.password_hash <> ''
             and lower(trim(i.username)) = v_email
             and i.password_hash = crypt(p_password, i.password_hash)
           )
        or (
             i.password_hash2 is not null and i.password_hash2 <> ''
             and lower(trim(i.username2)) = v_email
             and i.password_hash2 = crypt(p_password, i.password_hash2)
           )
  ) s;

  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Senha zerada pelo administrador: mesma comparação sem caixa.
--
-- A redefinição continua exigindo o link do organizador. É de propósito: se
-- desse para redefinir só com o e-mail, qualquer um que soubesse o endereço de
-- um gestor com a senha zerada entraria no time.
-- ---------------------------------------------------------------------------
create or replace function public.team_needs_password(p_team uuid, p_token text, p_username text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_invites
    where team_id = p_team and token = p_token
      and (
        (lower(trim(username))  = lower(trim(p_username)) and (password_hash  is null or password_hash  = '')) or
        (lower(trim(username2)) = lower(trim(p_username)) and (password_hash2 is null or password_hash2 = ''))
      )
  );
$$;

create or replace function public.team_set_password(
  p_team uuid, p_token text, p_username text, p_new text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text := crypt(p_new, gen_salt('bf'));
  v_login text := lower(trim(coalesce(p_username, '')));
begin
  update public.team_invites
     set password_hash  = case
           when lower(trim(username))  = v_login and (password_hash  is null or password_hash  = '') then v_hash
           else password_hash end,
         password_hash2 = case
           when lower(trim(username2)) = v_login and (password_hash2 is null or password_hash2 = '') then v_hash
           else password_hash2 end
   where team_id = p_team and token = p_token
     and (
       (lower(trim(username))  = v_login and (password_hash  is null or password_hash  = '')) or
       (lower(trim(username2)) = v_login and (password_hash2 is null or password_hash2 = ''))
     );
  return found;
end;
$$;

create or replace function public.reset_team_manager_password(p_team uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_login text := lower(trim(coalesce(p_username, '')));
begin
  if not exists (
    select 1 from public.teams t
    where t.id = p_team and public.owns_championship(t.championship_id)
  ) then
    raise exception 'Não autorizado';
  end if;
  update public.team_invites
     set password_hash  = case when lower(trim(username))  = v_login then '' else password_hash  end,
         password_hash2 = case when lower(trim(username2)) = v_login then '' else password_hash2 end
   where team_id = p_team;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
grant execute on function public.email_plausivel(text)                     to anon, authenticated;
grant execute on function public.team_login_email(text, text)              to anon, authenticated;
grant execute on function public.create_team_account(uuid, text, text, text) to anon, authenticated;
grant execute on function public.team_login(uuid, text, text, text)        to anon, authenticated;
grant execute on function public.team_needs_password(uuid, text, text)     to anon, authenticated;
grant execute on function public.team_set_password(uuid, text, text, text) to anon, authenticated;
grant execute on function public.reset_team_manager_password(uuid, text)   to authenticated;
