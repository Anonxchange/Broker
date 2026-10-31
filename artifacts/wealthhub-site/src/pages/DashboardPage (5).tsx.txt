import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import harborDashboardHtml from '@assets/Harbor_–_Investing_(1)_1792836967110.html?raw';
import {
  serializeInlineScript,
  supabase,
  supabaseConfigured,
  supabaseImageBucket,
  type AppProfile,
} from '../lib/supabase';
import { useAuth } from '../lib/auth-context';
import { SessionLoading } from '@/components/session-loading';
import { installMemberDashboardTools } from './member-dashboard-tools';
import { memberInvestments } from './investments-api';
import { runProfileRequest } from './profile-requests';
import { buildMemberOps, handleInvestmentsMessage } from './investments-bridge';
import './dashboard-page.css';

type DashboardPageProps = {
  onLogout: () => Promise<void>;
  onSignOutEverywhere: () => Promise<void>;
  profile: AppProfile;
  userId: string;
};

type MemberDepositMethod = {
  id: string;
  asset: string;
  network: string;
  address: string;
  qrDataUrl?: string;
};

type MemberDashboardState = {
  cash0: number;
  plans: unknown[];
  tx: unknown[];
  wallet: string | null;
  depositRequests: unknown[];
  watchlist: unknown[];
  priceAlerts: unknown[];
  [key: string]: unknown;
};

const EMPTY_DASHBOARD_STATE: MemberDashboardState = {
  cash0: 0,
  plans: [],
  tx: [],
  wallet: null,
  depositRequests: [],
  watchlist: [],
  priceAlerts: [],
};

type MemberWalletState = {
  a: string;
  net: number;
  amount: string;
  step?: string;
  proof?: File | null;
  lastRequest?: Record<string, unknown> | null;
};

declare const WS: MemberWalletState;
declare const ST: MemberDashboardState;
declare function depositProgress(step: string): string;
declare function px(asset: string): number;
declare function fmt(amount: number): string;
declare function save(): void;
declare function clearDepositProof(): void;
declare function renderWallet(): void;
declare function redrawWithdrawForm(): void;
declare function lg(symbol: string): string;
declare function cashNow(): number;
declare const NET: Record<string, string[]>;
declare const FEE: Record<string, number>;
declare let page: string;

