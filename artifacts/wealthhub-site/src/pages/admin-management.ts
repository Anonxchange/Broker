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
        documentCard("Government ID front", submission?.frontImageUrl),
        documentCard("Government ID back", submission?.backImageUrl),
        documentCard("Selfie", submission?.selfieImageUrl),
        documentCard("Proof of address", submission?.proofOfAddressUrl),
      ].join("");
      const canApprove = hasKycEvidence(user);
      kycReview = `
        <h4>Government ID review</h4>
        <div class="grid2">${documentFields}</div>
        <div class="grid2" style="margin-top:12px">${submittedDocuments}</div>
        ${
          canApprove
            ? '<p class="note">Review the submitted details and document images before making a decision.</p>'
            : '<div class="banner wait" style="margin-top:12px">Required ID details and a front image are not available. Approval is disabled until verified documents are submitted through secure storage.</div>'
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
      hd("Review identity checks before deciding", "Verification") +
      tabs("kyc", [
        ["pending", `Waiting (${count().Verification})`],
        ["verified", "Verified"],
        ["rejected", "Rejected"],
        ["all", "All"],
      ]) +
      tbl(
        [
          ["User", "1.5fr"],
          ["Government ID", "1.2fr"],
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
      toast("Approval requires ID details and a government ID front image.");
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

  api.changeDepositStatus = async (
    id: string,
    requestedStatus: string,
    note: string,
  ) => {
    need("money");
    const deposit = DB.deposits.find((item) => item.id === id);
    if (!deposit) fail("Deposit not found.");

    const user = U(deposit.uid);
    if (!user.id) fail("The deposit's user could not be found.");

    const previousStatus = deposit.status.toLowerCase();
    const nextStatus = requestedStatus.trim().toLowerCase();
    const validStatuses = statuses.map((status) => status.toLowerCase());
    if (!validStatuses.includes(previousStatus)) {
      fail("The deposit has an unknown current status.");
    }
    if (!validStatuses.includes(nextStatus)) {
      fail("Choose a valid deposit status.");
    }

    const nextNote = note.trim() || deposit.note;
    if (previousStatus === nextStatus) {
      if (nextNote !== deposit.note) {
        deposit.note = nextNote;
        log("Deposit note updated", deposit.id, `Status remains ${previousStatus}`);
        save();
      }
      return;
    }

    const amount = roundMoney(Number(deposit.usd));
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("This deposit has an invalid USD amount.");
    }
    if (nextStatus === "approved" && user.status !== "active") {
      fail("Deposits can only be credited to active accounts.");
    }

    const wasCredited = previousStatus === "approved";
    const shouldBeCredited = nextStatus === "approved";
    let nextBalance = roundMoney(user.bal);
    if (wasCredited && !shouldBeCredited) {
      nextBalance = roundMoney(user.bal - amount);
      if (nextBalance < 0) {
        fail(
          "This deposit credit cannot be reversed because the user's current balance is too low.",
        );
      }
    } else if (!wasCredited && shouldBeCredited) {
      nextBalance = roundMoney(user.bal + amount);
    }

    if (wasCredited !== shouldBeCredited) {
      user.bal = nextBalance;
      led(
        user,
        shouldBeCredited ? "deposit" : "deposit reversal",
        amount,
        `Deposit ${deposit.id} status changed from ${previousStatus} to ${nextStatus}`,
      );
    }
    deposit.status = nextStatus;
    deposit.note = nextNote;
    log(
      "Deposit status changed",
      deposit.id,
      `${previousStatus} → ${nextStatus} · ${usd(amount)} · ${user.email}`,
    );
    save();
  };

  api.changeWithdrawalStatus = async (
    id: string,
    requestedStatus: string,
    note: string,
  ) => {
    need("money");
    const withdrawal = DB.withdrawals.find((item) => item.id === id);
    if (!withdrawal) fail("Withdrawal not found.");

    const user = U(withdrawal.uid);
    if (!user.id) fail("The withdrawal's user could not be found.");

    const previousStatus = withdrawal.status.toLowerCase();
    const nextStatus = requestedStatus.trim().toLowerCase();
    const validStatuses = statuses.map((status) => status.toLowerCase());
    if (!validStatuses.includes(previousStatus)) {
      fail("The withdrawal has an unknown current status.");
    }
    if (!validStatuses.includes(nextStatus)) {
      fail("Choose a valid withdrawal status.");
    }

    const nextNote = note.trim() || withdrawal.note;
    if (previousStatus === nextStatus) {
      if (nextNote !== withdrawal.note) {
        withdrawal.note = nextNote;
        log(
          "Withdrawal note updated",
          withdrawal.id,
          `Status remains ${previousStatus}`,
        );
        save();
      }
      return;
    }

    const amount = roundMoney(Number(withdrawal.usd));
    if (!Number.isFinite(amount) || amount <= 0) {
      fail("This withdrawal has an invalid USD amount.");
    }
    if (nextStatus === "approved") {
      if (DB.settings.wdPaused) fail("Withdrawals are paused.");
      if (
        user.status !== "active" ||
        !user.wd ||
        (DB.settings.needKyc && user.kyc !== "verified")
      ) {
        fail("This user is not currently eligible for withdrawals.");
      }
    }

    const hadReservedFunds = previousStatus !== "declined";
    const shouldReserveFunds = nextStatus !== "declined";
    let nextBalance = roundMoney(user.bal);

    if (!hadReservedFunds && shouldReserveFunds) {
      if (
        user.status !== "active" ||
        !user.wd ||
        (DB.settings.needKyc && user.kyc !== "verified")
      ) {
        fail("This user is not currently eligible for withdrawals.");
      }
      if (amount > user.bal) {
        fail("The user's available balance is too low to reserve this withdrawal.");
      }
      nextBalance = roundMoney(user.bal - amount);
    } else if (hadReservedFunds && !shouldReserveFunds) {
      nextBalance = roundMoney(user.bal + amount);
    }

    if (hadReservedFunds !== shouldReserveFunds) {
      user.bal = nextBalance;
      led(
        user,
        shouldReserveFunds
          ? nextStatus === "approved"
            ? "withdrawal"
            : "withdrawal hold"
          : "refund",
        amount,
        `Withdrawal ${withdrawal.id} status changed from ${previousStatus} to ${nextStatus}`,
      );
    }
    withdrawal.status = nextStatus;
    withdrawal.note = nextNote;
    log(
      "Withdrawal status changed",
      withdrawal.id,
      `${previousStatus} → ${nextStatus} · ${usd(amount)} · ${user.email}`,
    );
    save();
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

  H["dep-status"] = async (
    button: HTMLElement & { dataset: DOMStringMap },
  ) => {
    need("money");
    const deposit = DB.deposits.find((item) => item.id === button.dataset.id);
    if (!deposit) {
      toast("Deposit not found.");
      return;
    }

    const form = await ask(
      `Change deposit ${deposit.id}`,
      [
        {
          k: "status",
          l: "New status",
          t: "select",
          o: statusOptions(deposit.status),
        },
        { k: "note", l: "Admin note (blank keeps current note)", t: "area" },
      ],
      "Save status",
      "Changing an approved deposit reverses or adds its balance credit. A reversal is blocked if the user has already spent the funds.",
    );
    if (!form) return;

    run(
      () =>
        api.changeDepositStatus(deposit.id, form.status, form.note || ""),
      "Deposit status updated",
    );
  };

  H["wd-status"] = async (
    button: HTMLElement & { dataset: DOMStringMap },
  ) => {
    need("money");
    const withdrawal = DB.withdrawals.find(
      (item) => item.id === button.dataset.id,
    );
    if (!withdrawal) {
      toast("Withdrawal not found.");
      return;
    }

    const form = await ask(
      `Change withdrawal ${withdrawal.id}`,
      [
        {
          k: "status",
          l: "New status",
          t: "select",
          o: statusOptions(withdrawal.status),
        },
        { k: "note", l: "Admin note (blank keeps current note)", t: "area" },
      ],
      "Save status",
      "Use this only to correct the record. Changing an approved withdrawal to Declined refunds held funds but does not reverse an external payout.",
    );
    if (!form) return;

    run(
      () =>
        api.changeWithdrawalStatus(
          withdrawal.id,
          form.status,
          form.note || "",
        ),
      "Withdrawal status updated",
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
      ["all", "All"],
      ["email", "Email"],
      ["closed", "Closed"],
      ["open", `Open (${count().Support})`],
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
    const qrPreview =
      pendingDepositQrDataUrl !== null
        ? pendingDepositQrDataUrl
        : editing?.qrDataUrl || "";
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
        <label class="fl" for="deposit-method-qr-file">QR code image (optional)</label>
        <input class="sel" id="deposit-method-qr-file" type="file" accept="image/png,image/jpeg,image/webp">
        <div class="row" id="deposit-method-qr-preview" style="margin-top:10px">
          ${qrPreview ? `<img src="${esc(qrPreview)}" alt="Deposit QR code preview" style="width:112px;height:112px;object-fit:contain;border:1px solid var(--line);border-radius:10px;padding:6px">` : '<small class="note">No QR image added.</small>'}
          <button class="btn alt sm" type="button" data-a="deposit-method-qr-remove" ${qrPreview ? "" : "disabled"}>Remove QR image</button>
        </div>
        <p class="note" id="deposit-method-qr-status" role="status"></p>
        <p class="err" id="deposit-method-qr-error" role="alert"></p>
        <p class="err" id="deposit-method-error" role="alert"></p>
        <div class="row">
          <button class="btn" type="button" data-a="deposit-method-save">${editing ? "Save changes" : "Add method"}</button>
          ${editing ? '<button class="btn alt" type="button" data-a="deposit-method-reset">Cancel edit</button>' : ""}
        </div>
      </form>`;

    const methodsTable = tbl(
      [
        ["Asset and network", "1fr"],
        ["Deposit address", "2fr"],
        ["QR", "70px"],
        ["", "150px", "r"],
      ],
      sharedDepositMethods.map((method) => [
        `${esc(method.asset)}<small>${esc(method.network)}</small>`,
        `<small>${esc(method.address)}</small>`,
        method.qrDataUrl
          ? `<img src="${esc(method.qrDataUrl)}" alt="QR code for ${esc(method.asset)}" style="width:44px;height:44px;object-fit:contain">`
          : "<small>—</small>",
        `<div class="acts"><button class="btn sm alt" type="button" data-a="deposit-method-edit" data-id="${esc(method.id)}">Edit</button><button class="btn sm bad" type="button" data-a="deposit-method-remove" data-id="${esc(method.id)}">Remove</button></div>`,
      ]),
      "No deposit methods have been added.",
    );

    return (
      hd(
        "Manage the destinations members select when they deposit",
        "Deposit methods",
      ) +
      `<div class="row" style="margin-top:14px"><span class="pill mut">Shown in the member deposit flow on this device</span><button class="btn alt sm" type="button" data-a="deposit-method-refresh">Refresh list</button></div>` +
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
    need("money");
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) {
      toast("Deposit method not found");
      return;
    }
    editingDepositMethodId = method.id;
    pendingDepositQrDataUrl = null;
    depositMethodsError = "";
    depositMethodsNotice = "";
    render();
  };

  H["deposit-method-reset"] = () => {
    editingDepositMethodId = "";
    pendingDepositQrDataUrl = null;
    depositMethodsError = "";
    depositMethodsNotice = "";
    render();
  };

  H["deposit-method-save"] = async () => {
    need("money");
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
    const error = document.querySelector<HTMLElement>(
      "#deposit-method-error",
    );
    const assetValue = asset?.value.trim() || "";
    const networkValue = network?.value.trim() || "";
    const addressValue = address?.value.trim() || "";
    const methodId = editingDepositMethodId;
    if (error) error.textContent = "";
    depositMethodsError = "";
    depositMethodsNotice = "";
    try {
      const existing = sharedDepositMethods.find(
        (method) => method.id === methodId,
      );
      if (
        sharedDepositMethods.some(
          (method) =>
            method.id !== methodId &&
            method.asset.toLowerCase() === assetValue.toLowerCase() &&
            method.network.toLowerCase() === networkValue.toLowerCase(),
        )
      ) {
        throw new Error("That asset and network already have a deposit method.");
      }
      const now = new Date().toISOString();
      const qrDataUrl =
        pendingDepositQrDataUrl !== null
          ? pendingDepositQrDataUrl || undefined
          : existing?.qrDataUrl;
      const method: SharedDepositMethod = {
        id: methodId || `DM-${Date.now()}`,
        asset: assetValue,
        network: networkValue,
        address: addressValue,
        ...(qrDataUrl ? { qrDataUrl } : {}),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      const nextMethods = methodId
        ? sharedDepositMethods.map((item) =>
            item.id === methodId ? method : item,
          )
        : [method, ...sharedDepositMethods];
      localStorage.setItem(
        depositMethodsStorageKey,
        JSON.stringify(nextMethods),
      );
      sharedDepositMethods = nextMethods;
      editingDepositMethodId = "";
      pendingDepositQrDataUrl = null;
      depositMethodsNotice = methodId
        ? "Deposit method updated."
        : "Deposit method added.";
      depositMethodsLoaded = true;
      render();
      toast(depositMethodsNotice);
    } catch (errorValue) {
      const message =
        errorValue instanceof Error
          ? errorValue.message
          : "The deposit method could not be saved in this browser.";
      if (error) error.textContent = message;
    }
  };

  H["deposit-method-remove"] = async (
    button: HTMLElement & { dataset: DOMStringMap },
  ) => {
    need("money");
    const method = sharedDepositMethods.find(
      (item) => item.id === button.dataset.id,
    );
    if (!method) {
      toast("Deposit method not found");
      return;
    }
    if (
      !window.confirm(
        `Remove ${method.asset} on ${method.network} from the member deposit flow?`,
      )
    ) {
      return;
    }

    try {
      const nextMethods = sharedDepositMethods.filter(
        (item) => item.id !== method.id,
      );
      localStorage.setItem(
        depositMethodsStorageKey,
        JSON.stringify(nextMethods),
      );
      sharedDepositMethods = nextMethods;
      editingDepositMethodId = "";
      pendingDepositQrDataUrl = null;
      depositMethodsNotice = "Deposit method removed.";
      depositMethodsLoaded = true;
      render();
      toast(depositMethodsNotice);
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "The deposit method could not be removed in this browser.",
      );
    }
  };

  H["deposit-method-qr-remove"] = () => {
    need("money");
    pendingDepositQrDataUrl = "";
    setDepositQrStatus("QR image will be removed when you save.");
    updateDepositQrPreview();
  };
}

export const adminManagementBehavior = `(${installAdminManagement.toString()})();`;
