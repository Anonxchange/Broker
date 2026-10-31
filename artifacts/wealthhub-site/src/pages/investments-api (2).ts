import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Auvrenthia investments data layer.
 * Every money change goes through a security-definer RPC (schema-part2/3.sql).
 * Nothing here writes a balance directly. Pass in the same `supabase` client
 * the rest of the app already uses.
 */

async function call<T = unknown>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message || 'The request failed.');
  return data as T;
}

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? ([] as unknown)) as T;
}

/** A side section that fails must not take the whole dashboard down with it. */
function soft<T>(result: { data: T[] | null; error: { message: string } | null }, label: string): T[] {
  if (result.error) {
    console.error(`Could not load ${label}.`, result.error.message);
    return [];
  }
  return result.data ?? [];
}

/** RLS filters rows silently on update/delete, so confirm that something changed. */
async function changed(
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  denied: string,
) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(denied);
}

/* ------------------------------------------------------------------ */
/* ADMIN                                                               */
/* ------------------------------------------------------------------ */

export async function loadAdminInvestments(supabase: SupabaseClient) {
  const [
    deposits, withdrawals, plans, userPlans, signalPlans, signals,
    signalSubs, loanProducts, loans, settings, ledger, audit,
  ] = await Promise.all([
    supabase.from('deposits').select('*').order('created_at', { ascending: false }),
    supabase.from('withdrawals').select('*').order('created_at', { ascending: false }),
    supabase.from('plans').select('*').order('sort_order').order('created_at'),
    supabase.from('user_plans').select('*').order('created_at', { ascending: false }),
    supabase.from('signal_plans').select('*').order('sort_order'),
    supabase.from('signals').select('*').order('posted_at', { ascending: false }),
    supabase.from('signal_subscriptions').select('*').order('started_at', { ascending: false }),
    supabase.from('loan_products').select('*').order('sort_order'),
    supabase.from('loans').select('*').order('created_at', { ascending: false }),
    supabase.from('app_settings').select('*').eq('id', 'global').maybeSingle(),
    supabase.from('balance_ledger').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300),
  ]);
  return {
    deposits: must(deposits),
    withdrawals: must(withdrawals),
    plans: must(plans),
    userPlans: must(userPlans),
    signalPlans: must(signalPlans),
    signals: must(signals),
    signalSubs: must(signalSubs),
    loanProducts: must(loanProducts),
    loans: must(loans),
    settings: settings.data ?? null,
    ledger: must(ledger),
    audit: must(audit),
  };
}

/** Fresh balances for every account (after any money action). */
export async function loadBalances(supabase: SupabaseClient) {
  return must(await supabase.from('profiles').select('id,demo_balance'));
}

