-- ===========================================================================
-- Tabelaço — mesário com senha zerada, pela tela de login padrão
--
-- Não há mais tela de login própria do mesário: ele entra pela página inicial,
-- com o e-mail e a senha. Quando o organizador zera a senha (0013), o mesário
-- precisa conseguir criar uma nova ali mesmo. `mesa_needs_password` responde por
-- UM campeonato; esta procura o e-mail em TODOS e devolve onde a senha está
-- zerada — o app então chama `mesa_set_password` (0013) em cada um.
--
-- Mesma exposição de `mesa_needs_password`: só diz que o e-mail está sem senha.
-- Idempotente.
-- ===========================================================================

create or replace function public.mesa_senha_zerada_email(p_username text)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'championship_id', o.championship_id,
           'championship_name', c.name,
           'username', o.username
         ) order by c.created_at desc), '[]'::jsonb)
    from public.officials o
    join public.championships c on c.id = o.championship_id
   where lower(o.username) = lower(trim(p_username))
     and (o.password_hash is null or o.password_hash = '');
$$;

grant execute on function public.mesa_senha_zerada_email(text) to anon, authenticated;
