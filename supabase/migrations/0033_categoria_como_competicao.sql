-- ===========================================================================
-- Tabelaço — cada categoria vira uma competição
--
-- Até aqui, categoria era um atributo do ATLETA: dizia quem podia ser
-- inscrito. A partida não sabia de categoria nenhuma, e um campeonato com
-- Sub-11, Sub-13 e Sub-15 gerava uma tabela só, misturando as três idades.
-- Isso contradizia a própria cobrança do app, que já cobra por categoria.
--
-- A partir daqui, cada categoria tem tabela, classificação, mata-mata,
-- campeão e — porque começam e terminam em datas diferentes — situação
-- própria.
--
-- O TIME continua sendo o CLUBE: um escudo, um responsável, um login. O que
-- nasce é a INSCRIÇÃO do clube em cada categoria (`team_categories`). O Leões
-- FC é um só, e disputa o Sub-11 e o Sub-15 — como no mundo real.
--
-- ---------------------------------------------------------------------------
-- Este é o PASSO 1: banco e dados. Depois de aplicá-lo, o app continua se
-- comportando exatamente como antes — tudo o que existe é convertido para a
-- primeira categoria, que é o mesmo que ter uma categoria só. As telas com
-- abas por categoria vêm no passo seguinte, e vão encontrar o terreno pronto.
-- ---------------------------------------------------------------------------
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A partida passa a saber de qual categoria é.
--
-- `text` e não uma chave estrangeira porque as categorias moram dentro de
-- `championships.categories` (jsonb) desde o começo — é lá que vivem o nome, a
-- faixa de idade, o tempo de jogo e o resto das regras. Uma tabela separada só
-- para o id seria uma segunda verdade sobre a mesma coisa.
-- ---------------------------------------------------------------------------
alter table public.matches add column if not exists category_id text;

create index if not exists matches_category_idx
  on public.matches (championship_id, category_id);

comment on column public.matches.category_id is
  'Categoria (id dentro de championships.categories) a que esta partida pertence.';

-- ---------------------------------------------------------------------------
-- 2. A inscrição do clube na categoria.
--
-- O grupo (A, B, C…) muda de lugar: sai do time e vem para cá. O mesmo clube
-- pode cair no grupo A do Sub-11 e no grupo C do Sub-15 — com o grupo preso ao
-- time, isso era impossível de representar.
-- ---------------------------------------------------------------------------
create table if not exists public.team_categories (
  team_id         uuid not null references public.teams on delete cascade,
  championship_id uuid not null references public.championships on delete cascade,
  category_id     text not null,
  "group"         text,
  created_at      timestamptz not null default now(),
  primary key (team_id, category_id)
);

create index if not exists team_categories_champ_idx
  on public.team_categories (championship_id, category_id);

alter table public.team_categories enable row level security;

-- Leitura pública, como times e partidas: a página do campeonato é aberta.
drop policy if exists team_categories_read on public.team_categories;
create policy team_categories_read on public.team_categories for select using (true);

drop policy if exists team_categories_write on public.team_categories;
create policy team_categories_write on public.team_categories
  for all using (public.owns_championship(championship_id))
  with check (public.owns_championship(championship_id));

-- ---------------------------------------------------------------------------
-- 3. O limite de equipes do plano conta CLUBES, não inscrições.
--
-- Um clube que disputa quatro categorias é um clube. Contar inscrições faria o
-- plano Grátis, de 8 equipes, não servir para nenhum campeonato de base — e o
-- número que está escrito no cartão do plano é de equipes.
--
-- O gatilho da 0031 já conta linhas de `teams`, então nada muda aqui. Fica
-- registrado porque é uma decisão, não um acaso.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. Conversão do que já existe.
--
-- Tudo vai para a PRIMEIRA categoria do campeonato. O resultado é idêntico ao
-- comportamento de hoje: uma competição só, com todos os jogos e todos os
-- clubes juntos.
--
-- Campeonato que já rodava com várias categorias fica com todos os jogos na
-- primeira — o que está correto do ponto de vista dos dados, mas pode não ser
-- o que o organizador queria. A tela de conferência do passo 2 existe para
-- isso: mostra os jogos convertidos e deixa mudá-los de categoria.
-- ---------------------------------------------------------------------------
update public.matches m
   set category_id = (
     select c.categories->0->>'id'
       from public.championships c
      where c.id = m.championship_id
   )
 where m.category_id is null;

insert into public.team_categories (team_id, championship_id, category_id, "group")
select t.id,
       t.championship_id,
       c.categories->0->>'id',
       nullif(t."group", '')
  from public.teams t
  join public.championships c on c.id = t.championship_id
 where jsonb_typeof(c.categories) = 'array'
   and jsonb_array_length(c.categories) > 0
   and c.categories->0->>'id' is not null
