-- ===========================================================================
-- Tabelaço — login do mesário pela tela de login padrão
--
-- O mesário não é usuário do Supabase Auth: o login dele é por campeonato
-- (mesa_login). Para ele entrar pela página inicial, com o mesmo e-mail e
-- senha, esta RPC procura o mesário em TODOS os campeonatos e devolve em
-- quais as credenciais conferem (sem expor o hash). O app abre o portal do
-- mesário de cada um — que já mostra somente as partidas atribuídas a ele.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.mesa_login_email(p_username text, p_password text)
returns jsonb
language sql
security definer
stable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'championship_id', o.championship_id,
           'championship_name', c.name,
           'championship_logo', c.logo,
           'name', o.name,
           'username', o.username
         ) order by c.created_at desc), '[]'::jsonb)
    from public.officials o
    join public.championships c on c.id = o.championship_id
   where lower(o.username) = lower(trim(p_username))
     and o.password_hash is not null and o.password_hash <> ''
     and o.password_hash = crypt(p_password, o.password_hash);
$$;

grant execute on function public.mesa_login_email(text, text) to anon, authenticated;
