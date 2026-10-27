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

type AdminIdentity = {
  email: string;
  role?: string;
  displayName?: string;
};

type SharedDepositMethod = {
  id: string;
  asset: string;
  network: string;
  address: string;
  createdAt: string;
  updatedAt: string;
};

declare let ME: AdminIdentity | null;
declare let view: string;
declare function render(): void;

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
  const profileStorageKey = (email: string) =>
    `auvrenthia-admin-profile:${email.toLowerCase()}`;
  const readDisplayName = (email: string) => {
    try {
      return localStorage.getItem(profileStorageKey(email)) || "";
    } catch {
      return "";
    }
  };

  let sharedDepositMethods: SharedDepositMethod[] = [];
  let depositMethodsLoaded = false;
  let depositMethodsLoading = false;
  let depositMethodsError = "";
  let depositMethodsNotice = "";
  let editingDepositMethodId = "";

  async function responseError(response: Response) {
    const payload: unknown = await response.json().catch(() => null);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
    ) {
      return payload.error;
    }
    return `Request failed (${response.status}).`;
  }

  async function refreshDepositMethods() {
    depositMethodsLoading = true;
    depositMethodsError = "";
    try {
      const response = await fetch("/api/deposit-methods", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response));
      const methods: unknown = await response.json();
      if (!Array.isArray(methods)) {
        throw new Error("The deposit list returned an unexpected response.");
      }
      sharedDepositMethods = methods as SharedDepositMethod[];
    } catch (error) {
      depositMethodsError =
        error instanceof Error
          ? error.message
          : "Deposit methods could not be loaded.";
    } finally {
      depositMethodsLoading = false;
      depositMethodsLoaded = true;
      if (view === "Deposit methods") render();
    }
  }

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

  V["Deposit methods"] = () => {
    if (!depositMethodsLoaded && !depositMethodsLoading) {
      void refreshDepositMethods();
    }

    const editing = sharedDepositMethods.find(
      (method) => method.id === editingDepositMethodId,
    );
    const form = `
      <form id="deposit-method-form" onsubmit="return false">
        <input id="deposit-method-id" type="hidden" value="${esc(editing?.id || "")}">
        <div class="grid2">
          <div>
            <label class="fl" for="deposit-method-asset">Asset</label>
            <input class="sel" id="deposit-method-asset" maxlength="24" required value="${esc(editing?.asset || "")}" placeholder="e.g. USDT">
          </div>
          <div>
            <label class="fl" for="deposit-method-network">Network</label>
            <input class="sel" id="deposit-method-network" maxlength="80" required value="${esc(editing?.network || "")}" placeholder="e.g. Ethereum (ERC-20)">
          </div>
        </div>
        <label class="fl" for="deposit-method-address">Deposit address</label>
        <textarea class="sel" id="deposit-method-address" maxlength="256" rows="3" required placeholder="Paste the receiving address">${esc(editing?.address || "")}</textarea>
        <label class="fl" for="deposit-method-password">Admin password</label>
        <input class="sel" id="deposit-method-password" type="password" autocomplete="current-password" required>
        <p class="err" id="deposit-method-error" role="alert"></p>
        <div class="row">
          <button class="btn" type="button" data-a="deposit-method-save">${editing ? "Save changes" : "Add method"}</button>
          ${editing ? '<button class="btn alt" type="button" data-a="deposit-method-reset">Cancel edit</button>' : ""}
          <a class="btn alt" href="/deposit" target="_top">View public page</a>
        </div>
      </form>`;

    const methodsTable = tbl(
      [
        ["Asset and network", "1fr"],
        ["Deposit address", "2fr"],
        ["", "150px", "r"],
      ],
      sharedDepositMethods.map((method) => [
        `${esc(method.asset)}<small>${esc(method.network)}</small>`,
        `<small>${esc(method.address)}</small>`,
        `<div class="acts"><button class="btn sm alt" type="button" data-a="deposit-method-edit" data-id="${esc(method.id)}">Edit</button><button class="btn sm bad" type="button" data-a="deposit-method-remove" data-id="${esc(method.id)}">Remove</button></div>`,
      ]),
      "No deposit methods have been added.",
    );

    return (
      hd(
        "Manage the crypto destinations shown to visitors",
        "Deposit methods",
      ) +
      `<div class="row" style="margin-top:14px"><span class="pill mut">Shared with all users</span><button class="btn alt sm" type="button" data-a="deposit-method-refresh">Refresh list</button></div>` +
      (depositMethodsError
        ? `<div class="banner bad" role="alert">${esc(depositMethodsError)}</div>`
        : "") +
      (depositMethodsNotice
        ? `<div class="banner wait" role="status">${esc(depositMethodsNotice)}</div>`
        : "") +
      `<h2 class="sec">${editing ? "Edit deposit method" : "Add a deposit method"}</h2>${form}` +
      `<h2 class="sec">Saved deposit methods</h2>` +
      (depositMethodsLoading && !depositMethodsLoaded
        ? '<p class="note" role="status">Loading deposit methods…</p>'
        : methodsTable)
    );
  };

  V["Account settings"] = () => {
    const email = ME?.email || "";
    const displayName = readDisplayName(email);
    const role = ME?.role || "Owner";
    return (
      hd("Update your profile details", "Account settings") +
      `<h2 class="sec">Account information</h2>` +
      `<div class="row2"><div>Email address<small>Managed by your sign-in account</small></div><strong>${esc(email)}</strong></div>` +
      `<div class="row2"><div>Access role<small>Controls which admin areas you can use</small></div><strong>${esc(role)}</strong></div>` +
      `<h2 class="sec">Profile</h2>` +
      `<label class="fl" for="admin-display-name">Display name</label>` +
      `<input class="sel" id="admin-display-name" maxlength="60" required value="${esc(displayName)}" placeholder="Enter your name">` +
      `<p class="err" id="account-settings-error" role="alert"></p>` +
      `<p class="note" id="account-settings-message">Your display name is saved in this browser. Email and access role come from your sign-in account.</p>` +
      `<div class="row"><button class="btn" type="button" data-a="account-settings-save">Save account settings</button></div>`
    );
  };

  H["account-settings-save"] = () => {
    const input = document.querySelector<HTMLInputElement>("#admin-display-name");
    const error = document.querySelector<HTMLElement>("#account-settings-error");
    const message = document.querySelector<HTMLElement>("#account-settings-message");
    const email = ME?.email || "";
    const displayName = input?.value.trim() || "";

    if (!email || !displayName || displayName.length > 60) {
      if (error) error.textContent = "Enter a display name of up to 60 characters.";
      return;
    }

    try {
      localStorage.setItem(profileStorageKey(email), displayName);
      if (ME) {
        ME.displayName = displayName;
        sessionStorage.setItem("hadm", JSON.stringify(ME));
      }
      const profileName = document.querySelector<HTMLElement>(
        "#admin-profile-role",
      );
      const profileInitial = document.querySelector<HTMLElement>(
        "#admin-profile-initial",
      );
      if (profileName) profileName.textContent = displayName;
      if (profileInitial) {
        profileInitial.textContent = displayName.slice(0, 1).toUpperCase();
      }
      if (error) error.textContent = "";
      if (message) message.textContent = "Account settings saved.";
      toast("Account settings saved");
    } catch {
      if (error) {
        error.textContent = "Account settings could not be saved in this browser.";
      }
    }
  };

  H["deposit-method-refresh"] = () => {
    depositMethodsLoaded = false;
    depositMethodsNotice = "";
    void refreshDepositMethods();
    render();
  };

  H["deposit-method-edit"] = (button: HTMLElement & { dataset: DOMStringMap }) => {
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) {
      toast("Deposit method not found");
      return;
    }
    editingDepositMethodId = method.id;
    depositMethodsError = "";
    depositMethodsNotice = "";
    render();
  };

  H["deposit-method-reset"] = () => {
    editingDepositMethodId = "";
    depositMethodsError = "";
    depositMethodsNotice = "";
    render();
  };

  H["deposit-method-save"] = async () => {
    const form = document.querySelector<HTMLFormElement>(
      "#deposit-method-form",
    );
    if (!form?.reportValidity()) return;

    const asset = document.querySelector<HTMLInputElement>(
      "#deposit-method-asset",
    );
    const network = document.querySelector<HTMLInputElement>(
      "#deposit-method-network",
    );
    const address = document.querySelector<HTMLTextAreaElement>(
      "#deposit-method-address",
    );
    const password = document.querySelector<HTMLInputElement>(
      "#deposit-method-password",
    );
    const error = document.querySelector<HTMLElement>(
      "#deposit-method-error",
    );
    const payload = {
      asset: asset?.value.trim() || "",
      network: network?.value.trim() || "",
      address: address?.value.trim() || "",
    };
    if (!password?.value) {
      if (error) error.textContent = "Enter the admin password to save changes.";
      return;
    }

    const methodId = editingDepositMethodId;
    const requestPassword = password.value;
    if (error) error.textContent = "";
    depositMethodsError = "";
    depositMethodsNotice = "";
    try {
      const response = await fetch(
        methodId
          ? `/api/admin/deposit-methods/${encodeURIComponent(methodId)}`
          : "/api/admin/deposit-methods",
        {
          method: methodId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Deposit-Admin-Password": requestPassword,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));

      editingDepositMethodId = "";
      depositMethodsNotice = methodId
        ? "Deposit method updated."
        : "Deposit method added.";
      depositMethodsLoaded = false;
      await refreshDepositMethods();
      toast(depositMethodsNotice);
    } catch (errorValue) {
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : "The deposit method could not be saved.";
      if (error) error.textContent = message;
    } finally {
      if (password) password.value = "";
    }
  };

  H["deposit-method-remove"] = async (
    button: HTMLElement & { dataset: DOMStringMap },
  ) => {
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) {
      toast("Deposit method not found");
      return;
    }
    const confirmation = await ask(
      `Remove ${method.asset} deposit method`,
      [{ k: "password", l: "Admin password", t: "password", r: 1 }],
      "Confirm removal",
      "This address will no longer appear on the public deposit page.",
    );
    if (!confirmation?.password) return;

    try {
      const response = await fetch(
        `/api/admin/deposit-methods/${encodeURIComponent(method.id)}`,
        {
          method: "DELETE",
          headers: { "X-Deposit-Admin-Password": confirmation.password },
        },
      );
      if (!response.ok) throw new Error(await responseError(response));

      editingDepositMethodId = "";
      depositMethodsNotice = "Deposit method removed.";
      depositMethodsLoaded = false;
      await refreshDepositMethods();
      toast(depositMethodsNotice);
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "The deposit method could not be removed.",
      );
    }
  };
}

export const adminManagementBehavior = `(${installAdminManagement.toString()})();`;
