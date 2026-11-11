-- Contagem de instalações do Sobra: quantos aparelhos usam o app e quais.
-- Só dados técnicos do aparelho. Nenhum dado financeiro nem pessoal entra aqui: não há e-mail,
-- nome, IP, localização nem nada do que a pessoa lança no app.
--
-- Como o acesso funciona:
--   * O app (papel anon) NÃO tem acesso direto à tabela: nem SELECT, nem INSERT, nem UPDATE.
--     Ele só pode chamar register_install(), que grava ou atualiza UM registro, o do id informado.
--     O id é um UUID gerado no aparelho; quem não conhece o id não consegue tocar no registro.
--   * Ler a tabela exige estar logado E estar na lista private.admins.
--
-- Por que uma função em vez de políticas de INSERT/UPDATE para o anon: no Postgres, um UPDATE com
-- "where id = ..." (e todo upsert) só enxerga linhas que o papel também pode ler por SELECT.
-- Sem política de SELECT, o UPDATE do anon simplesmente não alteraria nada. A função resolve isso
-- sem abrir leitura, e ainda garante que first_seen e last_seen venham do relógio do servidor.

create schema if not exists private;

-- ---------- Tabela ----------

create table public.installs (
  id uuid primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  os text not null default 'Outro' check (char_length(os) <= 40),
  os_version text check (char_length(os_version) <= 40),
  browser text check (char_length(browser) <= 60),
  device_model text check (char_length(device_model) <= 80),
  is_standalone boolean not null default false,
  screen text check (char_length(screen) <= 24),
  app_version text check (char_length(app_version) <= 24)
);

comment on table public.installs is 'Um registro por aparelho que abriu o Sobra. Só dados técnicos anônimos.';
comment on column public.installs.id is 'UUID gerado no aparelho (crypto.randomUUID) e guardado no localStorage dele.';
comment on column public.installs.is_standalone is 'Verdadeiro se o aparelho já abriu o Sobra como app instalado (PWA).';

create index installs_first_seen_idx on public.installs (first_seen);
create index installs_last_seen_idx on public.installs (last_seen);

alter table public.installs enable row level security;

-- ---------- Quem pode ler ----------

-- Lista de administradores, fora do esquema exposto pela API. O e-mail não fica no código:
-- a lista guarda o id do usuário do Supabase Auth.
create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table private.admins enable row level security;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.admins a where a.user_id = (select auth.uid()));
$$;

revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Permissões explícitas: o anon não ganha nada na tabela.
revoke all on table public.installs from public, anon, authenticated;
grant select on table public.installs to authenticated;

create policy "Só administradores leem as instalações"
on public.installs
for select
to authenticated
using ((select private.is_admin()));

-- Sem políticas de INSERT, UPDATE ou DELETE: pela API, ninguém escreve direto na tabela.

-- ---------- Registro feito pelo app ----------

