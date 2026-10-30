-- Auvrenthia Markets - schema part 3 (idempotent; safe to re-run).
-- Run AFTER schema.sql, storage-migration.sql and schema-part2.sql.
-- Adds: loans, admin control over deposits / withdrawals / plans / signals,
-- and the extra ledger kinds those need. Money rule is unchanged: every balance
-- change goes through public._post_ledger.

-- =====================================================================
-- 0. Ledger kinds, settings, plan columns
-- =====================================================================
alter table public.balance_ledger drop constraint if exists balance_ledger_kind_check;
alter table public.balance_ledger add constraint balance_ledger_kind_check check (kind in (
  'deposit', 'withdrawal_hold', 'withdrawal_release', 'trade_buy', 'trade_sell',
  'plan_investment', 'plan_payout', 'plan_profit', 'signal_subscription',
  'loan_disbursement', 'loan_repayment', 'admin_adjust'));

alter table public.app_settings
  add column if not exists loans_paused boolean not null default false,
  add column if not exists investing_paused boolean not null default false;

alter table public.user_plans
  add column if not exists profit_paid numeric(14, 2) not null default 0;
alter table public.user_plans drop constraint if exists user_plans_status_check;
alter table public.user_plans add constraint user_plans_status_check
  check (status in ('active', 'paused', 'completed', 'cancelled'));

-- Members can read these two flags through app_settings_read (already open to authenticated).
-- Make invest_in_plan and request_loan respect the pause flags.
create or replace function public.invest_in_plan(
  p_plan_id uuid, p_amount numeric, p_frequency text, p_months int,
  p_start date default current_date, p_reinvest boolean default true)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; pl record; v_id uuid := gen_random_uuid();
begin
  v_uid := public._assert_ready(public._tier_required());
  if (select investing_paused from public.app_settings where id = 'global') then
    raise exception 'Investing is paused.'; end if;
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

-- =====================================================================
-- 1. Loans
-- =====================================================================
create table if not exists public.loan_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  min_amount numeric(14, 2) not null default 100 check (min_amount > 0),
  max_amount numeric(14, 2) not null default 10000 check (max_amount >= min_amount),
  interest_pct numeric(6, 2) not null default 5 check (interest_pct between 0 and 100), -- flat, total over the term
  term_months int not null default 6 check (term_months > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid references public.loan_products (id) on delete set null,
  product_name text not null default '',
  principal numeric(14, 2) not null check (principal > 0),
  interest_pct numeric(6, 2) not null default 0,
  term_months int not null check (term_months > 0),
  total_due numeric(14, 2) not null check (total_due > 0),
  repaid numeric(14, 2) not null default 0 check (repaid >= 0),
  purpose text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'repaid', 'declined', 'defaulted', 'cancelled')),
  note text not null default '',
  due_date date,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists loans_user_idx on public.loans (user_id, created_at desc);
create index if not exists loans_status_idx on public.loans (status, created_at desc);

drop trigger if exists loan_products_set_updated_at on public.loan_products;
create trigger loan_products_set_updated_at before update on public.loan_products
for each row execute function public.set_updated_at();

create or replace function public.request_loan(p_product uuid, p_amount numeric, p_purpose text default '')
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_uid uuid; lp record; v_id uuid := gen_random_uuid(); v_amt numeric(14, 2); v_total numeric(14, 2);
begin
  v_uid := public._assert_ready(public._tier_required());
  if (select loans_paused from public.app_settings where id = 'global') then
    raise exception 'Loans are paused.'; end if;
  select * into lp from public.loan_products where id = p_product and is_active;
  if not found then raise exception 'That loan product is not available.'; end if;
  v_amt := round(coalesce(p_amount, 0), 2);
  if v_amt < lp.min_amount or v_amt > lp.max_amount then
    raise exception 'Loan amount must be between % and %.', lp.min_amount, lp.max_amount; end if;
  if exists (select 1 from public.loans where user_id = v_uid and status = 'pending') then
    raise exception 'You already have a loan request waiting for review.'; end if;
  v_total := round(v_amt * (1 + lp.interest_pct / 100), 2);
  insert into public.loans (id, user_id, product_id, product_name, principal, interest_pct, term_months, total_due, purpose)
  values (v_id, v_uid, lp.id, lp.name, v_amt, lp.interest_pct, lp.term_months, v_total, left(coalesce(p_purpose, ''), 1000));
  return v_id;
