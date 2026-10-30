-- Auvrenthia Markets - schema part 2 (idempotent; safe to re-run).
-- Run AFTER schema.sql and storage-migration.sql.
-- Before running: Supabase Auth > Providers > Email > turn ON "Confirm email".
-- Money rule: members never write money tables directly. Everything goes
-- through the security-definer functions below, and every balance change
-- lands in balance_ledger.

-- =====================================================================
-- 0. Fixes and helpers
-- =====================================================================
drop policy if exists deposit_methods_manage_staff on public.deposit_methods;
drop policy if exists deposit_methods_manage_finance on public.deposit_methods;
create policy deposit_methods_manage_finance
on public.deposit_methods for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

alter table public.profiles
  add column if not exists avatar_path text not null default '';
grant update (avatar_path) on public.profiles to authenticated;

create table if not exists public.app_settings (
  id text primary key default 'global' check (id = 'global'),
  need_kyc boolean not null default true,          -- true: tier 2 (ID) required to trade/withdraw/invest
  withdrawals_paused boolean not null default false,
  trading_paused boolean not null default false,
  trade_fee_pct numeric(5, 2) not null default 0 check (trade_fee_pct between 0 and 20),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values ('global') on conflict (id) do nothing;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_user uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_target_idx on public.audit_log (target_user, created_at desc);

create or replace function public.log_audit(p_action text, p_target uuid, p_detail jsonb)
returns void language sql security definer
set search_path = public set row_security = off as $$
  insert into public.audit_log (actor_id, action, target_user, detail)
  values ((select auth.uid()), p_action, p_target, coalesce(p_detail, '{}'::jsonb));
$$;

-- =====================================================================
-- 1. Balance ledger (profiles.demo_balance stays as the cached total)
-- =====================================================================
create table if not exists public.balance_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'deposit', 'withdrawal_hold', 'withdrawal_release', 'trade_buy', 'trade_sell',
    'plan_investment', 'plan_payout', 'signal_subscription', 'admin_adjust')),
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  ref_table text,
  ref_id text,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists balance_ledger_user_idx on public.balance_ledger (user_id, created_at desc);

create or replace function public._post_ledger(
  p_user uuid, p_kind text, p_amount numeric,
  p_ref_table text, p_ref_id text, p_note text)
returns numeric language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_cur numeric(14, 2); v_amt numeric(14, 2) := round(p_amount, 2); v_new numeric(14, 2);
begin
  select demo_balance into v_cur from public.profiles where id = p_user for update;
  if not found then raise exception 'Profile not found.'; end if;
  v_new := v_cur + v_amt;
  if v_new < 0 then raise exception 'Insufficient balance.'; end if;
  perform set_config('app.ledger_post', 'on', true);
  update public.profiles set demo_balance = v_new where id = p_user;
  perform set_config('app.ledger_post', 'off', true);
  insert into public.balance_ledger
    (user_id, kind, amount, balance_after, ref_table, ref_id, note, created_by)
  values (p_user, p_kind, v_amt, v_new, p_ref_table, p_ref_id, coalesce(p_note, ''), (select auth.uid()));
  return v_new;
end;
$$;

-- Any direct edit of demo_balance (e.g. old admin_update_profile path) is still ledgered.
create or replace function public.profiles_balance_guard()
returns trigger language plpgsql security definer
set search_path = public set row_security = off as $$
begin
  if new.demo_balance is distinct from old.demo_balance
     and coalesce(current_setting('app.ledger_post', true), '') <> 'on' then
    insert into public.balance_ledger (user_id, kind, amount, balance_after, note, created_by)
    values (new.id, 'admin_adjust', new.demo_balance - old.demo_balance,
            new.demo_balance, 'Direct balance edit', (select auth.uid()));
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_balance_guard on public.profiles;
create trigger profiles_balance_guard
after update of demo_balance on public.profiles
for each row execute function public.profiles_balance_guard();

create or replace function public.admin_adjust_balance(p_user uuid, p_amount numeric, p_note text)
returns numeric language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_new numeric;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Enter a non-zero amount.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A reason is required.'; end if;
  v_new := public._post_ledger(p_user, 'admin_adjust', p_amount, 'profiles', p_user::text, p_note);
  perform public.log_audit('balance_adjust', p_user, jsonb_build_object('amount', p_amount, 'note', p_note));
  return v_new;
