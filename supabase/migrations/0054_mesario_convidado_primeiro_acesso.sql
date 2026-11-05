-- ===========================================================================
-- Tabelaço — mesário cadastrado só com nome e e-mail
--
-- O organizador não define mais a senha do mesário (igual ao convite de
-- organizador):
--   • e-mail NOVO  → o mesário nasce com a senha zerada e a cria no primeiro
--     acesso pela tela de login principal (fluxo do 0013/0048);
--   • e-mail que JÁ É mesário em outro campeonato → herda a senha que a pessoa
--     já usa, então não precisa criar nada: o campeonato só aparece para ela.
--
-- Devolve true quando a pessoa já tinha senha (o app avisa o organizador).
-- A função antiga create_official(…, p_password) continua existindo.
-- Idempotente.
-- ===========================================================================

create or replace function public.add_official(p_champ uuid, p_name text, p_username text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(trim(coalesce(p_username, '')));
  v_hash  text;
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  if v_email = '' then
    raise exception 'Informe o e-mail do mesário.';
  end if;
  if exists (select 1 from public.officials
              where championship_id = p_champ and lower(username) = v_email) then
    raise exception 'Já existe um mesário com esse e-mail neste campeonato.';
  end if;

  select o.password_hash into v_hash
    from public.officials o
   where lower(o.username) = v_email
     and o.password_hash is not null and o.password_hash <> ''
   limit 1;

  insert into public.officials (championship_id, name, username, password_hash)
  values (p_champ, trim(p_name), v_email, coalesce(v_hash, ''));

  return v_hash is not null;
end;
$$;

grant execute on function public.add_official(uuid, text, text) to authenticated;
