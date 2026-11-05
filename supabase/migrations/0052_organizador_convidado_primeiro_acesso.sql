-- ===========================================================================
-- Tabelaço — primeiro acesso do organizador convidado
--
-- O organizador convidado (0047) entra pela tela principal digitando só o
-- e-mail; o app pergunta ao banco se aquele e-mail tem convite e AINDA NÃO tem
-- conta. Se tiver, oferece criar a senha ali mesmo.
--
-- Só responde para e-mail SEM conta: quem já tem conta entra com a senha dela,
-- e esta função nunca abre caminho para criar/trocar a senha de uma conta que
-- existe. Devolve apenas o que a tela precisa para a pessoa reconhecer o
-- convite (nome do campeonato e o nome dela) — nada de ids.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.organizador_convidado_sem_conta(p_email text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'championship_name', c.name,
           'name', o.name
         ) order by c.created_at desc), '[]'::jsonb)
    from public.championship_organizers o
    join public.championships c on c.id = o.championship_id
   where o.email = lower(trim(coalesce(p_email, '')))
     and not exists (
       select 1 from auth.users u
        where lower(u.email) = lower(trim(coalesce(p_email, '')))
     );
$$;

grant execute on function public.organizador_convidado_sem_conta(text) to anon, authenticated;
