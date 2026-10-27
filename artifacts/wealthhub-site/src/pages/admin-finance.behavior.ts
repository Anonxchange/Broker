export const adminFinanceBehavior = `
  const profitPeriodNames = { hour: "hour", day: "day", month: "month", year: "year" };
  const profitPeriodOptions = [
    ["hour", "Hourly"],
    ["day", "Daily"],
    ["month", "Monthly"],
    ["year", "Yearly"],
  ];
  const maxDemoAmount = 1000000000000;
  const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const userLabel = user => user.name + " (" + user.email + ")";
  const activePrincipal = user => DB.plans
    .filter(plan => plan.uid === user.id && plan.status === "active")
    .reduce((sum, plan) => sum + (Number(plan.amt) || 0), 0);

  DB.users.forEach(user => {
    if (!Number.isFinite(Number(user.profit))) user.profit = 0;
    if (!Number.isFinite(Number(user.profitRate))) user.profitRate = 0;
    if (!profitPeriodNames[user.profitPeriod]) user.profitPeriod = "day";
    if (typeof user.profitEnabled !== "boolean") user.profitEnabled = user.profitRate > 0;
    if (!Number.isFinite(Number(user.profitLastAt)) || Number(user.profitLastAt) <= 0) {
      user.profitLastAt = Date.now();
    }
  });
  save();

  function nextProfitAt(timestamp, period) {
    const date = new Date(timestamp);
    if (period === "hour") {
      date.setUTCHours(date.getUTCHours() + 1);
    } else if (period === "day") {
      date.setUTCDate(date.getUTCDate() + 1);
    } else if (period === "month") {
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
    } else if (period === "year") {
      const month = date.getUTCMonth();
      const day = date.getUTCDate();
      date.setUTCDate(1);
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      date.setUTCMonth(month);
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, lastDay));
    }
    return date.getTime();
  }

  function accrueUserProfit(user, now) {
    if (!user || !user.profitEnabled) return false;
    const rate = Number(user.profitRate);
    const period = user.profitPeriod;
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100 || !profitPeriodNames[period]) return false;

    let cursor = Number(user.profitLastAt);
    if (!Number.isFinite(cursor) || cursor <= 0 || cursor > now) {
      user.profitLastAt = now;
      return true;
    }

    let changed = false;
    let processed = 0;
    while (processed < 1000) {
      const next = nextProfitAt(cursor, period);
      if (!Number.isFinite(next) || next <= cursor || next > now) break;
      cursor = next;
      processed += 1;
      changed = true;

      const principalAndProfit = activePrincipal(user) + (Number(user.profit) || 0);
      const earned = money(principalAndProfit * rate / 100);
      if (!Number.isFinite(earned) || earned < 0 ||
          (Number(user.profit) || 0) + earned > maxDemoAmount ||
          (Number(user.bal) || 0) + earned > maxDemoAmount) {
        user.profitEnabled = false;
        user.profitLastAt = now;
        log("Profit schedule paused", user.email, "The demo accrual limit was reached.");
        toast("Profit schedule paused at the demo accrual limit.");
        return true;
      }

      if (earned > 0) {
        user.profit = money((Number(user.profit) || 0) + earned);
        user.bal = money((Number(user.bal) || 0) + earned);
        led(user, "profit", earned, "Scheduled profit credit: " + rate + "% per " + period);
        log("Scheduled profit credited", user.email, usd(earned) + " at " + rate + "% per " + period);
      }
    }

    if (changed) user.profitLastAt = cursor;
    return changed;
  }

  function accrueAllProfits() {
    let changed = false;
    const now = Date.now();
    DB.users.forEach(user => {
      if (accrueUserProfit(user, now)) changed = true;
    });
    if (changed) save();
    return changed;
  }

  function profitPanel(user) {
    const principal = activePrincipal(user);
    const profit = Number(user.profit) || 0;
    const period = profitPeriodNames[user.profitPeriod] ? user.profitPeriod : "day";
    const rate = Number(user.profitRate) || 0;
    const nextCredit = user.profitEnabled ? dt(nextProfitAt(Number(user.profitLastAt), period)) : "Not scheduled";
    const readOnly = can("money") ? "" : " disabled";
    const periods = profitPeriodOptions.map(option =>
      '<option value="' + option[0] + '"' + (period === option[0] ? " selected" : "") + ">" + option[1] + "</option>"
    ).join("");

    return '<div class="mini"><div>Profit credited</div><div class="r">' + usd(profit) + "</div></div>" +
      '<div class="mini"><div>Active investment principal</div><div class="r">' + usd(principal) + "</div></div>" +
      '<div class="mini"><div>Compounding base</div><div class="r">' + usd(principal + profit) + "</div></div>" +
      '<div class="mini"><div>Schedule status<small>' +
        (user.profitEnabled ? rate + "% per " + period + " · next credit " + nextCredit : "No active rate") +
      '</small></div><div class="r">' + pill(user.profitEnabled ? "active" : "paused") + "</div></div>" +
      '<h4>Profit schedule</h4>' +
      '<div class="two" style="grid-template-columns:1fr 1fr">' +
        '<div><label class="fl" for="profit-rate">Rate per period (%)</label>' +
          '<input class="sel" id="profit-rate" data-testid="input-profit-rate" type="number" min="0" max="100" step="0.01" value="' + esc(String(rate)) + '"' + readOnly + "></div>" +
        '<div><label class="fl" for="profit-period">Credit interval</label>' +
          '<select class="sel" id="profit-period" data-testid="select-profit-period"' + readOnly + ">" + periods + "</select></div>" +
      '</div>' +
      '<div class="err" id="profit-error" role="status"></div>' +
      '<button class="btn sm" data-a="save-profit-rate" data-id="' + esc(user.id) + '" data-testid="button-save-profit-rate"' + readOnly + ">Save rate</button>" +
      '<p class="note">The rate compounds on active investment principal plus prior credited profit. Credits are added to the balance when due. Hourly and daily periods use UTC time; monthly and yearly periods use UTC calendar dates. This prototype catches up when reopened and does not run while closed. Accrual pauses above $1 trillion.</p>' +
      '<h4>Manual adjustment</h4>' +
      '<p class="note">Increase or decrease changes both tracked profit and the available balance. Decreases cannot exceed either amount.</p>' +
      '<div class="acts">' +
        '<button class="btn sm" data-a="profit-add" data-id="' + esc(user.id) + '" data-testid="button-increase-profit"' + readOnly + ">Increase profit</button>" +
        '<button class="btn sm bad" data-a="profit-sub" data-id="' + esc(user.id) + '" data-testid="button-decrease-profit"' + readOnly + ">Decrease profit</button>" +
      "</div>";
  }

  api.setProfitSchedule = async function(id, rateValue, period) {
    need("money");
    const user = U(id);
    const rate = Number(rateValue);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) fail("Enter a rate from 0 to 100 percent per period.");
    if (!profitPeriodNames[period]) fail("Choose an hourly, daily, monthly, or yearly interval.");
    const now = Date.now();
    accrueUserProfit(user, now);
    user.profitRate = rate;
    user.profitPeriod = period;
    user.profitEnabled = rate > 0;
    user.profitLastAt = now;
    log("Profit schedule " + (user.profitEnabled ? "updated" : "disabled"), user.email,
      rate + "% per " + period + (user.profitEnabled ? "" : "; automatic credits stopped"));
    save();
  };

  api.adjustProfit = async function(id, direction, amountValue, reasonValue) {
    need("money");
    const user = U(id);
    const amount = money(amountValue);
    const reason = String(reasonValue || "").trim();
    if (!Number.isFinite(amount) || amount <= 0) fail("Enter a profit adjustment greater than zero.");
    if (!reason) fail("A reason is required.");
    accrueUserProfit(user, Date.now());
    if (direction === "subtract") {
      if (amount > (Number(user.profit) || 0)) fail("The decrease cannot exceed the user's tracked profit.");
      if (amount > (Number(user.bal) || 0)) fail("The decrease cannot exceed the user's available balance.");
      user.profit = money((Number(user.profit) || 0) - amount);
      user.bal = money((Number(user.bal) || 0) - amount);
    } else {
      if ((Number(user.profit) || 0) + amount > maxDemoAmount ||
          (Number(user.bal) || 0) + amount > maxDemoAmount) fail("This adjustment exceeds the demo limit.");
      user.profit = money((Number(user.profit) || 0) + amount);
      user.bal = money((Number(user.bal) || 0) + amount);
    }
    led(user, direction === "subtract" ? "profit-subtract" : "profit-add", amount, reason);
    log("Profit " + (direction === "subtract" ? "decreased" : "increased"), user.email,
      usd(amount) + ". " + reason);
    save();
  };

  api.createAdminPayment = async function(kind, userId, form) {
    need("money");
    const user = U(userId);
    const amount = money(form.amount);
    const reason = String(form.reason || "").trim();
    if (!user.id) fail("Choose a user.");
    if (!Number.isFinite(amount) || amount <= 0) fail("Enter an amount greater than zero.");
    if (!reason) fail("A reason is required.");
    if (kind === "withdrawal") {
      if (user.status !== "active") fail("This account cannot withdraw while it is on hold or suspended.");
      if (!user.wd || (DB.settings.needKyc && user.kyc !== "verified")) fail("This user is not eligible for withdrawals.");
      if (amount > (Number(user.bal) || 0)) fail("The withdrawal exceeds the user's available balance.");
    }

    const createdAt = Date.now();
    const prefix = kind === "deposit" ? "D-A-" : "W-A-";
    let id = prefix + createdAt;
    while (DB.deposits.concat(DB.withdrawals).some(payment => payment.id === id)) id += "1";
    if (kind === "deposit") {
      DB.deposits.unshift({
        id, uid: user.id, asset: "USD", net: "Admin-created", amt: amount, usd: amount,
        tx: "ADMIN-" + createdAt, status: "pending", t: createdAt, note: reason, adminCreated: true,
      });
    } else if (kind === "withdrawal") {
      DB.withdrawals.unshift({
        id, uid: user.id, asset: "USD", net: "Admin-created", amt: amount, usd: amount,
        to: String(form.destination || "").trim() || "Admin-created payout",
        status: "pending", t: createdAt, note: reason, adminCreated: true,
      });
    } else {
      fail("Choose a deposit or withdrawal.");
    }
    log("Admin-created " + kind + " pending", user.email, usd(amount) + ". " + reason);
    save();
  };

  H.ut = button => {
    UT = button.dataset.k;
    const accrued = UT === "Profit" && accrueUserProfit(U(OPEN), Date.now());
    if (accrued) save();
    $("#dw").innerHTML = userSheet(U(OPEN));
    if (accrued) render();
  };
  H["save-profit-rate"] = async button => {
    const rate = $("#profit-rate");
    const period = $("#profit-period");
    const error = $("#profit-error");
    const value = rate && rate.value;
    const parsedRate = Number(value);
    if (value === "" || !Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      if (error) error.textContent = "Enter a rate from 0 to 100 percent per period.";
      return;
    }
    await run(() => api.setProfitSchedule(button.dataset.id, parsedRate, period.value), "Profit schedule saved");
  };

  async function adjustUserProfit(button, direction) {
    const isDecrease = direction === "subtract";
    const result = await ask(
      isDecrease ? "Decrease user profit" : "Increase user profit",
      [{ k: "amount", l: "Amount (USD)", t: "number", r: 1 }, { k: "reason", l: "Reason", r: 1 }],
      isDecrease ? "Decrease profit" : "Increase profit",
      isDecrease
        ? "This also reduces the user's available balance and cannot exceed tracked profit."
        : "This also credits the same amount to the user's available balance."
    );
    if (result) {
      await run(() => api.adjustProfit(button.dataset.id, direction, result.amount, result.reason),
        isDecrease ? "Profit decreased" : "Profit increased");
    }
  }
  H["profit-add"] = button => adjustUserProfit(button, "add");
  H["profit-sub"] = button => adjustUserProfit(button, "subtract");

  async function createAdminPayment(kind) {
    const options = DB.users.map(user => esc(userLabel(user)));
    const fields = [
      { k: "user", l: "User", t: "select", o: options },
      { k: "amount", l: "Amount (USD)", t: "number", r: 1 },
    ];
    if (kind === "withdrawal") fields.push({ k: "destination", l: "Destination (optional)" });
    fields.push({ k: "reason", l: "Reason", t: "area", r: 1 });
    const result = await ask(
      kind === "deposit" ? "Create deposit" : "Create withdrawal",
      fields,
      "Create pending",
      "This creates a pending USD record. The balance changes only after approval."
    );
    if (!result) return;
    const user = DB.users.find(item => userLabel(item) === result.user);
    if (!user) {
      toast("Choose a valid user.");
      return;
    }
    await run(() => api.createAdminPayment(kind, user.id, result),
      kind === "deposit" ? "Pending deposit created" : "Pending withdrawal created");
  }
  H["new-deposit"] = () => createAdminPayment("deposit");
  H["new-withdrawal"] = () => createAdminPayment("withdrawal");

  const originalSignIn = signIn;
  signIn = async function() {
    await originalSignIn();
    if (ME && can("money") && accrueAllProfits()) refresh();
  };
  $("#lgo").onclick = signIn;
  if (ME && can("money") && accrueAllProfits()) refresh();
  window.setInterval(function() {
    if (ME && can("money") && accrueAllProfits()) refresh();
  }, 30000);
  document.addEventListener("visibilitychange", function() {
    if (!document.hidden && ME && can("money") && accrueAllProfits()) refresh();
  });
`;
