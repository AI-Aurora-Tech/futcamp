-- ===========================================================================
-- 0059 — Organizador valida o atleta conferindo no site da Receita
-- ===========================================================================
-- Alternativa gratuita à consulta automática (0058): o organizador abre o site
-- "Situação Cadastral do CPF" da Receita, confere o nome e confirma no app.
--
-- A confirmação entra na mesma tabela `cpf_verifications` (source = 'manual',
-- com quem confirmou), então o gatilho da 0058 continua sendo a única regra do
-- selo: trocar nome, CPF ou data depois derruba a validação.
--
-- Só dono, co-organizador ou master do campeonato confirmam
-- (`owns_championship`). O time não valida o próprio atleta.
--
-- Requer a 0058. Idempotente.
-- ===========================================================================

alter table public.cpf_verifications add column if not exists verified_by uuid;

create or replace function public.confirm_cpf_receita(p_player uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.players%rowtype;
  v_cpf text;
begin
  select * into p from public.players where id = p_player;
  if not found then
    raise exception 'Atleta não encontrado.';
  end if;
  if not public.owns_championship(p.championship_id) then
    raise exception 'Só o organizador do campeonato pode validar atletas.' using errcode = '42501';
  end if;
  v_cpf := regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g');
  if length(v_cpf) <> 11 or p.birthdate is null then
    raise exception 'O atleta precisa ter CPF e data de nascimento para ser validado.';
  end if;

  insert into public.cpf_verifications (cpf, birthdate, name, source, verified_by, verified_at)
  values (v_cpf, p.birthdate, p.name, 'manual', auth.uid(), now())
  on conflict (cpf, birthdate) do update
    set name = excluded.name, source = excluded.source,
        verified_by = excluded.verified_by, verified_at = excluded.verified_at;

  -- Regrava o atleta para o gatilho da 0058 acender o selo.
  update public.players set name = name where id = p_player;
end $$;

revoke all on function public.confirm_cpf_receita(uuid) from public, anon;
grant execute on function public.confirm_cpf_receita(uuid) to authenticated;
