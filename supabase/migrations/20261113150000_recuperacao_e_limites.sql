-- Código de recuperação de senha (sem e-mail), limite de cadastros por conexão e sinal de vida diário.
--
-- Código de recuperação: na criação da conta, o app gera um código (16 letras e números) e mostra para a
-- pessoa guardar. Aqui fica só o código embaralhado (bcrypt), como uma senha. Com o código, quem esqueceu a
-- senha cria outra; o código vale uma vez e, ao ser usado, derruba as sessões abertas da conta.

-- ---------- Tabelas internas (fora da API) ----------

create table private.recovery_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hash text not null,
  created_at timestamptz not null default now()
);
alter table private.recovery_codes enable row level security;

create table private.recovery_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip text not null default '',
  at timestamptz not null default now()
);
create index recovery_attempts_email_idx on private.recovery_attempts (email, at desc);
create index recovery_attempts_ip_idx on private.recovery_attempts (ip, at desc);
alter table private.recovery_attempts enable row level security;

create table private.signup_log (
  id bigint generated always as identity primary key,
  ip text not null default '',
  at timestamptz not null default now()
);
create index signup_log_ip_idx on private.signup_log (ip, at desc);
alter table private.signup_log enable row level security;

-- Endereço de quem chamou, como o servidor da API repassa. Vazio se não vier.
create function private.client_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select btrim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
$$;

-- Só letras e números, em maiúsculas: "abcd-efgh 1234" e "ABCDEFGH1234" são o mesmo código.
create function private.normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

revoke all on function private.client_ip() from public, anon, authenticated;
revoke all on function private.normalize_code(text) from public, anon, authenticated;

-- ---------- Criar conta: agora com código de recuperação e limite por conexão ----------

drop function public.create_account(text, text);

create function public.create_account(p_email text, p_password text, p_recovery_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid := gen_random_uuid();
  v_ip text := private.client_ip();
  v_code text := private.normalize_code(p_recovery_code);
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) > 254 then
    return jsonb_build_object('status', 'error', 'code', 'email_address_invalid');
  end if;
  if char_length(coalesce(p_password, '')) < 8 or octet_length(p_password) > 72 then
    return jsonb_build_object('status', 'error', 'code', 'weak_password');
  end if;
  if p_recovery_code is not null and char_length(v_code) <> 16 then
    return jsonb_build_object('status', 'error', 'code', 'invalid_recovery_code');
  end if;
  -- Até 5 contas por hora pela mesma conexão e 300 por hora no total: ninguém sozinho trava os cadastros.
  if v_ip <> '' and (select count(*) from private.signup_log s where s.ip = v_ip and s.at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'error', 'code', 'over_request_rate_limit');
  end if;
  if (select count(*) from private.signup_log s where s.at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('status', 'error', 'code', 'over_request_rate_limit');
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return jsonb_build_object('status', 'error', 'code', 'user_already_exists');
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );

  if p_recovery_code is not null then
    insert into private.recovery_codes (user_id, code_hash) values (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)));
  end if;
  insert into private.signup_log (ip) values (v_ip);
  delete from private.signup_log s where s.at < now() - interval '2 days';

  return jsonb_build_object('status', 'ok');
end;
$$;

comment on function public.create_account(text, text, text) is 'Cria a conta já confirmada, com código de recuperação opcional. Até 5 contas por hora por conexão e 300 no total.';
revoke all on function public.create_account(text, text, text) from public;
grant execute on function public.create_account(text, text, text) to anon, authenticated;

-- ---------- Código de recuperação ----------

-- A pessoa logada cria (ou troca) o próprio código. O anterior deixa de valer.
create function public.set_recovery_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := private.normalize_code(p_code);
begin
  if (select auth.uid()) is null then
    raise exception 'Entre na sua conta.' using errcode = '42501';
  end if;
  if char_length(v_code) <> 16 then
    return jsonb_build_object('status', 'error', 'code', 'invalid_recovery_code');
  end if;
  insert into private.recovery_codes (user_id, code_hash, created_at)
  values ((select auth.uid()), extensions.crypt(v_code, extensions.gen_salt('bf', 10)), now())
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = excluded.created_at;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- A pessoa logada já tem um código guardado? (Não devolve o código: ele não existe aqui, só o embaralhado.)
create function public.has_recovery_code()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.recovery_codes r where r.user_id = (select auth.uid()));
$$;

-- Esqueceu a senha: com o e-mail e o código, define uma senha nova. O código é gasto e as sessões caem.
create function public.reset_password_with_code(p_email text, p_code text, p_new_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := private.normalize_code(p_code);
  v_ip text := private.client_ip();
  v_user uuid;
  v_hash text;
begin
  -- Freio contra adivinhação: 5 erros por hora por e-mail e 20 por conexão.
  if (select count(*) from private.recovery_attempts a where a.email = v_email and a.at > now() - interval '1 hour') >= 5
     or (v_ip <> '' and (select count(*) from private.recovery_attempts a where a.ip = v_ip and a.at > now() - interval '1 hour') >= 20) then
    return jsonb_build_object('status', 'error', 'code', 'over_request_rate_limit');
  end if;
  if char_length(coalesce(p_new_password, '')) < 8 or octet_length(p_new_password) > 72 then
    return jsonb_build_object('status', 'error', 'code', 'weak_password');
  end if;

  select u.id, r.code_hash into v_user, v_hash
    from auth.users u
    join private.recovery_codes r on r.user_id = u.id
   where lower(u.email) = v_email;

  if v_user is null or v_hash is null or extensions.crypt(v_code, v_hash) <> v_hash then
    insert into private.recovery_attempts (email, ip) values (v_email, v_ip);
    delete from private.recovery_attempts a where a.at < now() - interval '2 days';
    return jsonb_build_object('status', 'error', 'code', 'invalid_recovery_code');
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)), updated_at = now()
   where id = v_user;
  delete from private.recovery_codes where user_id = v_user;
  delete from auth.refresh_tokens where user_id = v_user::text;
  delete from auth.sessions where user_id = v_user;
  delete from private.recovery_attempts a where a.email = v_email;
  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.set_recovery_code(text) from public, anon;
grant execute on function public.set_recovery_code(text) to authenticated;
revoke all on function public.has_recovery_code() from public, anon;
grant execute on function public.has_recovery_code() to authenticated;
revoke all on function public.reset_password_with_code(text, text, text) from public;
grant execute on function public.reset_password_with_code(text, text, text) to anon, authenticated;

-- ---------- Sinal de vida ----------

-- O Supabase grátis pausa o projeto depois de uma semana sem uso. Uma chamada diária (.github/workflows/manter-ativo.yml)
-- mantém o projeto acordado mesmo sem ninguém usando o app.
create function public.keep_alive()
returns text
language sql
stable
set search_path = ''
as $$
  select 'ok'::text;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