create function public.register_install(
  p_id uuid,
  p_os text default null,
  p_os_version text default null,
  p_browser text default null,
  p_device_model text default null,
  p_is_standalone boolean default false,
  p_screen text default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_new boolean;
begin
  if p_id is null then
    raise exception 'O id do aparelho é obrigatório.' using errcode = '22023';
  end if;

  -- Freio contra abuso: a função é pública por natureza, então limita quantos aparelhos NOVOS
  -- entram por hora. Quem já está registrado continua atualizando normalmente.
  select not exists (select 1 from public.installs i where i.id = p_id) into is_new;
  if is_new and (
    select count(*) from public.installs i where i.first_seen > now() - interval '1 hour'
  ) >= 500 then
    return;
  end if;

  insert into public.installs as i (id, os, os_version, browser, device_model, is_standalone, screen, app_version)
  values (
    p_id,
    coalesce(nullif(left(btrim(p_os), 40), ''), 'Outro'),
    nullif(left(btrim(p_os_version), 40), ''),
    nullif(left(btrim(p_browser), 60), ''),
    nullif(left(btrim(p_device_model), 80), ''),
    coalesce(p_is_standalone, false),
    nullif(left(btrim(p_screen), 24), ''),
    nullif(left(btrim(p_app_version), 24), '')
  )
  on conflict (id) do update set
    last_seen = now(),
    os = excluded.os,
    os_version = excluded.os_version,
    browser = excluded.browser,
    -- O modelo nem sempre vem; um valor já conhecido não é apagado.
    device_model = coalesce(excluded.device_model, i.device_model),
    -- No Android, o app instalado e o navegador dividem o mesmo id: uma vez instalado, fica marcado.
    is_standalone = i.is_standalone or excluded.is_standalone,
    screen = excluded.screen,
    app_version = excluded.app_version;
end;
$$;

comment on function public.register_install is 'Chamada pelo app: cria o registro do aparelho ou atualiza last_seen e os dados técnicos do próprio id.';

revoke all on function public.register_install(uuid, text, text, text, text, boolean, text, text) from public;
grant execute on function public.register_install(uuid, text, text, text, text, boolean, text, text) to anon, authenticated;

-- ---------- Números do painel ----------

-- Roda com as permissões de quem chama (security invoker): a política de leitura continua valendo.
create function public.install_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  days integer := least(greatest(coalesce(p_days, 30), 7), 90);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  result jsonb;
begin
  if not (select private.is_admin()) then
    raise exception 'Acesso restrito ao administrador.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'active_7d', count(*) filter (where i.last_seen >= now() - interval '7 days'),
    'active_30d', count(*) filter (where i.last_seen >= now() - interval '30 days'),
    'standalone', count(*) filter (where i.is_standalone),
    'new_7d', count(*) filter (where i.first_seen >= now() - interval '7 days')
  )
  into result
  from public.installs i;

  return result || jsonb_build_object(
    'days', days,
    'by_os', (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'count', t.n) order by t.n desc, t.label), '[]'::jsonb)
      from (select i.os as label, count(*) as n from public.installs i group by 1) t
    ),
    'by_model', (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'count', t.n) order by t.n desc, t.label), '[]'::jsonb)
      from (
        select coalesce(i.device_model, 'Não informado') as label, count(*) as n
        from public.installs i group by 1 order by 2 desc, 1 limit 15
      ) t
    ),
    'by_browser', (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'count', t.n) order by t.n desc, t.label), '[]'::jsonb)
      from (
        -- "Chrome 141" e "Chrome 142" contam juntos como "Chrome".
        select coalesce(nullif(regexp_replace(i.browser, '\s+[\d.]+$', ''), ''), 'Não informado') as label, count(*) as n
        from public.installs i group by 1
      ) t
    ),
    'by_app_version', (
      select coalesce(jsonb_agg(jsonb_build_object('label', t.label, 'count', t.n) order by t.n desc, t.label), '[]'::jsonb)
      from (select coalesce(i.app_version, 'Não informada') as label, count(*) as n from public.installs i group by 1) t
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0)) order by d.day)
      from (select generate_series(today - (days - 1), today, interval '1 day')::date as day) d
      left join (
        select (i.first_seen at time zone 'America/Sao_Paulo')::date as day, count(*) as n
        from public.installs i group by 1
      ) c on c.day = d.day
    ),
    'recent', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.last_seen desc), '[]'::jsonb)
      from (
        select i.first_seen, i.last_seen, i.os, i.os_version, i.browser, i.device_model, i.is_standalone, i.screen, i.app_version
        from public.installs i order by i.last_seen desc limit 20
      ) r
    )
  );
end;
$$;

comment on function public.install_stats is 'Totais e distribuições para o painel #/admin/instalacoes. Só responde a administradores.';

revoke all on function public.install_stats(integer) from public, anon;
grant execute on function public.install_stats(integer) to authenticated;

-- ---------- Depois de aplicar ----------
-- 1. No painel do Supabase, em Authentication > Users, crie o seu usuário (e-mail e senha).
--    Em Authentication > Sign In / Providers, desligue "Allow new users to sign up":
--    o painel só precisa do seu login.
-- 2. No SQL Editor (não neste arquivo, para o e-mail não ir para o repositório), rode:
--      insert into private.admins (user_id)
--      select id from auth.users where email = 'SEU_EMAIL_AQUI';
