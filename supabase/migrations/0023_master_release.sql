-- ===========================================================================
-- Tabelaço — liberação manual pelo administrador master
--
-- Nem todo pagamento passa pelo checkout: dinheiro na mão, transferência
-- direta, cortesia, patrocínio, ou uma confirmação que o Asaas não entregou.
-- Sem uma saída, o organizador que pagou fica preso e não há nada a fazer
-- pela interface.
--
-- A trava continua: `payment_status` NÃO pode ser mexido pelo app (o gatilho
-- da migration 0021 restaura os campos em qualquer update que não seja da
-- service role). Esta função é a única exceção, e ela exige `is_master()` —
-- verificado dentro do banco, não no navegador.
-- ===========================================================================

create or replace function public.master_release_championship(
  p_champ uuid,
  p_nota text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_master() then
    raise exception 'Somente o administrador master pode liberar um campeonato sem pagamento.';
  end if;

  update public.championships
     set payment_status = 'paid',
         payment_ref = coalesce(nullif(trim(p_nota), ''), 'liberado pelo master'),
         paid_at = now()
   where id = p_champ;

  if not found then
    raise exception 'Campeonato % não encontrado.', p_champ;
  end if;
end;
$$;

-- Só quem está logado pode chamar — e mesmo assim a função recusa quem não é
-- master. Visitante anônimo não chega nem a tentar.
revoke all on function public.master_release_championship(uuid, text) from public, anon;
grant execute on function public.master_release_championship(uuid, text) to authenticated;
