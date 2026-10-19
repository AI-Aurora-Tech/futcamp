-- ===========================================================================
-- Tabelaço — o time só inscreve; editar e excluir atleta é do organizador
--
-- Depois de inscrito, o atleta não pode mais ser alterado nem removido pelo
-- link do time. Só o organizador (dono do campeonato) e o master corrigem ou
-- removem — pelo painel, que grava direto em `players` sob a RLS de dono.
--
-- Por isso as RPCs que o link do time usava para isso deixam de existir.
-- Apaga TODAS as versões (overloads) de cada uma: várias migrations antigas
-- criaram assinaturas diferentes, e qualquer sobra continuaria acessível.
-- ===========================================================================

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('reg_update_player', 'reg_delete_player')
  loop
    execute format('drop function if exists %s', f.assinatura);
  end loop;
end;
$$;