on conflict (team_id, category_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Situação por categoria.
--
-- Categorias começam e terminam em datas diferentes: o Sub-11 pode encerrar
-- com o Sub-17 ainda na semifinal. `status` e `finishedAt` passam a viver
-- dentro de cada categoria, junto das outras regras dela.
--
-- A situação do CAMPEONATO continua existindo e vale como padrão — categoria
-- sem situação própria herda a dele. É o que mantém funcionando tudo o que já
-- foi criado.
-- ---------------------------------------------------------------------------
create or replace function public.categoria_status(p_champ uuid, p_category text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select cat->>'status'
       from public.championships c,
            lateral jsonb_array_elements(coalesce(c.categories, '[]'::jsonb)) cat
      where c.id = p_champ and cat->>'id' = p_category
      limit 1),
    (select status from public.championships where id = p_champ)
  );
$$;

/*
 * Muda a situação de UMA categoria.
 *
 * Passa por função e não por escrita direta porque a situação mora dentro do
 * jsonb: reescrever o array inteiro do navegador é como duas pessoas mexendo
 * na mesma planilha — a última salva apaga a outra. Aqui só o elemento da
 * categoria é tocado.
 */
create or replace function public.set_categoria_status(
  p_champ uuid, p_category text, p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if p_status not in ('draft', 'active', 'finished') then
    raise exception 'Situação desconhecida: %', p_status;
  end if;
  if not public.owns_championship(p_champ) then
    raise exception 'Somente o organizador do campeonato pode mudar a situação da categoria.';
  end if;

  update public.championships c
     set categories = (
       select jsonb_agg(
         case
           when cat->>'id' = p_category then
             cat
               || jsonb_build_object('status', p_status)
               || case
                    when p_status = 'finished'
                      then jsonb_build_object('finishedAt', to_char(now() at time zone 'utc',
                                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                    else jsonb_build_object('finishedAt', null)
                  end
           else cat
         end
         order by ord
       )
       from jsonb_array_elements(c.categories) with ordinality as t(cat, ord)
     )
   where c.id = p_champ
   returning categories into v;

  return v;
end;
$$;

revoke all on function public.set_categoria_status(uuid, text, text) from public, anon;
grant execute on function public.set_categoria_status(uuid, text, text) to authenticated;
grant execute on function public.categoria_status(uuid, text)          to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Portal do time: as inscrições do clube viajam junto.
--
-- O responsável tem um login só e cuida de todas as categorias em que o clube
-- está. Para isso o portal precisa saber quais são.
-- ---------------------------------------------------------------------------
create or replace function public.team_registration(p_team uuid, p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare v jsonb;
begin
  if not public.invite_valid(p_team, p_token) then
    return null;
  end if;

  select jsonb_build_object(
    'team', to_jsonb(t.*),
    'championship_name', c.name,
    'championship_logo', c.logo,
    'audience', c.audience,
    'categories', c.categories,
    -- Em quais categorias este clube está inscrito. Vazio = todas (campeonato
    -- convertido, ou inscrição que o organizador ainda não fez).
    'team_categories', coalesce(
      (select jsonb_agg(tc.category_id order by tc.created_at)
         from public.team_categories tc where tc.team_id = p_team),
      '[]'::jsonb),
    'registration_cutoff_hours', c.registration_cutoff_hours,
    'closed_rounds', coalesce(c.closed_rounds, '[]'::jsonb),
    'championship', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'sport', c.sport,
      'audience', c.audience,
      'season', c.season,
      'description', c.description,
      'logo', c.logo,
      'format', c.format,
      'categories', c.categories,
      'double_round', c.double_round,
      'num_groups', c.num_groups,
      'teams_per_group', c.teams_per_group,
      'advance_per_group', c.advance_per_group,
      'league_qualifiers', c.league_qualifiers,
      'third_place', c.third_place,
      'points_win', c.points_win,
      'points_draw', c.points_draw,
      'tiebreakers', c.tiebreakers,
      'registration_cutoff_hours', c.registration_cutoff_hours,
      'bench_size', c.bench_size
    ),
    'has_account', (i.username is not null),
    'managers', to_jsonb(array_remove(array[i.username, i.username2], null)),
    'players', coalesce(
      (select jsonb_agg(to_jsonb(p.*) order by p.number nulls last)
         from public.players p where p.team_id = p_team),
      '[]'::jsonb)
  ) into v
  from public.teams t
  join public.championships c on c.id = t.championship_id
  join public.team_invites i on i.team_id = t.id
  where t.id = p_team;

  return v;
end;
$$;
