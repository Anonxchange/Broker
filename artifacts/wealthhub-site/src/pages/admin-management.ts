type AdminUser = {
  id: string;
  name: string;
  email: string;
  kyc: string;
  status: string;
  wd: boolean;
  bal: number;
  country?: string;
  gender?: string;
  address?: string;
  phone?: string;
  ledger: Array<Record<string, unknown>>;
};

type AdminPayment = {
  id: string;
  uid: string;
  asset: string;
  net: string;
  amt: number;
  usd: number;
  status: string;
  t: number;
  note: string;
  tx?: string;
  to?: string;
};

type AdminTicket = {
  id: string;
  uid: string;
  subject: string;
  status: string;
  t: number;
  msgs: unknown[];
};

declare const DB: {
  users: AdminUser[];
  deposits: AdminPayment[];
  withdrawals: AdminPayment[];
  tickets: AdminTicket[];
  settings: {
    needKyc: boolean;
    wdPaused: boolean;
  };
};
declare const api: {
  createUser: (form: Record<string, string>) => Promise<AdminUser>;
  createDeposit: (form: Record<string, string>) => Promise<AdminPayment>;
  createWithdrawal: (form: Record<string, string>) => Promise<AdminPayment>;
  [key: string]: unknown;
};
declare const H: Record<string, (...args: any[]) => unknown>;
declare const V: Record<string, () => string>;
declare const FL: { tk: string };
declare let userSheet: (user: AdminUser) => string;
declare const openUser: (id: string) => void;
declare const UT: string;
declare const ask: (
  title: string,
  fields: Array<Record<string, unknown>>,
  confirmLabel?: string,
  note?: string,
) => Promise<Record<string, string> | null>;
declare const run: (
  operation: () => Promise<unknown>,
  successMessage?: string,
) => Promise<void>;
declare const toast: (message: string) => void;
declare const need: (permission: string) => void;
declare const fail: (message: string) => never;
declare const save: () => void;
declare const led: (
  user: AdminUser,
  type: string,
  amount: number,
  note: string,
) => void;
declare const log: (action: string, target: string, details: string) => void;
declare const U: (id: string) => AdminUser;
declare const count: () => { Support: number };
declare const tabs: (key: string, items: string[][]) => string;
declare const hd: (label: string, title: string) => string;
declare const tbl: (
  columns: Array<[string, string, string?]>,
  rows: unknown[][],
  emptyMessage: string,
) => string;
declare const who: (user: AdminUser) => string;
declare const esc: (value: unknown) => string;
declare const pill: (status: string) => string;
declare const dt: (time: number) => string;
declare const usd: (amount: number) => string;

