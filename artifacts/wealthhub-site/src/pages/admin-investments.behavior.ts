/**
 * Injected into the admin iframe AFTER the bootstrap script (see AdminPage.tsx).
 * Replaces the JSON-state deposits, withdrawals, investments and plan catalog
 * with the real Supabase tables, and adds Signals and Loans.
 *
 * Rules for editing this string: no backticks and no dollar-brace sequences
 * (it lives inside String.raw), and everything stays inside the IIFE so it
 * cannot clash with names declared by the other behavior scripts.
 */
export const adminInvestmentsBehavior = String.raw`
(() => {
  /* ---------- bridge to the React host ---------- */
  const waiting = new Map();
  let seq = 0;
  window.addEventListener("message", e => {
    if (e.source !== window.parent || !window.__AUVORIGINOK__(e)) return;
    const m = e.data;
    if (!m || m.type !== "auvrenthia-inv-result") return;
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m.data); else w.reject(new Error(m.error || "The request failed."));
  });
  const inv = (op, ...args) => new Promise((resolve, reject) => {
    const id = "i" + (++seq) + "-" + Date.now();
    waiting.set(id, { resolve, reject });
    window.parent.postMessage({ type: "auvrenthia-inv-call", id, op, args }, window.__AUVHOST__);
    setTimeout(() => { if (waiting.delete(id)) reject(new Error("The request timed out. Try again.")); }, 30000);
  });

  /* ---------- helpers ---------- */
  const num = v => Number(v) || 0;
  const ts = v => (v ? Date.parse(v) : 0);
  const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const emailOf = id => (DB.users.find(u => u.id === id) || {}).email || "";
  const userLab = u => u.name + " (" + u.email + ")";
  const pick = (list, cur) => (cur && list.indexOf(String(cur)) > -1 ? [String(cur)].concat(list.filter(x => x !== String(cur))) : list);
  const retText = p => {
    const a = num(p.return_min), b = num(p.return_max);
    return a === b ? a + "%" : a + "\u2013" + b + "%";
  };
  const short = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "\u2026" : s; };
  const S = { plans: [], signalPlans: [], signals: [], signalSubs: [], loanProducts: [], loans: [], server: null };
  SP.completed = "ok"; SP.repaid = "ok"; SP.defaulted = "bad"; SP.hit = "ok"; SP.stopped = "bad";
  NP.Signals = "money"; NP.Loans = "money";
  FL.loan = "pending"; FL.sig = "feed";

  /* ---------- load server data into the shapes the console already uses ---------- */
  function apply(d) {
    S.server = d;
    S.plans = d.plans;
    const planBy = {};
    d.plans.forEach(p => { planBy[p.id] = p; });
    DB.catalog = d.plans.map(p => ({
      id: p.id, name: p.name, cls: p.category, desc: p.description, risk: p.risk,
      rmin: num(p.return_min), rmax: num(p.return_max), ret: retText(p),
      min: num(p.min_amount), max: p.max_amount == null ? "" : num(p.max_amount),
      freq: p.frequency, months: p.term_months, on: p.is_active, sort: p.sort_order
    }));
    DB.plans = d.userPlans.map(up => {
      const c = planBy[up.plan_id] || {};
      return {
        id: up.id, uid: up.user_id, name: c.name || "Plan", cls: c.category || "", amt: num(up.amount),
        freq: up.frequency, months: up.term_months, status: up.status, ret: c.name ? retText(c) : "",
        t: ts(up.created_at), profit: num(up.profit_paid), payout: up.payout_usd == null ? null : num(up.payout_usd)
      };
    });
    DB.deposits = d.deposits.map(x => ({
      id: x.id, uid: x.user_id, asset: x.asset, net: x.network, amt: num(x.amount), usd: num(x.usd_amount),
      tx: x.receipt_path || "", status: x.status, t: ts(x.created_at), note: x.note || "", receipt: x.receipt_path || ""
    }));
    DB.withdrawals = d.withdrawals.map(x => ({
      id: x.id, uid: x.user_id, asset: x.asset, net: x.network, amt: num(x.amount), usd: num(x.usd_amount),
      to: x.address || "", status: x.status, t: ts(x.created_at), note: x.note || ""
    }));
    S.signalPlans = d.signalPlans; S.signals = d.signals; S.signalSubs = d.signalSubs;
    S.loanProducts = d.loanProducts; S.loans = d.loans;
    const st = d.settings || {};
    DB.settings.needKyc = !!st.need_kyc;
    DB.settings.wdPaused = !!st.withdrawals_paused;
    DB.settings.loansPaused = !!st.loans_paused;
    DB.settings.investingPaused = !!st.investing_paused;
    const bal = {};
    (d.balances || []).forEach(b => { bal[b.id] = num(b.demo_balance); });
    const led = {};
    (d.ledger || []).forEach(l => {
      (led[l.user_id] = led[l.user_id] || []).push({ t: ts(l.created_at), type: l.kind.replace(/_/g, " "), amt: num(l.amount), note: l.note, by: emailOf(l.created_by) || "system" });
    });
    DB.users.forEach(u => {
      if (bal[u.id] != null) u.bal = bal[u.id];
      u.ledger = led[u.id] || [];
    });
    DB.audit = DB.audit.filter(a => !a.srv).concat((d.audit || []).map(a => ({
      t: ts(a.created_at), admin: emailOf(a.actor_id) || "system", act: a.action.replace(/_/g, " "),
      target: emailOf(a.target_user), detail: short(JSON.stringify(a.detail || {}), 160), srv: true
    }))).sort((a, b) => b.t - a.t);
  }
  async function reload() { apply(await inv("load")); }

  /* the old browser-side profit scheduler would change balances locally, so switch it off */
  try { window.accrueUserProfit = () => false; } catch (e) {}

  /* ---------- api: everything goes through the database functions ---------- */
  const origSetting = api.setting;
  const settingMap = { wdPaused: "withdrawals_paused", needKyc: "need_kyc", loansPaused: "loans_paused", investingPaused: "investing_paused" };
  api.setting = async (k, v) => {
    if (!settingMap[k]) return origSetting.call(api, k, v);
    need(k === "wdPaused" ? "money" : "settings");
    const patch = {}; patch[settingMap[k]] = !!v;
    await inv("updateSettings", patch);
    await reload();
  };
  api.decideDep = async (id, ok, note, amountUsd) => { need("money"); await inv("decideDeposit", id, !!ok, note || "", amountUsd == null ? null : amountUsd); await reload(); };
  api.decideWd = async (id, ok, note) => { need("money"); await inv("decideWithdrawal", id, !!ok, note || ""); await reload(); };
  api.adjust = async (id, mode, amt, why) => {
    need("money");
    const u = U(id);
    const delta = r2(mode === "add" ? amt : mode === "sub" ? -amt : amt - u.bal);
    if (!delta) fail("That would not change the balance.");
    await inv("adjustBalance", id, delta, why);
    await reload();
  };
  api.createPlanFor = async (uid, r) => {
    need("money");
    const c = DB.catalog.find(x => x.name === r.p);
    if (!c) fail("Choose a plan.");
    const months = { "6 months": 6, "1 year": 12, "3 years": 36, "5 years": 60, "10 years": 120 }[r.mo] || 12;
    await inv("investForUser", uid, c.id, num(r.amt), months, String(r.fund).indexOf("Take") === 0, r.fq);
    await reload();
  };
  api.planAmount = async (id, dir, amt, why, move) => { need("money"); await inv("changePlanAmount", id, dir === "inc" ? amt : -amt, !!move, why); await reload(); };
  api.planStatus = async (id, s, why, refund) => {
    need("money");
    if (s === "cancelled") await inv("cancelPlan", id, !!refund, why || ""); else await inv("setPlanStatus", id, s);
    await reload();
  };
  const catRow = c => ({
    id: c.id || undefined, name: c.name, category: c.cls, description: c.desc || "", risk: num(c.risk),
    return_min: num(c.rmin), return_max: num(c.rmax), min_amount: num(c.min),
    max_amount: c.max === "" || c.max == null ? null : num(c.max), frequency: c.freq,
    term_months: Math.max(1, Math.round(num(c.months) || 12)), is_active: c.on !== false, sort_order: Math.round(num(c.sort))
  });
  api.saveCatalog = async c => { need("settings"); await inv("savePlan", catRow(c)); await reload(); };
  api.toggleCatalog = async id => { need("settings"); const c = DB.catalog.find(x => x.id === id); await inv("setPlanActive", id, !c.on); await reload(); };
  api.deleteCatalog = async id => { need("settings"); await inv("deletePlan", id); await reload(); };
  api.createAdminPayment = async (kind, uid, f) => {
    need("money");
    if (kind === "deposit") await inv("createDeposit", uid, num(f.amount), f.reason, String(f.status || "").toLowerCase() === "approved");
    else await inv("createWithdrawal", uid, num(f.amount), f.destination || "", f.reason);
    await reload();
  };
  api.createDeposit = async f => {
    need("money");
    const u = U(f.uid);
    if (!u.id) fail("Choose a user.");
    await inv("createDeposit", u.id, num(f.usd), (f.note || "").trim() || ("Admin deposit " + (f.route || "")), String(f.status).toLowerCase() === "approved");
    await reload();
  };
  api.createWithdrawal = async f => {
    need("money");
    const u = U(f.uid);
    if (!u.id) fail("Choose a user.");
    if (String(f.status).toLowerCase() === "approved") fail("Create it as pending, then approve it so the balance is held first.");
    await inv("createWithdrawal", u.id, num(f.usd), f.destination || "", (f.note || "").trim() || "Admin withdrawal");
    await reload();
  };
  api.setProfitSchedule = async () => fail("Automatic profit schedules are switched off. Use Credit profit on the investment instead.");
  api.adjustProfit = async (id, direction, amount, reason) => {
    need("money");
    await inv("adjustBalance", id, r2(direction === "subtract" ? -amount : amount), "Profit adjustment: " + reason);
    await reload();
  };
  api.signalPlanSave = async p => { need("money"); await inv("saveSignalPlan", p); await reload(); };
  api.signalPost = async s => { need("money"); await inv("postSignal", s); await reload(); };
  api.signalStatus = async (id, s) => { need("money"); await inv("setSignalStatus", id, s); await reload(); };
  api.signalDelete = async id => { need("money"); await inv("deleteSignal", id); await reload(); };
  api.signalGrant = async (uid, planId, days, charge) => { need("money"); await inv("grantSignals", uid, planId, days, charge); await reload(); };
  api.signalCancel = async (id, refund) => { need("money"); await inv("cancelSignalSub", id, refund); await reload(); };
  api.loanProductSave = async p => { need("money"); await inv("saveLoanProduct", p); await reload(); };
  api.loanDecide = async (id, ok, note) => { need("money"); await inv("decideLoan", id, !!ok, note || ""); await reload(); };
  api.loanStatus = async (id, s, note) => { need("money"); await inv("setLoanStatus", id, s, note || ""); await reload(); };

  /* ---------- views: deposits and withdrawals ---------- */
  const stFilter = (k, arr) => (FL[k] === "all" ? arr : arr.filter(x => x.status === FL[k]));
  const cnt = a => a.filter(x => x.status === "pending").length;
  V.Deposits = () => {
    const L = stFilter("dep", DB.deposits);
    return hd("Check each payment and its receipt, then approve or decline", "Deposits",
      '<div class="row" style="margin:0"><button class="btn alt" data-a="exp" data-t="deposits">Export CSV</button><button class="btn" data-a="new-deposit">Create deposit</button></div>') +
      tabs("dep", [["pending", "Pending (" + cnt(DB.deposits) + ")"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]]) +
      tbl([["User", "1.3fr"], ["Asset", "1fr"], ["Amount", "120px", "r"], ["Receipt", "110px"], ["Time", "110px"], ["Status / action", "230px"]],
        L.map(d => {
          const rec = d.receipt ? '<button class="btn sm alt" data-a="inv-receipt" data-p="' + esc(d.receipt) + '">View</button>' : "<small>None</small>";
          const act = d.status === "pending"
            ? '<div class="acts"><button class="btn sm" data-a="dep-ok" data-id="' + d.id + '" ' + (U(d.uid).status !== "active" ? "disabled" : "") + '>Approve</button><button class="btn sm bad" data-a="dep-no" data-id="' + d.id + '">Decline</button></div>'
            : '<div class="acts">' + pill(d.status) + "</div>" + (d.note ? "<small>" + esc(d.note) + "</small>" : "");
          return [who(U(d.uid)), d.asset + "<small>" + esc(d.net) + "</small>", usd(d.usd) + "<small>" + d.amt + " " + d.asset + "</small>", rec, dt(d.t), act];
        }), "No deposits in this list.");
  };
  V.Withdrawals = () => {
    const s = DB.settings, L = stFilter("wd", DB.withdrawals);
    return hd("Approve payouts once you have sent them", "Withdrawals",
      '<div class="row" style="margin:0"><button class="btn alt" data-a="exp" data-t="withdrawals">Export CSV</button><button class="btn alt" data-a="new-withdrawal">Create withdrawal</button><button class="btn ' + (s.wdPaused ? "" : "alt") + '" data-a="pausewd">' + (s.wdPaused ? "Resume withdrawals" : "Pause all withdrawals") + "</button></div>") +
      (s.wdPaused ? '<div class="banner bad">Withdrawals are paused. Members cannot request new ones and pending requests cannot be approved until you resume.</div>' : "") +
      tabs("wd", [["pending", "Pending (" + cnt(DB.withdrawals) + ")"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]]) +
      tbl([["User", "1.3fr"], ["Asset", "1fr"], ["Amount", "120px", "r"], ["Destination", "1.3fr"], ["Time", "110px"], ["Status / action", "230px"]],
        L.map(w => {
          const u = U(w.uid), blocked = u.status !== "active";
          const act = w.status === "pending"
            ? '<div class="acts"><button class="btn sm" data-a="wd-ok" data-id="' + w.id + '" ' + (s.wdPaused || blocked ? "disabled" : "") + '>Approve</button><button class="btn sm bad" data-a="wd-no" data-id="' + w.id + '">Decline</button></div>'
            : '<div class="acts">' + pill(w.status) + "</div>" + (w.note ? "<small>" + esc(w.note) + "</small>" : "");
          return [who(u) + (blocked ? '<small style="color:var(--dn)">Account on hold or suspended</small>' : ""), w.asset + "<small>" + esc(w.net) + "</small>", usd(w.usd) + "<small>" + w.amt + " " + w.asset + "</small>", '<small style="word-break:break-all">' + esc(w.to) + "</small>", dt(w.t), act];
        }), "No withdrawals in this list.");
  };
  H["dep-ok"] = async b => {
    const d = DB.deposits.find(x => x.id === b.dataset.id);
    const r = await ask("Approve deposit", [{ k: "usd", l: "Amount to credit (USD)", t: "number", r: 1, v: d.usd }, { k: "note", l: "Note (optional)" }], "Approve and credit", "The amount is added to the member balance. Change it if the receipt shows a different value.");
    if (r) run(() => api.decideDep(d.id, true, r.note, num(r.usd)), "Deposit approved and credited");
  };
  H["dep-no"] = async b => {
    const r = await ask("Decline deposit", [{ k: "note", l: "Reason", t: "area", r: 1 }], "Decline");
    if (r) run(() => api.decideDep(b.dataset.id, false, r.note), "Deposit declined");
  };
  H["wd-ok"] = async b => {
    const r = await ask("Approve withdrawal", [{ k: "note", l: "Transaction hash (optional)" }], "Approve payout", "The amount was already held from the balance when it was requested. Approve once you have sent the funds.");
    if (r) run(() => api.decideWd(b.dataset.id, true, r.note), "Withdrawal approved");
  };
  H["wd-no"] = async b => {
    const r = await ask("Decline withdrawal", [{ k: "note", l: "Reason", t: "area", r: 1 }], "Decline", "The held amount goes back to the member balance.");
    if (r) run(() => api.decideWd(b.dataset.id, false, r.note), "Withdrawal declined and refunded");
  };
  H["inv-receipt"] = async b => {
    try {
      const url = await inv("receiptUrl", b.dataset.p);
      const o = $("#ov");
      o.hidden = false;
      o.innerHTML = '<div class="sheet"><div class="sh"><div><h3>Deposit receipt</h3></div><button class="ic" data-a="ovx" aria-label="Close">\u2715</button></div><img src="' + esc(url) + '" alt="Deposit receipt" style="max-width:100%;border-radius:12px"></div>';
      o.onclick = e => { if (e.target === o) closeOv(); };
    } catch (e) { toast(e.message); }
  };
  async function adminPayment(kind) {
    const f = [{ k: "user", l: "User", t: "select", o: DB.users.map(userLab) }, { k: "amount", l: "Amount (USD)", t: "number", r: 1 }];
    if (kind === "deposit") f.push({ k: "status", l: "Status", t: "select", o: ["Pending", "Approved"] });
    else f.push({ k: "destination", l: "Destination (optional)" });
    f.push({ k: "reason", l: "Reason", t: "area", r: 1 });
    const r = await ask(kind === "deposit" ? "Create deposit" : "Create withdrawal", f, "Create",
      kind === "deposit" ? "Approved credits the balance now. Pending waits for your approval." : "The amount is held from the balance now and paid out when you approve it.");
    if (!r) return;
    const u = DB.users.find(x => userLab(x) === r.user);
    if (!u) { toast("Choose a valid user."); return; }
    run(() => api.createAdminPayment(kind, u.id, r), kind === "deposit" ? "Deposit created" : "Withdrawal created and held");
  }
  H["new-deposit"] = () => adminPayment("deposit");
  H["new-withdrawal"] = () => adminPayment("withdrawal");

  /* ---------- views: investments and plan catalog ---------- */
  V.Investments = () => {
    const L = stFilter("inv", DB.plans);
    return hd("Change what members have invested", "Investments", '<button class="btn" data-a="addinv">Create investment</button>') +
      (DB.settings.investingPaused ? '<div class="banner bad">Member investing is paused. Admin changes still work.</div>' : "") +
      tabs("inv", [["all", "All"], ["active", "Active"], ["paused", "Paused"], ["completed", "Completed"], ["cancelled", "Cancelled"]]) +
      tbl([["User", "1.4fr"], ["Plan", "1.2fr"], ["Amount", "110px", "r"], ["Profit paid", "100px", "r"], ["Schedule", "100px"], ["Status", "100px"], ["", "100px", "r"]],
        L.map(p => [who(U(p.uid)), p.name + "<small>" + esc(p.cls) + " \u00b7 " + esc(p.ret) + "</small>", usd(p.amt), usd(p.profit), p.freq, pill(p.status), '<button class="btn sm" data-a="pl" data-id="' + p.id + '">Manage</button>']),
        "No investments in this list.");
  };
  window.planSheet = id => {
    const p = DB.plans.find(x => x.id === id), u = U(p.uid), o = $("#ov"), closed = p.status === "cancelled" || p.status === "completed" ? "disabled" : "";
    o.hidden = false;
    o.innerHTML = '<div class="sheet"><div class="sh"><div><h3>' + esc(p.name) + "</h3><p>" + esc(u.name) + " \u00b7 " + esc(p.cls) + " \u00b7 " + p.freq + (p.months ? " \u00b7 " + termL(p.months) : "") + '</p></div><button class="ic" data-a="ovx" aria-label="Close">\u2715</button></div><div class="bigb"><span>Invested</span><b>' + usd(p.amt) + "</b> " + pill(p.status) + '</div><p class="note">Profit paid so far: ' + usd(p.profit) + '</p><div class="grid2">' +
      '<button class="btn alt" data-a="pl-inc" data-id="' + p.id + '" ' + closed + ">Increase amount</button>" +
      '<button class="btn alt" data-a="pl-red" data-id="' + p.id + '" ' + closed + ">Reduce amount</button>" +
      '<button class="btn alt" data-a="pl-profit" data-id="' + p.id + '" ' + (p.status !== "active" ? "disabled" : "") + ">Credit profit</button>" +
      '<button class="btn alt" data-a="pl-settle" data-id="' + p.id + '" ' + closed + ">Settle and pay out</button>" +
      '<button class="btn alt" data-a="pl-pause" data-id="' + p.id + '" ' + closed + ">" + (p.status === "paused" ? "Resume plan" : "Pause plan") + "</button>" +
      '<button class="btn bad" data-a="pl-cancel" data-id="' + p.id + '" ' + closed + ">Cancel plan</button></div></div>";
    o.onclick = e => { if (e.target === o) closeOv(); };
  };
  H.pl = b => window.planSheet(b.dataset.id);
  H["pl-profit"] = async b => {
    closeOv();
    const p = DB.plans.find(x => x.id === b.dataset.id);
    const r = await ask("Credit profit", [{ k: "amt", l: "Profit (USD)", t: "number", r: 1 }, { k: "why", l: "Note", r: 1 }], "Credit", p.name + " for " + U(p.uid).name + ". The amount is added to their balance and the plan stays active.");
    if (r) run(async () => { await inv("creditPlanProfit", p.id, num(r.amt), r.why); await reload(); }, "Profit credited");
  };
  H["pl-settle"] = async b => {
    closeOv();
    const p = DB.plans.find(x => x.id === b.dataset.id);
    const r = await ask("Settle plan", [{ k: "amt", l: "Total payout (USD)", t: "number", r: 1, v: p.amt }, { k: "why", l: "Note", r: 1 }], "Settle and pay out", "Closes the plan and credits the payout (principal plus return) to the member balance.");
    if (r) run(async () => { await inv("settlePlan", p.id, num(r.amt), r.why); await reload(); }, "Plan settled");
  };

  V["Plan catalog"] = () => hd("The plans members can choose from", "Plan catalog", '<button class="btn" data-a="cat-new">Create plan</button>') +
    tbl([["Plan", "1.4fr"], ["Market", "110px"], ["Risk", "80px"], ["Return", "100px"], ["Min / max", "130px", "r"], ["Schedule", "100px"], ["Term", "70px"], ["Status", "90px"], ["", "210px"]],
      DB.catalog.map(c => [esc(c.name) + (c.desc ? "<small>" + esc(short(c.desc, 70)) + "</small>" : ""), esc(c.cls), ["", "Low", "Medium", "High"][c.risk] || "", c.ret, usd(c.min) + (c.max === "" ? "" : "<small>up to " + usd(c.max) + "</small>"), c.freq, termL(c.months), pill(c.on ? "active" : "paused"),
        '<div class="acts"><button class="btn sm alt" data-a="cat-edit" data-id="' + c.id + '">Edit</button><button class="btn sm alt" data-a="cat-tog" data-id="' + c.id + '">' + (c.on ? "Disable" : "Enable") + '</button><button class="btn sm bad" data-a="cat-del" data-id="' + c.id + '">Delete</button></div>']),
      "No plans yet. Create the first one.");
  window.catForm = async c => {
    const r = await ask(c ? "Edit plan" : "Create plan", [
      { k: "name", l: "Plan name", r: 1, v: c ? c.name : "" },
      { k: "cls", l: "Market", t: "select", o: pick(["Stocks", "ETFs", "Crypto", "Real estate", "Bonds", "Commodities", "Balanced"], c && c.cls) },
      { k: "desc", l: "Description shown to members", t: "area" },
      { k: "risk", l: "Risk (1 low, 2 medium, 3 high)", t: "select", o: pick(["1", "2", "3"], c && c.risk) },
      { k: "rmin", l: "Return from (% per term)", t: "number", r: 1, v: c ? c.rmin : 5 },
      { k: "rmax", l: "Return to (%)", t: "number", r: 1, v: c ? c.rmax : 8 },
      { k: "min", l: "Minimum (USD)", t: "number", r: 1, v: c ? c.min : 50 },
      { k: "max", l: "Maximum (USD, leave empty for none)", t: "number", v: c ? c.max : "" },
      { k: "freq", l: "Schedule", t: "select", o: pick(["Weekly", "Monthly", "Quarterly", "One-time"], c && c.freq) },
      { k: "months", l: "Default term (months)", t: "number", r: 1, v: c ? c.months : 12 },
      { k: "sort", l: "Sort order (lowest first)", t: "number", v: c ? c.sort : 0 }
    ], "Save plan");
    if (!r) return;
    if (num(r.rmax) < num(r.rmin)) { toast("Return to must be at least return from."); return; }
    run(() => api.saveCatalog(Object.assign({}, c || {}, { name: r.name.trim(), cls: r.cls, desc: r.desc, risk: +r.risk, rmin: r.rmin, rmax: r.rmax, min: r.min, max: r.max, freq: r.freq, months: r.months, sort: r.sort })), "Plan saved");
  };
  H["cat-new"] = () => window.catForm();
  H["cat-edit"] = b => window.catForm(DB.catalog.find(c => c.id === b.dataset.id));
  H["cat-del"] = async b => {
    const c = DB.catalog.find(x => x.id === b.dataset.id);
    const r = await ask("Delete plan", [], "Delete", "Delete " + c.name + "? A plan that members have invested in cannot be deleted. Disable it instead.");
    if (r) run(() => api.deleteCatalog(c.id), "Plan deleted");
  };

  /* ---------- Signals ---------- */
  const subActive = s => s.status === "active" && ts(s.expires_at) > Date.now();
  V.Signals = () => {
    const t = FL.sig;
    let body = "";
    if (t === "plans") {
      body = tbl([["Plan", "1.2fr"], ["Price", "90px", "r"], ["Period", "90px"], ["Features", "2fr"], ["Status", "90px"], ["", "150px"]],
        S.signalPlans.map(p => [esc(p.name) + (p.badge ? "<small>" + esc(p.badge) + "</small>" : "") + "<small>" + esc(p.id) + "</small>", usd(num(p.price)), p.period_days + " days", "<small>" + esc((p.features || []).join(" \u00b7 ")) + "</small>", pill(p.is_active ? "active" : "paused"),
          '<div class="acts"><button class="btn sm alt" data-a="sp-edit" data-id="' + esc(p.id) + '">Edit</button><button class="btn sm alt" data-a="sp-tog" data-id="' + esc(p.id) + '">' + (p.is_active ? "Disable" : "Enable") + "</button></div>"]),
        "No signal plans yet.");
    } else if (t === "subs") {
      body = tbl([["Member", "1.4fr"], ["Plan", "1fr"], ["Paid", "90px", "r"], ["Started", "110px"], ["Expires", "110px"], ["Status", "90px"], ["", "150px"]],
        S.signalSubs.map(s => [who(U(s.user_id)), esc(s.plan_id), usd(num(s.price)), dt(ts(s.started_at)), dt(ts(s.expires_at)), pill(subActive(s) ? "active" : s.status === "cancelled" ? "cancelled" : "closed"),
          s.status === "active" ? '<button class="btn sm bad" data-a="ss-cancel" data-id="' + s.id + '">Cancel</button>' : ""]),
        "Nobody has subscribed yet.");
    } else {
      body = tbl([["Asset", "1.2fr"], ["Side", "70px"], ["Entry", "100px", "r"], ["Take profit", "100px", "r"], ["Stop loss", "100px", "r"], ["Posted", "110px"], ["Status", "90px"], ["", "230px"]],
        S.signals.map(g => [esc(g.symbol) + "<small>" + esc(g.category) + "</small>", g.direction === "buy" ? "Buy" : "Sell", g.entry, g.take_profit, g.stop_loss, dt(ts(g.posted_at)), pill(g.status),
          '<div class="acts"><button class="btn sm alt" data-a="sg-set" data-id="' + g.id + '" data-s="hit">Hit</button><button class="btn sm alt" data-a="sg-set" data-id="' + g.id + '" data-s="stopped">Stopped</button><button class="btn sm alt" data-a="sg-set" data-id="' + g.id + '" data-s="closed">Close</button><button class="btn sm bad" data-a="sg-del" data-id="' + g.id + '">Delete</button></div>']),
        "No signals posted yet.");
    }
    return hd("Plans members pay for, and the signals they receive", "Signals",
      '<div class="row" style="margin:0"><button class="btn" data-a="sg-new">Post signal</button><button class="btn alt" data-a="sp-new">Create signal plan</button><button class="btn alt" data-a="ss-grant">Grant subscription</button></div>') +
      tabs("sig", [["feed", "Signals (" + S.signals.length + ")"], ["subs", "Subscriptions (" + S.signalSubs.filter(subActive).length + ")"], ["plans", "Signal plans"]]) + body;
  };
  H["sp-new"] = () => signalPlanForm();
  H["sp-edit"] = b => signalPlanForm(S.signalPlans.find(p => p.id === b.dataset.id));
  H["sp-tog"] = b => { const p = S.signalPlans.find(x => x.id === b.dataset.id); run(() => api.signalPlanSave(Object.assign({}, p, { is_active: !p.is_active })), p.is_active ? "Signal plan disabled" : "Signal plan enabled"); };
  async function signalPlanForm(p) {
    const f = [];
    if (!p) f.push({ k: "id", l: "Plan id (letters, numbers, dashes; cannot change later)", r: 1 });
    f.push({ k: "name", l: "Name", r: 1, v: p ? p.name : "" }, { k: "blurb", l: "Short description", v: p ? p.blurb : "" },
      { k: "price", l: "Price (USD)", t: "number", r: 1, v: p ? p.price : 49 }, { k: "days", l: "Period (days)", t: "number", r: 1, v: p ? p.period_days : 30 },
      { k: "features", l: "Features (one per line)", t: "area" }, { k: "badge", l: "Badge (for example Most popular)", v: p ? p.badge : "" },
      { k: "sort", l: "Sort order", t: "number", v: p ? p.sort_order : 0 });
    const r = await ask(p ? "Edit signal plan" : "Create signal plan", f, "Save");
    if (!r) return;
    const id = p ? p.id : r.id.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(id)) { toast("Plan id can use letters, numbers and dashes only."); return; }
    const feats = r.features.trim() ? r.features.split("\n").map(x => x.trim()).filter(Boolean) : (p ? p.features : []);
    run(() => api.signalPlanSave({ id, name: r.name.trim(), blurb: r.blurb, price: num(r.price), period_days: Math.max(1, Math.round(num(r.days))), features: feats, badge: r.badge, sort_order: Math.round(num(r.sort)), is_active: p ? p.is_active : true }), "Signal plan saved");
  }
  H["sg-new"] = async () => {
    const r = await ask("Post signal", [
      { k: "cat", l: "Market", t: "select", o: ["Crypto", "Forex", "Stocks", "ETFs", "Commodities"] },
      { k: "sym", l: "Symbol (for example BTC/USDT)", r: 1 },
      { k: "dir", l: "Direction", t: "select", o: ["Buy", "Sell"] },
      { k: "entry", l: "Entry", t: "number", r: 1, step: "0.00000001" },
      { k: "tp", l: "Take profit", t: "number", r: 1, step: "0.00000001" },
      { k: "sl", l: "Stop loss", t: "number", r: 1, step: "0.00000001" }
    ], "Post signal", "Only members with an active signal plan can see it.");
    if (r) run(() => api.signalPost({ category: r.cat, symbol: r.sym.trim().toUpperCase(), direction: r.dir.toLowerCase(), entry: num(r.entry), take_profit: num(r.tp), stop_loss: num(r.sl) }), "Signal posted");
  };
  H["sg-set"] = b => run(() => api.signalStatus(b.dataset.id, b.dataset.s), "Signal updated");
  H["sg-del"] = async b => { const r = await ask("Delete signal", [], "Delete", "This removes it from every member."); if (r) run(() => api.signalDelete(b.dataset.id), "Signal deleted"); };
  H["ss-grant"] = async () => {
    const act = S.signalPlans.filter(p => p.is_active);
    if (!act.length) { toast("Create an active signal plan first."); return; }
    const r = await ask("Grant signal subscription", [
      { k: "user", l: "Member", t: "select", o: DB.users.map(userLab) },
      { k: "plan", l: "Plan", t: "select", o: act.map(p => p.id + " \u00b7 " + p.name) },
      { k: "days", l: "Days (empty uses the plan period)", t: "number" },
      { k: "charge", l: "Charge the member balance?", t: "select", o: ["No, free grant", "Yes, charge the plan price"] }
    ], "Grant");
    if (!r) return;
    const u = DB.users.find(x => userLab(x) === r.user);
    if (!u) { toast("Choose a valid member."); return; }
    run(() => api.signalGrant(u.id, r.plan.split(" \u00b7 ")[0], r.days === "" ? null : Math.round(num(r.days)), r.charge.indexOf("Yes") === 0), "Subscription granted");
  };
  H["ss-cancel"] = async b => {
    const r = await ask("Cancel subscription", [{ k: "refund", l: "Refund the price paid?", t: "select", o: ["No", "Yes"] }], "Cancel subscription");
    if (r) run(() => api.signalCancel(b.dataset.id, r.refund === "Yes"), "Subscription cancelled");
  };

  /* ---------- Loans ---------- */
  const loanPend = () => S.loans.filter(l => l.status === "pending").length;
  V.Loans = () => {
    const t = FL.loan, s = DB.settings;
    let body;
    if (t === "products") {
      body = tbl([["Product", "1.4fr"], ["Amount range", "150px", "r"], ["Interest", "90px"], ["Term", "80px"], ["Status", "90px"], ["", "150px"]],
        S.loanProducts.map(p => [esc(p.name) + (p.description ? "<small>" + esc(short(p.description, 80)) + "</small>" : ""), usd(num(p.min_amount)) + " \u2013 " + usd(num(p.max_amount)), num(p.interest_pct) + "% flat", termL(p.term_months), pill(p.is_active ? "active" : "paused"),
          '<div class="acts"><button class="btn sm alt" data-a="lp-edit" data-id="' + p.id + '">Edit</button><button class="btn sm alt" data-a="lp-tog" data-id="' + p.id + '">' + (p.is_active ? "Disable" : "Enable") + "</button></div>"]),
        "No loan products yet.");
    } else {
      const L = t === "all" ? S.loans : S.loans.filter(l => l.status === t);
      body = tbl([["Member", "1.3fr"], ["Product", "1fr"], ["Principal", "100px", "r"], ["Repaid / due", "130px", "r"], ["Due date", "100px"], ["Status / action", "250px"]],
        L.map(l => {
          let act = "";
          if (l.status === "pending") act = '<div class="acts"><button class="btn sm" data-a="ln-ok" data-id="' + l.id + '">Approve</button><button class="btn sm bad" data-a="ln-no" data-id="' + l.id + '">Decline</button></div>';
          else if (l.status === "active") act = '<div class="acts">' + pill("active") + '<button class="btn sm alt" data-a="ln-set" data-id="' + l.id + '" data-s="repaid">Mark repaid</button><button class="btn sm bad" data-a="ln-set" data-id="' + l.id + '" data-s="defaulted">Default</button></div>';
          else act = '<div class="acts">' + pill(l.status) + "</div>" + (l.note ? "<small>" + esc(l.note) + "</small>" : "");
          return [who(U(l.user_id)) + (l.purpose ? "<small>" + esc(short(l.purpose, 80)) + "</small>" : ""), esc(l.product_name || "Loan") + "<small>" + num(l.interest_pct) + "% \u00b7 " + termL(l.term_months) + "</small>", usd(num(l.principal)), usd(num(l.repaid)) + "<small>of " + usd(num(l.total_due)) + "</small>", l.due_date || "\u2014", act];
        }), "No loans in this list.");
    }
    return hd("Review requests, track repayments, set the products", "Loans",
      '<div class="row" style="margin:0"><button class="btn" data-a="lp-new">Create loan product</button><button class="btn ' + (s.loansPaused ? "" : "alt") + '" data-a="sw-loans">' + (s.loansPaused ? "Resume loan requests" : "Pause loan requests") + "</button></div>") +
      (s.loansPaused ? '<div class="banner bad">Loan requests are paused. Members cannot request new loans.</div>' : "") +
      tabs("loan", [["pending", "Pending (" + loanPend() + ")"], ["active", "Active"], ["repaid", "Repaid"], ["declined", "Declined"], ["defaulted", "Defaulted"], ["all", "All"], ["products", "Products"]]) + body;
  };
  H["sw-loans"] = () => run(() => api.setting("loansPaused", !DB.settings.loansPaused), DB.settings.loansPaused ? "Loan requests resumed" : "Loan requests paused");
  H["ln-ok"] = async b => {
    const l = S.loans.find(x => x.id === b.dataset.id);
    const r = await ask("Approve loan", [{ k: "note", l: "Note (optional)" }], "Approve and pay out", usd(num(l.principal)) + " is credited to the member balance now. They repay " + usd(num(l.total_due)) + ".");
    if (r) run(() => api.loanDecide(l.id, true, r.note), "Loan approved and credited");
  };
  H["ln-no"] = async b => { const r = await ask("Decline loan", [{ k: "note", l: "Reason", t: "area", r: 1 }], "Decline"); if (r) run(() => api.loanDecide(b.dataset.id, false, r.note), "Loan declined"); };
  H["ln-set"] = async b => { const r = await ask("Update loan", [{ k: "note", l: "Note", r: 1 }], "Save"); if (r) run(() => api.loanStatus(b.dataset.id, b.dataset.s, r.note), "Loan updated"); };
  H["lp-new"] = () => loanProductForm();
  H["lp-edit"] = b => loanProductForm(S.loanProducts.find(p => p.id === b.dataset.id));
  H["lp-tog"] = b => { const p = S.loanProducts.find(x => x.id === b.dataset.id); run(() => api.loanProductSave(Object.assign({}, p, { is_active: !p.is_active })), p.is_active ? "Product disabled" : "Product enabled"); };
  async function loanProductForm(p) {
    const r = await ask(p ? "Edit loan product" : "Create loan product", [
      { k: "name", l: "Name", r: 1, v: p ? p.name : "" }, { k: "desc", l: "Description", v: p ? p.description : "" },
      { k: "min", l: "Minimum (USD)", t: "number", r: 1, v: p ? p.min_amount : 100 }, { k: "max", l: "Maximum (USD)", t: "number", r: 1, v: p ? p.max_amount : 5000 },
      { k: "rate", l: "Total interest over the term (%)", t: "number", r: 1, v: p ? p.interest_pct : 5 }, { k: "months", l: "Term (months)", t: "number", r: 1, v: p ? p.term_months : 6 },
      { k: "sort", l: "Sort order", t: "number", v: p ? p.sort_order : 0 }
    ], "Save product");
    if (!r) return;
    if (num(r.max) < num(r.min)) { toast("Maximum must be at least the minimum."); return; }
    run(() => api.loanProductSave(Object.assign({}, p || {}, { name: r.name.trim(), description: r.desc, min_amount: num(r.min), max_amount: num(r.max), interest_pct: num(r.rate), term_months: Math.max(1, Math.round(num(r.months))), sort_order: Math.round(num(r.sort)), is_active: p ? p.is_active : true })), "Loan product saved");
  }

  /* ---------- settings switch for investing ---------- */
  const origSettings = V.Settings;
  V.Settings = () => origSettings() + '<div class="card" style="margin-top:14px">' +
    rw("Member investing", "Pause new plan investments from members", sw("investingPaused", !DB.settings.investingPaused, "Investing allowed")) + "</div>";

  /* ---------- navigation and badges ---------- */
  window.drawNav = function () {
    const c = count(), extra = { Loans: loanPend() };
    const L = [["Overview"], "Payments", ["Deposits"], ["Withdrawals"], ["Loans"], ["Verification"], "People and plans", ["Users"], ["Investments"], ["Plan catalog"], ["Signals"], "Engage", ["Support"], ["Announcements"], "System", ["Team"], ["Audit log"], ["Settings"]]
      .filter(x => typeof x === "string" || !NP[x[0]] || can(NP[x[0]]));
    $("#nav").innerHTML = L.map(x => typeof x === "string" ? '<div class="grp">' + x + "</div>" : '<button class="nav ' + (view === x[0] ? "on" : "") + '" data-v="' + x[0] + '">' + x[0] + ((c[x[0]] || extra[x[0]]) ? "<i>" + (c[x[0]] || extra[x[0]]) + "</i>" : "") + "</button>").join("");
  };
  /* settings toggles for "investingPaused" use data-k, which H.sw handles; invert so ON means allowed */
  H.sw = b => {
    const k = b.dataset.k;
    if (k === "investingPaused") return run(() => api.setting(k, !DB.settings.investingPaused), "Saved");
    return run(() => api.setting(k, !DB.settings[k]));
  };

  /* ---------- first load ---------- */
  DB.catalog = DB.catalog || []; DB.plans = DB.plans || []; DB.deposits = DB.deposits || []; DB.withdrawals = DB.withdrawals || [];
  inv("load").then(d => { apply(d); render(); }).catch(e => { toast(e.message || "Could not load investment data."); try { render(); } catch (x) {} });
  setInterval(() => { if (!document.hidden && $("#ov").hidden) reload().then(() => { if ($("#ov").hidden) render(); }).catch(() => {}); }, 60000);
})();
`;
