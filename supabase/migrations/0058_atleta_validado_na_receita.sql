-- ===========================================================================
-- 0058 — Atleta validado na Receita Federal
-- ===========================================================================
-- O organizador confere o atleta no site "Situação Cadastral do CPF" da
-- Receita e confirma no app (RPC da 0059). A confirmação fica gravada em
-- `cpf_verifications`.
--
-- A marcação `players.cpf_verified` é decidida AQUI, pelo banco, e não pela
-- tela: o gatilho confere se aquele CPF + nascimento + nome foram mesmo
-- confirmados. Assim ninguém marca um atleta como "validado" mandando `true`
-- do navegador, e a regra vale para todos os caminhos de inscrição (portal do
-- time, painel do organizador, importação).
--
-- Se depois alguém trocar o nome, o CPF ou a data, a marcação cai sozinha.
--
-- Idempotente: pode ser reexecutada com segurança.
-- ===========================================================================

-- 1. Confirmações. Ninguém lê nem escreve direto: só a RPC da 0059.
create table if not exists public.cpf_verifications (
  cpf         text not null,
  birthdate   date not null,
  name        text not null,
  source      text not null default 'manual',
  verified_at timestamptz not null default now(),
  primary key (cpf, birthdate)
);
alter table public.cpf_verifications enable row level security;
revoke all on public.cpf_verifications from anon, authenticated;

-- 2. A marcação no atleta.
alter table public.players add column if not exists cpf_verified boolean not null default false;

-- 3. Nome comparado sem acento, caixa ou espaço duplo ("José  da Silva" = "JOSE DA SILVA").
create or replace function public.nome_normalizado(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(trim(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '\s+', ' ', 'g'))
$$;

-- 4. O gatilho: o valor enviado pelo cliente é ignorado.
create or replace function public.players_set_cpf_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.cpf_verified := exists (
    select 1 from public.cpf_verifications v
     where v.cpf = regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g')
       and v.birthdate = new.birthdate
       and public.nome_normalizado(v.name) = public.nome_normalizado(new.name)
  );
  return new;
end $$;

drop trigger if exists players_set_cpf_verified on public.players;
create trigger players_set_cpf_verified
  before insert or update on public.players
  for each row execute function public.players_set_cpf_verified();
