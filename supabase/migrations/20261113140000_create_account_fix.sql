-- Corrige create_account: a variável "email" tinha o mesmo nome da coluna auth.users.email, e o Postgres recusava
-- a consulta ("column reference email is ambiguous"). As variáveis passam a se chamar v_email e v_id.
-- create or replace mantém as permissões; elas são repetidas abaixo só para deixar explícito.
create or replace function public.create_account(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid := gen_random_uuid();
begin
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email) > 254 then
    return jsonb_build_object('status', 'error', 'code', 'email_address_invalid');
  end if;
  if char_length(coalesce(p_password, '')) < 8 or octet_length(p_password) > 72 then
    return jsonb_build_object('status', 'error', 'code', 'weak_password');
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
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

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.create_account(text, text) from public;
grant execute on function public.create_account(text, text) to anon, authenticated;
