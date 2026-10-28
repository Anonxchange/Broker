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

    const id 
