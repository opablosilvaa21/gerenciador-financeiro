-- Backup na nuvem: os dados financeiros de cada pessoa, guardados na conta dela, para recuperar
-- num celular novo e manter dois aparelhos iguais.
--
-- Uma linha por conta (o "cofre"), com tudo o que o app guarda: carteiras, categorias, lançamentos,
-- contas fixas e metas, no mesmo formato do backup em JSON.
--
-- Quem acessa o quê:
--   * Cada pessoa logada lê, grava e apaga só o próprio cofre (RLS por auth.uid()). Ninguém lê o de outra.
--   * Sem login (papel anon), nada.
--   * O histórico (últimas 5 versões de cada cofre) fica no esquema private, fora da API: serve para
--     recuperar dados se algo der errado, e só o administrador do projeto alcança.

-- ---------- Cofre ----------

create table public.vaults (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by text check (char_length(updated_by) <= 64),
  size_bytes integer not null default 0
);

comment on table public.vaults is 'Backup na nuvem: os dados do app de cada conta. Só o dono acessa.';
comment on column public.vaults.revision is 'Sobe a cada gravação. O app grava dizendo qual versão viu por último; se outro aparelho gravou antes, junta e tenta de novo.';

alter table public.vaults enable row level security;

revoke all on table public.vaults from public, anon, authenticated;
grant select, insert, update, delete on table public.vaults to authenticated;

create policy "Cada pessoa lê só o próprio cofre"
on public.vaults for select to authenticated
using (user_id = (select auth.uid()));

create policy "Cada pessoa cria só o próprio cofre"
on public.vaults for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Cada pessoa altera só o próprio cofre"
on public.vaults for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Cada pessoa apaga só o próprio cofre"
on public.vaults for delete to authenticated
using (user_id = (select auth.uid()));

-- ---------- Gravar com controle de versão ----------

-- Roda com as permissões de quem chama (security invoker): as regras acima continuam valendo.
create function public.save_vault(p_data jsonb, p_base_revision bigint, p_device text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  size integer := octet_length(p_data::text);
  new_revision bigint;
  current_revision bigint;
begin
  if uid is null then
    raise exception 'Entre na sua conta para guardar na nuvem.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data -> 'transactions') is distinct from 'array'
     or jsonb_typeof(p_data -> 'accounts') is distinct from 'array' then
    raise exception 'Os dados não têm o formato do app.' using errcode = '22023';
  end if;
  if size > 5 * 1024 * 1024 then
    raise exception 'Os dados passaram de 5 MB.' using errcode = '54000';
  end if;

  if coalesce(p_base_revision, 0) = 0 then
    insert into public.vaults (user_id, data, revision, updated_by, size_bytes)
    values (uid, p_data, 1, left(p_device, 64), size)
    on conflict (user_id) do nothing
    returning revision into new_revision;
  else
    update public.vaults
       set data = p_data,
           revision = revision + 1,
           updated_at = now(),
           updated_by = left(p_device, 64),
           size_bytes = size
     where user_id = uid and revision = p_base_revision
    returning revision into new_revision;
  end if;

  if new_revision is not null then
    return jsonb_build_object('status', 'ok', 'revision', new_revision);
  end if;

  -- Outro aparelho gravou antes (ou o cofre foi apagado): o app busca, junta e tenta de novo.
  select v.revision into current_revision from public.vaults v where v.user_id = uid;
  return jsonb_build_object('status', 'conflict', 'revision', current_revision);
end;
$$;

comment on function public.save_vault is 'Grava o cofre da pessoa logada se ninguém gravou desde a versão informada; senão devolve conflict.';

revoke all on function public.save_vault(jsonb, bigint, text) from public, anon;
grant execute on function public.save_vault(jsonb, bigint, text) to authenticated;

-- ---------- Histórico: as 5 últimas versões de cada cofre ----------

create table private.vault_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  revision bigint not null,
  data jsonb not null,
  saved_at timestamptz not null default now()
);

create index vault_history_user_idx on private.vault_history (user_id, revision desc);

alter table private.vault_history enable row level security;

create function private.keep_vault_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.vault_history (user_id, revision, data, saved_at)
  values (old.user_id, old.revision, old.data, old.updated_at);

  delete from private.vault_history h
   where h.user_id = old.user_id
     and h.id not in (
       select k.id from private.vault_history k
        where k.user_id = old.user_id
        order by k.revision desc
        limit 5
     );
  return new;
end;
$$;

revoke all on function private.keep_vault_history() from public, anon, authenticated;

create trigger vaults_keep_history
after update of data on public.vaults
for each row
when (old.data is distinct from new.data)
execute function private.keep_vault_history();

-- ---------- Excluir a conta (LGPD) ----------

-- Apaga o usuário logado; o cofre e o histórico saem junto (on delete cascade).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Entre na sua conta para excluí-la.' using errcode = '42501';
  end if;
  delete from auth.users where id = (select auth.uid());
end;
$$;

comment on function public.delete_my_account is 'A pessoa logada exclui a própria conta e tudo o que estava guardado na nuvem.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Criar conta sem depender de e-mail ----------

-- O envio de e-mail embutido do Supabase só entrega para a equipe do projeto, então a confirmação por e-mail
-- não chegaria a quem usa o app. Esta função cria a conta já confirmada, com a senha guardada em bcrypt
-- (o mesmo formato que o login do Supabase confere). Depois disso, o app entra pelo login normal.
-- Freio contra abuso: no máximo 60 contas novas por hora no projeto inteiro.
create function public.create_account(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  email text := lower(btrim(coalesce(p_email, '')));
  new_id uuid := gen_random_uuid();
begin
  if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(email) > 254 then
    return jsonb_build_object('status', 'error', 'code', 'email_address_invalid');
  end if;
  if char_length(coalesce(p_password, '')) < 8 or octet_length(p_password) > 72 then
    return jsonb_build_object('status', 'error', 'code', 'weak_password');
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = email) then
    return jsonb_build_object('status', 'error', 'code', 'user_already_exists');
  end if;
  if (select count(*) from auth.users u where u.created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('status', 'error', 'code', 'over_request_rate_limit');
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated', email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.create_account is 'Cria a conta do backup na nuvem já confirmada, sem depender de e-mail. Limite de 60 contas novas por hora.';

revoke all on function public.create_account(text, text) from public;
grant execute on function public.create_account(text, text) to anon, authenticated;