/** Short-lived link to a member's deposit receipt (private bucket). */
export async function getReceiptUrl(supabase: SupabaseClient, path: string, bucket = 'Images') {
  if (!path) return '';
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export const adminInvestments = {
  /* deposits */
  decideDeposit: (s: SupabaseClient, id: string, approve: boolean, note = '', usd: number | null = null) =>
    call(s, 'decide_deposit', { p_id: id, p_approve: approve, p_note: note, p_usd: usd }),
  createDeposit: (s: SupabaseClient, userId: string, usd: number, note: string, approve = false) =>
    call<string>(s, 'admin_create_deposit', { p_user: userId, p_usd: usd, p_note: note, p_approve: approve }),

  /* withdrawals */
  decideWithdrawal: (s: SupabaseClient, id: string, approve: boolean, note = '') =>
    call(s, 'decide_withdrawal', { p_id: id, p_approve: approve, p_note: note }),
  createWithdrawal: (s: SupabaseClient, userId: string, usd: number, address: string, note: string) =>
    call<string>(s, 'admin_create_withdrawal', { p_user: userId, p_usd: usd, p_address: address, p_note: note }),

  /* trading catalog and holdings */
  saveAsset: async (s: SupabaseClient, asset: { symbol: string; name: string; category: string; is_active: boolean }, price: number | null) => {
    const symbol = asset.symbol.trim().toUpperCase();
    const a = await s.from('assets').upsert({ ...asset, symbol });
    if (a.error) throw new Error(a.error.message);
    if (price !== null) {
      if (!(price > 0)) throw new Error('Enter a price above zero.');
      const p = await s.from('asset_prices').upsert({ symbol, price });
      if (p.error) throw new Error(p.error.message);
    }
  },
  setHolding: (s: SupabaseClient, userId: string, symbol: string, qty: number) =>
    call(s, 'admin_set_holding', { p_user: userId, p_symbol: symbol, p_qty: qty }),

  /* referrals */
  rewardReferral: (s: SupabaseClient, referralId: string, usd: number, note = '') =>
    call(s, 'admin_reward_referral', { p_referral: referralId, p_usd: usd, p_note: note }),

  /* balance */
  adjustBalance: (s: SupabaseClient, userId: string, amount: number, note: string) =>
    call(s, 'admin_adjust_balance', { p_user: userId, p_amount: amount, p_note: note }),

  /* plan catalog (direct table writes, allowed to owner/finance by RLS) */
  savePlan: async (s: SupabaseClient, plan: Record<string, unknown>) => {
    const { error } = await s.from('plans').upsert(plan);
    if (error) throw new Error(error.message);
  },
  setPlanActive: (s: SupabaseClient, id: string, active: boolean) =>
    changed(s.from('plans').update({ is_active: active }).eq('id', id).select('id'),
      'Only an owner or finance admin can change plans.'),
  deletePlan: async (s: SupabaseClient, id: string) => {
    // user_plans.plan_id has no cascade, so a plan with investments cannot be deleted. Deactivate it instead.
    const { data, error } = await s.from('plans').delete().eq('id', id).select('id');
    if (error) throw new Error('This plan has investments. Disable it instead of deleting it.');
    if (!data || data.length === 0) throw new Error('Only an owner or finance admin can delete plans.');
  },
  changePlanAmount: (s: SupabaseClient, userPlanId: string, delta: number, move: boolean, note = '') =>
    call(s, 'admin_change_plan_amount', { p_user_plan: userPlanId, p_delta: delta, p_move: move, p_note: note }),
  setPlanStatus: (s: SupabaseClient, userPlanId: string, status: 'active' | 'paused') =>
    call(s, 'admin_set_plan_status', { p_user_plan: userPlanId, p_status: status }),

  /* member plan positions */
  investForUser: (
    s: SupabaseClient, userId: string, planId: string, amount: number, months: number,
    charge = true, frequency: string | null = null,
  ) =>
    call<string>(s, 'admin_invest_for_user', {
      p_user: userId, p_plan_id: planId, p_amount: amount, p_months: months,
      p_charge: charge, p_frequency: frequency,
    }),
  creditPlanProfit: (s: SupabaseClient, userPlanId: string, amount: number, note = '') =>
    call(s, 'admin_credit_plan_profit', { p_user_plan: userPlanId, p_amount: amount, p_note: note }),
  settlePlan: (s: SupabaseClient, userPlanId: string, payout: number, note = '') =>
    call(s, 'admin_settle_plan', { p_user_plan: userPlanId, p_payout: payout, p_note: note }),
  cancelPlan: (s: SupabaseClient, userPlanId: string, refund: boolean, note = '') =>
    call(s, 'admin_cancel_plan', { p_user_plan: userPlanId, p_refund: refund, p_note: note }),

  /* signals */
  saveSignalPlan: async (s: SupabaseClient, plan: Record<string, unknown>) => {
    const { error } = await s.from('signal_plans').upsert(plan);
    if (error) throw new Error(error.message);
  },
  postSignal: async (s: SupabaseClient, signal: {
    category: string; symbol: string; direction: 'buy' | 'sell';
    entry: number; take_profit: number; stop_loss: number;
  }, adminId: string) => {
    const { error } = await s.from('signals').insert({ ...signal, posted_by: adminId });
    if (error) throw new Error(error.message);
  },
  setSignalStatus: (s: SupabaseClient, id: string, status: 'active' | 'hit' | 'stopped' | 'closed') =>
    changed(s.from('signals').update({ status }).eq('id', id).select('id'),
      'Only an owner or finance admin can change signals.'),
  deleteSignal: (s: SupabaseClient, id: string) =>
    changed(s.from('signals').delete().eq('id', id).select('id'),
      'Only an owner or finance admin can delete signals.'),
  grantSignals: (s: SupabaseClient, userId: string, planId: string, days: number | null = null, charge = false) =>
    call<string>(s, 'admin_grant_signal_subscription', {
      p_user: userId, p_plan_id: planId, p_days: days, p_charge: charge,
    }),
  cancelSignalSub: (s: SupabaseClient, id: string, refund = false) =>
    call(s, 'admin_cancel_signal_subscription', { p_id: id, p_refund: refund }),

  /* loans */
  saveLoanProduct: async (s: SupabaseClient, product: Record<string, unknown>) => {
    const { error } = await s.from('loan_products').upsert(product);
    if (error) throw new Error(error.message);
  },
  decideLoan: (s: SupabaseClient, id: string, approve: boolean, note = '') =>
    call(s, 'decide_loan', { p_id: id, p_approve: approve, p_note: note }),
  setLoanStatus: (s: SupabaseClient, id: string, status: 'active' | 'repaid' | 'defaulted', note = '') =>
    call(s, 'admin_set_loan_status', { p_id: id, p_status: status, p_note: note }),

  /* global switches (owner only by RLS) */
  updateSettings: (s: SupabaseClient, patch: Partial<{
    need_kyc: boolean; withdrawals_paused: boolean; trading_paused: boolean;
    loans_paused: boolean; investing_paused: boolean; trade_fee_pct: number;
  }>) =>
    changed(s.from('app_settings').update(patch).eq('id', 'global').select('id'),
      'Only an owner can change platform settings.'),
};

/* ------------------------------------------------------------------ */
/* MEMBER                                                              */
/* ------------------------------------------------------------------ */

export async function loadMemberInvestments(supabase: SupabaseClient, userId: string) {
  const attempt = async () => {
    const [
      profile, methods, deposits, withdrawals, plans, userPlans,
      signalPlans, signals, signalSubs, loanProducts, loans, settings, ledger,
      holdings, orders, assets, prices,
    ] = await Promise.all([
      supabase.from('profiles').select('demo_balance,withdrawals_enabled,kyc_status').eq('id', userId).maybeSingle(),
      supabase.from('deposit_methods').select('*').eq('is_active', true).order('asset'),
      supabase.from('deposits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('withdrawals').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('user_plans').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('signal_plans').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('signals').select('*').order('posted_at', { ascending: false }).limit(100), // RLS: empty without an active subscription
      supabase.from('signal_subscriptions').select('*').eq('user_id', userId).order('expires_at', { ascending: false }),
      supabase.from('loan_products').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('loans').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('app_settings').select('*').eq('id', 'global').maybeSingle(),
      supabase.from('balance_ledger').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500),
      supabase.from('holdings').select('*').eq('user_id', userId).gt('quantity', 0),
      supabase.from('orders').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
      supabase.from('assets').select('*').eq('is_active', true),
      supabase.from('asset_prices').select('*'),
    ]);
    // The balance is what the whole dashboard depends on, so it is the one thing that must load.
    if (profile.error) throw new Error(profile.error.message);
    if (!profile.data) throw new Error('Your profile could not be found.');

    const userPlanRows = soft(userPlans as { data: Array<{ plan_id: string }> | null; error: { message: string } | null }, 'plans');
    // Name/terms for plans the member holds, even after an admin switched the plan off.
    const heldPlanIds = Array.from(new Set(userPlanRows.map((row) => row.plan_id)));
    const positionPlans = heldPlanIds.length
      ? soft(await supabase.from('plans').select('*').in('id', heldPlanIds), 'held plans')
      : [];
    return {
      profile: profile.data,
      positionPlans,
      methods: soft(methods, 'deposit methods'),
      deposits: soft(deposits, 'deposits'),
      withdrawals: soft(withdrawals, 'withdrawals'),
      plans: soft(plans, 'plans'),
      userPlans: userPlanRows,
      signalPlans: soft(signalPlans, 'signal plans'),
      signals: soft(signals, 'signals'),
      signalSubs: soft(signalSubs, 'signal subscriptions'),
      loanProducts: soft(loanProducts, 'loan products'),
      loans: soft(loans, 'loans'),
      settings: settings.data ?? null,
      ledger: soft(ledger, 'ledger'),
      holdings: soft(holdings, 'holdings'),
      orders: soft(orders, 'orders'),
      assets: soft(assets, 'assets'),
      prices: soft(prices, 'prices'),
    };
  };
  // One quiet retry covers a token refresh or a dropped connection.
  try {
    return await attempt();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return attempt();
  }
}

export const memberInvestments = {
  /** Upload the receipt to Images/deposit-proofs/<userId>/<file> first, then pass that path. */
  requestDeposit: (s: SupabaseClient, methodId: string, amount: number, usd: number | null, receiptPath: string) =>
    call<string>(s, 'request_deposit', {
      p_method_id: methodId, p_amount: amount, p_usd: usd, p_receipt_path: receiptPath,
    }),
  requestWithdrawal: (s: SupabaseClient, asset: string, network: string, address: string, amount: number, usd: number | null) =>
    call<string>(s, 'request_withdrawal', {
      p_asset: asset, p_network: network, p_address: address, p_amount: amount, p_usd: usd,
    }),
  cancelWithdrawal: (s: SupabaseClient, id: string) => call(s, 'cancel_withdrawal', { p_id: id }),

  /** Fills at the platform price in asset_prices; the quantity is the only thing the browser decides. */
  placeOrder: (s: SupabaseClient, symbol: string, side: 'buy' | 'sell', qty: number) =>
    call<string>(s, 'place_order', { p_symbol: symbol, p_side: side, p_qty: qty }),

  investInPlan: (
    s: SupabaseClient, planId: string, amount: number, frequency: string, months: number,
    start: string | null = null, reinvest = true,
  ) =>
    call<string>(s, 'invest_in_plan', {
      p_plan_id: planId, p_amount: amount, p_frequency: frequency, p_months: months,
      p_start: start ?? undefined, p_reinvest: reinvest,
    }),

  subscribeSignals: (s: SupabaseClient, planId: string) =>
    call<string>(s, 'subscribe_signal_plan', { p_plan_id: planId }),

  requestLoan: (s: SupabaseClient, productId: string, amount: number, purpose = '') =>
    call<string>(s, 'request_loan', { p_product: productId, p_amount: amount, p_purpose: purpose }),
  cancelLoanRequest: (s: SupabaseClient, id: string) => call(s, 'cancel_loan_request', { p_id: id }),
  repayLoan: (s: SupabaseClient, id: string, amount: number) =>
    call(s, 'repay_loan', { p_id: id, p_amount: amount }),
};