end;
$$;

-- =====================================================================
-- 2. KYC: tier 1 = email confirmed (Supabase Auth), tier 2 = ID approved
-- =====================================================================
create table if not exists public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_type text not null check (document_type in ('passport', 'national_id', 'drivers_license')),
  issuing_country text not null,
  date_of_birth date,
  expiry_date date,
  front_path text not null,
  back_path text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text not null default '',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists kyc_submissions_user_idx on public.kyc_submissions (user_id, created_at desc);

-- Document numbers live apart so members can never read them back.
create table if not exists public.kyc_document_numbers (
  submission_id uuid primary key references public.kyc_submissions (id) on delete cascade,
  document_number text not null
);

create or replace function public.member_tier(p_user uuid default null)
returns int language plpgsql stable security definer
set search_path = public set row_security = off as $$
declare v uuid := coalesce(p_user, (select auth.uid())); v_email boolean; v_kyc boolean;
begin
  if v is null then return 0; end if;
  if v <> (select auth.uid()) and not public.is_platform_staff() then
    raise exception 'Not allowed.'; end if;
  select (u.email_confirmed_at is not null) into v_email from auth.users u where u.id = v;
  select (p.kyc_status = 'verified') into v_kyc from public.profiles p where p.id = v;
  if coalesce(v_email, false) and coalesce(v_kyc, false) then return 2; end if;
  if coalesce(v_email, false) then return 1; end if;
  return 0;
end;
$$;

create or replace function public._tier_required()
returns int language sql stable security definer
set search_path = public set row_security = off as $$
  select case when need_kyc then 2 else 1 end from public.app_settings where id = 'global';
$$;

create or replace function public._assert_ready(p_min_tier int)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'Sign in required.'; end if;
  if not public.is_active_member() then raise exception 'This account is not active.'; end if;
  if public.member_tier(v_uid) < p_min_tier then
    raise exception 'Complete verification (tier %) first.', p_min_tier; end if;
  return v_uid;
end;
$$;

create or replace function public.submit_kyc(
  p_document_type text, p_document_number text, p_country text,
  p_dob date, p_expiry date, p_front_path text, p_back_path text)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := public._assert_ready(1);  -- email must be confirmed first
  if exists (select 1 from public.profiles where id = v_uid and kyc_status = 'verified') then
    raise exception 'Your ID is already verified.'; end if;
  if exists (select 1 from public.kyc_submissions where user_id = v_uid and status = 'pending') then
    raise exception 'A submission is already under review.'; end if;
  if coalesce(trim(p_document_number), '') = '' or coalesce(trim(p_country), '') = '' then
    raise exception 'Document number and issuing country are required.'; end if;
  if p_front_path not like 'kyc/' || v_uid::text || '/%'
     or (coalesce(p_back_path, '') <> '' and p_back_path not like 'kyc/' || v_uid::text || '/%') then
    raise exception 'Upload the ID images to your own folder first.'; end if;
  insert into public.kyc_submissions
    (user_id, document_type, issuing_country, date_of_birth, expiry_date, front_path, back_path)
  values (v_uid, p_document_type, trim(p_country), p_dob, p_expiry, p_front_path, coalesce(p_back_path, ''))
  returning id into v_id;
  insert into public.kyc_document_numbers (submission_id, document_number)
  values (v_id, trim(p_document_number));
  update public.profiles set kyc_status = 'pending' where id = v_uid;
  return v_id;
end;
$$;

