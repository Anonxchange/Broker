import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import harborDashboardHtml from '@assets/Harbor_–_Investing_(1)_1792836967110.html?raw';
import {
  serializeInlineScript,
  supabase,
  supabaseConfigured,
  supabaseImageBucket,
  type AppProfile,
} from '../lib/supabase';
import { SessionLoading } from '@/components/session-loading';
import { installMemberDashboardTools } from './member-dashboard-tools';
import './dashboard-page.css';

type DashboardPageProps = {
  onLogout: () => Promise<void>;
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

function installMemberDepositMethods() {
  const browserWindow = window as typeof window & {
    depositGuide?: () => string;
    depositChoose?: () => string;
    depositProof?: () => string;
    depositComplete?: () => string;
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
        window.location.origin,
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
          .map((method) => {
            const qr = method.qrDataUrl
              ? `<img src="${escapeHtml(method.qrDataUrl)}" alt="QR code for ${escapeHtml(method.asset)} on ${escapeHtml(method.network)}" style="width:104px;height:104px;object-fit:contain;border-radius:10px;background:#fff;padding:6px">`
              : "";
            return `<div class="deposit-guide-card"><h3>${escapeHtml(method.asset)} · ${escapeHtml(method.network)}</h3><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${qr}<code style="display:block;max-width:100%;overflow-wrap:anywhere;user-select:all">${escapeHtml(method.address)}</code></div></div>`;
          })
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
    return `<div class="deposit-shell">${depositProgress("guide")}<div class="deposit-guide-grid"><div class="deposit-guide-card"><h3>1. Choose a payment method</h3><p>Use an active destination listed below. Confirm the asset and network before paying.</p></div><div class="deposit-guide-card"><h3>2. Send your payment</h3><p>Check the address carefully. Transfers may be irreversible; never guess or reuse a destination.</p></div><div class="deposit-guide-card"><h3>3. Submit your receipt</h3><p>Attach a screenshot or payment slip. Staff will review the request; submitting proof does not automatically credit funds.</p></div></div><h2 class="sec">Available deposit methods</h2><div class="deposit-guide-grid">${methodCards}</div><div class="deposit-actions"><button class="btn" id="deposit-start"${methods.length ? "" : " disabled"}>Start deposit request</button></div>${recent ? `<h2 class="sec">Recent deposit requests</h2>${recent}` : ""}</div>`;
  };

  browserWindow.depositChoose = function depositChooseWithAdminMethods() {
    const methods = readDepositMethods();
    const assets = Array.from(
      new Map(
        methods.map((method) => [method.asset.trim().toLowerCase(), method.asset]),
      ).values(),
    );
    if (assets.length === 0) {
      return `<div class="deposit-shell">${depositProgress("choose")}<div class="mp"><div class="mph"><div><h3>No deposit methods available</h3><small>An administrator has not configured a deposit destination yet.</small></div></div><div class="deposit-callout"><strong>No payment destination</strong><p>Contact support before sending a payment. An administrator must add an active method first.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button></div></div></div>`;
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
    const qr = selected?.qrDataUrl
      ? `<img src="${escapeHtml(selected.qrDataUrl)}" alt="QR code for ${escapeHtml(selected.asset)} on ${escapeHtml(selected.network)}" style="width:132px;height:132px;object-fit:contain;border-radius:10px;background:#fff;padding:6px">`
      : "";

    return `<div class="deposit-shell">${depositProgress("choose")}<div class="mp"><div class="mph"><div><h3>Choose deposit details</h3><small>Use the destination configured by the administrator for this asset and network.</small></div></div><label class="fl" for="wa">Asset</label><select class="sel" id="wa">${assetOptions}</select><label class="fl" for="wn">Network</label><select class="sel" id="wn">${networkOptions}</select>${selected ? `<div class="deposit-callout" style="margin-top:16px"><strong>Deposit destination</strong><p>Send only ${escapeHtml(selected.asset)} using ${escapeHtml(selected.network)}.</p><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px">${qr}<code style="display:block;max-width:100%;overflow-wrap:anywhere;user-select:all">${escapeHtml(selected.address)}</code></div><div class="deposit-actions"><button class="btn alt" id="deposit-method-copy" type="button">Copy address</button></div></div>` : ""}<label class="fl" for="wq">Amount (${escapeHtml(selectedAsset)})</label><div class="amt"><input id="wq" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00" value="${amount}"></div><div class="hint" id="wu">${estimatedValue}</div><div class="err" id="we" role="alert"></div><div class="deposit-callout"><strong>Review notice</strong><p>After paying, attach your receipt for staff review. Payments are not verified or credited automatically.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button><button class="btn" id="deposit-continue">Continue to receipt</button></div></div></div>`;
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
    return `<div class="deposit-shell deposit-complete">${depositProgress("complete")}<div class="deposit-callout"><strong>Deposit request submitted</strong><p>Your payment details and receipt are saved securely. An authorized staff member must review the submission. No funds are credited automatically.</p></div><div class="mp"><div class="mph"><div><h3>${amount} ${escapeHtml(request.a)}</h3><small>${escapeHtml(request.net)} · ${Number.isFinite(submittedAt) ? new Date(submittedAt).toLocaleString() : "Submitted"}</small></div><span class="risk r1">${status}</span></div><div class="meta"><span>Estimated value<b>${Number.isFinite(estimate) ? fmt(estimate) : "Estimate unavailable"}</b></span><span>Receipt<b>${receiptName}</b></span></div></div><div class="deposit-actions"><button class="btn" id="deposit-again">Start another deposit request</button></div></div>`;
  };
  browserWindow.depositProof = function depositProofWithAdminMethod() {
    const method = selectedDepositMethod();
    const value = px(WS.a)
      ? fmt(Number(WS.amount) * px(WS.a))
      : "Estimate unavailable";
    const destination = method
      ? `<div class="deposit-callout"><strong>Selected deposit destination</strong><p>${escapeHtml(method.asset)} · ${escapeHtml(method.network)}</p><code style="display:block;overflow-wrap:anywhere;user-select:all">${escapeHtml(method.address)}</code>${method.qrDataUrl ? `<img src="${escapeHtml(method.qrDataUrl)}" alt="QR code for ${escapeHtml(method.asset)} on ${escapeHtml(method.network)}" style="display:block;width:132px;height:132px;object-fit:contain;margin-top:12px;border-radius:10px;background:#fff;padding:6px">` : ""}</div>`
      : `<div class="deposit-callout"><strong>No deposit method is available</strong><p>Go back and contact support before continuing.</p></div>`;
    return `<div class="deposit-shell">${depositProgress("proof")}<div class="mp"><div class="mph"><div><h3>Review and attach your receipt</h3><small>${escapeHtml(WS.a)} · ${escapeHtml(method?.network || "No network selected")} · ${escapeHtml(WS.amount)} ${escapeHtml(WS.a)}</small></div><span class="risk r1">${value}</span></div>${destination}<div class="deposit-callout"><strong>Staff review required</strong><p>Your screenshot is stored privately and attached to this request. Staff must review the payment; uploading proof does not automatically credit funds.</p></div><label class="receipt-upload" for="deposit-proof"><b>Upload transfer screenshot</b><small class="hint">PNG, JPG, or WebP · up to 8 MB</small><input id="deposit-proof" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="proof-note"></label><p id="proof-note" class="hint">The image is stored in the private Images bucket and is visible only to you and authorized staff.</p><div id="deposit-proof-preview" class="receipt-preview" hidden></div><p class="err" id="deposit-proof-error" role="alert"></p><div class="deposit-actions"><button class="btn alt" id="deposit-edit">Back to amount</button><button class="btn" id="submit-deposit" disabled>Submit deposit request</button></div></div></div>`;
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
      button.textContent = "Uploading receipt…";
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
        window.location.origin,
      );
    },
    true,
  );

  window.addEventListener("message", (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== window.location.origin
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
        button.textContent = "Submit deposit request";
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
        button.textContent = "Submit deposit request";
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
      const levelByStatus={none:0,pending:1,rejected:0,verified:3};
      const levelCount=levelByStatus[String(authProfile?.kyc_status||"none")]??0;
      const levelBox=document.createElement("button");
      levelBox.type="button";
      levelBox.className="profile-level";
      levelBox.setAttribute("role","menuitem");
      levelBox.dataset.profileAction="kyc-open";
      levelBox.setAttribute("aria-label","Verification level "+levelCount+" of 3. Open verification.");
      const levelTop=document.createElement("span");
      levelTop.className="profile-level__top";
      const levelLabel=document.createElement("b");
      levelLabel.textContent="Verification level";
      const levelValue=document.createElement("span");
      levelValue.textContent=levelCount+" of 3";
      levelTop.append(levelLabel,levelValue);
      const levelBar=document.createElement("i");
      levelBar.className="profile-level__bar";
      const levelFill=document.createElement("u");
      levelFill.style.width=Math.round(levelCount/3*100)+"%";
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
      '["Security and verification","M12 3l8',
      '["Profile","M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"],["Security and verification","M12 3l8',
    )
    .replaceAll('Sample only', 'Varies by network')
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
      'const MARKET_ICONS=Object.create(null),MARKET_STATUS=Object.create(null),MARKET_META=Object.create(null);\nfunction lg(t){const src=MARKET_ICONS[t];if(src)return `<img class="lg" src="${src}" alt="" loading="lazy" style="object-fit:cover;border-radius:50%">`;return `<b class="lg" style="background:var(--brand);color:#fff">${String(t||"").replace(/[^A-Za-z0-9]/g,"").slice(0,3)}</b>`}\nfunction renderRail',
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
              columns:["name","close","change","change_abs","volume","open","high","low","currency","description"]
            })
          });
          if(!response.ok)throw new Error("TradingView returned HTTP "+response.status);
          const payload=await response.json();
          const quotes=Array.isArray(payload.data)?payload.data:[];
          const bySymbol=new Map(quotes.filter(row=>row&&typeof row.s==="string").map(row=>[row.s,row.d]));
          const numberOrNull=value=>typeof value==="number"&&Number.isFinite(value)?value:null;
          const clean=value=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;");
          const rows=instruments.flatMap(instrument=>{
            const quote=bySymbol.get(instrument.ticker);
            if(!Array.isArray(quote)||typeof quote[1]!=="number"||!Number.isFinite(quote[1]))return [];
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
      'let live=null,lerr=null;if(D[k][0][5]){try{live=await liveCandles(D[k].find(r=>r[0]===sym)[5],LD)}catch(e){lerr=e&&e.code||"error"}if(tok!==TOK)return}',
      'let live=null,lerr=null;try{const symbol=(D[k].find(r=>r[0]===sym)||[])[5]||sym.replace("/","-");const category={"Stocks":"stocks","ETFs":"etfs","Crypto":"crypto","Forex":"forex","Commodities":"commodities"}[k];const history=await window.__AUVRENTHIA_MARKET_REQUEST__({action:"history",category,symbol,days:LD});live=history&&history.candles;if(!Array.isArray(live)||live.length===0)throw new Error("No historical data returned")}catch(e){lerr=e&&e.message||"error"}if(tok!==TOK)return',
    )
    .replace(
      'const up=css("--up"),dn=css("--dn"),d=live||cd(p,sym.length*977+sym.charCodeAt(0),TF,140);',
      'const up=css("--up"),dn=css("--dn"),d=live||[];if(!d.length){el.innerHTML=\'<p class="note">Live chart data is currently unavailable for this asset.</p>\';$("#ohlc").textContent="";return}',
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
      'const save=()=>{window.parent.postMessage({type:"auvrenthia-member-state-update",state:ST},window.location.origin)};',
    )
    .replace(
      'window.parent.postMessage({type:"auvrenthia-member-logout"},"*");',
      'window.parent.postMessage({type:"auvrenthia-member-logout"},"*");',
    )
    .replace(
      '</head>',
      () => `<script>window.__AUVRENTHIA_DASHBOARD_STATE__=${serializeInlineScript(initialState)};window.__AUVRENTHIA_DEPOSIT_METHODS__=${serializeInlineScript(depositMethods)};window.__AUVRENTHIA_PROFILE__=${serializeInlineScript(profile)};</script><script>${marketRequestBridge}</script><style>${wealthHubTypography}</style></head>`,
    )
    .replace(
      '</body>',
      () => `<script>try{${profileMenuControl}}catch(error){console.error("Profile menu initialization failed.",error);}try{${headerLogoControl}}catch(error){console.error("Dashboard header initialization failed.",error);}try{(${installMemberDepositMethods.toString()})();}catch(error){console.error("Dashboard action initialization failed.",error);}try{(${installMemberDashboardTools.toString()})();}catch(error){console.error("Dashboard navigation initialization failed.",error);}</script></body>`,
    );

  const requiredTransforms = [
    'window.__AUVRENTHIA_DASHBOARD_STATE__=',
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
  profile,
  userId,
}: DashboardPageProps) {
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
        event.source !== frameRef.current?.contentWindow
      ) {
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
            const request = {
              id: `DEP-${requestId}`,
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
            };
            const { data: currentState, error: readError } = await client
              .from('member_dashboard_state')
              .select('data')
              .eq('user_id', userId)
              .maybeSingle();
            if (readError) throw readError;
            const storedData =
              currentState?.data && typeof currentState.data === 'object'
                ? (currentState.data as Record<string, unknown>)
                : {};
            const storedRequests = Array.isArray(storedData.depositRequests)
              ? storedData.depositRequests
              : [];
            const { error: saveError } = await client
              .from('member_dashboard_state')
              .upsert(
                {
                  user_id: userId,
                  data: {
                    ...storedData,
                    cash0: Number(profile.demo_balance) || 0,
                    depositRequests: [request, ...storedRequests],
                  },
                },
                { onConflict: 'user_id' },
              );
            if (saveError) throw saveError;
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
        void (async () => {
          try {
            const { error } = await client
              .from('member_dashboard_state')
              .upsert(
                {
                  user_id: userId,
                  data: {
                    ...nextState,
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
  }, [depositMethods, onLogout, profile.demo_balance, userId]);

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
