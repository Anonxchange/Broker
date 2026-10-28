type AdminUser = {
  id: string;
  name: string;
  email: string;
  joined: number;
  kyc: string;
  status: string;
  wd: boolean;
  bal: number;
  country?: string;
  gender?: string;
  address?: string;
  phone?: string;
  kycSubmission?: AdminKycSubmission;
  ledger: Array<Record<string, unknown>>;
};

type AdminKycSubmission = {
  documentType: string;
  documentNumber: string;
  issuingCountry: string;
  dateOfBirth?: string;
  expiryDate?: string;
  submittedAt?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  selfieImageUrl?: string;
  proofOfAddressUrl?: string;
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
  qrDataUrl?: string;
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
  changeDepositStatus: (
    id: string,
    status: string,
    note: string,
  ) => Promise<void>;
  changeWithdrawalStatus: (
    id: string,
    status: string,
    note: string,
  ) => Promise<void>;
  setKyc: (id: string, status: string, note: string) => Promise<void>;
  [key: string]: unknown;
};
declare const H: Record<string, (...args: any[]) => unknown>;
declare const V: Record<string, () => string>;
declare const FL: { tk: string; kyc: string };
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
declare const can: (permission: string) => boolean;
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
declare const count: () => { Support: number; Verification: number };
declare const tabs: (key: string, items: string[][]) => string;
declare const hd: (label: string, title: string, actions?: string) => string;
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
  const depositMethodsStorageKey = "auvrenthia-deposit-methods-v1";
  const maxDepositQrBytes = 512 * 1024;
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
  const statusOptions = (currentStatus: string) => {
    const current =
      statuses.find(
        (status) => status.toLowerCase() === currentStatus.toLowerCase(),
      ) || statuses[0];
    return [current, ...statuses.filter((status) => status !== current)];
  };
  const hasKycEvidence = (user: AdminUser) =>
    Boolean(
      user.kycSubmission?.documentType?.trim() &&
        user.kycSubmission.documentNumber?.trim() &&
        user.kycSubmission.issuingCountry?.trim() &&
        user.kycSubmission.frontImageUrl?.trim(),
    );
  const safeKycDocumentUrl = (value?: string) => {
    if (!value?.trim()) return "";
    try {
      const url = new URL(value, document.baseURI);
      const sameOrigin = url.origin === window.location.origin;
      const supabaseStorage =
        url.protocol === "https:" && url.hostname.endsWith(".supabase.co");
      if (!sameOrigin && !supabaseStorage) {
        return "";
      }
      return url.href;
    } catch {
      return "";
    }
  };
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
  let pendingDepositQrDataUrl: string | null = null;

  function isSharedDepositMethod(value: unknown): value is SharedDepositMethod {
    if (typeof value !== "object" || value === null) return false;
    const method = value as Record<string, unknown>;
    const qrDataUrl = method.qrDataUrl;
    return (
      typeof method.id === "string" &&
      typeof method.asset === "string" &&
      typeof method.network === "string" &&
      typeof method.address === "string" &&
      typeof method.createdAt === "string" &&
      typeof method.updatedAt === "string" &&
      (qrDataUrl === undefined ||
        (typeof qrDataUrl === "string" &&
          qrDataUrl.length <= 720_000 &&
          /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
            qrDataUrl,
          )))
    );
  }

  async function refreshDepositMethods() {
    depositMethodsLoading = true;
    depositMethodsError = "";
    try {
      const saved = localStorage.getItem(depositMethodsStorageKey);
      const methods: unknown = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(methods) || !methods.every(isSharedDepositMethod)) {
        throw new Error("Saved deposit methods have an unexpected format.");
      }
      sharedDepositMethods = methods;
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

  function updateDepositQrPreview() {
    const container = document.querySelector<HTMLElement>(
      "#deposit-method-qr-preview",
    );
    if (!container) return;

    const editing = sharedDepositMethods.find(
      (method) => method.id === editingDepositMethodId,
    );
    const qrPreview =
      pendingDepositQrDataUrl !== null
        ? pendingDepositQrDataUrl
        : editing?.qrDataUrl || "";
    container.replaceChildren();

    if (qrPreview) {
      const image = document.createElement("img");
      image.src = qrPreview;
      image.alt = "Deposit QR code preview";
      image.style.width = "112px";
      image.style.height = "112px";
      image.style.objectFit = "contain";
      image.style.border = "1px solid var(--line)";
      image.style.borderRadius = "10px";
      image.style.padding = "6px";
      container.append(image);
    } else {
      const empty = document.createElement("small");
      empty.className = "note";
      empty.textContent = "No QR image added.";
      container.append(empty);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn alt sm";
    removeButton.dataset.a = "deposit-method-qr-remove";
    removeButton.textContent = "Remove QR image";
    removeButton.disabled = !qrPreview;
    container.append(removeButton);
  }

  function setDepositQrStatus(message: string, isError = false) {
    const target = document.querySelector<HTMLElement>(
      isError ? "#deposit-method-qr-error" : "#deposit-method-qr-status",
    );
    if (target) target.textContent = message;
  }

  document.addEventListener("change", (event: Event) => {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement) ||
      input.id !== "deposit-method-qr-file"
    ) {
      return;
    }
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setDepositQrStatus("Choose a PNG, JPG, or WebP QR image.", true);
      return;
    }
    if (!file.size || file.size > maxDepositQrBytes) {
      setDepositQrStatus(
        "Choose a QR image smaller than 512 KB for this browser preview.",
        true,
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (
        typeof reader.result !== "string" ||
        reader.result.length > 720_000
      ) {
        setDepositQrStatus("The QR image could not be saved.", true);
      } else {
        pendingDepositQrDataUrl = reader.result;
        setDepositQrStatus("", true);
        setDepositQrStatus("QR image ready to save.");
        updateDepositQrPreview();
      }
    };
    reader.onerror = () => {
      setDepositQrStatus("The QR image could not be read.", true);
    };
    reader.readAsDataURL(file);
  });

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
      ["Account ID", user.id],
      ["Full name", user.name],
      ["Email address", user.email],
      ["Country", user.country],
      ["Gender", user.gender],
      ["Phone", user.phone],
      ["Address", user.address],
    ]
      .map(
        ([label, value]) =>
          `<div class="mini"><div>${esc(label)}</div><div class="r">${value?.trim() ? esc(value) : "Not provided"}</div></div>`,
      )
      .join("");

    let kycReview = "";
    if (can("kyc")) {
      const submission = user.kycSubmission;
      const documentFields = [
        ["Document type", submission?.documentType],
        ["Document number", submission?.documentNumber],
        ["Issuing country", submission?.issuingCountry],
        ["Date of birth", submission?.dateOfBirth],
        ["Expiry date", submission?.expiryDate],
        [
          "Submitted",
          submission?.submittedAt &&
          Number.isFinite(Date.parse(submission.submittedAt))
            ? new Date(submission.submittedAt).toLocaleString()
            : undefined,
        ],
      ]
        .map(
          ([label, value]) =>
            `<div class="mini"><div>${esc(label)}</div><div class="r">${value?.trim() ? esc(value) : "Not provided"}</div></div>`,
        )
        .join("");

      const documentCard = (label: string, value?: string) => {
        const url = safeKycDocumentUrl(value);
        return `<div class="mini"><div>${esc(label)}</div>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(label)}"><img src="${esc(url)}" alt="${esc(label)} preview" style="display:block;width:100%;max-width:240px;max-height:180px;object-fit:contain;border:1px solid var(--line);border-radius:10px;margin-top:8px"></a><small class="note">Select the image to open it.</small>` : '<small class="note">Not submitted</small>'}</div>`;
      };
      const submittedDocuments = [
        documentCard("Government ID front — check address", submission?.frontImageUrl),
        documentCard("Government ID back", submission?.backImageUrl),
        documentCard("Selfie", submission?.selfieImageUrl),
        documentCard("Proof of address", submission?.proofOfAddressUrl),
      ].join("");
      const canApprove = hasKycEvidence(user);
      kycReview = `
        <h4>Tier 3 — Government ID with address</h4>
        <p class="note">Confirm the ID displays the user's current residential address and compare it with the profile details above.</p>
        <div class="grid2">${documentFields}</div>
        <div class="grid2" style="margin-top:12px">${submittedDocuments}</div>
        ${
          canApprove
            ? '<p class="note">Review the submitted details and document images before making a decision.</p>'
            : '<div class="banner wait" style="margin-top:12px">Required Tier 3 ID details and a front image are not available. Approval is disabled until the address-bearing ID is available through secure storage.</div>'
        }`;
    }

    const approvalDisabled =
      user.kyc === "verified" || !hasKycEvidence(user);
    const profileMarkup = markup.replace(
      /<button class="btn sm" data-a="kyc-ok" data-id="[^"]*"[^>]*>Verify<\/button>/,
      `<button class="btn sm" data-a="kyc-ok" data-id="${esc(user.id)}" ${approvalDisabled ? 'disabled aria-disabled="true"' : ""}>Verify</button>`,
    );

    return profileMarkup.replace(
      /(<div class="tabs">[\s\S]*?<\/div>)/,
      `$1<h4>Profile information</h4><div class="grid2">${details}</div>${kycReview}`,
    );
  };

  V.Verification = () => {
    need("kyc");
    const users =
      FL.kyc === "all"
        ? DB.users
        : DB.users.filter((user) => user.kyc === FL.kyc);
    return (
      hd("Review Tier 3 ID checks before deciding", "Verification") +
      tabs("kyc", [
        ["pending", `Waiting (${count().Verification})`],
        ["verified", "Verified"],
        ["rejected", "Rejected"],
        ["all", "All"],
      ]) +
      tbl(
        [
          ["User", "1.5fr"],
          ["Tier 3 ID with address", "1.2fr"],
          ["Joined", "110px"],
          ["Status", "110px"],
          ["", "125px", "r"],
        ],
        users.map((user) => [
          who(user),
          user.kycSubmission
            ? `${esc(user.kycSubmission.documentType || "ID document")}<small>${user.kycSubmission.frontImageUrl ? "Front image submitted" : "Front image missing"}</small>`
            : '<span class="pill wait">No ID submitted</span>',
          new Date(user.joined).toLocaleDateString(),
          pill(user.kyc),
          `<button class="btn sm" data-a="kyc-review" data-id="${esc(user.id)}">Review profile</button>`,
        ]),
        "Nobody in this list.",
      )
    );
  };

  H["kyc-review"] = (button: HTMLElement & { dataset: DOMStringMap }) => {
    need("kyc");
    const user = U(button.dataset.id || "");
    if (!user.id) {
      toast("User profile not found.");
      return;
    }
    openUser(user.id);
  };

  H["kyc-ok"] = (
    button: HTMLElement & { dataset: DOMStringMap },
  ) => {
    need("kyc");
    const user = U(button.dataset.id || "");
    if (!user.id) {
      toast("User profile not found.");
      return;
    }
    if (!hasKycEvidence(user)) {
      toast("Tier 3 approval requires ID details and an image of the address-bearing ID.");
      return;
    }
    return run(
      () => api.setKyc(user.id, "verified", "Identity documents reviewed"),
      "User verified",
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
      usd: roundMoney(usdAmount),
      status,
      t: Date.now(),
      note: form.note.trim(),
      to: form.destination.trim(),
    };
    DB.withdrawals.unshift(withdrawal);
    if (status === "approved") {
      user.bal = roundMoney(user.bal - withdrawal.usd);
      led(user, "withdrawal", -withdrawal.usd, `Admin withdrawal ${id} approved`);
    }
    log(
      "Withdrawal created",
      id,
      `${status} · ${usd(withdrawal.usd)} · ${user.email}${withdrawal.note ? ` · ${withdrawal.note}` : ""}`,
    );
    save();
    return withdrawal;
  };

  let activeSupportTab: "tickets" | "email" = "tickets";
  const baseSupportView = V.Support;
  if (baseSupportView) {
    V.Support = () => {
      const supportMarkup = baseSupportView();
      const composerMarkup = can("support")
        ? browserWindow.__adminEmailComposerMarkup?.() ||
          '<div class="err" role="alert">The email composer is unavailable.</div>'
        : "";
      return `<div class="tabs" role="tablist" aria-label="Support sections">
        <button type="button" class="tab${activeSupportTab === "tickets" ? " on" : ""}" role="tab" aria-selected="${activeSupportTab === "tickets"}" aria-controls="support-tickets" data-a="support-tab" data-tab="tickets">Tickets</button>
        <button type="button" class="tab${activeSupportTab === "email" ? " on" : ""}" role="tab" aria-selected="${activeSupportTab === "email"}" aria-controls="support-email" data-a="support-tab" data-tab="email">Email</button>
      </div>
      <section id="support-tickets" role="tabpanel"${activeSupportTab === "tickets" ? "" : " hidden"}>${supportMarkup}</section>
      <section id="support-email" role="tabpanel"${activeSupportTab === "email" ? "" : " hidden"}>${composerMarkup}</section>`;
    };
  }
  H["support-tab"] = (button) => {
    if (button.dataset.tab === "tickets" || button.dataset.tab === "email") {
      activeSupportTab = button.dataset.tab;
      render();
    }
  };

  function withPaymentAction(
    baseView: () => string,
    kind: "deposit" | "withdrawal",
  ) {
    return () => {
      need("money");
      const markup = baseView();
      const target = kind === "deposit" ? "deposits" : "withdrawals";
      const action = kind === "deposit" ? "new-deposit" : "new-withdrawal";
      const label = kind === "deposit" ? "Create deposit" : "Create withdrawal";
      const exportButton = `<button class="btn alt" data-a="exp" data-t="${target}">Export CSV</button>`;
      const createButton = `<button class="btn" data-a="${action}">${label}</button>`;
      return markup.includes(exportButton)
        ? markup.replace(exportButton, `${createButton}${exportButton}`)
        : `<div class="acts" style="justify-content:flex-end">${createButton}</div>${markup}`;
    };
  }

  if (V.Deposits) V.Deposits = withPaymentAction(V.Deposits, "deposit");
  if (V.Withdrawals)
    V.Withdrawals = withPaymentAction(V.Withdrawals, "withdrawal");

  function accountSettingsView() {
    const email = ME?.email || "";
    const displayName = readDisplayName(email);
    const role = ME?.role || "Admin";
    return (
      hd("Manage your admin profile", "Account settings") +
      `<div style="max-width:720px;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel)">
        <div class="two">
          <div>
            <label class="fl" for="account-display-name">Display name</label>
            <input class="sel" id="account-display-name" maxlength="80" value="${esc(displayName)}" autocomplete="name">
          </div>
          <div>
            <label class="fl" for="account-email">Email</label>
            <input class="sel" id="account-email" value="${esc(email)}" readonly>
          </div>
        </div>
        <p class="note">Role: ${esc(role)}. This prototype stores your display name in this browser only.</p>
        <div class="acts">
          <button type="button" class="btn" data-a="account-settings-save">Save changes</button>
          <button type="button" class="btn alt" data-a="account-settings-reset">Reset display name</button>
        </div>
        <div id="account-settings-status" class="note" role="status" aria-live="polite"></div>
      </div>`
    );
  }

  function syncAccountProfile(displayName: string) {
    const label = document.querySelector<HTMLElement>("#admin-profile-role");
    const initial = document.querySelector<HTMLElement>(
      "#admin-profile-initial",
    );
    if (label) label.textContent = displayName || ME?.role || "Admin";
    if (initial) {
      initial.textContent = (displayName || ME?.email || "A")
        .trim()
        .slice(0, 1)
        .toUpperCase();
    }
  }

  H["account-settings-save"] = () => {
    const email = ME?.email || "";
    const input = document.querySelector<HTMLInputElement>(
      "#account-display-name",
    );
    const status = document.querySelector<HTMLElement>(
      "#account-settings-status",
    );
    const displayName = input?.value.trim() || "";
    if (displayName.length > 80) {
      if (status) status.textContent = "Use 80 characters or fewer.";
      return;
    }
    try {
      if (displayName) {
        localStorage.setItem(profileStorageKey(email), displayName);
      } else {
        localStorage.removeItem(profileStorageKey(email));
      }
      syncAccountProfile(displayName);
      if (status) status.textContent = "Saved in this browser.";
    } catch {
      if (status) status.textContent = "Could not save settings in this browser.";
    }
  };

  H["account-settings-reset"] = () => {
    const email = ME?.email || "";
    const input = document.querySelector<HTMLInputElement>(
      "#account-display-name",
    );
    const status = document.querySelector<HTMLElement>(
      "#account-settings-status",
    );
    try {
      localStorage.removeItem(profileStorageKey(email));
      if (input) input.value = "";
      syncAccountProfile("");
      if (status) status.textContent = "Display name reset.";
    } catch {
      if (status) status.textContent = "Could not reset settings in this browser.";
    }
  };

  V["Account settings"] = accountSettingsView;

  function depositMethodsView() {
    need("money");
    if (!depositMethodsLoaded && !depositMethodsLoading) {
      void refreshDepositMethods();
    }

    const editing = sharedDepositMethods.find(
      (method) => method.id === editingDepositMethodId,
    );
    const blocked = !depositMethodsLoaded || Boolean(depositMethodsError);
    const methodRows = sharedDepositMethods.length
      ? sharedDepositMethods
          .map(
            (method) => `<div class="mini">
              <div>
                <strong>${esc(method.asset)} · ${esc(method.network)}</strong>
                <small style="overflow-wrap:anywhere">${esc(method.address)}</small>
                ${method.qrDataUrl ? "<small>QR image saved</small>" : ""}
              </div>
              <div class="acts">
                <button type="button" class="btn alt sm" data-a="deposit-method-edit" data-id="${esc(method.id)}">Edit</button>
                <button type="button" class="btn alt sm bad" data-a="deposit-method-remove" data-id="${esc(method.id)}">Remove</button>
              </div>
            </div>`,
          )
          .join("")
      : '<p class="note">No deposit methods have been added.</p>';

    window.setTimeout(updateDepositQrPreview, 0);
    return (
      hd(
        "Manage the deposit routes shown in this prototype",
        "Deposit methods",
        `<button type="button" class="btn" data-a="deposit-method-new">New method</button>`,
      ) +
      (depositMethodsLoading
        ? '<p class="note" role="status">Loading saved methods…</p>'
        : "") +
      (depositMethodsError
        ? `<div class="err" role="alert">${esc(depositMethodsError)}</div>`
        : "") +
      (depositMethodsNotice
        ? `<p class="note" role="status">${esc(depositMethodsNotice)}</p>`
        : "") +
      `<div class="two" style="align-items:start">
        <section>
          <h3>Saved methods</h3>
          ${methodRows}
        </section>
        <section style="padding:16px;border:1px solid var(--line);border-radius:14px">
          <h3>${editing ? "Edit deposit method" : "Add deposit method"}</h3>
          <div>
            <label class="fl" for="deposit-method-asset">Asset</label>
            <input class="sel" id="deposit-method-asset" maxlength="20" value="${esc(editing?.asset || "")}" placeholder="USDT">
          </div>
          <div>
            <label class="fl" for="deposit-method-network">Network</label>
            <input class="sel" id="deposit-method-network" maxlength="60" value="${esc(editing?.network || "")}" placeholder="TRON (TRC20)">
          </div>
          <div>
            <label class="fl" for="deposit-method-address">Deposit address</label>
            <textarea class="sel" id="deposit-method-address" maxlength="512" rows="3" placeholder="Enter the receiving address">${esc(editing?.address || "")}</textarea>
          </div>
          <div>
            <label class="fl" for="deposit-method-qr-file">QR image</label>
            <input class="sel" id="deposit-method-qr-file" type="file" accept="image/png,image/jpeg,image/webp">
            <div id="deposit-method-qr-preview" class="acts" style="justify-content:flex-start;margin-top:10px"></div>
            <div id="deposit-method-qr-status" class="note" role="status"></div>
            <div id="deposit-method-qr-error" class="err" role="alert"></div>
          </div>
          <div class="acts" style="margin-top:14px">
            <button type="button" class="btn" data-a="deposit-method-save"${blocked ? " disabled" : ""}>Save method</button>
            <button type="button" class="btn alt" data-a="deposit-method-new">Clear</button>
          </div>
          <p class="note">Methods and QR previews are saved in this browser only; they are not published to customer deposit screens.</p>
        </section>
      </div>`
    );
  }

  V["Deposit methods"] = depositMethodsView;

  H["deposit-method-new"] = () => {
    need("money");
    editingDepositMethodId = "";
    pendingDepositQrDataUrl = null;
    depositMethodsNotice = "";
    depositMethodsError = "";
    render();
  };

  H["deposit-method-edit"] = (button) => {
    need("money");
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) {
      toast("That deposit method is no longer available.");
      return;
    }
    editingDepositMethodId = method.id;
    pendingDepositQrDataUrl = null;
    depositMethodsNotice = "";
    render();
  };

  H["deposit-method-save"] = () => {
    need("money");
    if (!depositMethodsLoaded || depositMethodsError) {
      toast("Deposit methods could not be loaded. Reload before saving.");
      return;
    }
    const asset =
      document.querySelector<HTMLInputElement>("#deposit-method-asset")?.value
        .trim() || "";
    const network =
      document.querySelector<HTMLInputElement>(
        "#deposit-method-network",
      )?.value.trim() || "";
    const address =
      document.querySelector<HTMLTextAreaElement>(
        "#deposit-method-address",
      )?.value.trim() || "";
    const errorTarget = document.querySelector<HTMLElement>(
      "#deposit-method-qr-error",
    );
    if (!asset || !network || !address) {
      if (errorTarget) errorTarget.textContent = "Asset, network, and address are required.";
      return;
    }
    const duplicate = sharedDepositMethods.some(
      (method) =>
        method.id !== editingDepositMethodId &&
        method.asset.toLowerCase() === asset.toLowerCase() &&
        method.network.toLowerCase() === network.toLowerCase(),
    );
    if (duplicate) {
      if (errorTarget)
        errorTarget.textContent = "A method for this asset and network already exists.";
      return;
    }

    const previous = sharedDepositMethods.find(
      (method) => method.id === editingDepositMethodId,
    );
    let id = previous?.id || `DM-${Date.now()}`;
    while (
      !previous &&
      sharedDepositMethods.some((method) => method.id === id)
    ) {
      id += "1";
    }
    const now = new Date().toISOString();
    const qrDataUrl =
      pendingDepositQrDataUrl === null
        ? previous?.qrDataUrl
        : pendingDepositQrDataUrl || undefined;
    const method: SharedDepositMethod = {
      id,
      asset,
      network,
      address,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      ...(qrDataUrl ? { qrDataUrl } : {}),
    };
    const nextMethods = previous
      ? sharedDepositMethods.map((item) => (item.id === id ? method : item))
      : [method, ...sharedDepositMethods];
    try {
      localStorage.setItem(
        depositMethodsStorageKey,
        JSON.stringify(nextMethods),
      );
      sharedDepositMethods = nextMethods;
      editingDepositMethodId = "";
      pendingDepositQrDataUrl = null;
      depositMethodsError = "";
      depositMethodsNotice = "Deposit method saved in this browser.";
      render();
    } catch {
      if (errorTarget)
        errorTarget.textContent = "Could not save this method in browser storage.";
    }
  };

  H["deposit-method-remove"] = (button) => {
    need("money");
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) return;
    if (
      !window.confirm(
        `Remove ${method.asset} on ${method.network} from this browser?`,
      )
    ) {
      return;
    }
    const nextMethods = sharedDepositMethods.filter(
      (item) => item.id !== method.id,
    );
    try {
      localStorage.setItem(
        depositMethodsStorageKey,
        JSON.stringify(nextMethods),
      );
      sharedDepositMethods = nextMethods;
      if (editingDepositMethodId === method.id) {
        editingDepositMethodId = "";
        pendingDepositQrDataUrl = null;
      }
      depositMethodsNotice = "Deposit method removed from this browser.";
      depositMethodsError = "";
      render();
    } catch {
      toast("Could not remove this method from browser storage.");
    }
  };

  H["deposit-method-qr-remove"] = () => {
    need("money");
    pendingDepositQrDataUrl = "";
    setDepositQrStatus("QR image will be removed when you save.");
    setDepositQrStatus("", true);
    updateDepositQrPreview();
  };
}

export const adminManagementBehavior = `(${installAdminManagement.toString()})();`;