function installAdminManagement() {
  const browserWindow = window as typeof window & {
    __adminEmailComposerMarkup?: () => string;
  };
  const roundMoney = (amount: number) =>
    Math.round((amount + Number.EPSILON) * 100) / 100;
  const userLabel = (user: AdminUser) => `${user.name} (${user.email})`;
  const parseRoute = (route: string) => {
    const [asset, net] = route.split(" — ");
    if (!asset || !net) fail("Choose a valid asset and network.");
    return { asset, net };
  };
  const paymentRoutes = [
    "USDT — TRON (TRC20)",
    "USDT — BNB Chain (BEP20)",
    "USDT — Ethereum (ERC20)",
    "USDC — Ethereum (ERC20)",
    "BTC — Bitcoin",
    "ETH — Ethereum (ERC20)",
    "SOL — Solana",
  ];
  const statuses = ["Pending", "Approved", "Declined"];

  const originalCreateUser = api.createUser;
  api.createUser = async (form: Record<string, string>) => {
    const user = await originalCreateUser(form);
    user.country = (form.country || "").trim();
    user.gender = (form.gender || "").trim();
    user.address = (form.address || "").trim();
    user.phone = (form.phone || "").trim();
    save();
    return user;
  };

  const originalUserSheet = userSheet;
  userSheet = (user) => {
    const markup = originalUserSheet(user);
    if (UT !== "Overview") return markup;

    const details = [
      ["Country", user.country],
      ["Gender", user.gender],
      ["Phone", user.phone],
      ["Address", user.address],
    ]
      .filter(([, value]) => Boolean(value?.trim()))
      .map(
        ([label, value]) =>
          `<div class="mini"><div>${label}</div><div class="r">${esc(value)}</div></div>`,
      )
      .join("");
    if (!details) return markup;

    return markup.replace(
      /(<div class="tabs">[\s\S]*?<\/div>)/,
      `$1<h4>Profile details</h4>${details}`,
    );
  };

  H.cu = async () => {
    const form = await ask(
      "Create user",
      [
        { k: "name", l: "Full name", r: 1 },
        { k: "email", l: "Email", t: "email", r: 1 },
        { k: "pw", l: "Temporary password", t: "password", r: 1 },
        { k: "address", l: "Address", t: "area" },
        { k: "country", l: "Country" },
        { k: "phone", l: "Phone number", t: "tel" },
        { k: "gender", l: "Gender" },
        { k: "bal", l: "Opening balance (USD)", t: "number", v: 0 },
        {
          k: "kyc",
          l: "Verification",
          t: "select",
          o: ["verified", "pending", "none"],
        },
      ],
      "Create user",
    );
    if (form) {
      run(async () => {
        const user = await api.createUser(form);
        openUser(user.id);
      }, "User created");
    }
  };

  api.createDeposit = async (form: Record<string, string>) => {
    need("money");
    const user = U(form.uid);
    const amount = Number(form.amt);
    const usdAmount = Number(form.usd);
    const status = form.status.toLowerCase();
    if (!user.id) fail("Choose a user.");
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("Enter an asset amount greater than zero.");
    }
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      fail("Enter a USD value greater than zero.");
    }
    if (!statuses.map((value) => value.toLowerCase()).includes(status)) {
      fail("Choose a valid deposit status.");
    }
    if (status === "approved" && user.status !== "active") {
      fail("Deposits can only be credited to active accounts.");
    }

    const { asset, net } = parseRoute(form.route);
    const id = `D-${Date.now()}`;
    const deposit: AdminPayment = {
      id,
      uid: user.id,
      asset,
      net,
      amt: amount,
      usd: roundMoney(usdAmount),
      tx: form.reference.trim() || `ADMIN-${id}`,
      status,
      t: Date.now(),
      note: form.note.trim(),
    };
    DB.deposits.unshift(deposit);
    if (status === "approved") {
      user.bal = roundMoney(user.bal + deposit.usd);
      led(user, "deposit", deposit.usd, `Admin deposit ${id} approved`);
    }
    log(
      "Deposit created",
      id,
      `${status} · ${usd(deposit.usd)} · ${user.email}${deposit.note ? ` · ${deposit.note}` : ""}`,
    );
    save();
    return deposit;
  };

  api.createWithdrawal = async (form: Record<string, string>) => {
    need("money");
    const user = U(form.uid);
    const amount = Number(form.amt);
    const usdAmount = Number(form.usd);
    const status = form.status.toLowerCase();
    if (!user.id) fail("Choose a user.");
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("Enter an asset amount greater than zero.");
    }
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      fail("Enter a USD value greater than zero.");
    }
    if (!form.destination.trim()) fail("Enter a destination address.");
    if (!statuses.map((value) => value.toLowerCase()).includes(status)) {
      fail("Choose a valid withdrawal status.");
    }

    const { asset, net } = parseRoute(form.route);
    const value = roundMoney(usdAmount);
    if (status !== "declined") {
      if (
        user.status !== "active" ||
        !user.wd ||
        (DB.settings.needKyc && user.kyc !== "verified")
      ) {
        fail("This user is not currently eligible for withdrawals.");
      }
      if (status === "approved" && DB.settings.wdPaused) {
        fail("Withdrawals are paused. Create it as pending instead.");
      }
      if (value > user.bal) fail("The user's available balance is too low.");
    }

    const id = `W-${Date.now()}`;
    const withdrawal: AdminPayment = {
      id,
      uid: user.id,
      asset,
      net,
      amt: amount,
      usd: value,
      to: form.destination.trim(),
      status,
      t: Date.now(),
      note: form.note.trim(),
    };
    DB.withdrawals.unshift(withdrawal);
    if (status !== "declined") {
      user.bal = roundMoney(user.bal - value);
      led(
        user,
        status === "pending" ? "withdrawal hold" : "withdrawal",
        value,
        `Admin withdrawal ${id} ${status}`,
      );
    }
    log(
      "Withdrawal created",
      id,
      `${status} · ${usd(value)} · ${user.email}${withdrawal.note ? ` · ${withdrawal.note}` : ""}`,
    );
    save();
    return withdrawal;
  };

  H["dep-new"] = async () => {
    const form = await ask(
      "Create deposit",
      [
        { k: "user", l: "User", t: "select", o: DB.users.map(userLabel) },
        { k: "route", l: "Asset and network", t: "select", o: paymentRoutes },
        { k: "amt", l: "Asset amount", t: "number", r: 1, step: "any" },
        { k: "usd", l: "Amount (USD)", t: "number", r: 1, step: "0.01" },
        { k: "status", l: "Initial status", t: "select", o: statuses },
        { k: "reference", l: "Transaction hash or reference" },
        { k: "note", l: "Admin note", t: "area" },
      ],
      "Create deposit",
      "Approved deposits credit the user's USD balance. Pending deposits wait for review.",
    );
    if (!form) return;
    const user = DB.users.find((item) => userLabel(item) === form.user);
    run(
      () =>
        api.createDeposit({
          ...form,
          uid: user?.id || "",
          status: form.status,
        }),
      "Deposit created",
    );
  };

  H["wd-new"] = async () => {
    const form = await ask(
      "Create withdrawal",
      [
        { k: "user", l: "User", t: "select", o: DB.users.map(userLabel) },
        { k: "route", l: "Asset and network", t: "select", o: paymentRoutes },
        { k: "amt", l: "Asset amount", t: "number", r: 1, step: "any" },
        { k: "usd", l: "Amount (USD)", t: "number", r: 1, step: "0.01" },
        { k: "destination", l: "Destination address", r: 1 },
        { k: "status", l: "Initial status", t: "select", o: statuses },
        { k: "note", l: "Admin note", t: "area" },
      ],
      "Create withdrawal",
      "Pending and approved withdrawals reserve or deduct the USD balance. Declined withdrawals do not change it.",
    );
    if (!form) return;
    const user = DB.users.find((item) => userLabel(item) === form.user);
    run(
      () =>
        api.createWithdrawal({
          ...form,
          uid: user?.id || "",
          status: form.status,
        }),
      "Withdrawal created",
    );
  };

  const originalDepositsView = V.Deposits;
  V.Deposits = () =>
    originalDepositsView().replace(
      '<button class="btn alt" data-a="exp" data-t="deposits">Export CSV</button>',
      '<button class="btn" data-a="dep-new">Create deposit</button><button class="btn alt" data-a="exp" data-t="deposits">Export CSV</button>',
    );

  const originalWithdrawalsView = V.Withdrawals;
  V.Withdrawals = () =>
    originalWithdrawalsView().replace(
      '<button class="btn alt" data-a="exp" data-t="withdrawals">Export CSV</button>',
      '<button class="btn" data-a="wd-new">Create withdrawal</button><button class="btn alt" data-a="exp" data-t="withdrawals">Export CSV</button>',
    );

  V.Support = () => {
    const tickets = DB.tickets
      .filter((ticket) => FL.tk === "all" || ticket.status === FL.tk)
      .sort((first, second) => second.t - first.t);
    const supportTabs = tabs("tk", [
      ["open", `Open (${count().Support})`],
      ["closed", "Closed"],
      ["all", "All"],
      ["email", "Email"],
    ]);
    const content =
      FL.tk === "email"
        ? browserWindow.__adminEmailComposerMarkup?.()
        : tbl(
            [
              ["Ticket", "80px"],
              ["User", "1.3fr"],
              ["Subject", "1.6fr"],
              ["Updated", "110px"],
              ["Status", "90px"],
              ["", "100px", "r"],
            ],
            tickets.map((ticket) => [
              ticket.id,
              who(U(ticket.uid)),
              `${esc(ticket.subject)}<small>${ticket.msgs.length} messages</small>`,
              dt(ticket.t),
              pill(ticket.status),
              `<button class="btn sm" data-a="tk" data-id="${ticket.id}">Open</button>`,
            ]),
            "No tickets here.",
          );
    if (content === undefined) {
      throw new Error("The preview-only email composer did not initialize.");
    }
    return hd("Answer users and close the loop", "Support") + supportTabs + content;
  };
}

export const adminManagementBehavior = `(${installAdminManagement.toString()})();`;