end;
$$;

create or replace function public.cancel_loan_request(p_id uuid)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare l record;
begin
  select * into l from public.loans where id = p_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Loan not found.'; end if;
  if l.status <> 'pending' then raise exception 'Only pending requests can be cancelled.'; end if;
  update public.loans set status = 'cancelled', decided_at = now() where id = p_id;
end;
$$;

create or replace function public.decide_loan(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare l record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into l from public.loans where id = p_id for update;
  if not found then raise exception 'Loan not found.'; end if;
  if l.status <> 'pending' then raise exception 'Already decided.'; end if;
  if p_approve then
    perform public._post_ledger(l.user_id, 'loan_disbursement', l.principal, 'loans', l.id::text, 'Loan approved');
    update public.loans
       set status = 'active', note = coalesce(p_note, ''),
           due_date = (current_date + make_interval(months => l.term_months))::date,
           decided_by = (select auth.uid()), decided_at = now()
     where id = p_id;
  else
    update public.loans
       set status = 'declined', note = coalesce(p_note, ''),
           decided_by = (select auth.uid()), decided_at = now()
     where id = p_id;
  end if;
  perform public.log_audit('loan_decision', l.user_id,
    jsonb_build_object('id', p_id, 'approved', p_approve, 'principal', l.principal));
end;
$$;

create or replace function public.repay_loan(p_id uuid, p_amount numeric)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare l record; v_uid uuid := (select auth.uid()); v_pay numeric(14, 2); v_left numeric(14, 2);
begin
  v_uid := public._assert_ready(1);
  select * into l from public.loans where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Loan not found.'; end if;
  if l.status <> 'active' then raise exception 'This loan is not open for repayment.'; end if;
  v_left := l.total_due - l.repaid;
  v_pay := least(round(coalesce(p_amount, 0), 2), v_left);
  if v_pay <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  perform public._post_ledger(v_uid, 'loan_repayment', -v_pay, 'loans', l.id::text, 'Loan repayment');
  update public.loans
     set repaid = repaid + v_pay,
         status = case when repaid + v_pay >= total_due then 'repaid' else status end
   where id = p_id;
end;
$$;

create or replace function public.admin_set_loan_status(p_id uuid, p_status text, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare l record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  if p_status not in ('active', 'repaid', 'defaulted') then raise exception 'Unsupported loan status.'; end if;
  select * into l from public.loans where id = p_id for update;
  if not found then raise exception 'Loan not found.'; end if;
  if l.status in ('pending', 'declined', 'cancelled') then
    raise exception 'Only approved loans can change status.'; end if;
  update public.loans set status = p_status, note = coalesce(nullif(p_note, ''), note) where id = p_id;
  perform public.log_audit('loan_status', l.user_id, jsonb_build_object('id', p_id, 'status', p_status));
end;
$$;

-- =====================================================================
-- 2. Admin control: deposits and withdrawals created on a member's behalf
-- =====================================================================
create or replace function public.admin_create_deposit(
  p_user uuid, p_usd numeric, p_note text, p_approve boolean default false)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_id uuid := gen_random_uuid(); v_usd numeric(14, 2) := round(coalesce(p_usd, 0), 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  if v_usd <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A reason is required.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Profile not found.'; end if;
  insert into public.deposits (id, user_id, asset, network, amount, usd_amount, note, status, decided_by, decided_at)
  values (v_id, p_user, 'USD', 'Admin-created', v_usd, v_usd, p_note,
          case when p_approve then 'approved' else 'pending' end,
          case when p_approve then (select auth.uid()) end,
          case when p_approve then now() end);
  if p_approve then
    perform public._post_ledger(p_user, 'deposit', v_usd, 'deposits', v_id::text, 'Admin-created deposit');
  end if;
  perform public.log_audit('admin_create_deposit', p_user,
    jsonb_build_object('id', v_id, 'usd', v_usd, 'approved', p_approve));
  return v_id;
end;
$$;

create or replace function public.admin_create_withdrawal(
  p_user uuid, p_usd numeric, p_address text, p_note text)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare v_id uuid := gen_random_uuid(); v_usd numeric(14, 2) := round(coalesce(p_usd, 0), 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  if v_usd <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A reason is required.'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Profile not found.'; end if;
  insert into public.withdrawals (id, user_id, asset, network, address, amount, usd_amount, note)
  values (v_id, p_user, 'USD', 'Admin-created',
          coalesce(nullif(trim(p_address), ''), 'Admin-created payout'), v_usd, v_usd, p_note);
  perform public._post_ledger(p_user, 'withdrawal_hold', -v_usd, 'withdrawals', v_id::text, 'Admin-created withdrawal');
  perform public.log_audit('admin_create_withdrawal', p_user, jsonb_build_object('id', v_id, 'usd', v_usd));
  return v_id;
end;
$$;

-- =====================================================================
-- 3. Admin control: investment plans held by members
-- =====================================================================
create or replace function public.admin_invest_for_user(
  p_user uuid, p_plan_id uuid, p_amount numeric, p_months int,
  p_charge boolean default true, p_frequency text default null)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare pl record; v_id uuid := gen_random_uuid(); v_amt numeric(14, 2) := round(coalesce(p_amount, 0), 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into pl from public.plans where id = p_plan_id;
  if not found then raise exception 'Plan not found.'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if coalesce(p_months, 0) <= 0 then raise exception 'Enter a term in months.'; end if;
  if p_frequency is not null and p_frequency not in ('Weekly', 'Monthly', 'Quarterly', 'One-time') then
    raise exception 'Invalid frequency.'; end if;
  insert into public.user_plans (id, user_id, plan_id, amount, frequency, term_months)
  values (v_id, p_user, pl.id, v_amt, coalesce(p_frequency, pl.frequency), p_months);
  if p_charge then
    perform public._post_ledger(p_user, 'plan_investment', -v_amt, 'user_plans', v_id::text, 'Plan: ' || pl.name || ' (admin)');
  end if;
  perform public.log_audit('admin_invest', p_user,
    jsonb_build_object('id', v_id, 'plan', pl.name, 'amount', v_amt, 'charged', p_charge));
  return v_id;
end;
$$;

create or replace function public.admin_credit_plan_profit(p_user_plan uuid, p_amount numeric, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record; v_amt numeric(14, 2) := round(coalesce(p_amount, 0), 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status <> 'active' then raise exception 'Plan is not active.'; end if;
  if v_amt <= 0 then raise exception 'Enter an amount greater than zero.'; end if;
  perform public._post_ledger(up.user_id, 'plan_profit', v_amt, 'user_plans', up.id::text,
    coalesce(nullif(p_note, ''), 'Plan profit credited'));
  update public.user_plans set profit_paid = profit_paid + v_amt where id = p_user_plan;
  perform public.log_audit('plan_profit', up.user_id, jsonb_build_object('id', p_user_plan, 'amount', v_amt));
end;
$$;

create or replace function public.admin_cancel_plan(p_user_plan uuid, p_refund boolean, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status not in ('active', 'paused') then raise exception 'Plan is already closed.'; end if;
  if p_refund then
    perform public._post_ledger(up.user_id, 'plan_payout', up.amount, 'user_plans', up.id::text,
      coalesce(nullif(p_note, ''), 'Plan cancelled, principal returned'));
  end if;
  update public.user_plans set status = 'cancelled', payout_usd = case when p_refund then up.amount else 0 end
   where id = p_user_plan;
  perform public.log_audit('plan_cancelled', up.user_id,
    jsonb_build_object('id', p_user_plan, 'refunded', p_refund));
end;
$$;

create or replace function public.admin_change_plan_amount(
  p_user_plan uuid, p_delta numeric, p_move boolean, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record; v_delta numeric(14, 2) := round(coalesce(p_delta, 0), 2);
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status not in ('active', 'paused') then raise exception 'Plan is already closed.'; end if;
  if v_delta = 0 then raise exception 'Enter an amount greater than zero.'; end if;
  if up.amount + v_delta <= 0 then
    raise exception 'The plan cannot go to zero. Cancel it instead.'; end if;
  if p_move then
    perform public._post_ledger(up.user_id,
      case when v_delta > 0 then 'plan_investment' else 'plan_payout' end,
      -v_delta, 'user_plans', up.id::text,
      coalesce(nullif(p_note, ''), 'Plan amount changed by admin'));
  end if;
  update public.user_plans set amount = amount + v_delta where id = p_user_plan;
  perform public.log_audit('plan_amount', up.user_id,
    jsonb_build_object('id', p_user_plan, 'delta', v_delta, 'moved', p_move));
end;
$$;

create or replace function public.admin_set_plan_status(p_user_plan uuid, p_status text)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  if p_status not in ('active', 'paused') then raise exception 'Unsupported plan status.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status not in ('active', 'paused') then raise exception 'Plan is already closed.'; end if;
  update public.user_plans set status = p_status where id = p_user_plan;
  perform public.log_audit('plan_status', up.user_id, jsonb_build_object('id', p_user_plan, 'status', p_status));
end;
$$;

-- admin_settle_plan from part 2 only accepted active plans; accept paused ones too.
create or replace function public.admin_settle_plan(p_user_plan uuid, p_payout numeric, p_note text default '')
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare up record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into up from public.user_plans where id = p_user_plan for update;
  if not found then raise exception 'Plan not found.'; end if;
  if up.status not in ('active', 'paused') then raise exception 'Plan is already closed.'; end if;
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
-- 4. Admin control: signals
-- =====================================================================
create or replace function public.admin_grant_signal_subscription(
  p_user uuid, p_plan_id text, p_days int default null, p_charge boolean default false)
returns uuid language plpgsql security definer
set search_path = public set row_security = off as $$
declare sp record; v_id uuid := gen_random_uuid(); v_from timestamptz; v_days int;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into sp from public.signal_plans where id = p_plan_id;
  if not found then raise exception 'Signal plan not found.'; end if;
  v_days := coalesce(p_days, sp.period_days);
  if v_days <= 0 then raise exception 'Enter a number of days.'; end if;
  select greatest(now(), coalesce(max(expires_at), now())) into v_from
    from public.signal_subscriptions where user_id = p_user and status = 'active';
  if p_charge and sp.price > 0 then
    perform public._post_ledger(p_user, 'signal_subscription', -sp.price, 'signal_subscriptions', v_id::text, 'Signals: ' || sp.name);
  end if;
  insert into public.signal_subscriptions (id, user_id, plan_id, price, started_at, expires_at)
  values (v_id, p_user, sp.id, case when p_charge then sp.price else 0 end, now(), v_from + make_interval(days => v_days));
  perform public.log_audit('signal_granted', p_user,
    jsonb_build_object('plan', sp.id, 'days', v_days, 'charged', p_charge));
  return v_id;
end;
$$;

create or replace function public.admin_cancel_signal_subscription(p_id uuid, p_refund boolean default false)
returns void language plpgsql security definer
set search_path = public set row_security = off as $$
declare s record;
begin
  if public.current_profile_role() not in ('owner', 'finance') then
    raise exception 'Owner or finance access is required.'; end if;
  select * into s from public.signal_subscriptions where id = p_id for update;
  if not found then raise exception 'Subscription not found.'; end if;
  if s.status <> 'active' then raise exception 'Subscription is not active.'; end if;
  if p_refund and s.price > 0 then
    perform public._post_ledger(s.user_id, 'admin_adjust', s.price, 'signal_subscriptions', s.id::text, 'Signal subscription refund');
  end if;
  update public.signal_subscriptions set status = 'cancelled', expires_at = least(expires_at, now()) where id = p_id;
  perform public.log_audit('signal_sub_cancelled', s.user_id, jsonb_build_object('id', p_id, 'refunded', p_refund));
end;
$$;

-- =====================================================================
-- 5. RLS and grants for the new tables
-- =====================================================================
alter table public.loan_products enable row level security;
alter table public.loans enable row level security;

drop policy if exists loan_products_read on public.loan_products;
create policy loan_products_read on public.loan_products for select to authenticated
using (is_active or public.is_platform_staff());
drop policy if exists loan_products_manage on public.loan_products;
create policy loan_products_manage on public.loan_products for all to authenticated
using (public.current_profile_role() in ('owner', 'finance'))
with check (public.current_profile_role() in ('owner', 'finance'));

drop policy if exists loans_read on public.loans;
create policy loans_read on public.loans for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_staff());

revoke all on public.loan_products, public.loans from anon;
grant select, insert, update, delete on public.loan_products to authenticated;
grant select on public.loans to authenticated;

revoke all on function public.request_loan(uuid, numeric, text) from public, anon;
revoke all on function public.cancel_loan_request(uuid) from public, anon;
revoke all on function public.decide_loan(uuid, boolean, text) from public, anon;
revoke all on function public.repay_loan(uuid, numeric) from public, anon;
revoke all on function public.admin_set_loan_status(uuid, text, text) from public, anon;
revoke all on function public.admin_create_deposit(uuid, numeric, text, boolean) from public, anon;
revoke all on function public.admin_create_withdrawal(uuid, numeric, text, text) from public, anon;
revoke all on function public.admin_invest_for_user(uuid, uuid, numeric, int, boolean, text) from public, anon;
revoke all on function public.admin_credit_plan_profit(uuid, numeric, text) from public, anon;
revoke all on function public.admin_cancel_plan(uuid, boolean, text) from public, anon;
revoke all on function public.admin_grant_signal_subscription(uuid, text, int, boolean) from public, anon;
revoke all on function public.admin_cancel_signal_subscription(uuid, boolean) from public, anon;
revoke all on function public.invest_in_plan(uuid, numeric, text, int, date, boolean) from public, anon;

grant execute on function public.request_loan(uuid, numeric, text) to authenticated;
grant execute on function public.cancel_loan_request(uuid) to authenticated;
grant execute on function public.decide_loan(uuid, boolean, text) to authenticated;
grant execute on function public.repay_loan(uuid, numeric) to authenticated;
grant execute on function public.admin_set_loan_status(uuid, text, text) to authenticated;
grant execute on function public.admin_create_deposit(uuid, numeric, text, boolean) to authenticated;
grant execute on function public.admin_create_withdrawal(uuid, numeric, text, text) to authenticated;
grant execute on function public.admin_invest_for_user(uuid, uuid, numeric, int, boolean, text) to authenticated;
grant execute on function public.admin_credit_plan_profit(uuid, numeric, text) to authenticated;
grant execute on function public.admin_cancel_plan(uuid, boolean, text) to authenticated;
grant execute on function public.admin_grant_signal_subscription(uuid, text, int, boolean) to authenticated;
grant execute on function public.admin_cancel_signal_subscription(uuid, boolean) to authenticated;
grant execute on function public.invest_in_plan(uuid, numeric, text, int, date, boolean) to authenticated;
revoke all on function public.admin_change_plan_amount(uuid, numeric, boolean, text) from public, anon;
revoke all on function public.admin_set_plan_status(uuid, text) from public, anon;
grant execute on function public.admin_change_plan_amount(uuid, numeric, boolean, text) to authenticated;
grant execute on function public.admin_set_plan_status(uuid, text) to authenticated;

-- Seed one loan product so the member page has something to show (edit in admin).
insert into public.loan_products (name, description, min_amount, max_amount, interest_pct, term_months, sort_order)
select 'Starter loan', 'Short-term loan against your account standing.', 100, 5000, 5, 6, 1
where not exists (select 1 from public.loan_products);
