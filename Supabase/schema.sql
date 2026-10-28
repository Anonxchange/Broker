-- Auvrenthia Markets browser-side Supabase setup.
-- Run this once in Supabase SQL Editor before enabling the Vercel deployment.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  address text not null default '',
  country text not null default '',
  phone text not null default '',
  admin_note text not null default '',
  role text not null default 'member'
    check (role in ('member', 'owner', 'finance', 'support')),
  account_status text not null default 'active'
    check (account_status in ('active', 'hold', 'suspended', 'archived')),
  kyc_status text not null default 'none'
    check (kyc_status in ('none', 'pending', 'verified', 'rejected')),
  withdrawals_enabled boolean not null default false,
  demo_balance numeric(14, 2) not null default 0
    check (demo_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.member_dashboard_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default
    '{"cash0":0,"plans":[],"tx":[],"wallet":null,"depositRequests":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_console_state (
  id text primary key default 'global' check (id = 'global'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.deposit_methods (
  id text primary key,
  asset text not null,
  network text not null,
  address text not null,
  qr_data_url text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_method_qr_size check (length(qr_data_url) <= 720000)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists member_dashboard_state_set_updated_at
  on public.member_dashboard_state;
create trigger member_dashboard_state_set_updated_at
before update on public.member_dashboard_state
for each row execute function public.set_updated_at();

drop trigger if exists admin_console_state_set_updated_at
  on public.admin_console_state;
create trigger admin_console_state_set_updated_at
before update on public.admin_console_state
for each row execute function public.set_updated_at();

drop trigger if exists deposit_methods_set_updated_at on public.deposit_methods;
create trigger deposit_methods_set_updated_at
before update on public.deposit_methods
for each row execute function public.set_updated_at();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select coalesce(
    public.current_profile_role() in ('owner', 'finance', 'support'),
    false
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.account_status = 'active'
  );
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    address,
    country,
    phone
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(new.raw_user_meta_data ->> 'address', ''),
    coalesce(new.raw_user_meta_data ->> 'country', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    address = excluded.address,
    country = excluded.country,
    phone = excluded.phone;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_patch jsonb
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  actor_role text := public.current_profile_role();
  allowed_keys text[];
begin
  if actor_role not in ('owner', 'finance', 'support') then
    raise exception 'Staff access is required.';
  end if;

  if actor_role = 'owner' then
    allowed_keys := array[
      'first_name', 'last_name', 'address', 'country', 'phone',
      'admin_note', 'account_status', 'kyc_status', 'withdrawals_enabled',
      'demo_balance'
    ];
  elsif actor_role = 'finance' then
    allowed_keys := array['withdrawals_enabled', 'demo_balance'];
  else
    allowed_keys := array['kyc_status', 'admin_note'];
  end if;

  if exists (
    select 1
    from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) as keys(key)
    where keys.key <> all (allowed_keys)
  ) then
    raise exception 'This role cannot update one or more requested profile fields.';
  end if;

  update public.profiles
  set
    first_name = coalesce(p_patch ->> 'first_name', first_name),
    last_name = coalesce(p_patch ->> 'last_name', last_name),
    address = coalesce(p_patch ->> 'address', address),
    country = coalesce(p_patch ->> 'country', country),
    phone = coalesce(p_patch ->> 'phone', phone),
    admin_note = coalesce(left(p_patch ->> 'admin_note', 3000), admin_note),
    account_status = coalesce(p_patch ->> 'account_status', account_status),
    kyc_status = coalesce(p_patch ->> 'kyc_status', kyc_status),
    withdrawals_enabled = coalesce(
      (p_patch ->> 'withdrawals_enabled')::boolean,
      withdrawals_enabled
    ),
    demo_balance = coalesce(
      (p_patch ->> 'demo_balance')::numeric,
      demo_balance
    )
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

create or replace function public.admin_set_profile_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  if public.current_profile_role() <> 'owner' then
    raise exception 'Only an owner can change staff roles.';
  end if;

  if p_role not in ('member', 'owner', 'finance', 'support') then
    raise exception 'Unsupported role.';
  end if;

  update public.profiles
  set role = p_role
  where id = p_user_id;

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.member_dashboard_state enable row level security;
alter table public.admin_console_state enable row level security;
alter table public.deposit_methods enable row level security;

drop policy if exists profiles_read_own_or_staff on public.profiles;
create policy profiles_read_own_or_staff
on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_platform_staff());

drop policy if exists profiles_update_own_contact on public.profiles;
create policy profiles_update_own_contact
on public.profiles for update to authenticated
using (id = (select auth.uid()) and public.is_active_member())
with check (id = (select auth.uid()) and public.is_active_member());

drop policy if exists dashboard_state_read_own_or_staff
  on public.member_dashboard_state;
create policy dashboard_state_read_own_or_staff
on public.member_dashboard_state for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());

drop policy if exists dashboard_state_insert_own
  on public.member_dashboard_state;
create policy dashboard_state_insert_own
on public.member_dashboard_state for insert to authenticated
with check (user_id = (select auth.uid()) and public.is_active_member());

drop policy if exists dashboard_state_update_own
  on public.member_dashboard_state;
create policy dashboard_state_update_own
on public.member_dashboard_state for update to authenticated
using (user_id = (select auth.uid()) and public.is_active_member())
with check (user_id = (select auth.uid()) and public.is_active_member());

drop policy if exists admin_console_state_read_staff
  on public.admin_console_state;
create policy admin_console_state_read_staff
on public.admin_console_state for select to authenticated
using (public.is_platform_staff());

drop policy if exists admin_console_state_insert_staff
  on public.admin_console_state;
create policy admin_console_state_insert_staff
on public.admin_console_state for insert to authenticated
with check (public.is_platform_staff());

drop policy if exists admin_console_state_update_staff
  on public.admin_console_state;
create policy admin_console_state_update_staff
on public.admin_console_state for update to authenticated
using (public.is_platform_staff())
with check (public.is_platform_staff());

drop policy if exists deposit_methods_read_active_or_staff
  on public.deposit_methods;
create policy deposit_methods_read_active_or_staff
on public.deposit_methods for select to authenticated
using (
  (is_active and public.is_active_member())
  or public.is_platform_staff()
);

drop policy if exists deposit_methods_manage_staff
  on public.deposit_methods;
create policy deposit_methods_manage_finance
on public.deposit_methods for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

revoke all on public.profiles from anon;
revoke all on public.member_dashboard_state from anon;
revoke all on public.admin_console_state from anon;
revoke all on public.deposit_methods from anon;

grant select on public.profiles to authenticated;
grant update (first_name, last_name, address, country, phone)
  on public.profiles to authenticated;
grant select, insert, update on public.member_dashboard_state to authenticated;
grant select, insert, update on public.admin_console_state to authenticated;
grant select, insert, update, delete on public.deposit_methods to authenticated;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_platform_staff() to authenticated;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.admin_update_profile(uuid, jsonb)
  to authenticated;
grant execute on function public.admin_set_profile_role(uuid, text)
  to authenticated;

revoke all on function public.current_profile_role() from public, anon;
revoke all on function public.is_platform_staff() from public, anon;
revoke all on function public.is_active_member() from public, anon;
revoke all on function public.admin_update_profile(uuid, jsonb) from public, anon;
revoke all on function public.admin_set_profile_role(uuid, text) from public, anon;