create or replace function public.review_kyc(p_submission uuid, p_approve boolean, p_reason text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare s record;
begin
  if public.current_profile_role() not in ('owner', 'support') then
    raise exception 'Owner or support access is required.'; end if;
  select * into s from public.kyc_submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found.'; end if;
  if s.status <> 'pending' then raise exception 'Already reviewed.'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'A rejection reason is required.'; end if;
  update public.kyc_submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         rejection_reason = case when p_approve then '' else trim(p_reason) end,
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_submission;
  update public.profiles
     set kyc_status = case when p_approve then 'verified' else 'rejected' end
   where id = s.user_id;
  perform public.log_audit('kyc_review', s.user_id,
    jsonb_build_object('submission', p_submission, 'approved', p_approve, 'reason', p_reason));
end;
$$;

-- =====================================================================
-- 3. Assets, prices, holdings, orders (admin-set prices)
-- =====================================================================
create table if not exists public.assets (
  symbol text primary key check (symbol = upper(symbol)),
  name text not null,
  category text not null default 'crypto' check (category in ('crypto', 'forex', 'commodity')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.asset_prices (
  symbol text primary key references public.assets (symbol) on delete cascade,
  price numeric(24, 8) not null check (price > 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.holdings (
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null references public.assets (symbol),
  quantity numeric(28, 10) not null default 0 check (quantity >= 0),
  avg_cost numeric(24, 8) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null references public.assets (symbol),
  side text not null check (side in ('buy', 'sell')),
  quantity numeric(28, 10) not null check (quantity > 0),
  price numeric(24, 8) not null,
  total_usd numeric(14, 2) not null,
  fee_usd numeric(14, 2) not null default 0,
  status text not null default 'filled' check (status in ('filled', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- Stablecoins priced at 1; set every other price from the admin console.
insert into public.assets (symbol, name, category) values
  ('USDT', 'Tether', 'crypto'), ('USDC', 'USD Coin', 'crypto'),
  ('BTC', 'Bitcoin', 'crypto'), ('ETH', 'Ethereum', 'crypto'),
  ('BNB', 'BNB', 'crypto'), ('SOL', 'Solana', 'crypto')
on conflict (symbol) do nothing;
insert into public.asset_prices (symbol, price) values ('USDT', 1), ('USDC', 1)
on conflict (symbol) do nothing;

create or replace function public.place_order(p_symbol text, p_side text, p_qty numeric)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare
  v_uid uuid; v_sym text := upper(trim(p_symbol)); v_price numeric; st record;
  v_total numeric(14, 2); v_fee numeric(14, 2); v_id uuid := gen_random_uuid(); v_have numeric;
begin
  v_uid := public._assert_ready(public._tier_required());
  if p_side not in ('buy', 'sell') then raise exception 'Choose buy or sell.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter a quantity greater than zero.'; end if;
  select * into st from public.app_settings where id = 'global';
  if st.trading_paused then raise exception 'Trading is paused.'; end if;
  select ap.price into v_price from public.asset_prices ap
    join public.assets a on a.symbol = ap.symbol where ap.symbol = v_sym and a.is_active;
  if v_price is null then raise exception 'No price available for %.', v_sym; end if;
  v_total := round(p_qty * v_price, 2);
  if v_total <= 0 then raise exception 'Order is too small.'; end if;
  v_fee := round(v_total * st.trade_fee_pct / 100, 2);

  insert into public.orders (id, user_id, symbol, side, quantity, price, total_usd, fee_usd)
  values (v_id, v_uid, v_sym, p_side, p_qty, v_price, v_total, v_fee);

  if p_side = 'buy' then
    perform public._post_ledger(v_uid, 'trade_buy', -(v_total + v_fee), 'orders', v_id::text, 'Buy ' || v_sym);
    insert into public.holdings (user_id, symbol, quantity, avg_cost)
    values (v_uid, v_sym, p_qty, v_price)
    on conflict (user_id, symbol) do update set
      avg_cost = (holdings.quantity * holdings.avg_cost + excluded.quantity * excluded.avg_cost)
                 / (holdings.quantity + excluded.quantity),
      quantity = holdings.quantity + excluded.quantity,
      updated_at = now();
  else
    select quantity into v_have from public.holdings
     where user_id = v_uid and symbol = v_sym for update;
    if coalesce(v_have, 0) < p_qty then raise exception 'You do not hold enough %.', v_sym; end if;
    update public.holdings set quantity = quantity - p_qty, updated_at = now()
     where user_id = v_uid and symbol = v_sym;
    perform public._post_ledger(v_uid, 'trade_sell', v_total - v_fee, 'orders', v_id::text, 'Sell ' || v_sym);
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_set_holding(p_user uuid, p_symbol text, p_qty numeric)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
begin
  if public.current_profile_role() <> 'owner' then raise exception 'Only an owner can set holdings.'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Quantity cannot be negative.'; end if;
  insert into public.holdings (user_id, symbol, quantity)
  values (p_user, upper(p_symbol), p_qty)
  on conflict (user_id, symbol) do update set quantity = excluded.quantity, updated_at = now();
  perform public.log_audit('holding_set', p_user, jsonb_build_object('symbol', upper(p_symbol), 'qty', p_qty));
end;
$$;

-- =====================================================================
-- 4. Deposits and withdrawals (real tables; balance moves via ledger)
-- =====================================================================
create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  method_id text references public.deposit_methods (id) on delete set null,
  asset text not null,
  network text not null,
  amount numeric(28, 10) not null check (amount > 0),
  usd_amount numeric(14, 2) not null default 0,
  receipt_path text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  note text not null default '',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists deposits_user_idx on public.deposits (user_id, created_at desc);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  asset text not null,
  network text not null,
  address text not null,
  amount numeric(28, 10) not null check (amount > 0),
  usd_amount numeric(14, 2) not null check (usd_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  note text not null default '',
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists withdrawals_user_idx on public.withdrawals (user_id, created_at desc);

create or replace function public.request_deposit(
  p_method_id text, p_amount numeric, p_usd numeric, p_receipt_path text)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; m record; v_price numeric; v_usd numeric(14, 2); v_id uuid;
begin
  v_uid := public._assert_ready(1);
  select * into m from public.deposit_methods where id = p_method_id and is_active;
  if not found then raise exception 'That deposit method is not available.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if p_receipt_path not like 'deposit-proofs/' || v_uid::text || '/%' then
    raise exception 'Upload your receipt first.'; end if;
  select price into v_price from public.asset_prices where symbol = upper(m.asset);
  v_usd := coalesce(round(p_amount * v_price, 2), round(coalesce(p_usd, 0), 2));
  insert into public.deposits (user_id, method_id, asset, network, amount, usd_amount, receipt_path)
  values (v_uid, m.id, m.asset, m.network, p_amount, v_usd, p_receipt_path)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.decide_deposit(
  p_id uuid, p_approve boolean, p_note text default '', p_usd numeric default null)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare d record; v_usd numeric(14, 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into d from public.deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found.'; end if;
  if d.status <> 'pending' then raise exception 'Already decided.'; end if;
  v_usd := round(coalesce(p_usd, d.usd_amount), 2);
  if p_approve then
    if v_usd <= 0 then raise exception 'Set a USD credit amount greater than zero.'; end if;
    perform public._post_ledger(d.user_id, 'deposit', v_usd, 'deposits', d.id::text, 'Deposit approved');
  end if;
  update public.deposits
     set status = case when p_approve then 'approved' else 'declined' end,
         usd_amount = v_usd, note = coalesce(p_note, ''),
         decided_by = (select auth.uid()), decided_at = now()
   where id = p_id;
  perform public.log_audit('deposit_decision', d.user_id,
    jsonb_build_object('id', p_id, 'approved', p_approve, 'usd', v_usd));
end;
$$;

create or replace function public.request_withdrawal(
  p_asset text, p_network text, p_address text, p_amount numeric, p_usd numeric)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; v_price numeric; v_usd numeric(14, 2); v_id uuid := gen_random_uuid();
begin
  v_uid := public._assert_ready(public._tier_required());
  if (select withdrawals_paused from public.app_settings where id = 'global') then
    raise exception 'Withdrawals are paused.'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and withdrawals_enabled) then
    raise exception 'Withdrawals are not enabled for your account.'; end if;
  if p_amount is null or p_amount <= 0 or coalesce(trim(p_address), '') = '' then
    raise exception 'Enter an amount and destination address.'; end if;
  select price into v_price from public.asset_prices where symbol = upper(p_asset);
  v_usd := coalesce(round(p_amount * v_price, 2), round(coalesce(p_usd, 0), 2));
  if v_usd <= 0 then raise exception 'Could not price this withdrawal.'; end if;
  insert into public.withdrawals (id, user_id, asset, network, address, amount, usd_amount)
  values (v_id, v_uid, upper(p_asset), p_network, trim(p_address), p_amount, v_usd);
  perform public._post_ledger(v_uid, 'withdrawal_hold', -v_usd, 'withdrawals', v_id::text, 'Withdrawal requested');
  return v_id;
end;
$$;

create or replace function public.decide_withdrawal(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare w record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found.'; end if;
  if w.status <> 'pending' then raise exception 'Already decided.'; end if;
  if not p_approve then
    perform public._post_ledger(w.user_id, 'withdrawal_release', w.usd_amount, 'withdrawals', w.id::text, 'Withdrawal declined');
  end if;
  update public.withdrawals
     set status = case when p_approve then 'approved' else 'declined' end,
         note = coalesce(p_note, ''), decided_by = (select auth.uid()), decided_at = now()
   where id = p_id;
  perform public.log_audit('withdrawal_decision', w.user_id,
    jsonb_build_object('id', p_id, 'approved', p_approve));
end;
$$;

create or replace function public.cancel_withdrawal(p_id uuid)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare w record;
begin
  select * into w from public.withdrawals
   where id = p_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Withdrawal not found.'; end if;
  if w.status <> 'pending' then raise exception 'Only pending withdrawals can be cancelled.'; end if;
  perform public._post_ledger(w.user_id, 'withdrawal_release', w.usd_amount, 'withdrawals', w.id::text, 'Withdrawal cancelled');
  update public.withdrawals set status = 'cancelled', decided_at = now() where id = p_id;
end;
$$;

-- =====================================================================
-- 5. Investment plans (admin uploads the catalog)
-- =====================================================================
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Crypto',
  name text not null,
  description text not null default '',
  risk smallint not null default 2 check (risk between 1 and 3),
  return_min numeric(6, 2) not null default 0,
  return_max numeric(6, 2) not null default 0,
  min_amount numeric(14, 2) not null default 10 check (min_amount >= 0),
  max_amount numeric(14, 2),
  frequency text not null default 'Monthly' check (frequency in ('Weekly', 'Monthly', 'Quarterly', 'One-time')),
  term_months int not null default 12 check (term_months > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  amount numeric(14, 2) not null check (amount > 0),
  frequency text not null,
  term_months int not null check (term_months > 0),
  start_date date not null default current_date,
  reinvest boolean not null default true,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  payout_usd numeric(14, 2),
  created_at timestamptz not null default now()
);
create index if not exists user_plans_user_idx on public.user_plans (user_id, created_at desc);

-- Simplification: the amount is charged once at start. Recurring contributions
-- need a scheduler (pg_cron / edge function) and are not included here.
create or replace function public.invest_in_plan(
  p_plan_id uuid, p_amount numeric, p_frequency text, p_months int,
  p_start date default current_date, p_reinvest boolean default true)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; pl record; v_id uuid := gen_random_uuid();
begin
  v_uid := public._assert_ready(public._tier_required());
  select * into pl from public.plans where id = p_plan_id and is_active;
  if not found then raise exception 'This plan is not available.'; end if;
  if p_amount is null or p_amount < pl.min_amount then
    raise exception 'The minimum for this plan is %.', pl.min_amount; end if;
  if pl.max_amount is not null and p_amount > pl.max_amount then
    raise exception 'The maximum for this plan is %.', pl.max_amount; end if;
  if p_frequency not in ('Weekly', 'Monthly', 'Quarterly', 'One-time') or coalesce(p_months, 0) <= 0 then
    raise exception 'Invalid frequency or term.'; end if;
  insert into public.user_plans (id, user_id, plan_id, amount, frequency, term_months, start_date, reinvest)
  values (v_id, v_uid, pl.id, round(p_amount, 2), p_frequency, p_months, coalesce(p_start, current_date), p_reinvest);
  perform public._post_ledger(v_uid, 'plan_investment', -round(p_amount, 2), 'user_plans', v_id::text, 'Plan: ' || pl.name);
  return v_id;
end;
$$;

create or replace function public.admin_settle_plan(p_user_plan uuid, p_payout numeric, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status <> 'active' then raise exception 'Plan is not active.'; end if;
  if p_payout is null or p_payout < 0 then raise exception 'Payout cannot be negative.'; end if;
  if p_payout > 0 then
    perform public._post_ledger(up.user_id, 'plan_payout', p_payout, 'user_plans', up.id::text,
      coalesce(nullif(p_note, ''), 'Plan settled'));
  end if;
  update public.user_plans set status = 'completed', payout_usd = round(p_payout, 2) where id = p_user_plan;
  perform public.log_audit('plan_settled', up.user_id, jsonb_build_object('id', p_user_plan, 'payout', p_payout));
end;
$$;

-- =====================================================================
-- 6. Signals (admin posts; members pay from balance to see them)
-- =====================================================================
create table if not exists public.signal_plans (
  id text primary key,
  name text not null,
  blurb text not null default '',
  price numeric(10, 2) not null check (price >= 0),
  period_days int not null default 30 check (period_days > 0),
  features jsonb not null default '[]'::jsonb,
  badge text not null default '',
  is_active boolean not null default true,
  sort_order int not null default 0
);
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Crypto',
  symbol text not null,
  direction text not null check (direction in ('buy', 'sell')),
  entry numeric(24, 8) not null,
  take_profit numeric(24, 8) not null,
  stop_loss numeric(24, 8) not null,
  status text not null default 'active' check (status in ('active', 'hit', 'stopped', 'closed')),
  posted_by uuid,
  posted_at timestamptz not null default now()
);
create index if not exists signals_posted_idx on public.signals (posted_at desc);
create table if not exists public.signal_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.signal_plans (id),
  price numeric(10, 2) not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled'))
);
create index if not exists signal_subs_user_idx on public.signal_subscriptions (user_id, expires_at desc);

insert into public.signal_plans (id, name, blurb, price, features, badge, sort_order) values
  ('starter', 'Starter', 'Core market signals for getting started.', 49,
   '["Crypto and forex signals","Entry, take-profit and stop-loss levels","Email delivery"]', '', 1),
  ('pro', 'Pro', 'More markets and faster delivery.', 99,
   '["Everything in Starter","Stocks, ETFs and commodities","Instant dashboard alerts","Signal history and results"]', 'Most popular', 2),
  ('vip', 'VIP', 'Full coverage with priority support.', 199,
   '["Everything in Pro","Priority support","Market notes from our analysts","Early access to new products"]', '', 3)
on conflict (id) do nothing;

create or replace function public.subscribe_signal_plan(p_plan_id text)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; sp record; v_id uuid := gen_random_uuid(); v_from timestamptz;
begin
  v_uid := public._assert_ready(1);
  select * into sp from public.signal_plans where id = p_plan_id and is_active;
  if not found then raise exception 'That signal plan is not available.'; end if;
  select greatest(now(), coalesce(max(expires_at), now())) into v_from
    from public.signal_subscriptions where user_id = v_uid and status = 'active';
  if sp.price > 0 then
    perform public._post_ledger(v_uid, 'signal_subscription', -sp.price, 'signal_subscriptions', v_id::text, 'Signals: ' || sp.name);
  end if;
  insert into public.signal_subscriptions (id, user_id, plan_id, price, started_at, expires_at)
  values (v_id, v_uid, sp.id, sp.price, now(), v_from + make_interval(days => sp.period_days));
  return v_id;
end;
$$;

-- =====================================================================
-- 7. updated_at triggers for new tables
-- =====================================================================
drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans
for each row execute function public.set_updated_at();
drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
drop trigger if exists asset_prices_set_updated_at on public.asset_prices;
create trigger asset_prices_set_updated_at before update on public.asset_prices
for each row execute function public.set_updated_at();

-- =====================================================================
-- 8. Row level security
-- =====================================================================
alter table public.app_settings enable row level security;
alter table public.audit_log enable row level security;
alter table public.balance_ledger enable row level security;
alter table public.kyc_submissions enable row level security;
alter table public.kyc_document_numbers enable row level security;
alter table public.assets enable row level security;
alter table public.asset_prices enable row level security;
alter table public.holdings enable row level security;
alter table public.orders enable row level security;
alter table public.deposits enable row level security;
alter table public.withdrawals enable row level security;
alter table public.plans enable row level security;
alter table public.user_plans enable row level security;
alter table public.signal_plans enable row level security;
alter table public.signals enable row level security;
alter table public.signal_subscriptions enable row level security;

-- Settings: everyone signed in reads, owner writes.
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (true);
drop policy if exists app_settings_owner_write on public.app_settings;
create policy app_settings_owner_write on public.app_settings for update to authenticated
using (public.current_profile_role() = 'owner') with check (public.current_profile_role() = 'owner');

-- Audit log: staff read only (written by functions).
drop policy if exists audit_log_staff_read on public.audit_log;
create policy audit_log_staff_read on public.audit_log for select to authenticated
using (public.is_platform_staff());

-- Member-owned, function-written tables: own rows or staff read.
drop policy if exists balance_ledger_read on public.balance_ledger;
create policy balance_ledger_read on public.balance_ledger for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists holdings_read on public.holdings;
create policy holdings_read on public.holdings for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists deposits_read on public.deposits;
create policy deposits_read on public.deposits for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists withdrawals_read on public.withdrawals;
create policy withdrawals_read on public.withdrawals for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists user_plans_read on public.user_plans;
create policy user_plans_read on public.user_plans for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists signal_subs_read on public.signal_subscriptions;
create policy signal_subs_read on public.signal_subscriptions for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());

-- KYC: member reads own submissions; document numbers are owner/support only.
drop policy if exists kyc_submissions_read on public.kyc_submissions;
create policy kyc_submissions_read on public.kyc_submissions for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());
drop policy if exists kyc_numbers_staff_read on public.kyc_document_numbers;
create policy kyc_numbers_staff_read on public.kyc_document_numbers for select to authenticated
using (public.current_profile_role() in ('owner', 'support'));

-- Catalogs: members read active rows; owner/finance manage everything.
drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets for select to authenticated
using (is_active or public.is_platform_staff());
drop policy if exists assets_manage on public.assets;
create policy assets_manage on public.assets for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

drop policy if exists asset_prices_read on public.asset_prices;
create policy asset_prices_read on public.asset_prices for select to authenticated using (true);
drop policy if exists asset_prices_manage on public.asset_prices;
create policy asset_prices_manage on public.asset_prices for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated
using (is_active or public.is_platform_staff());
drop policy if exists plans_manage on public.plans;
create policy plans_manage on public.plans for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

drop policy if exists signal_plans_read on public.signal_plans;
create policy signal_plans_read on public.signal_plans for select to authenticated
using (is_active or public.is_platform_staff());
drop policy if exists signal_plans_manage on public.signal_plans;
create policy signal_plans_manage on public.signal_plans for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

drop policy if exists signals_read on public.signals;
create policy signals_read on public.signals for select to authenticated
using (
  public.is_platform_staff()
  or exists (
    select 1 from public.signal_subscriptions s
    where s.user_id = (select auth.uid()) and s.status = 'active' and s.expires_at > now())
);
drop policy if exists signals_manage on public.signals;
create policy signals_manage on public.signals for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

-- =====================================================================
-- 9. Storage: KYC ID images and avatars (private Images bucket)
-- =====================================================================
drop policy if exists images_kyc_read on storage.objects;
create policy images_kyc_read on storage.objects for select to authenticated
using (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'kyc'
  and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_platform_staff())
);
drop policy if exists images_kyc_insert on storage.objects;
create policy images_kyc_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'kyc'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.is_active_member()
);

drop policy if exists images_avatar_read on storage.objects;
create policy images_avatar_read on storage.objects for select to authenticated
using (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'avatars'
  and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_platform_staff())
);
drop policy if exists images_avatar_insert on storage.objects;
create policy images_avatar_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text and public.is_active_member()
);
drop policy if exists images_avatar_update on storage.objects;
create policy images_avatar_update on storage.objects for update to authenticated
using (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text)
with check (
  bucket_id = 'Images' and (storage.foldername(name))[1] = 'avatars'
  and (storage.foldername(name))[2] = (select auth.uid())::text);

-- =====================================================================
-- 10. Grants
-- =====================================================================
revoke all on public.app_settings, public.audit_log, public.balance_ledger,
  public.kyc_submissions, public.kyc_document_numbers, public.assets, public.asset_prices,
  public.holdings, public.orders, public.deposits, public.withdrawals, public.plans,
  public.user_plans, public.signal_plans, public.signals, public.signal_subscriptions
  from anon;

-- Read-only for members (RLS narrows rows); writes only through functions.
grant select on public.audit_log, public.balance_ledger, public.kyc_submissions,
  public.kyc_document_numbers, public.holdings, public.orders, public.deposits,
  public.withdrawals, public.user_plans, public.signal_subscriptions to authenticated;
-- Catalog tables: staff write through RLS policies above.
grant select, insert, update, delete on public.assets, public.asset_prices,
  public.plans, public.signal_plans, public.signals to authenticated;
grant select, update on public.app_settings to authenticated;

-- Internal helpers: not callable from the client.
revoke all on function public._post_ledger(uuid, text, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.log_audit(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tier_required() from public, anon, authenticated;
revoke all on function public._assert_ready(int) from public, anon, authenticated;

-- Client-callable functions (each checks role / ownership inside).
revoke all on function public.member_tier(uuid) from public, anon;
revoke all on function public.submit_kyc(text, text, text, date, date, text, text) from public, anon;
revoke all on function public.review_kyc(uuid, boolean, text) from public, anon;
revoke all on function public.admin_adjust_balance(uuid, numeric, text) from public, anon;
revoke all on function public.admin_set_holding(uuid, text, numeric) from public, anon;
revoke all on function public.place_order(text, text, numeric) from public, anon;
revoke all on function public.request_deposit(text, numeric, numeric, text) from public, anon;
revoke all on function public.decide_deposit(uuid, boolean, text, numeric) from public, anon;
revoke all on function public.request_withdrawal(text, text, text, numeric, numeric) from public, anon;
revoke all on function public.decide_withdrawal(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_withdrawal(uuid) from public, anon;
revoke all on function public.invest_in_plan(uuid, numeric, text, int, date, boolean) from public, anon;
revoke all on function public.admin_settle_plan(uuid, numeric, text) from public, anon;
revoke all on function public.subscribe_signal_plan(text) from public, anon;

grant execute on function public.member_tier(uuid) to authenticated;
grant execute on function public.submit_kyc(text, text, text, date, date, text, text) to authenticated;
grant execute on function public.review_kyc(uuid, boolean, text) to authenticated;
grant execute on function public.admin_adjust_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_set_holding(uuid, text, numeric) to authenticated;
grant execute on function public.place_order(text, text, numeric) to authenticated;
grant execute on function public.request_deposit(text, numeric, numeric, text) to authenticated;
grant execute on function public.decide_deposit(uuid, boolean, text, numeric) to authenticated;
grant execute on function public.request_withdrawal(text, text, text, numeric, numeric) to authenticated;
grant execute on function public.decide_withdrawal(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_withdrawal(uuid) to authenticated;
grant execute on function public.invest_in_plan(uuid, numeric, text, int, date, boolean) to authenticated;
grant execute on function public.admin_settle_plan(uuid, numeric, text) to authenticated;
grant execute on function public.subscribe_signal_plan(text) to authenticated;

-- =====================================================================
-- 11. LOCK MEMBER MONEY KEYS  (run this block LAST, after the dashboard
--     uses request_deposit / place_order / invest_in_plan etc.)
--     Until the frontend is rewired, enabling this stops the current
--     JSON-based deposit flow from saving.
-- =====================================================================
create or replace function public.lock_member_state()
returns trigger language plpgsql security definer
set search_path = public set row_security = off as $$
begin
  if public.is_platform_staff() then return new; end if;
  if tg_op = 'UPDATE' then
    new.data := new.data || jsonb_build_object(
      'cash0', coalesce(old.data -> 'cash0', '0'::jsonb),
      'plans', coalesce(old.data -> 'plans', '[]'::jsonb),
      'tx', coalesce(old.data -> 'tx', '[]'::jsonb),
      'depositRequests', coalesce(old.data -> 'depositRequests', '[]'::jsonb));
  else
    new.data := new.data || jsonb_build_object(
      'cash0', 0, 'plans', '[]'::jsonb, 'tx', '[]'::jsonb, 'depositRequests', '[]'::jsonb);
  end if;
  return new;
end;
$$;

-- Uncomment when ready:
-- drop trigger if exists member_state_lock on public.member_dashboard_state;
-- create trigger member_state_lock
-- before insert or update on public.member_dashboard_state
-- for each row execute function public.lock_member_state();
