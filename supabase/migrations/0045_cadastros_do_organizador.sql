-- ===========================================================================
-- Tabelaço — o organizador leva os seus cadastros para o campeonato novo
--
-- Árbitros e campos moram no próprio campeonato (jsonb) e o app copia sozinho.
-- Os MESÁRIOS são linhas em `officials`, com a senha em hash: copiar pelo
-- navegador exigiria ler o hash. Esta função copia no banco, sem expô-lo.
--
-- Copia, para `p_champ`, os mesários dos OUTROS campeonatos do mesmo dono —
-- um por e-mail (o cadastro mais recente vale), pulando quem já está lá. O
-- mesário entra no campeonato novo com o MESMO e-mail e a MESMA senha.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

create or replace function public.copiar_mesarios_do_organizador(p_champ uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_n     int;
begin
  if not public.owns_championship(p_champ) then
    raise exception 'Não autorizado';
  end if;
  select owner_id into v_owner from public.championships where id = p_champ;

  insert into public.officials (championship_id, name, username, password_hash)
  select p_champ, o.name, o.username, o.password_hash
    from (
      select distinct on (lower(trim(o.username))) o.*
        from public.officials o
        join public.championships c on c.id = o.championship_id
       where c.owner_id = v_owner and c.id <> p_champ
       order by lower(trim(o.username)), o.created_at desc
    ) o
   where not exists (
     select 1 from public.officials x
      where x.championship_id = p_champ
        and lower(trim(x.username)) = lower(trim(o.username))
   );

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.copiar_mesarios_do_organizador(uuid) from public, anon;
grant execute on function public.copiar_mesarios_do_organizador(uuid) to authenticated;
