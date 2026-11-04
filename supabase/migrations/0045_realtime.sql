-- ===========================================================================
-- Tabelaço — resultados em tempo real
--
-- Coloca as tabelas do campeonato na publicação do Supabase Realtime: quem
-- está com a página pública, o painel do organizador ou o portal do mesário
-- aberto recebe placares, eventos, times e atletas sem recarregar a janela.
--
-- `replica identity full` faz o DELETE trazer a linha antiga inteira (com o
-- championship_id), para o app ignorar exclusões de outros campeonatos.
--
-- A leitura continua sujeita ao RLS (as políticas *_read já são públicas).
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['championships', 'teams', 'players', 'matches', 'match_events'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

alter table public.teams        replica identity full;
alter table public.players      replica identity full;
alter table public.matches      replica identity full;
alter table public.match_events replica identity full;