function installMemberDepositMethods() {
  const browserWindow = window as typeof window & {
    depositGuide?: () => string;
    depositChoose?: () => string;
    depositProof?: () => string;
    depositComplete?: () => string;
    wform?: () => string;
    renderWallet?: () => void;
    loadPublic?: (category: string) => void;
    __auvrenthiaMarketRequest?: (
      payload: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    __getSelectedDepositMethod?: () => MemberDepositMethod | null;
    __AUVRENTHIA_DEPOSIT_METHODS__?: unknown;
  };
  const pendingMarketRequests = new Map<
    string,
    {
      resolve: (data: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  browserWindow.__auvrenthiaMarketRequest = (payload) =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pendingMarketRequests.delete(requestId);
        reject(new Error("Market data request timed out."));
      }, 20_000);
      pendingMarketRequests.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage(
        {
          type: "auvrenthia-market-request",
          requestId,
          payload,
        },
        (window as unknown as { __AUVHOST__: string }).__AUVHOST__,
      );
    });
  const escapeHtml = (value: unknown) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return entities[character];
    });
  const validQrDataUrl = (value: unknown): value is string => {
    if (typeof value !== "string") return false;
    if (
      value.length <= 720_000 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
    ) {
      return true;
    }
    try {
      const url = new URL(value);
      return (
        value.length <= 4_096 &&
        url.protocol === "https:" &&
        url.hostname.endsWith(".supabase.co") &&
        url.pathname.includes("/storage/v1/object/sign/")
      );
    } catch {
      return false;
    }
  };

  const stepper = (active: number) =>
    `<div class="deposit-steps" aria-label="Deposit progress">${["Instructions", "Amount", "Pay and upload slip"]
      .map(
        (label, index) =>
          `<div class="deposit-step${index <= active ? " active" : ""}"><b>${index + 1}</b><span>${label}</span></div>`,
      )
      .join("")}</div>`;

  function readDepositMethods(): MemberDepositMethod[] {
    const parsed = browserWindow.__AUVRENTHIA_DEPOSIT_METHODS__;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is MemberDepositMethod => {
      if (typeof value !== "object" || value === null) return false;
      const method = value as Record<string, unknown>;
      return (
        typeof method.id === "string" &&
        typeof method.asset === "string" &&
        method.asset.trim().length > 0 &&
        typeof method.network === "string" &&
        method.network.trim().length > 0 &&
        typeof method.address === "string" &&
        method.address.trim().length > 0 &&
        (method.qrDataUrl === undefined || validQrDataUrl(method.qrDataUrl))
      );
    });
  }

  function methodsForAsset(asset: string) {
    return readDepositMethods().filter(
      (method) =>
        method.asset.trim().toLowerCase() === asset.trim().toLowerCase(),
    );
  }

  function selectedDepositMethod() {
    const methods = methodsForAsset(WS.a);
    const selectedIndex = Number.isInteger(WS.net) ? WS.net : 0;
    return methods[selectedIndex] || methods[0] || null;
  }

  const originalDepositChoose = browserWindow.depositChoose;
  if (typeof originalDepositChoose !== "function") return;

  browserWindow.depositGuide = function depositGuideWithConfiguredMethods() {
    const methods = readDepositMethods();
    const methodCards = methods.length
      ? methods
          .map(
            (method) =>
              `<div class="deposit-guide-card"><h3>${escapeHtml(method.asset)}</h3><p>${escapeHtml(method.network)}</p></div>`,
          )
          .join("")
      : '<div class="deposit-callout"><strong>No payment methods are available</strong><p>Contact support before sending a payment. An administrator must configure a destination first.</p></div>';
    const recent = Array.isArray(ST.depositRequests)
      ? ST.depositRequests
          .filter((request: unknown) => request && typeof request === "object")
          .slice(0, 3)
          .map((request: unknown) => {
            const item = request as Record<string, unknown>;
            const amount = Number(item.amt) || 0;
            const date = Number(item.t);
            const submittedAt = Number.isFinite(date)
              ? new Date(date).toLocaleString()
              : "Recently submitted";
            return `<div class="wl"><div class="nm"><div>${escapeHtml(item.a)} deposit request<small>${escapeHtml(item.net)} · ${escapeHtml(submittedAt)}</small></div></div><div class="r">${amount} ${escapeHtml(item.a)}<small>${escapeHtml(item.status || "pending review")}</small></div></div>`;
          })
          .join("")
      : "";
    return `<div class="deposit-shell">${stepper(0)}<div class="deposit-guide-grid"><div class="deposit-guide-card"><h3>1. Choose asset and amount</h3><p>Pick the asset, network and the amount you plan to send.</p></div><div class="deposit-guide-card"><h3>2. Send your payment</h3><p>You will see the payment address and QR code on the next page. Transfers may be irreversible, so check them carefully.</p></div><div class="deposit-guide-card"><h3>3. Upload your slip</h3><p>After paying, attach a screenshot or payment slip. Staff review the request; funds are not credited automatically.</p></div></div><h2 class="sec">Supported assets and networks</h2><div class="deposit-guide-grid">${methodCards}</div><div class="deposit-actions"><button class="btn" id="deposit-start"${methods.length ? "" : " disabled"}>Start deposit request</button></div>${recent ? `<h2 class="sec">Recent deposit requests</h2>${recent}` : ""}</div>`;
  };

  browserWindow.depositChoose = function depositChooseWithAdminMethods() {
    const methods = readDepositMethods();
    const assets = Array.from(
      new Map(
        methods.map((method) => [method.asset.trim().toLowerCase(), method.asset]),
      ).values(),
    );
    if (assets.length === 0) {
      return `<div class="deposit-shell">${stepper(1)}<div class="mp"><div class="mph"><div><h3>No deposit methods available</h3><small>An administrator has not configured a deposit destination yet.</small></div></div><div class="deposit-callout"><strong>No payment destination</strong><p>Contact support before sending a payment. An administrator must add an active method first.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button></div></div></div>`;
    }

    const selectedAsset =
      assets.find(
        (asset) => asset.trim().toLowerCase() === WS.a.trim().toLowerCase(),
      ) || assets[0];
    WS.a = selectedAsset;
    const availableMethods = methodsForAsset(selectedAsset);
    WS.net = Math.min(
      Math.max(0, Number.isInteger(WS.net) ? WS.net : 0),
      Math.max(availableMethods.length - 1, 0),
    );
    const selected = availableMethods[WS.net];
    const networkOptions = availableMethods
      .map(
        (method, index) =>
          `<option value="${index}"${index === WS.net ? " selected" : ""}>${escapeHtml(method.network)}</option>`,
      )
      .join("");
    const assetOptions = assets
      .map(
        (asset) =>
          `<option value="${escapeHtml(asset)}"${asset === selectedAsset ? " selected" : ""}>${escapeHtml(asset)}</option>`,
      )
      .join("");
    const amount = Number(WS.amount) || "";
    const estimatedValue =
      amount && px(selectedAsset)
        ? `≈ ${fmt(Number(amount) * px(selectedAsset))}`
        : "";
    return `<div class="deposit-shell">${stepper(1)}<div class="mp"><div class="mph"><div><h3>Choose deposit details</h3><small>Select the asset and network, then enter the amount you will send.</small></div></div><label class="fl" for="wa">Asset</label><select class="sel" id="wa">${assetOptions}</select><label class="fl" for="wn">Network</label><select class="sel" id="wn">${networkOptions}</select><label class="fl" for="wq">Amount (${escapeHtml(selectedAsset)})</label><div class="amt"><input id="wq" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00" value="${amount}"></div><div class="hint" id="wu">${estimatedValue}</div><div class="err" id="we" role="alert"></div><div class="deposit-callout"><strong>What happens next</strong><p>On the next page you will get the payment address and QR code for ${selected ? `${escapeHtml(selected.asset)} on ${escapeHtml(selected.network)}` : "this network"}. After paying, upload your slip for staff review.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button><button class="btn" id="deposit-continue">Continue to payment</button></div></div></div>`;
  };

  browserWindow.__getSelectedDepositMethod = selectedDepositMethod;
  browserWindow.depositComplete = function depositCompleteWithReviewStatus() {
    const request = WS.lastRequest as Record<string, unknown> | null;
    if (!request) return browserWindow.depositGuide?.() || "";
    const amount = Number(request.amt) || 0;
    const estimate = Number(request.usd);
    const receiptName = escapeHtml(request.receiptName || "Uploaded image");
    const status = escapeHtml(request.status || "Pending staff review");
    const submittedAt = Number(request.t);
    return `<div class="deposit-shell deposit-complete">${stepper(2)}<div class="deposit-callout"><strong>Deposit request submitted</strong><p>Your payment details and receipt are saved securely. An authorized staff member must review the submission. No funds are credited automatically.</p></div><div class="mp"><div class="mph"><div><h3>${amount} ${escapeHtml(request.a)}</h3><small>${escapeHtml(request.net)} · ${Number.isFinite(submittedAt) ? new Date(submittedAt).toLocaleString() : "Submitted"}</small></div><span class="risk r1">${status}</span></div><div class="meta"><span>Estimated value<b>${Number.isFinite(estimate) ? fmt(estimate) : "Estimate unavailable"}</b></span><span>Receipt<b>${receiptName}</b></span></div></div><div class="deposit-actions"><button class="btn" id="deposit-again">Start another deposit request</button></div></div>`;
  };
  browserWindow.depositProof = function depositProofWithAdminMethod() {
    const method = selectedDepositMethod();
    const amount = Number(WS.amount) || 0;
    const value = px(WS.a) ? fmt(amount * px(WS.a)) : "";
    if (!method) {
      return `<div class="deposit-shell">${stepper(2)}<div class="mp"><div class="deposit-callout"><strong>No deposit method is available</strong><p>Go back and contact support before sending a payment.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-edit">Back</button></div></div></div>`;
    }
    const qr = method.qrDataUrl
      ? `<img class="pay-qr" src="${escapeHtml(method.qrDataUrl)}" alt="QR code for ${escapeHtml(method.asset)} on ${escapeHtml(method.network)}">`
      : `<div class="pay-qr pay-qr-empty">QR code not available. Copy the address instead.</div>`;
    return `<div class="deposit-shell">${stepper(2)}
      <div class="mp pay">
        <div class="mph"><div><h3>Send your payment</h3><small>Step 1 of 2 · pay to the address below</small></div><span class="risk r1">${escapeHtml(method.asset)} · ${escapeHtml(method.network)}</span></div>
        <div class="pay-amount"><span>Amount to send</span><b>${escapeHtml(String(amount))} ${escapeHtml(method.asset)}</b>${value ? `<small>≈ ${value}</small>` : ""}</div>
        <div class="pay-grid">
          ${qr}
          <div class="pay-addr"><span>${escapeHtml(method.asset)} address (${escapeHtml(method.network)})</span><code>${escapeHtml(method.address)}</code><button class="btn alt" id="deposit-method-copy" type="button">Copy address</button></div>
        </div>
        <div class="deposit-callout"><strong>Check before you send</strong><p>Send only ${escapeHtml(method.asset)} on ${escapeHtml(method.network)}. Anything else may be lost permanently.</p></div>
      </div>
      <div class="mp pay">
        <div class="mph"><div><h3>Upload your payment slip</h3><small>Step 2 of 2 · after you have paid</small></div></div>
        <label class="receipt-upload" for="deposit-proof"><b>Upload transfer screenshot or slip</b><small class="hint">PNG, JPG, or WebP · up to 8 MB</small><input id="deposit-proof" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="proof-note"></label>
        <p id="proof-note" class="hint">Stored privately and visible only to you and authorized staff. Staff must review the payment; uploading a slip does not credit funds automatically.</p>
        <div id="deposit-proof-preview" class="receipt-preview" hidden></div>
        <p class="err" id="deposit-proof-error" role="alert"></p>
        <div class="deposit-actions"><button class="btn alt" id="deposit-edit">Back</button><button class="btn" id="submit-deposit" disabled>Submit slip</button></div>
      </div>
    </div>`;
  };

  const misc = document.querySelector("#misc");
  misc?.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      const button =
        target instanceof Element
          ? target.closest<HTMLButtonElement>("#submit-deposit")
          : null;
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const error = document.querySelector<HTMLElement>(
        "#deposit-proof-error",
      );
      const file = (WS as MemberWalletState & { proof?: File | null }).proof;
      const method = selectedDepositMethod();
      const amount = Number(WS.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        if (error) error.textContent = "Enter an amount greater than zero.";
        return;
      }
      if (!method) {
        if (error) error.textContent = "No active payment method is available.";
        return;
      }
      if (!file) {
        if (error) error.textContent = "Attach a payment screenshot to continue.";
        return;
      }
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 8 * 1024 * 1024
      ) {
        if (error) {
          error.textContent = "Choose a PNG, JPG, or WebP image under 8 MB.";
        }
        return;
      }

      button.disabled = true;
      button.textContent = "Uploading slip…";
      if (error) error.textContent = "";
      window.parent.postMessage(
        {
          type: "auvrenthia-member-deposit-submit",
          deposit: {
            methodId: method.id,
            asset: method.asset,
            network: method.network,
            amount,
            estimatedUsd: px(method.asset)
              ? amount * px(method.asset)
              : null,
            receiptName: file.name,
          },
          proof: file,
        },
        (window as unknown as { __AUVHOST__: string }).__AUVHOST__,
      );
    },
    true,
  );

  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      !(window as unknown as { __AUVORIGINOK__: (e: MessageEvent) => boolean }).__AUVORIGINOK__(event)
    ) {
      return;
    }
    if (event.data?.type === "auvrenthia-market-response") {
      const requestId = event.data.requestId;
      if (typeof requestId !== "string") return;
      const pending = pendingMarketRequests.get(requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingMarketRequests.delete(requestId);
      if (event.data.ok && event.data.data && typeof event.data.data === "object") {
        pending.resolve(event.data.data as Record<string, unknown>);
      } else {
        pending.reject(
          new Error(
            typeof event.data.error === "string"
              ? event.data.error
              : "Market data is temporarily unavailable.",
          ),
        );
      }
      return;
    }
    if (
      event.data?.type !== "auvrenthia-member-deposit-submit-result"
    ) {
      return;
    }
    const button = document.querySelector<HTMLButtonElement>(
      "#submit-deposit",
    );
    const error = document.querySelector<HTMLElement>(
      "#deposit-proof-error",
    );
    if (!event.data.ok) {
      if (button) {
        button.disabled = false;
        button.textContent = "Submit slip";
      }
      if (error) {
        error.textContent =
          typeof event.data.message === "string"
            ? event.data.message
            : "The receipt could not be uploaded. Please try again.";
      }
      return;
    }
    const request = event.data.request as
      | Record<string, unknown>
      | undefined;
    if (!request || typeof request.id !== "string") {
      if (button) {
        button.disabled = false;
        button.textContent = "Submit slip";
      }
      if (error) error.textContent = "The deposit request response was invalid.";
      return;
    }
    ST.depositRequests = Array.isArray(ST.depositRequests)
      ? ST.depositRequests
      : [];
    ST.depositRequests.unshift(request);
    const wallet = WS as MemberWalletState & {
      lastRequest?: unknown;
      step?: string;
    };
    wallet.lastRequest = request;
    clearDepositProof();
    wallet.step = "complete";
    save();
    renderWallet();
  });

  misc?.addEventListener("click", async (event) => {
    const target = event.target;
    const button =
      target instanceof Element
        ? target.closest<HTMLButtonElement>("#deposit-method-copy")
        : null;
    if (!button) return;

    const method = selectedDepositMethod();
    if (!method) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(method.address);
      } else {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = method.address;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.append(temporaryInput);
        temporaryInput.select();
        document.execCommand("copy");
        temporaryInput.remove();
      }
      button.textContent = "Address copied";
    } catch {
      button.textContent = "Select the address to copy";
    }
  });

  // ---- Withdrawals: coin picker, wired to Supabase (request_withdrawal). ----
  // The request holds the amount from the balance until an admin decides it.
  const COIN_NAMES: Record<string, string> = {
    USDT: "Tether",
    USDC: "USD Coin",
    BTC: "Bitcoin",
    ETH: "Ethereum",
    BNB: "BNB",
    SOL: "Solana",
  };
  const withdrawState = () => WS as MemberWalletState & { wdA: string; wdNet: number };

  browserWindow.wform = function withdrawForm() {
    const wallet = withdrawState();
    const coins = Object.keys(NET);
    const asset = coins.includes(wallet.wdA) ? wallet.wdA : coins[0];
    const networks = NET[asset];
    const network = networks[wallet.wdNet] || networks[0];
    const price = px(asset);
    const fee = FEE[asset] || 0;
    const cards = coins
      .map((coin) => {
        const coinPrice = px(coin);
        return `<button type="button" class="wd-coin${coin === asset ? " on" : ""}" data-wd-coin="${escapeHtml(coin)}" aria-pressed="${coin === asset}">${lg(coin)}<span><b>${escapeHtml(coin)}</b><small>${escapeHtml(COIN_NAMES[coin] || coin)}</small></span><em>${coinPrice ? fmt(coinPrice) : "—"}</em></button>`;
      })
      .join("");
    const networkOptions = networks
      .map(
        (name, index) =>
          `<option value="${index}"${index === wallet.wdNet ? " selected" : ""}>${escapeHtml(name)}</option>`,
      )
      .join("");
    return `<div class="wd-label">Choose a coin</div><div class="wd-coins">${cards}</div>
      <label class="fl" for="wn">Network</label><select class="sel" id="wn">${networkOptions}</select>
      <label class="fl" for="wd">Withdraw to address</label><input class="sel" id="wd" placeholder="Paste a ${escapeHtml(network)} address" autocomplete="off" spellcheck="false">
      <label class="fl" for="wq">Amount (${escapeHtml(asset)})</label><div class="amt"><input id="wq" type="number" inputmode="decimal" min="0" placeholder="0.00"><button class="go" id="mx" type="button" style="padding:8px 14px;font-size:14px">Max</button></div>
      <div class="hint" id="wu"></div>
      <div class="wd-summary"><div><span>Network</span><b>${escapeHtml(network)}</b></div><div><span>Estimated network fee</span><b>${price ? fmt(fee) : "—"}</b></div></div>
      <div class="err" id="we" role="alert"></div>
      <button class="btn" id="wgo" type="button" style="width:100%">Request withdrawal</button>`;
  };

  type MemberApi = {
    __AUVRENTHIA_INV__?: (op: string, ...args: unknown[]) => Promise<unknown>;
    __AUVRENTHIA_MEMBER__?: {
      server: () => {
        withdrawals?: Array<Record<string, unknown>>;
        settings?: Record<string, unknown> | null;
        profile?: Record<string, unknown> | null;
      } | null;
      refresh: (repaintAnyPage?: boolean) => Promise<void>;
    };
  };
  const memberApi = () => window as unknown as MemberApi;

  // Why this member cannot withdraw right now, or "" when they can. The
  // database enforces the same rules; this only gives a clear message first.
  const withdrawalBlockReason = () => {
    const data = memberApi().__AUVRENTHIA_MEMBER__?.server();
    if (!data) return "";
    if (data.settings?.withdrawals_paused) {
      return "Withdrawals are temporarily paused. Please try again later.";
    }
    const unverified =
      data.profile && data.profile.kyc_status !== "verified";
    if (data.settings?.need_kyc !== false && unverified) {
      return data.profile?.kyc_status === "pending"
        ? "Your identity documents are under review. Withdrawals open as soon as verification is complete."
        : "Please complete identity verification to enable withdrawals.";
    }
    if (data.profile && data.profile.withdrawals_enabled === false) {
      return unverified
        ? "Please complete identity verification to enable withdrawals."
        : "Withdrawals are not yet active on your account. They will be enabled once your account review is complete.";
    }
    return "";
  };
  // True when the fix is for the member to verify, so we can offer a direct link.
  const withdrawalNeedsVerification = () => {
    const data = memberApi().__AUVRENTHIA_MEMBER__?.server();
    return Boolean(
      data?.profile &&
        data.profile.kyc_status !== "verified" &&
        data.profile.kyc_status !== "pending",
    );
  };

  const withdrawalStatusLabel: Record<string, string> = {
    pending: "Pending review",
    approved: "Approved",
    declined: "Declined (amount returned)",
    cancelled: "Cancelled (amount returned)",
  };
  const withdrawalRowsMarkup = () => {
    const rows = memberApi().__AUVRENTHIA_MEMBER__?.server()?.withdrawals ?? [];
    if (!rows.length) return '<p class="note">No withdrawals yet.</p>';
    return rows
      .slice(0, 10)
      .map((row) => {
        const status = String(row.status ?? "pending");
        const when = new Date(String(row.created_at ?? "")).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        const cancel =
          status === "pending"
            ? `<button class="more" type="button" data-wd-cancel="${escapeHtml(row.id)}">Cancel request</button>`
            : "";
        const reason =
          status === "declined" && row.note ? ` · ${escapeHtml(row.note)}` : "";
        return `<div class="wl"><div class="nm"><div>${escapeHtml(row.asset)} withdrawal<small>${escapeHtml(row.network)} · ${escapeHtml(withdrawalStatusLabel[status] ?? status)}${reason}</small></div></div><div class="r">${escapeHtml(Number(row.amount) || 0)} ${escapeHtml(row.asset)}<small>${fmt(Number(row.usd_amount) || 0)} · ${escapeHtml(when)}</small>${cancel}</div></div>`;
      })
      .join("");
  };

  const originalRenderWallet = browserWindow.renderWallet;
  if (typeof originalRenderWallet === "function") {
    browserWindow.renderWallet = function renderWalletWithWithdrawals() {
      originalRenderWallet();
      if (page !== "Withdraw") return;
      const root = document.querySelector("#misc");
      const blocked = withdrawalBlockReason();
      const badge = root?.querySelector(".head .risk");
      if (badge) badge.textContent = blocked ? "Unavailable" : "Live";
      const callout = root?.querySelector(".deposit-callout");
      if (callout) {
        callout.innerHTML = blocked
          ? `<strong>Withdrawals unavailable</strong><p>${escapeHtml(blocked)}</p>${
              withdrawalNeedsVerification()
                ? '<button class="btn alt" type="button" data-tool-action="navigate" data-destination="Security and verification">Verify identity</button>'
                : ""
            }`
          : "<strong>Review before withdrawing</strong><p>Check the coin, network, address and amount carefully. Blockchain transfers cannot be reversed. The amount is held from your balance while we review the request.</p>";
      }
      const submit = root?.querySelector<HTMLButtonElement>("#wgo");
      if (submit) submit.disabled = Boolean(blocked);
      const heading = root?.querySelector("h2.sec");
      if (heading) {
        heading.textContent = "Your withdrawals";
        while (heading.nextSibling) heading.nextSibling.remove();
        heading.insertAdjacentHTML("afterend", withdrawalRowsMarkup());
      }
    };
  }

  document.querySelector("#misc")?.addEventListener(
    "click",
    (event) => {
      if (page !== "Withdraw") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const coin = target.closest<HTMLElement>("[data-wd-coin]");
      if (coin) {
        const wallet = withdrawState();
        const next = coin.dataset.wdCoin || "";
        if (next && next !== wallet.wdA && NET[next]) {
          wallet.wdA = next;
          wallet.wdNet = 0;
          redrawWithdrawForm();
        }
        return;
      }

      const api = memberApi();
      const cancelButton = target.closest<HTMLButtonElement>("[data-wd-cancel]");
      if (cancelButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const id = cancelButton.dataset.wdCancel || "";
        if (!id || !api.__AUVRENTHIA_INV__) return;
        cancelButton.disabled = true;
        cancelButton.textContent = "Cancelling…";
        void api
          .__AUVRENTHIA_INV__("cancelWithdrawal", id)
          .then(() => api.__AUVRENTHIA_MEMBER__?.refresh(true))
          .catch((error: unknown) => {
            cancelButton.disabled = false;
            cancelButton.textContent =
              error instanceof Error ? error.message : "Could not cancel. Try again.";
          });
        return;
      }

      const submitButton = target.closest<HTMLButtonElement>("#wgo");
      if (!submitButton) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (submitButton.disabled) return;
      const wallet = withdrawState();
      const asset = wallet.wdA;
      const network = NET[asset][wallet.wdNet] || NET[asset][0];
      const quantity = Number((document.querySelector("#wq") as HTMLInputElement | null)?.value) || 0;
      const address = (document.querySelector("#wd") as HTMLInputElement | null)?.value.trim() || "";
      const error = document.querySelector<HTMLElement>("#we");
      if (!error) return;
      error.style.color = "";
      const blocked = withdrawalBlockReason();
      if (blocked) {
        error.textContent = blocked;
      } else if (!(quantity > 0)) {
        error.textContent = "Enter an amount.";
      } else if (address.length < 26) {
        error.textContent = `Enter a valid ${network} address.`;
      } else if (!px(asset)) {
        error.textContent = `No price available for ${asset} right now.`;
      } else if (quantity * px(asset) > cashNow()) {
        error.textContent = "Not enough balance for this amount.";
      } else if (!api.__AUVRENTHIA_INV__) {
        error.textContent = "Account services are not available. Reload the page.";
      } else {
        error.textContent = "";
        submitButton.disabled = true;
        submitButton.textContent = "Submitting…";
        void api
          .__AUVRENTHIA_INV__("requestWithdrawal", asset, network, address, quantity, quantity * px(asset))
          .then(async () => {
            try {
              await api.__AUVRENTHIA_MEMBER__?.refresh(true);
            } catch {
              // The balance refreshes on the next sync.
            }
            const done = document.querySelector<HTMLElement>("#we");
            if (done) {
              done.textContent =
                "Withdrawal requested. The amount is held from your balance while we review it.";
              done.style.color = "var(--up)";
            }
          })
          .catch((failure: unknown) => {
            submitButton.disabled = false;
            submitButton.textContent = "Request withdrawal";
            error.textContent =
              failure instanceof Error ? failure.message : "The withdrawal could not be requested.";
          });
      }
    },
    true,
  );

  const flowStyle = document.createElement("style");
  flowStyle.textContent = `
    .pay{margin-top:14px}
    .pay-amount{display:grid;gap:2px;margin:16px 0;padding:14px 16px;border:1px dashed var(--line);border-radius:14px}
    .pay-amount span,.pay-amount small{color:var(--mute);font-size:13px}
    .pay-amount b{font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .pay-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center;margin-bottom:16px}
    .pay-qr{width:176px;height:176px;object-fit:contain;border-radius:14px;background:#fff;padding:10px}
    .pay-qr-empty{display:grid;place-items:center;text-align:center;padding:14px;border:1px dashed var(--line);background:transparent;color:var(--mute);font-size:13px}
    .pay-addr{display:grid;gap:10px;min-width:0}
    .pay-addr span{color:var(--mute);font-size:13px}
    .pay-addr code{display:block;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:color-mix(in srgb,var(--ink) 5%,transparent);overflow-wrap:anywhere;user-select:all;font-size:14px;line-height:1.5}
    @media(max-width:560px){.pay-grid{grid-template-columns:1fr;justify-items:center}.pay-addr{width:100%}}
    .wd-label{margin-top:4px;color:var(--mute);font-size:13px;font-weight:600}
    .wd-coins{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:10px 0 6px}
    .wd-coin{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-areas:"logo name" "logo price";align-items:center;column-gap:12px;padding:12px;border:1px solid var(--line);border-radius:14px;text-align:left;transition:border-color .15s,background .15s}
    .wd-coin>:first-child{grid-area:logo}
    .wd-coin span{grid-area:name;display:grid;min-width:0}
    .wd-coin b{font-size:15px}
    .wd-coin small{color:var(--mute);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wd-coin em{grid-area:price;font-style:normal;color:var(--mute);font-size:12px;font-variant-numeric:tabular-nums}
    .wd-coin:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
    .wd-coin.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 10%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 18%,transparent)}
    .wd-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));margin:14px 0;border:1px solid var(--line);border-radius:12px;overflow:hidden}
    .wd-summary div{display:grid;gap:2px;padding:11px 14px;min-width:0}
    .wd-summary div+div{border-left:1px solid var(--line)}
    .wd-summary span{color:var(--mute);font-size:12px}
    .wd-summary b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  document.head.appendChild(flowStyle);

  renderWallet();
  for (const category of [
    "Stocks",
    "ETFs",
    "Crypto",
    "Forex",
    "Commodities",
  ]) {
    browserWindow.loadPublic?.(category);
  }
}

function buildDashboardDocument(
  initialState: MemberDashboardState,
  depositMethods: MemberDepositMethod[],
  profile: AppProfile,
) {
  const wealthHubTypography = `
    @font-face {
      font-family: Ppmori;
      src: url("/wealthhub/assets/media/cdn.prod.website-files.com/68f0faa809be102289ce1257/68f0faa809be102289ce12a8_PPMori-Regular.otf") format("opentype");
      font-style: normal;
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: Ppmori;
      src: url("/wealthhub/assets/media/cdn.prod.website-files.com/68f0faa809be102289ce1257/68f0faa809be102289ce12a9_PPMori-SemiBold.otf") format("opentype");
      font-style: normal;
      font-weight: 600;
      font-display: swap;
    }
    body {
      font-family: Ppmori, Arial, sans-serif !important;
      font-size: 1rem !important;
      font-weight: 400;
      line-height: 1.5;
    }
    .logo .dashboard-brand-mark {
      display: block;
      width: 171px;
      max-width: 100%;
      height: auto;
    }
    #title .dashboard-brand-mark {
      display: block;
      width: 30px;
      max-width: 30px;
      height: 30px;
      object-fit: contain;
      object-position: center;
    }
    #title {
      display: flex;
      min-width: 0;
      align-items: center;
      flex: 0 1 auto;
      margin-right: auto;
    }
    #tick {
      display: block;
      width: 100%;
      overflow: hidden;
      padding: 0 0 14px;
      margin: -6px 0 24px;
      border-bottom: 1px solid var(--line);
      font-size: 13px;
      white-space: nowrap;
      scrollbar-width: none;
    }
    #tick::-webkit-scrollbar {
      display: none;
    }
    #tick .ticker-track {
      display: flex;
      width: max-content;
      will-change: transform;
      animation: auvrenthia-price-ticker 42s linear infinite;
    }
    #tick .ticker-group {
      display: flex;
      flex: none;
      align-items: center;
      gap: 30px;
      padding-right: 30px;
    }
    #tick .ticker-group > span {
      display: inline-flex;
      flex: none;
      align-items: center;
    }
    #tick .ticker-group > span > b {
      margin: 0 7px 0 6px;
      font-weight: 700;
    }
    #tick:hover .ticker-track,
    #tick:focus .ticker-track {
      animation-play-state: paused;
    }
    @keyframes auvrenthia-price-ticker {
      to {
        transform: translate3d(-50%, 0, 0);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #tick {
        overflow-x: auto;
      }
      #tick .ticker-track {
        width: 100%;
        animation: none;
        transform: none;
      }
      #tick .ticker-group[aria-hidden="true"] {
        display: none;
      }
    }
    .top {
      width: 100%;
      justify-content: flex-start;
    }
    .profile-control {
      position: relative;
      z-index: 30;
      flex: none;
    }
    .profile-control .av {
      cursor: pointer;
    }
    .profile-trigger:focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 3px;
    }
    .profile-dropdown {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      z-index: 50;
      width: min(260px, calc(100vw - 36px));
      padding: 8px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--bg);
      box-shadow: 0 18px 44px rgba(4, 12, 35, 0.2);
    }
    .profile-dropdown[hidden] {
      display: none;
    }
    .profile-dropdown__view[hidden] {
      display: none;
    }
    .profile-dropdown__identity {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 9px 10px 12px;
      margin-bottom: 5px;
      border-bottom: 1px solid var(--line);
    }
    .profile-dropdown__initial {
      display: grid;
      width: 36px;
      height: 36px;
      flex: none;
      place-items: center;
      border-radius: 50%;
      background: var(--ink);
      color: var(--bg);
      font-size: 14px;
      font-weight: 800;
    }
    .profile-dropdown__identity strong,
    .profile-dropdown__identity small {
      display: block;
    }
    .profile-dropdown__identity strong {
      color: var(--ink);
      font-size: 14px;
    }
    .profile-dropdown__identity small {
      color: var(--mute);
      font-size: 12px;
    }
    .profile-trigger {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
    }
    .profile-trigger .av {
      pointer-events: none;
    }
    .profile-dropdown button {
      display: flex;
      width: 100%;
      align-items: center;
      padding: 10px;
      border-radius: 8px;
      color: var(--ink);
      font-size: 14px;
      text-align: left;
    }
    .profile-dropdown button svg {
      width: 18px;
      height: 18px;
      flex: none;
      margin-right: 10px;
      color: var(--mute);
    }
    .profile-dropdown button:hover,
    .profile-dropdown button:focus-visible {
      background: color-mix(in srgb, var(--brand) 10%, transparent);
    }
    .profile-dropdown__divider {
      height: 1px;
      margin: 5px 0;
      background: var(--line);
    }
    .profile-dropdown .profile-level {
      display: grid;
      gap: 8px;
      margin-top: 8px;
      padding: 12px;
      border: 1px solid var(--line);
      background: color-mix(in srgb, var(--brand) 6%, transparent);
    }
    .profile-level__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
    }
    .profile-level__top span {
      color: var(--mute);
      font-variant-numeric: tabular-nums;
    }
    .profile-level__bar {
      display: block;
      height: 5px;
      border-radius: 3px;
      background: var(--line);
      overflow: hidden;
    }
    .profile-level__bar u {
      display: block;
      height: 100%;
      background: var(--brand);
      border-radius: 3px;
    }
    .profile-level small {
      color: var(--mute);
      font-size: 12px;
    }
    .profile-dropdown__empty {
      margin: 0;
      padding: 14px 10px 10px;
      color: var(--mute);
      font-size: 13px;
    }
  `;
  const profileMenuControl = `
    const memberAvatar=document.querySelector(".top .av")||document.querySelector(".av");
    if(!memberAvatar||!memberAvatar.parentNode){
      console.error("Dashboard profile menu could not find the avatar in the header.");
    }else{
      const profileControl=document.createElement("div");
      profileControl.className="profile-control";
      const profileTrigger=document.createElement("button");
      profileTrigger.type="button";
      profileTrigger.className="profile-trigger";
      profileTrigger.setAttribute("aria-label","Open profile menu");
      profileTrigger.setAttribute("aria-haspopup","menu");
      profileTrigger.setAttribute("aria-expanded","false");
      profileTrigger.title="Profile and account settings";
      memberAvatar.setAttribute("aria-hidden","true");
      memberAvatar.parentNode.insertBefore(profileControl,memberAvatar);
      profileControl.appendChild(profileTrigger);
      profileTrigger.appendChild(memberAvatar);

      const profileMenu=document.createElement("div");
      profileMenu.className="profile-dropdown";
      profileMenu.id="member-profile-menu";
      profileMenu.setAttribute("role","menu");
      profileMenu.hidden=true;
      profileMenu.innerHTML='<div class="profile-dropdown__view" data-profile-view="menu"><div class="profile-dropdown__identity"><span class="profile-dropdown__initial" aria-hidden="true">A</span><div><strong>Profile</strong><small>Manage your account</small></div></div><button type="button" role="menuitem" data-profile-action="profile">Profile</button><button type="button" role="menuitem" data-profile-action="notifications"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg><span>Notifications</span></button><button type="button" role="menuitem" data-profile-action="settings">Security &amp; verification</button><button type="button" role="menuitem" data-profile-action="statements">Statements and tax</button><button type="button" role="menuitem" data-profile-action="referral">Referral</button><div class="profile-dropdown__divider"></div><button type="button" role="menuitem" data-profile-action="signout">Sign out</button></div><div class="profile-dropdown__view" data-profile-view="notifications" hidden><button type="button" role="menuitem" data-profile-action="back"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6M9 12h11"/></svg><span>Back to profile menu</span></button><p class="profile-dropdown__empty">No new notifications.</p></div>';
      const profileInitial=profileMenu.querySelector(".profile-dropdown__initial");
      if(profileInitial&&memberAvatar.textContent.trim())profileInitial.textContent=memberAvatar.textContent.trim();
      const authProfile=window.__AUVRENTHIA_PROFILE__;
      if(authProfile){
        const fullName=[authProfile.first_name,authProfile.last_name].filter(Boolean).join(" ").trim();
        const displayName=fullName||authProfile.email||"Member";
        const identity=profileMenu.querySelector(".profile-dropdown__identity strong");
        const identityDetail=profileMenu.querySelector(".profile-dropdown__identity small");
        if(identity)identity.textContent=displayName;
        if(identityDetail)identityDetail.textContent=authProfile.email||"Signed-in account";
        memberAvatar.textContent=displayName.slice(0,1).toUpperCase();
        if(profileInitial)profileInitial.textContent=displayName.slice(0,1).toUpperCase();
      }
      profileControl.appendChild(profileMenu);
      const profileMenuView=profileMenu.querySelector('[data-profile-view="menu"]');
      const notificationsView=profileMenu.querySelector('[data-profile-view="notifications"]');
      const kycButton=document.createElement("button");
      kycButton.type="button";
      kycButton.setAttribute("role","menuitem");
      kycButton.dataset.profileAction="kyc";
      kycButton.textContent="Identity verification";
      const levelByStatus={none:1,pending:1,rejected:1,verified:2};
      const levelCount=levelByStatus[String(authProfile?.kyc_status||"none")]??0;
      const levelBox=document.createElement("button");
      levelBox.type="button";
      levelBox.className="profile-level";
      levelBox.setAttribute("role","menuitem");
      levelBox.dataset.profileAction="kyc-open";
      levelBox.setAttribute("aria-label","Verification level "+levelCount+" of 2. Open verification.");
      const levelTop=document.createElement("span");
      levelTop.className="profile-level__top";
      const levelLabel=document.createElement("b");
      levelLabel.textContent="Verification level";
      const levelValue=document.createElement("span");
      levelValue.textContent=levelCount+" of 2";
      levelTop.append(levelLabel,levelValue);
      const levelBar=document.createElement("i");
      levelBar.className="profile-level__bar";
      const levelFill=document.createElement("u");
      levelFill.style.width=Math.round(levelCount/2*100)+"%";
      levelBar.appendChild(levelFill);
      const levelNote=document.createElement("small");
      levelNote.textContent={none:"Not started",pending:"Under review",verified:"Verified",rejected:"Action required"}[String(authProfile?.kyc_status||"none")]||"Not started";
      levelBox.append(levelTop,levelBar,levelNote);
      profileMenuView.appendChild(levelBox);

      const kycView=document.createElement("div");
      kycView.className="profile-dropdown__view";
      kycView.dataset.profileView="kyc";
      kycView.hidden=true;
      const kycStates={
        none:{icon:"!",title:"Verification not started",detail:"No verification request has been submitted."},
        pending:{icon:"…",title:"Under review",detail:"Your verification submission is being reviewed."},
        verified:{icon:"✓",title:"Verified",detail:"Your identity verification is complete."},
        rejected:{icon:"!",title:"Action required",detail:"Contact support for next steps."}
      };
      const kycState=kycStates[String(authProfile?.kyc_status||"none")]||kycStates.none;
      const verificationPanel=document.querySelector('[data-testid="verification-progress"]');
      if(verificationPanel){
        const actionButton=verificationPanel.querySelector("button");
        const verificationTitle=document.createElement("b");
        verificationTitle.textContent="Identity verification · "+kycState.title;
        const verificationDetail=document.createElement("span");
        verificationDetail.textContent=kycState.detail;
        verificationPanel.replaceChildren(verificationTitle,verificationDetail);
        if(actionButton)verificationPanel.appendChild(actionButton);
      }
      const kycIdentity=document.createElement("div");
      kycIdentity.className="profile-dropdown__identity";
      const kycIcon=document.createElement("span");
      kycIcon.className="profile-dropdown__initial";
      kycIcon.setAttribute("aria-hidden","true");
      kycIcon.textContent=kycState.icon;
      const kycIdentityText=document.createElement("div");
      const kycTitle=document.createElement("strong");
      kycTitle.textContent=kycState.title;
      const kycSubtitle=document.createElement("small");
      kycSubtitle.textContent="Identity verification";
      kycIdentityText.append(kycTitle,kycSubtitle);
      kycIdentity.append(kycIcon,kycIdentityText);
      const kycDescription=document.createElement("p");
      kycDescription.className="profile-dropdown__empty";
      kycDescription.textContent=kycState.detail;
      kycView.append(kycIdentity,kycDescription);
      const kycOpenButton=document.createElement("button");
      kycOpenButton.type="button";
      kycOpenButton.setAttribute("role","menuitem");
      kycOpenButton.dataset.profileAction="kyc-open";
      kycOpenButton.textContent="Open verification section";
      const kycBackButton=document.createElement("button");
      kycBackButton.type="button";
      kycBackButton.setAttribute("role","menuitem");
      kycBackButton.dataset.profileAction="kyc-back";
      kycBackButton.textContent="Back to profile menu";
      kycView.append(kycOpenButton,kycBackButton);
      profileMenu.appendChild(kycView);
      const resetProfileMenuView=()=>{
        profileMenuView.hidden=false;
        notificationsView.hidden=true;
        kycView.hidden=true;
      };

      const setProfileMenuOpen=open=>{
        profileMenu.hidden=!open;
        profileTrigger.setAttribute("aria-expanded",String(open));
      };
      const toggleProfileMenu=()=>{
        const open=profileMenu.hidden;
        if(open)resetProfileMenuView();
        setProfileMenuOpen(open);
      };
      profileTrigger.setAttribute("aria-controls",profileMenu.id);
      profileTrigger.addEventListener("click",event=>{
        event.stopPropagation();
        toggleProfileMenu();
      });
      profileTrigger.addEventListener("keydown",event=>{
        if(event.key==="ArrowDown"){event.preventDefault();resetProfileMenuView();setProfileMenuOpen(true);profileMenu.querySelector('[data-profile-action="notifications"]')?.focus()}
      });
      profileMenu.addEventListener("click",event=>{
        const clickedElement=event.target instanceof Element?event.target:null;
        const action=clickedElement?.closest("[data-profile-action]");
        if(!action)return;
        event.stopPropagation();
        if(action.dataset.profileAction==="notifications"){
          profileMenuView.hidden=true;
          notificationsView.hidden=false;
          notificationsView.querySelector("button")?.focus();
          return;
        }
        if(action.dataset.profileAction==="back"){
          notificationsView.hidden=true;
          profileMenuView.hidden=false;
          profileMenu.querySelector('[data-profile-action="notifications"]')?.focus();
          return;
        }
        if(action.dataset.profileAction==="kyc"){
          profileMenuView.hidden=true;
          notificationsView.hidden=true;
          kycView.hidden=false;
          kycOpenButton.focus();
          return;
        }
        if(action.dataset.profileAction==="kyc-back"){
          kycView.hidden=true;
          profileMenuView.hidden=false;
          kycButton.focus();
          return;
        }
        if(action.dataset.profileAction==="kyc-open"){
          setProfileMenuOpen(false);
          document.querySelector('#nav .nav[data-p="Security and verification"]')?.click();
          return;
        }
        setProfileMenuOpen(false);
        if(action.dataset.profileAction==="signout"){
          window.parent.postMessage({type:"auvrenthia-member-logout"},"*");
          return;
        }
        const destinations={profile:"Profile",settings:"Security and verification",statements:"Statements and tax",referral:"Referral"};
        const destination=destinations[action.dataset.profileAction];
        if(destination)document.querySelector('#nav .nav[data-p="'+destination+'"]')?.click();
      });
      document.addEventListener("click",event=>{
        if(!profileControl.contains(event.target))setProfileMenuOpen(false);
      });
      document.addEventListener("keydown",event=>{
        if(event.key==="Escape"&&!profileMenu.hidden){setProfileMenuOpen(false);profileTrigger.focus()}
      });
    }
  `;
  // Lets scripts inside the iframe call the signed-in Supabase client through the host.
  // window.__AUVRENTHIA_INV__('load') | ('investInPlan', planId, amount, freq, months) | ...
  const investmentsBridge = `
    (function(){
      var waiting=new Map(),seq=0;
      window.addEventListener("message",function(e){
        if(e.source!==window.parent||!window.__AUVORIGINOK__(e))return;
        var m=e.data;
        if(!m||m.type!=="auvrenthia-inv-result")return;
        var w=waiting.get(m.id);
        if(!w)return;
        waiting.delete(m.id);
        if(m.ok)w.resolve(m.data);else w.reject(new Error(m.error||"The request failed."));
      });
      window.__AUVRENTHIA_INV__=function(op){
        var args=Array.prototype.slice.call(arguments,1);
        return new Promise(function(resolve,reject){
          var id="m"+(++seq)+"-"+Date.now();
          waiting.set(id,{resolve:resolve,reject:reject});
          window.parent.postMessage({type:"auvrenthia-inv-call",id:id,op:op,args:args},window.__AUVHOST__);
          setTimeout(function(){if(waiting.delete(id))reject(new Error("The request timed out. Try again."))},30000);
        });
      };
    })();
  `;

  const marketRequestBridge = `
    window.__AUVRENTHIA_MARKET_REQUEST__=function(payload){
      return new Promise((resolve,reject)=>{
        const requestId=typeof crypto!=="undefined"&&typeof crypto.randomUUID==="function"?crypto.randomUUID():String(Date.now())+"-"+String(Math.random()).slice(2);
        const finish=(handler,value)=>{window.clearTimeout(timeout);window.removeEventListener("message",onMessage);handler(value)};
        const onMessage=event=>{
          if(event.source!==window.parent)return;
          const response=event.data;
          if(response?.type!=="auvrenthia-market-response"||response.requestId!==requestId)return;
          if(response.ok)finish(resolve,response.data);
          else finish(reject,new Error(response.error||"Market data is temporarily unavailable."));
        };
        const timeout=window.setTimeout(()=>finish(reject,new Error("Market data request timed out.")),20000);
        window.addEventListener("message",onMessage);
        window.parent.postMessage({type:"auvrenthia-market-request",requestId,payload},"*");
      });
    };

    window.__AUVRENTHIA_HISTORY__=async function(category,symbol,days,display){
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      let lastError=null;
      for(let attempt=0;attempt<2;attempt++){
        try{
          const res=await window.__AUVRENTHIA_MARKET_REQUEST__({action:"history",category:category,symbol:symbol,days:days});
          if(res&&Array.isArray(res.candles)&&res.candles.length>0)return res.candles;
          lastError=new Error("No historical data returned");
        }catch(e){lastError=e}
        if(attempt===0)await wait(900);
      }
      if(category==="crypto"){
        try{
          const base=String(display||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
          const pair=base.endsWith("USDT")?base:base+"USDT";
          const d=Number(days)||7;
          const cfg=d<=1?["5m",288]:d<=7?["1h",168]:d<=30?["4h",180]:d<=90?["1d",90]:["1d",365];
          const res=await fetch("https://data-api.binance.vision/api/v3/klines?symbol="+pair+"&interval="+cfg[0]+"&limit="+cfg[1]);
          if(res.ok){
            const rows=await res.json();
            const out=Array.isArray(rows)?rows.map(k=>({time:Math.floor(k[0]/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4]})).filter(k=>k.close>0):[];
            if(out.length)return out;
          }
        }catch(e){}
      }
      throw lastError||new Error("No historical data returned");
    };
  `;
  const portfolioBalanceBridge = `
    window.__AUVRENTHIA_SYNC_PORTFOLIO__=function(balance,ledger){
      const current=Number(balance);
      if(!Number.isFinite(current))return;
      const now=Date.now();
      const rangeMs={"1D":86400000,"1W":604800000,"1M":2592000000,"1Y":31536000000};
      const cutoff=rg==="All"?0:now-(rangeMs[rg]||2592000000);
      const points=(Array.isArray(ledger)?ledger:[]).flatMap(row=>{
        const value=Number(row&&row.balance_after);
        const at=new Date(row&&row.created_at||"").getTime();
        return Number.isFinite(value)&&value>=0&&Number.isFinite(at)&&at>=cutoff
          ?[{at,value}]:[];
      }).sort((a,b)=>a.at-b.at);
      if(points.length)points.push({at:now,value:current});
      S=points.length?points.map(point=>point.value):[current];
      window.__AUVRENTHIA_PORTFOLIO_BALANCE__=current;
      total=current;
      drawChart();
    };
  `;
  const tradingViewMarketChart = `
    window.mktChart=function(k,sym){
      const rows=D[k]||[];
      const selected=rows.find(function(row){return row[0]===sym});
      const instrument=(MARKET_INSTRUMENTS[k]||[]).find(function(item){return item.symbol===sym});
      const host=document.querySelector("#tv");
      if(!selected||!host)return;
      const ticker=instrument&&instrument.ticker;
      if(!ticker){
        host.innerHTML='<p class="note">A TradingView chart is not available for this instrument.</p>';
        return;
      }
      document.querySelector("#chips").innerHTML=rows.map(function(row){
        return '<button class="'+(row[0]===sym?"on":"")+'" data-s="'+row[0]+'">'+row[0]+'</button>';
      }).join("");
      document.querySelector("#chips").onclick=function(event){
        const button=event.target.closest("button[data-s]");
        if(button)window.mktChart(k,button.dataset.s);
      };
      const price=Number(selected[2]);
      const change=Number(selected[3]);
      const header=document.querySelector("#ph");
      header.innerHTML="";
      const priceLabel=document.createElement("b");
      priceLabel.textContent=Number.isFinite(price)?(k==="Forex"?price.toFixed(4):fmt(price)):"—";
      const changeLabel=document.createElement("span");
      changeLabel.className=Number.isFinite(change)?(change>=0?"up":"dn"):"lbl";
      changeLabel.textContent=Number.isFinite(change)?(change>=0?"+":"−")+Math.abs(change).toFixed(1)+"%":"";
      const nameLabel=document.createElement("span");
      nameLabel.className="lbl";
      nameLabel.textContent=String(selected[1]||sym);
      header.append(priceLabel,changeLabel,nameLabel);
      document.querySelector("#tf").innerHTML="";
      host.style.minHeight="420px";
      const url=new URL("https://s.tradingview.com/widgetembed/");
      url.searchParams.set("symbol",ticker);
      url.searchParams.set("interval","D");
      url.searchParams.set("style","1");
      url.searchParams.set("theme",document.documentElement.dataset.theme==="dark"?"dark":"light");
      url.searchParams.set("timezone","Etc/UTC");
      url.searchParams.set("locale","en");
      url.searchParams.set("withdateranges","1");
      url.searchParams.set("hideideas","1");
      url.searchParams.set("hide_volume","0");
      url.searchParams.set("allow_symbol_change","0");
      url.searchParams.set("hidesidetoolbar","0");
      const frame=document.createElement("iframe");
      frame.title=String(selected[1]||sym)+" TradingView candlestick chart";
      frame.loading="lazy";
      frame.allowFullscreen=true;
      frame.referrerPolicy="strict-origin-when-cross-origin";
      frame.style.cssText="display:block;width:100%;height:420px;border:0";
      frame.src=url.toString();
      host.replaceChildren(frame);
      document.querySelector("#ohlc").textContent="Candlestick history provided by TradingView.";
    };
  `;
  const headerLogoControl = `
    const dashboardTitle=document.querySelector("#title");
    const syncHeaderLogo=()=>{
      if(!dashboardTitle||dashboardTitle.querySelector("[data-dashboard-brand]"))return;
      const logo=document.createElement("img");
      logo.src="/wealthhub/auvrenthia-mark.svg";
      logo.alt="Auvrenthia Markets";
      logo.className="dashboard-brand-mark";
      logo.setAttribute("data-dashboard-brand","");
      dashboardTitle.replaceChildren(logo);
      dashboardTitle.setAttribute("aria-label","Auvrenthia Markets dashboard");
    };
    syncHeaderLogo();
    new MutationObserver(syncHeaderLogo).observe(dashboardTitle,{childList:true});
  `;
  const kycStatusRenderer = String.raw`function renderKyc(){
    const profile=window.__AUVRENTHIA_PROFILE__||{};
    const states={
      none:{label:"Not started",detail:"No identity verification request has been submitted.",risk:"r2"},
      pending:{label:"Under review",detail:"Your verification submission is being reviewed.",risk:"r2"},
      verified:{label:"Verified",detail:"Your identity verification is complete.",risk:"r1"},
      rejected:{label:"Action required",detail:"Contact support for the next steps.",risk:"r3"}
    };
    const state=states[String(profile.kyc_status||"none")]||states.none;
    $("#misc").innerHTML='<div class="head"><div><div class="lbl">Account verification</div><div class="bal">Identity verification</div></div><span class="risk '+state.risk+'">'+state.label+'</span></div><div class="mp"><div class="mph"><div><h3>'+state.label+'</h3><small>'+state.detail+'</small></div></div><p class="note">Your identity status is read from your account. Contact support if you need to submit or update documents.</p></div>';
  }`;
  let html = harborDashboardHtml
    .replace(/function renderKyc\(\)\{[^\n]*\}/, kycStatusRenderer)
    .replace('<title>Harbor – Investing</title>', '<title>Auvrenthia Markets</title>')
    .replace(
      '["My plans","M3 17l6-6 4 4 8-8M15 7h6v6"],',
      '["My plans","M3 17l6-6 4 4 8-8M15 7h6v6"],["Signals","M4 18l4-6 4 3 4-8 4 5M4 21h16"],',
    )
    .replace(
      '["Security and verification","M12 3l8',
      '["Profile","M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],["Security and verification","M12 3l8',
    )
    .replaceAll('Sample only', 'Varies by network')
    .replaceAll('<span class="risk r1">Demo only</span>', '<span class="risk r1">${dep?"Manual review":"Coming soon"}</span>')
    .replaceAll('Available sample balance', 'Available balance')
    .replaceAll('This preview changes sample balance only; it does not submit a real transaction.', 'Blockchain transfers cannot be reversed.')
    .replaceAll('Recent demo activity', 'Recent withdrawals')
    .replaceAll('Recent demo requests', 'Recent deposit requests')
    .replaceAll('Submit demo withdrawal', 'Request withdrawal')
    .replaceAll('Demo request saved on this device', 'Deposit request submitted')
    .replaceAll('Start another demo request', 'Start another deposit')
    .replaceAll('Save demo request', 'Submit deposit request')
    .replaceAll('before saving your demo request', 'before submitting your deposit request')
    .replaceAll('saved with the local demo request', 'saved with your deposit request')
    .replaceAll('A quick view of what makes up your sample wallet.', 'A quick view of what makes up your wallet.')
    .replaceAll('Sample value', 'Value')
    .replaceAll('This preview has no real receiving address. Do not send funds. The next steps only demonstrate the flow.', 'Send only the exact asset on the exact network shown at the payment step.')
    .replaceAll('Only use the exact network selected here in a live account. No live address is available in this preview.', 'Only use the exact network selected here.')
    .replaceAll('Do not send funds. The screenshot is only previewed in this browser and will not be uploaded to the company or reviewed.', 'Attach a clear screenshot or slip of your transfer for review.')
    .replaceAll('Preview only', 'Pending review')
    .replaceAll('Verification · Tier 2 of 3', 'Identity verification')
    .replaceAll(
      'Tier 1 email and Tier 2 face checks are complete in this sample. Tier 3 requires a government ID showing your current address.',
      'Contact support to confirm your identity verification requirements.',
    )
    .replaceAll(
      'Rates are illustrative estimates, not guarantees. All plans here are samples.',
      'Plan options and projected returns are illustrative. Returns are not guaranteed.',
    )
    .replaceAll(
      'This is a sample, so no real money moved.',
      'No payment or transfer was initiated.',
    )
    .replaceAll(
      'Live. Demo speed: 1 second equals 1 day',
      'Illustrative plan activity · not live performance',
    )
    .replaceAll(
      'No investment plans in this preview yet.',
      'No investment plans are available yet.',
    )
    .replaceAll(
      'Live prices need a data connection, so sample prices are shown.',
      'Live market data is temporarily unavailable.',
    )
    .replaceAll(
      'sample address for the prototype',
      'payment details for your selected method',
    )
    .replaceAll('Confirm deposit (demo)', 'Submit deposit request')
    .replace(
      'Network fee (sample): ${fmt(FEE[a])}',
      'Network fee: Confirm the current fee with your network or provider.',
    )
    .replaceAll(
      'Other options connect a demo address in this prototype.',
      'Wallet connections are currently unavailable.',
    )
    .replaceAll('· sample headline', '· illustrative headline')
    .replace(
      'Live chart unavailable, showing sample candles ("+lerr+")',
      'Live chart data is temporarily unavailable.',
    )
    .replace(
      '<div class="logo">Harbor</div>',
      '<div class="logo"><img src="/wealthhub/auvrenthia-logo.svg" alt="Auvrenthia Markets" class="dashboard-brand-mark" /></div>',
    )
    .replace(
      /<button class="ic" aria-label="Notifications">[\s\S]*?<\/button>/,
      '',
    )
    .replace(
      /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/,
      '',
    )
    .replaceAll('#6D93FF', 'var(--brand)')
    .replaceAll(
      'rgba(109,147,255,.22)',
      'color-mix(in srgb,var(--brand) 22%,transparent)',
    )
    .replace(
      /function tickRender\(\)\{[\s\S]*?\}\nlet LIVE=/,
      'function tickRender(){const find=(rows,symbol)=>rows.find(row=>row[0]===symbol),items=[["BTC",find(D.Crypto,"BTC"),"crypto"],["ETH",find(D.Crypto,"ETH"),"crypto"],["EUR/USD",find(D.Forex,"EUR/USD"),"forex"],["USD/NGN",find(D.Forex,"USD/NGN"),"forex"],["Gold",find(D.Commodities,"XAU"),"metal"],["Silver",find(D.Commodities,"XAG"),"metal"]];const markup=items.map(([name,asset,kind])=>{const value=asset?asset[2]:null,change=asset&&Number.isFinite(asset[3])?asset[3]:null,price=value==null?"—":kind==="forex"?value.toFixed(4):kind==="crypto"&&Math.abs(value)<.01?"$"+value.toPrecision(4):fmt(value);return `<span>${name}<b>${price}</b><span class="${change===null?"":change>=0?"up":"dn"}">${change===null?"":(change>=0?"+":"−")+Math.abs(change).toFixed(2)+"%"}</span></span>`}).join("");const ticker=$("#tick");ticker.setAttribute("role","region");ticker.setAttribute("aria-label","Live market prices");ticker.setAttribute("aria-live","off");ticker.setAttribute("tabindex","0");ticker.innerHTML=`<div class="ticker-track"><div class="ticker-group">${markup}</div><div class="ticker-group" aria-hidden="true">${markup}</div></div>`}\nlet LIVE=',
    )
    .replace(
      /function lg\(t\)\{[\s\S]*?\nfunction renderRail/,
      'const MARKET_ICONS=Object.create(null),MARKET_STATUS=Object.create(null),MARKET_META=Object.create(null);\nfunction lg(t){const src=MARKET_ICONS[t]||(window.TV_LOGOS&&window.TV_LOGOS[t]);const badge=`<b class="lg" style="background:var(--brand);color:#fff">${String(t||"").replace(/[^A-Za-z0-9]/g,"").slice(0,3)}</b>`;if(src)return `<img class="lg" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fb="${badge.replace(/"/g,"&quot;")}" onerror="if(!this.dataset.t&&this.src.indexOf(\'--big.svg\')>0){this.dataset.t=1;this.src=this.src.replace(\'--big.svg\',\'.svg\')}else{this.outerHTML=this.dataset.fb}" style="background:#fff;object-fit:contain;border-radius:50%">`;return badge}\nfunction renderRail',
    )
    .replace(
      /async function loadCrypto\(\)\{[\s\S]*?\nfunction lg/,
      'async function loadCrypto(){await Promise.all([loadPublic("Stocks"),loadPublic("ETFs"),loadPublic("Crypto"),loadPublic("Forex"),loadPublic("Commodities")])}\nconst MARKET_ICONS=Object.create(null),MARKET_STATUS=Object.create(null),MARKET_META=Object.create(null);\nfunction lg',
    )
    .replace(
      /async function loadPublic\(\)\{[\s\S]*?\}\ntickRender\(\);/,
      `const MARKET_INSTRUMENTS={
        Stocks:[
          {symbol:"AAPL",ticker:"NASDAQ:AAPL",name:"Apple Inc."},
          {symbol:"MSFT",ticker:"NASDAQ:MSFT",name:"Microsoft"},
          {symbol:"NVDA",ticker:"NASDAQ:NVDA",name:"NVIDIA"},
          {symbol:"AMZN",ticker:"NASDAQ:AMZN",name:"Amazon"},
          {symbol:"TSLA",ticker:"NASDAQ:TSLA",name:"Tesla"}
        ],
        ETFs:[
          {symbol:"VOO",ticker:"AMEX:VOO",name:"Vanguard S&P 500 ETF"},
          {symbol:"QQQ",ticker:"NASDAQ:QQQ",name:"Invesco QQQ Trust"},
          {symbol:"VTI",ticker:"AMEX:VTI",name:"Vanguard Total Stock Market ETF"},
          {symbol:"SPY",ticker:"AMEX:SPY",name:"SPDR S&P 500 ETF"},
          {symbol:"IVV",ticker:"AMEX:IVV",name:"iShares Core S&P 500 ETF"}
        ],
        Crypto:[
          {symbol:"BTC",ticker:"BINANCE:BTCUSDT",name:"Bitcoin",id:"bitcoin"},
          {symbol:"ETH",ticker:"BINANCE:ETHUSDT",name:"Ethereum",id:"ethereum"},
          {symbol:"SOL",ticker:"BINANCE:SOLUSDT",name:"Solana",id:"solana"},
          {symbol:"BNB",ticker:"BINANCE:BNBUSDT",name:"BNB",id:"binancecoin"},
          {symbol:"XRP",ticker:"BINANCE:XRPUSDT",name:"XRP",id:"ripple"},
          {symbol:"DOGE",ticker:"BINANCE:DOGEUSDT",name:"Dogecoin",id:"dogecoin"},
          {symbol:"ADA",ticker:"BINANCE:ADAUSDT",name:"Cardano",id:"cardano"},
          {symbol:"TRX",ticker:"BINANCE:TRXUSDT",name:"TRON",id:"tron"},
          {symbol:"AVAX",ticker:"BINANCE:AVAXUSDT",name:"Avalanche",id:"avalanche-2"},
          {symbol:"LINK",ticker:"BINANCE:LINKUSDT",name:"Chainlink",id:"chainlink"}
        ],
        Forex:[
          {symbol:"EUR/USD",ticker:"FX_IDC:EURUSD",name:"Euro / US dollar"},
          {symbol:"GBP/USD",ticker:"FX_IDC:GBPUSD",name:"British pound / US dollar"},
          {symbol:"USD/JPY",ticker:"FX_IDC:USDJPY",name:"US dollar / Japanese yen"},
          {symbol:"AUD/USD",ticker:"FX_IDC:AUDUSD",name:"Australian dollar / US dollar"},
          {symbol:"USD/CAD",ticker:"FX_IDC:USDCAD",name:"US dollar / Canadian dollar"},
          {symbol:"USD/CHF",ticker:"FX_IDC:USDCHF",name:"US dollar / Swiss franc"},
          {symbol:"USD/CNY",ticker:"FX_IDC:USDCNY",name:"US dollar / Chinese yuan"},
          {symbol:"USD/NGN",ticker:"FX_IDC:USDNGN",name:"US dollar / Nigerian naira"}
        ],
        Commodities:[
          {symbol:"XAU",ticker:"COMEX:GC1!",name:"Gold futures"},
          {symbol:"XAG",ticker:"COMEX:SI1!",name:"Silver futures"},
          {symbol:"XPT",ticker:"NYMEX:PL1!",name:"Platinum futures"},
          {symbol:"XPD",ticker:"NYMEX:PA1!",name:"Palladium futures"}
        ]
      };
      const MARKET_SCANNERS={Stocks:"america",ETFs:"america",Crypto:"crypto",Forex:"forex",Commodities:"futures"};
      const MARKET_CACHE=Object.create(null);
      const MARKET_IN_FLIGHT=Object.create(null);
      async function loadPublic(category){
        const existingRequest=MARKET_IN_FLIGHT[category];
        if(existingRequest)return existingRequest;
        const request=(async()=>{
        const instruments=MARKET_INSTRUMENTS[category];
        if(!instruments)return;
        const cached=MARKET_CACHE[category];
        if(cached&&Date.now()-cached.updatedAt<30000){
          D[category]=cached.rows;
          MARKET_META[category]=cached.meta;
          MARKET_STATUS[category]=cached.status;
          if(category==="Crypto")LIVE={ok:true,msg:cached.status};
          tickRender();renderRail();renderList();if(page===category)renderMkt(category);
          return;
        }
        MARKET_STATUS[category]="Loading live TradingView quotes…";
        try{
          const response=await fetch("https://scanner.tradingview.com/"+MARKET_SCANNERS[category]+"/scan",{
            method:"POST",
            headers:{"Content-Type":"text/plain;charset=UTF-8","Accept":"application/json"},
            body:JSON.stringify({
              symbols:{tickers:instruments.map(item=>item.ticker),query:{types:[]}},
              columns:["name","close","change","change_abs","volume","open","high","low","currency","description","logoid","base_currency_logoid"]
            })
          });
          if(!response.ok)throw new Error("TradingView returned HTTP "+response.status);
          const payload=await response.json();
          const quotes=Array.isArray(payload.data)?payload.data:[];
          const bySymbol=new Map(quotes.filter(row=>row&&typeof row.s==="string").map(row=>[row.s,row.d]));
          const numberOrNull=value=>typeof value==="number"&&Number.isFinite(value)?value:null;
          const clean=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;");
          const safeLogoId=value=>typeof value==="string"&&value.length>0&&value.length<120&&value.split("").every(ch=>"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-./".includes(ch));
          const rows=instruments.flatMap(instrument=>{
            const quote=bySymbol.get(instrument.ticker);
            if(!Array.isArray(quote)||typeof quote[1]!=="number"||!Number.isFinite(quote[1]))return [];
            const logoId=safeLogoId(quote[10])?quote[10]:safeLogoId(quote[11])?quote[11]:null;
            if(logoId)MARKET_ICONS[instrument.symbol]="https://s3-symbol-logo.tradingview.com/"+logoId+"--big.svg";
            return [[
              clean(instrument.symbol),
              clean(instrument.name),
              quote[1],
              numberOrNull(quote[2]),
              [],
              instrument.id||null,
              numberOrNull(quote[5]),
              numberOrNull(quote[6]),
              numberOrNull(quote[7]),
              numberOrNull(quote[3]),
              numberOrNull(quote[4]),
              typeof quote[8]==="string"?clean(quote[8]):null
            ]];
          });
          if(!rows.length)throw new Error("TradingView returned no quotes for "+category);
          const fetchedAt=new Date().toISOString();
          const meta={source:"TradingView",asOf:fetchedAt,stale:false};
          const status="TradingView · updated "+new Date(fetchedAt).toLocaleString();
          D[category]=rows;
          MARKET_META[category]=meta;
          MARKET_STATUS[category]=status;
          MARKET_CACHE[category]={rows,meta,status,updatedAt:Date.now()};
          if(category==="Crypto")LIVE={ok:true,msg:status};
        }catch(error){
          D[category]=[];
          MARKET_META[category]=null;
          MARKET_STATUS[category]="TradingView quotes are temporarily unavailable.";
          if(category==="Crypto")LIVE={ok:false,msg:MARKET_STATUS[category]};
        }
        tickRender();renderRail();renderList();if(page===category)renderMkt(category);
        })();
        MARKET_IN_FLIGHT[category]=request;
        try{await request}finally{if(MARKET_IN_FLIGHT[category]===request)delete MARKET_IN_FLIGHT[category]}
      }
      tickRender();`,
    )
    .replace(
      'if(!hasPageContent)return;',
      "if(!hasPageContent){console.error('Dashboard section is missing a handler.',nextPage);page=nextPage;document.getElementById('title').textContent=nextPage;document.querySelectorAll('.nav').forEach(button=>button.classList.toggle('on',button.dataset.p===nextPage));document.getElementById('dash').hidden=true;document.getElementById('plans').hidden=true;document.getElementById('mkt').hidden=true;const section=document.getElementById('misc');if(section){section.hidden=false;section.innerHTML='<div class=\"mp\"><p class=\"note\">This section could not load. Refresh and try again.</p></div>';}return;}",
    )
    .replace(
      'if(ism)renderMkt(page);if(ms)',
      'if(ism){renderMkt(page);if(["Stocks","ETFs","Crypto","Forex","Commodities"].includes(page))loadPublic(page)}if(ms)',
    )
    .replace(
      '$("#tabs").onclick=e=>{if(e.target.dataset.t){tab=e.target.dataset.t;renderList()}};',
      '$("#tabs").onclick=e=>{if(e.target.dataset.t){tab=e.target.dataset.t;renderList();if(["Stocks","ETFs","Crypto","Forex","Commodities"].includes(tab))loadPublic(tab)}};',
    )
    .replace(
      'const LV=!!D[k][0][5],TT=LV?LDS:TFS;',
      'const LV=true,TT=LDS;',
    )
    .replace(
      'function setBal(i){if(S.length<2){$("#bal").textContent=total>0?fmt(total):"—";const c=$("#chg");c.className="chg";c.textContent="Portfolio history will appear here when account data is recorded.";return}',
      'function setBal(i){if(S.length<2){$("#bal").textContent=Number.isFinite(total)?fmt(total):"—";const c=$("#chg");c.className="chg";c.textContent="No balance activity in this period.";return}',
    )
    .replace(
      'if(S.length<2){el.innerHTML=\'<text class="chart-empty" x="16" y="36">Portfolio history will appear here when account data is recorded.</text>\';setBal(0);return}',
      'if(S.length<2){const color=getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();el.innerHTML=\'<circle cx="50%" cy="50%" r="5" fill="\'+color+\'"/><text class="chart-empty" x="16" y="36">No balance activity in this period.</text>\';setBal(0);return}',
    )
    .replace(
      'total=H+pv+c;drawMix();',
      'total=Number.isFinite(window.__AUVRENTHIA_PORTFOLIO_BALANCE__)?window.__AUVRENTHIA_PORTFOLIO_BALANCE__:H+pv+c;drawMix();',
    )
    .replace(
      'let live=null,lerr=null;if(D[k][0][5]){try{live=await liveCandles(D[k].find(r=>r[0]===sym)[5],LD)}catch(e){lerr=e&&e.code||"error"}if(tok!==TOK)return}',
      'let live=null,lerr=null;try{const symbol=(D[k].find(r=>r[0]===sym)||[])[5]||sym.replace("/","-");const category={"Stocks":"stocks","ETFs":"etfs","Crypto":"crypto","Forex":"forex","Commodities":"commodities"}[k];live=await window.__AUVRENTHIA_HISTORY__(category,symbol,LD,sym)}catch(e){lerr=e&&e.message||"error"}if(tok!==TOK)return',
    )
    .replace(
      'const up=css("--up"),dn=css("--dn"),d=live||cd(p,sym.length*977+sym.charCodeAt(0),TF,140);',
      'const up=css("--up"),dn=css("--dn"),d=live||[];if(!d.length){el.innerHTML=\'<p class="note">Live chart data is currently unavailable for this asset. <button class="btn alt" type="button">Retry</button></p>\';const rb=el.querySelector("button");if(rb)rb.onclick=()=>mktChart(k,sym);$("#ohlc").textContent="";return}',
    )
    .replace(
      'path(r[4]||series(i*13+t.length*7,30,c/8),100,30,3)',
      'r[4]&&r[4].length?path(r[4],100,30,3):""',
    )
    .replace(
      'tickRender();renderRail();renderList();drawChart();loadCrypto();',
      'D.Stocks=[];D.ETFs=[];D.Crypto=[];D.Forex=[];D.Commodities=[];D.Agriculture=[];D.Bonds=[];D["Real estate"]=[];MARKET_STATUS.Agriculture="Live market data is not configured for this category.";MARKET_STATUS.Bonds="Live market data is not configured for this category.";MARKET_STATUS["Real estate"]="Live market data is not configured for this category.";tickRender();renderRail();renderList();drawChart();loadCrypto();',
    )
    .replace(
      'const rows=[D.Crypto[0],D.Stocks[1],D.Crypto[1],D.Stocks[0],D.Commodities[0]];',
      'const rows=[D.Crypto[0],D.Stocks[1],D.Crypto[1],D.Stocks[0],D.Commodities[0]].filter(Boolean);',
    )
    .replace(
      'else{const o=[...rows].sort((a,b)=>b[3]-a[3]),g=o[0],l=o[o.length-1],f=x=>(x<0?"−":"+")+Math.abs(x).toFixed(1)+"%";s1=["Top gainer today",g[0],f(g[3]),g[3]>=0?"up":"dn"];s2=["Weakest today",l[0],f(l[3]),l[3]>=0?"up":"dn"]}',
      'else if(rows.some(r=>Number.isFinite(r[3]))){const o=[...rows].sort((a,b)=>b[3]-a[3]),g=o[0],l=o[o.length-1],f=x=>(x<0?"−":"+")+Math.abs(x).toFixed(1)+"%";s1=["Top gainer today",g[0],f(g[3]),g[3]>=0?"up":"dn"];s2=["Weakest today",l[0],f(l[3]),l[3]>=0?"up":"dn"]}else{const meta=MARKET_META[k];s1=["Price source",meta?meta.source:"Public market feed","",""];s2=["Updated",meta&&meta.asOf?new Date(meta.asOf).toLocaleString():"—","",""]}',
    )
    .replace(
      'const rows=D[k],yl=k==="Real estate"||k==="Bonds",hold=CL[k][2];let s1,s2;',
      'const rows=D[k];if(!rows.length){$("#mkt").innerHTML=`<div class="head"><div><div class="lbl">${INFO[k][0]}</div><div class="bal" style="font-size:clamp(34px,6vw,56px)">${k}</div></div></div><p class="note">${MARKET_STATUS[k]||"Loading live market data…"}</p>`;return}const yl=k==="Real estate"||k==="Bonds",hold=CL[k][2];let s1,s2;',
    )
    .replace(
      '${INFO[k][1]}${k==="Crypto"?" "+(LIVE.ok?"Prices are live from CoinGecko.":LIVE.msg):""}',
      '${INFO[k][1]}${["Stocks","ETFs","Crypto","Forex","Commodities"].includes(k)?" "+(MARKET_STATUS[k]||"Loading live market data…"):""}',
    )
    .replace(
      'const k=c>=0?"up":"dn",col=c>=0?"var(--up)":"var(--dn)";',
      'const validChange=Number.isFinite(c),k=validChange?(c>=0?"up":"dn"):"",col=validChange?(c>=0?"var(--up)":"var(--dn)"):"var(--mute)";',
    )
    .replace(
      '<div class="r">${tab==="Forex"?p.toFixed(4):fmt(p)}</div><div class="r ${k}">${c>=0?"+":"−"}${Math.abs(c).toFixed(1)}%</div>',
      '<div class="r">${tab==="Forex"?p.toFixed(4):tab==="Crypto"&&Math.abs(p)<.01?"$"+p.toPrecision(4):fmt(p)}</div><div class="r ${k}">${Number.isFinite(c)?(c>=0?"+":"−")+Math.abs(c).toFixed(1)+"%":"—"}</div>',
    )
    .replace(
      'ST.wallet=(await window.ethereum.request({method:"eth_requestAccounts"}))[0]',
      'throw new Error("Wallet connections are currently unavailable.")',
    )
    .replace(
      'let ST={cash0:2400,plans:[],tx:[],wallet:null,depositRequests:[]}',
      'let ST=window.__AUVRENTHIA_DASHBOARD_STATE__||{cash0:0,plans:[],tx:[],wallet:null,depositRequests:[]}',
    )
    .replace(
      'try{const s=JSON.parse(localStorage.getItem("harbor")||"null");if(s&&s.plans)ST=s}catch(e){}',
      '',
    )
    .replace(
      'const save=()=>{try{localStorage.setItem("harbor",JSON.stringify(ST))}catch(e){}};',
      'const save=()=>{window.parent.postMessage({type:"auvrenthia-member-state-update",state:ST},window.__AUVHOST__)};',
    )
    .replace(
      'window.parent.postMessage({type:"auvrenthia-member-logout"},"*");',
      'window.parent.postMessage({type:"auvrenthia-member-logout"},"*");',
    )
    .replace(
      '</head>',
      () => `<script>window.__AUVHOST__=(window.origin&&window.origin!=="null")?window.origin:"*";window.__AUVORIGINOK__=function(e){return window.__AUVHOST__==="*"||e.origin===window.__AUVHOST__};</script><script>window.__AUVRENTHIA_DASHBOARD_STATE__=${serializeInlineScript(initialState)};window.__AUVRENTHIA_DEPOSIT_METHODS__=${serializeInlineScript(depositMethods)};window.__AUVRENTHIA_PROFILE__=${serializeInlineScript(profile)};</script><script>${marketRequestBridge}</script><script>${portfolioBalanceBridge}</script><script>${investmentsBridge}</script><style>${wealthHubTypography}</style></head>`,
    )
    .replace(
      '</body>',
      () => `<script>${tradingViewMarketChart}try{${profileMenuControl}}catch(error){console.error("Profile menu initialization failed.",error);}try{${headerLogoControl}}catch(error){console.error("Dashboard header initialization failed.",error);}try{(${installMemberDepositMethods.toString()})();}catch(error){console.error("Dashboard action initialization failed.",error);}try{(${installMemberDashboardTools.toString()})();}catch(error){console.error("Dashboard navigation initialization failed.",error);}</script></body>`,
    );

  const requiredTransforms = [
    'window.__AUVRENTHIA_DASHBOARD_STATE__=',
    'window.__AUVRENTHIA_SYNC_PORTFOLIO__=',
    'window.mktChart=function(k,sym)',
    'No balance activity in this period.',
    'D.Agriculture=[];D.Bonds=[];D["Real estate"]=[];',
    'MARKET_IN_FLIGHT[category]',
    'profileTrigger.addEventListener("click"',
    'Dashboard section is missing a handler.',
    'Dashboard navigation initialization failed.',
  ];
  const missingTransforms = requiredTransforms.filter(
    (marker) => !html.includes(marker),
  );
  if (missingTransforms.length > 0) {
    throw new Error(
      `Dashboard source integration is incomplete: ${missingTransforms.join(', ')}`,
    );
  }
  const staleVerificationCopy = [
    'Tier 2 of 3 · sample',
    'Complete · sample',
    'Pending · sample',
  ].find((copy) => html.includes(copy));
  if (staleVerificationCopy) {
    throw new Error('Sample verification statuses cannot be rendered.');
  }

  const darkMode = document.documentElement.classList.contains('dark');
  html = html.replace(
    '<html lang="en">',
    `<html lang="en" data-theme="${darkMode ? 'dark' : 'light'}">`,
  );
  return html;
}

export default function DashboardPage({
  onLogout,
  onSignOutEverywhere,
  profile,
  userId,
}: DashboardPageProps) {
  const { changePassword } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameDocumentRef = useRef<Document | null>(null);
  const frameLogoutHandlerRef = useRef<((event: MouseEvent) => void) | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [dashboardState, setDashboardState] =
    useState<MemberDashboardState>(EMPTY_DASHBOARD_STATE);
  const [depositMethods, setDepositMethods] = useState<MemberDepositMethod[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const sourceDocument = useMemo(
    () => buildDashboardDocument(dashboardState, depositMethods, profile),
    [dashboardState, depositMethods, profile],
  );
  const handleFrameLoad = () => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;

    if (frameDocumentRef.current && frameLogoutHandlerRef.current) {
      frameDocumentRef.current.removeEventListener(
        'click',
        frameLogoutHandlerRef.current,
        true,
      );
    }

    const interceptLogout = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      if (
        !target.closest('[data-profile-action="signout"], [data-a="logout"]')
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void onLogout();
    };

    frameDocument.addEventListener('click', interceptLogout, true);
    frameDocumentRef.current = frameDocument;
    frameLogoutHandlerRef.current = interceptLogout;
  };

  useEffect(() => {
    let active = true;
    async function loadDashboardData() {
      if (!supabase) {
        setLoadError('Account services are temporarily unavailable. Please try again later.');
        setReady(true);
        return;
      }
      const client = supabase;

      const [stateResult, methodsResult] = await Promise.all([
        supabase
          .from('member_dashboard_state')
          .select('data')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('deposit_methods')
          .select(
            'id,asset,network,address,qr_data_url,qr_storage_path,is_active',
          )
          .eq('is_active', true)
          .order('asset'),
      ]);
      if (!active) return;

      if (stateResult.error || methodsResult.error) {
        setLoadError(
          'We could not load your dashboard. Please refresh or contact support if this continues.',
        );
        setReady(true);
        return;
      }

      const savedState =
        stateResult.data?.data && typeof stateResult.data.data === 'object'
          ? (stateResult.data.data as Partial<MemberDashboardState>)
          : {};
      setDashboardState({
        ...EMPTY_DASHBOARD_STATE,
        ...savedState,
        cash0: Number(profile.demo_balance) || 0,
        plans: Array.isArray(savedState.plans) ? savedState.plans : [],
        tx: Array.isArray(savedState.tx) ? savedState.tx : [],
        depositRequests: Array.isArray(savedState.depositRequests)
          ? savedState.depositRequests
          : [],
        watchlist: Array.isArray(savedState.watchlist)
          ? savedState.watchlist
          : [],
        priceAlerts: Array.isArray(savedState.priceAlerts)
          ? savedState.priceAlerts
          : [],
      });
      const resolvedMethods = await Promise.all(
        (methodsResult.data || []).map(async (method) => {
          let qrDataUrl = method.qr_data_url || undefined;
          if (method.qr_storage_path) {
            const { data, error } = await client.storage
              .from(supabaseImageBucket)
              .createSignedUrl(method.qr_storage_path, 60 * 60);
            if (error) throw error;
            qrDataUrl = data.signedUrl;
          }
          return {
            id: method.id,
            asset: method.asset,
            network: method.network,
            address: method.address,
            qrDataUrl,
          };
        }),
      );
      if (!active) return;
      setDepositMethods(resolvedMethods);
      setLoadError('');
      setReady(true);
    }

    void loadDashboardData().catch((error: unknown) => {
      if (active) {
        console.error('Member dashboard data could not be loaded.', error);
        setLoadError('We could not load your dashboard. Please try again.');
        setReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [profile.demo_balance, userId]);

  useLayoutEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== window.location.origin
      ) {
        return;
      }

      // Trading panel: Buy / Sell go to place_order, which fills at the platform price.
      if (
        event.data?.type === 'auvrenthia-trade-request' &&
        typeof event.data.requestId === 'string'
      ) {
        const requestId = event.data.requestId as string;
        const reply = (ok: boolean, error?: string) => {
          frameRef.current?.contentWindow?.postMessage(
            { type: 'auvrenthia-trade-response', requestId, ok, error },
            window.location.origin,
          );
        };
        const symbol = event.data.symbol;
        const side = event.data.side;
        const qty = Number(event.data.qty);
        if (
          requestId.length > 100 ||
          typeof symbol !== 'string' ||
          !/^[A-Za-z0-9./:_-]{1,20}$/.test(symbol) ||
          (side !== 'buy' && side !== 'sell') ||
          !Number.isFinite(qty) ||
          qty <= 0 ||
          qty > 1_000_000_000
        ) {
          reply(false, 'That order could not be understood.');
          return;
        }
        if (!supabase) {
          reply(false, 'Your session has expired. Sign in again.');
          return;
        }
        void memberInvestments
          .placeOrder(supabase, symbol, side, qty)
          .then(() => reply(true))
          .catch((error: unknown) =>
            reply(
              false,
              error instanceof Error
                ? error.message
                : 'The order could not be placed. Please try again.',
            ),
          );
        return;
      }

      // Member money actions (plans, withdrawals, signals, loans, balance, history).
      if (
        handleInvestmentsMessage(
          event,
          frameRef.current,
          supabase,
          buildMemberOps(userId),
        )
      ) {
        return;
      }

      if (event.data?.type === 'auvrenthia-profile-request') {
        const requestId = event.data.requestId;
        if (typeof requestId !== 'string' || requestId.length > 100) return;
        const reply = (ok: boolean, message: string, extra: Record<string, unknown> = {}) => {
          frameRef.current?.contentWindow?.postMessage(
            { type: 'auvrenthia-profile-response', requestId, ok, message, ...extra },
            window.location.origin,
          );
        };
        if (!supabase) {
          reply(false, 'Account services are temporarily unavailable.');
          return;
        }
        void runProfileRequest(supabase, userId, supabaseImageBucket, event.data)
          .then((result) =>
            reply(true, result.message, { profile: result.profile, avatarUrl: result.avatarUrl, kyc: result.kyc, tickets: result.tickets, announcements: result.announcements, referral: result.referral }),
          )
          .catch((error: unknown) =>
            reply(false, error instanceof Error ? error.message : 'The request failed. Please try again.'),
          );
        return;
      }

      if (event.data?.type === 'auvrenthia-profile-auth-request') {
        const requestId = event.data.requestId;
        const action = event.data.action;
        if (
          typeof requestId !== 'string' ||
          requestId.length > 100 ||
          typeof action !== 'string'
        ) {
          return;
        }
        const respond = (ok: boolean, message: string) => {
          frameRef.current?.contentWindow?.postMessage(
            {
              type: 'auvrenthia-profile-auth-response',
              requestId,
              ok,
              message,
            },
            window.location.origin,
          );
        };

        if (action === 'change-password') {
          const password = event.data.password;
          if (
            typeof password !== 'string' ||
            password.length < 8 ||
            password.length > 72
          ) {
            respond(false, 'Use a password between 8 and 72 characters.');
            return;
          }
          void changePassword(password)
            .then(() => respond(true, 'Password changed successfully.'))
            .catch((error: unknown) =>
              respond(
                false,
                error instanceof Error
                  ? error.message
                  : 'The password could not be changed. Please try again.',
              ),
            );
          return;
        }

        if (action === 'sign-out-all-devices') {
          void onSignOutEverywhere()
            .then(() => respond(true, 'You have been signed out on all devices.'))
            .catch((error: unknown) =>
              respond(
                false,
                error instanceof Error
                  ? error.message
                  : 'Sign-out failed. Your sessions are still active.',
              ),
            );
          return;
        }

        respond(false, 'That account action is not supported.');
        return;
      }

      if (
        event.data?.type === 'auvrenthia-market-request' &&
        typeof event.data.requestId === 'string' &&
        event.data.payload &&
        typeof event.data.payload === 'object'
      ) {
        const requestId = event.data.requestId as string;
        const respond = (ok: boolean, data?: unknown, error?: string) => {
          frameRef.current?.contentWindow?.postMessage(
            {
              type: 'auvrenthia-market-response',
              requestId,
              ok,
              data,
              error,
            },
            '*',
          );
        };

        const client = supabase;
        if (!client) {
          respond(
            false,
            undefined,
            supabaseConfigured
              ? 'Your session has expired. Sign in again.'
              : 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your deployment environment.',
          );
          return;
        }
        void client.functions
          .invoke('market-data', {
            body: event.data.payload as Record<string, string | number>,
          })
          .then(({ data, error }) => {
            if (error) {
              respond(false, undefined, error.message);
              return;
            }
            respond(true, data);
          })
          .catch((error: unknown) => {
            respond(
              false,
              undefined,
              error instanceof Error
                ? error.message
                : 'Market data is temporarily unavailable.',
            );
          });
      } else if (
        event.data?.type === 'auvrenthia-member-deposit-submit'
      ) {
        const client = supabase;
        const proof = event.data.proof;
        const deposit = event.data.deposit as
          | Record<string, unknown>
          | undefined;
        const method = depositMethods.find(
          (candidate) => candidate.id === deposit?.methodId,
        );
        const amount = Number(deposit?.amount);
        const respond = (ok: boolean, message?: string, request?: unknown) => {
          frameRef.current?.contentWindow?.postMessage(
            {
              type: 'auvrenthia-member-deposit-submit-result',
              ok,
              message,
              request,
            },
            window.location.origin,
          );
        };
        if (!client || !(proof instanceof File) || !method) {
          respond(
            false,
            'We could not submit your request. Please check the details and try again.',
          );
          return;
        }
        if (
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 1_000_000_000_000 ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(proof.type) ||
          proof.size === 0 ||
          proof.size > 8 * 1024 * 1024
        ) {
          respond(false, 'Check the amount and attach an image under 8 MB.');
          return;
        }
        const requestId = crypto.randomUUID();
        const extension =
          proof.type === 'image/png'
            ? 'png'
            : proof.type === 'image/webp'
              ? 'webp'
              : 'jpg';
        const receiptPath = `deposit-proofs/${userId}/${requestId}.${extension}`;
        void (async () => {
          try {
            const { data: activeMethod, error: methodError } = await client
              .from('deposit_methods')
              .select('id,asset,network')
              .eq('id', method.id)
              .eq('is_active', true)
              .maybeSingle();
            if (methodError) throw methodError;
            if (!activeMethod) {
              throw new Error(
                'That deposit method is no longer active. Refresh and choose another.',
              );
            }
            const { error } = await client.storage
              .from(supabaseImageBucket)
              .upload(receiptPath, proof, {
                cacheControl: '3600',
                contentType: proof.type,
                upsert: false,
              });
            if (error) throw error;
            const estimatedUsd = Number(deposit?.estimatedUsd);
            // Real deposits table (what the admin console approves), not the JSON state.
            const depositId = await memberInvestments.requestDeposit(
              client,
              activeMethod.id,
              amount,
              Number.isFinite(estimatedUsd) && estimatedUsd >= 0
                ? estimatedUsd
                : null,
              receiptPath,
            );
            const request = {
              id: String(depositId),
              methodId: activeMethod.id,
              a: activeMethod.asset,
              net: activeMethod.network,
              amt: amount,
              usd:
                Number.isFinite(estimatedUsd) && estimatedUsd >= 0
                  ? estimatedUsd
                  : 0,
              t: Date.now(),
              status: 'pending',
              note: '',
              receiptPath,
              receiptName:
                typeof deposit?.receiptName === 'string'
                  ? deposit.receiptName.slice(0, 255)
                  : 'payment-receipt',
              server: true,
            };
            respond(true, undefined, request);
          } catch (error: unknown) {
            const message =
              error instanceof Error
                ? error.message
                : 'The receipt could not be uploaded.';
            setSaveError('Deposit receipt upload failed.');
            console.error('Supabase deposit receipt upload failed.', error);
            respond(
              false,
              `${message} Check the private Images bucket policies.`,
            );
          }
        })();
      } else if (
        event.data?.type === 'auvrenthia-member-state-update' &&
        event.data.state &&
        typeof event.data.state === 'object'
      ) {
        const nextState = event.data.state as MemberDashboardState;
        if (
          !Array.isArray(nextState.plans) ||
          !Array.isArray(nextState.tx) ||
          !Array.isArray(nextState.depositRequests) ||
          !Array.isArray(nextState.watchlist) ||
          !Array.isArray(nextState.priceAlerts)
        ) {
          return;
        }
        setSaveError('');
        const client = supabase;
        if (!client) return;
        // Deposits live in the deposits table now; keep them out of the JSON state.
        const persistedRequests = nextState.depositRequests.filter(
          (request) => !(request as { server?: boolean })?.server,
        );
        void (async () => {
          try {
            const { error } = await client
              .from('member_dashboard_state')
              .upsert(
                {
                  user_id: userId,
                  data: {
                    ...nextState,
                    depositRequests: persistedRequests,
                    cash0: Number(profile.demo_balance) || 0,
                  },
                },
                { onConflict: 'user_id' },
              );
            if (error) {
              throw error;
            }
          } catch (error: unknown) {
          setSaveError('Your dashboard changes could not be saved. Please try again.');
            console.error('Supabase dashboard-state save failed.', error);
          }
        })();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    changePassword,
    depositMethods,
    onLogout,
    onSignOutEverywhere,
    profile.demo_balance,
    userId,
  ]);

  if (loadError) {
    return (
      <main className="member-dashboard-source">
        <section role="alert" className="dashboard-data-error">
          <h1>Dashboard unavailable</h1>
          <p>{loadError}</p>
        </section>
      </main>
    );
  }
  if (!ready) {
    return <SessionLoading />;
  }
  return (
    <main className="member-dashboard-source">
      {saveError && <p className="dashboard-sync-error" role="alert">{saveError}</p>}
      <iframe
        ref={frameRef}
        className="member-dashboard-frame"
        title="Auvrenthia Markets member dashboard"
        srcDoc={sourceDocument}
        onLoad={handleFrameLoad}
      />
    </main>
  );
}
