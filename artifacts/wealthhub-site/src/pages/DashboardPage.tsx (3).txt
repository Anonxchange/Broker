import { useEffect, useMemo, useRef, useState } from 'react';
import harborDashboardHtml from '@assets/Harbor_–_Investing_(1)_1792836967110.html?raw';
import { serializeInlineScript, supabase, type AppProfile } from '../lib/supabase';
import './dashboard-page.css';

type DashboardPageProps = {
  onLogout: () => void;
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
  [key: string]: unknown;
};

const EMPTY_DASHBOARD_STATE: MemberDashboardState = {
  cash0: 0,
  plans: [],
  tx: [],
  wallet: null,
  depositRequests: [],
};

type MemberWalletState = {
  a: string;
  net: number;
  amount: string;
};

declare const WS: MemberWalletState;
declare function depositProgress(step: string): string;
declare function px(asset: string): number;
declare function fmt(amount: number): string;

function installMemberDepositMethods() {
  const browserWindow = window as typeof window & {
    depositChoose?: () => string;
    depositProof?: () => string;
    __getSelectedDepositMethod?: () => MemberDepositMethod | null;
    __AUVRENTHIA_DEPOSIT_METHODS__?: unknown;
  };
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
  const validQrDataUrl = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length <= 720_000 &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value);

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

  browserWindow.depositChoose = function depositChooseWithAdminMethods() {
    const methods = readDepositMethods();
    const assets = Array.from(
      new Map(
        methods.map((method) => [method.asset.trim().toLowerCase(), method.asset]),
      ).values(),
    );
    if (assets.length === 0) {
      return `<div class="deposit-shell">${depositProgress("choose")}<div class="mp"><div class="mph"><div><h3>No deposit methods available</h3><small>An administrator has not configured a deposit destination yet.</small></div></div><div class="deposit-callout"><strong>Preview only</strong><p>No transfer will be submitted or credited in this demo.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button></div></div></div>`;
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

    return `<div class="deposit-shell">${depositProgress("choose")}<div class="mp"><div class="mph"><div><h3>Choose deposit details</h3><small>Use the destination configured by the admin for this asset and network.</small></div></div><label class="fl" for="wa">Asset</label><select class="sel" id="wa">${assetOptions}</select><label class="fl" for="wn">Network</label><select class="sel" id="wn">${networkOptions}</select>${selected ? `<div class="deposit-callout" style="margin-top:16px"><strong>Deposit destination</strong><p>Only send ${escapeHtml(selected.asset)} using ${escapeHtml(selected.network)}.</p><div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px">${qr}<code style="display:block;max-width:100%;overflow-wrap:anywhere;user-select:all">${escapeHtml(selected.address)}</code></div><div class="deposit-actions"><button class="btn alt" id="deposit-method-copy" type="button">Copy address</button></div></div>` : ""}<label class="fl" for="wq">Amount (${escapeHtml(selectedAsset)})</label><div class="amt"><input id="wq" type="number" inputmode="decimal" min="0" step="any" placeholder="0.00" value="${amount}"></div><div class="hint" id="wu">${estimatedValue}</div><div class="err" id="we" role="alert"></div><div class="deposit-callout"><strong>Demo only</strong><p>These are admin-configured instructions for preview. No transaction is submitted or credited.</p></div><div class="deposit-actions"><button class="btn alt" id="deposit-back-guide">Back</button><button class="btn" id="deposit-continue">Continue to receipt</button></div></div></div>`;
  };

  browserWindow.__getSelectedDepositMethod = selectedDepositMethod;
  browserWindow.depositProof = function depositProofWithAdminMethod() {
    const method = selectedDepositMethod();
    const value = px(WS.a)
      ? fmt(Number(WS.amount) * px(WS.a))
      : "Estimate unavailable";
    const destination = method
      ? `<div class="deposit-callout"><strong>Selected deposit destination</strong><p>${escapeHtml(method.asset)} · ${escapeHtml(method.network)}</p><code style="display:block;overflow-wrap:anywhere;user-select:all">${escapeHtml(method.address)}</code>${method.qrDataUrl ? `<img src="${escapeHtml(method.qrDataUrl)}" alt="QR code for ${escapeHtml(method.asset)} on ${escapeHtml(method.network)}" style="display:block;width:132px;height:132px;object-fit:contain;margin-top:12px;border-radius:10px;background:#fff;padding:6px">` : ""}</div>`
      : `<div class="deposit-callout"><strong>No deposit method is available</strong><p>Go back and contact support before continuing.</p></div>`;
    return `<div class="deposit-shell">${depositProgress("proof")}<div class="mp"><div class="mph"><div><h3>Review and attach your receipt</h3><small>${escapeHtml(WS.a)} · ${escapeHtml(method?.network || "No network selected")} · ${escapeHtml(WS.amount)} ${escapeHtml(WS.a)}</small></div><span class="risk r1">${value}</span></div>${destination}<div class="deposit-callout"><strong>Preview only</strong><p>Do not send funds from this demo. The screenshot is only previewed in this browser and is not uploaded or reviewed.</p></div><label class="receipt-upload" for="deposit-proof"><b>Upload transfer screenshot</b><small class="hint">PNG, JPG, or WebP · up to 8 MB</small><input id="deposit-proof" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="proof-note"></label><p id="proof-note" class="hint">Your file stays on this page. Only its filename is saved with the local demo request.</p><div id="deposit-proof-preview" class="receipt-preview" hidden></div><p class="err" id="deposit-proof-error" role="alert"></p><div class="deposit-actions"><button class="btn alt" id="deposit-edit">Back to amount</button><button class="btn" id="submit-deposit" disabled>Save demo request</button></div></div></div>`;
  };

  const misc = document.querySelector("#misc");
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
      width: 26px;
      max-width: 26px;
      height: 26px;
      object-fit: cover;
      object-position: left center;
    }
    #title {
      display: flex;
      min-width: 0;
      align-items: center;
      flex: 0 1 auto;
      margin-right: auto;
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
    .profile-control .av:focus-visible {
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
    .profile-dropdown__empty {
      margin: 0;
      padding: 14px 10px 10px;
      color: var(--mute);
      font-size: 13px;
    }
  `;
  const profileMenuControl = `
    const memberAvatar=document.querySelector(".top .av");
    if(memberAvatar){
      const profileControl=document.createElement("div");
      profileControl.className="profile-control";
      memberAvatar.parentNode.insertBefore(profileControl,memberAvatar);
      profileControl.appendChild(memberAvatar);

      const profileMenu=document.createElement("div");
      profileMenu.className="profile-dropdown";
      profileMenu.setAttribute("role","menu");
      profileMenu.hidden=true;
      profileMenu.innerHTML='<div class="profile-dropdown__view" data-profile-view="menu"><div class="profile-dropdown__identity"><span class="profile-dropdown__initial" aria-hidden="true">A</span><div><strong>Profile</strong><small>Manage your account</small></div></div><button type="button" role="menuitem" data-profile-action="notifications"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg><span>Notifications</span></button><button type="button" role="menuitem" data-profile-action="settings">Account settings</button><button type="button" role="menuitem" data-profile-action="statements">Statements and tax</button><button type="button" role="menuitem" data-profile-action="rewards">Rewards</button><div class="profile-dropdown__divider"></div><button type="button" role="menuitem" data-profile-action="signout">Sign out</button></div><div class="profile-dropdown__view" data-profile-view="notifications" hidden><button type="button" role="menuitem" data-profile-action="back"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6M9 12h11"/></svg><span>Back to profile menu</span></button><p class="profile-dropdown__empty">No new notifications.</p></div>';
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
      kycButton.textContent="KYC verification";
      profileMenuView.appendChild(kycButton);

      const kycView=document.createElement("div");
      kycView.className="profile-dropdown__view";
      kycView.dataset.profileView="kyc";
      kycView.hidden=true;
      kycView.innerHTML='<div class="profile-dropdown__identity"><span class="profile-dropdown__initial" aria-hidden="true">2/3</span><div><strong>Verification tiers</strong><small>Tier 2 of 3 · sample profile</small></div></div><p class="profile-dropdown__empty">Tier 1 email and Tier 2 face checks are marked complete in this sample. Tier 3 requires a government ID showing the current address. This preview does not perform checks or collect documents.</p>';
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
        memberAvatar.setAttribute("aria-expanded",String(open));
      };
      const toggleProfileMenu=()=>{
        const open=profileMenu.hidden;
        if(open)resetProfileMenuView();
        setProfileMenuOpen(open);
      };
      memberAvatar.setAttribute("role","button");
      memberAvatar.setAttribute("tabindex","0");
      memberAvatar.setAttribute("aria-label","Open profile menu");
      memberAvatar.setAttribute("aria-haspopup","menu");
      memberAvatar.setAttribute("aria-expanded","false");
      memberAvatar.title="Profile and account settings";
      memberAvatar.addEventListener("click",event=>{
        event.stopPropagation();
        toggleProfileMenu();
      });
      memberAvatar.addEventListener("keydown",event=>{
        if(event.key==="Enter"||event.key===" "){
          event.preventDefault();
          toggleProfileMenu();
        }
        if(event.key==="ArrowDown"){event.preventDefault();resetProfileMenuView();setProfileMenuOpen(true);profileMenu.querySelector('[data-profile-action="notifications"]')?.focus()}
      });
      profileMenu.addEventListener("click",event=>{
        const action=event.target.closest("[data-profile-action]");
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
        const destinations={settings:"Security and verification",statements:"Statements and tax",rewards:"Rewards"};
        const destination=destinations[action.dataset.profileAction];
        if(destination)document.querySelector('#nav .nav[data-p="'+destination+'"]')?.click();
      });
      document.addEventListener("click",event=>{
        if(!profileControl.contains(event.target))setProfileMenuOpen(false);
      });
      document.addEventListener("keydown",event=>{
        if(event.key==="Escape"){setProfileMenuOpen(false);memberAvatar.focus()}
      });
    }
  `;
  const headerLogoControl = `
    const dashboardTitle=document.querySelector("#title");
    const syncHeaderLogo=()=>{
      if(!dashboardTitle||dashboardTitle.querySelector("[data-dashboard-brand]"))return;
      const logo=document.createElement("img");
      logo.src="/wealthhub/auvrenthia-logo.svg";
      logo.alt="Auvrenthia";
      logo.className="dashboard-brand-mark";
      logo.setAttribute("data-dashboard-brand","");
      dashboardTitle.replaceChildren(logo);
    };
    syncHeaderLogo();
    new MutationObserver(syncHeaderLogo).observe(dashboardTitle,{childList:true});
  `;
  let html = harborDashboardHtml
    .replace('<title>Harbor – Investing</title>', '<title>Auvrenthia Markets</title>')
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
      'function tickRender(){const find=(rows,symbol)=>rows.find(row=>row[0]===symbol),items=[["BTC",find(D.Crypto,"BTC"),"crypto"],["ETH",find(D.Crypto,"ETH"),"crypto"],["EUR/USD",find(D.Forex,"EUR/USD"),"forex"],["USD/NGN",find(D.Forex,"USD/NGN"),"forex"],["Gold",find(D.Commodities,"XAU"),"metal"],["Silver",find(D.Commodities,"XAG"),"metal"]];$("#tick").innerHTML=items.map(([name,asset,kind])=>{const value=asset?asset[2]:null,change=asset&&Number.isFinite(asset[3])?asset[3]:null,price=value==null?"—":kind==="forex"?value.toFixed(4):kind==="crypto"&&Math.abs(value)<.01?"$"+value.toPrecision(4):fmt(value);return `<span>${name}<b>${price}</b><span class="${change===null?"":change>=0?"up":"dn"}">${change===null?"":(change>=0?"+":"−")+Math.abs(change).toFixed(2)+"%"}</span></span>`}).join("")}\nlet LIVE=',
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
      'async function loadPublic(category){const key={"Stocks":"stocks","ETFs":"etfs","Crypto":"crypto","Forex":"forex","Commodities":"commodities"}[category];if(!key)return;MARKET_STATUS[category]="Loading live market data…";try{const response=await fetch("/api/markets/"+key,{cache:"no-store"});const feed=await response.json();if(!response.ok||!feed||!Array.isArray(feed.assets))throw new Error(feed&&feed.error||"Market feed unavailable");const clean=value=>String(value??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;", "\\"":"&quot;"}[ch]));D[category]=feed.assets.map(asset=>{if(asset.icon)MARKET_ICONS[asset.symbol]=asset.icon;return[clean(asset.symbol),clean(asset.name),asset.price,asset.change24h,asset.sparkline||[],asset.id||null]});MARKET_META[category]={source:feed.source,asOf:feed.asOf,stale:feed.stale};MARKET_STATUS[category]=feed.source+" · updated "+(feed.asOf?new Date(feed.asOf).toLocaleString():"just now")+(feed.stale?" · showing cached data":"");if(category==="Crypto")LIVE={ok:true,msg:MARKET_STATUS[category]}}catch(error){D[category]=[];MARKET_META[category]=null;MARKET_STATUS[category]="Live data is unavailable; no sample prices are being shown.";if(category==="Crypto")LIVE={ok:false,msg:MARKET_STATUS[category]}}tickRender();renderRail();renderList();if(page===category)renderMkt(category)}\ntickRender();',
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
      'let live=null,lerr=null;try{const symbol=(D[k].find(r=>r[0]===sym)||[])[5]||sym.replace("/","-");const category={"Stocks":"stocks","ETFs":"etfs","Crypto":"crypto","Forex":"forex","Commodities":"commodities"}[k];const response=await fetch("/api/markets/"+category+"/history/"+encodeURIComponent(symbol)+"/"+LD,{cache:"no-store"});if(!response.ok)throw new Error("Historical data unavailable");const history=await response.json();live=history.candles;if(!Array.isArray(live)||live.length===0)throw new Error("No historical data returned")}catch(e){lerr=e&&e.message||"error"}if(tok!==TOK)return',
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
      'D.Stocks=[];D.ETFs=[];D.Crypto=[];D.Forex=[];D.Commodities=[];tickRender();renderRail();renderList();drawChart();loadCrypto();',
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
      '${INFO[k][1]}${["Crypto","Forex","Commodities"].includes(k)?" "+(MARKET_STATUS[k]||"Loading live market data…"):""}',
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
      'throw new Error("Wallet connection is disabled in this preview.")',
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
      'window.parent.postMessage({type:"auvrenthia-member-logout"},window.location.origin);',
    )
    .replace(
      '</head>',
      `<script>window.__AUVRENTHIA_DASHBOARD_STATE__=${serializeInlineScript(initialState)};window.__AUVRENTHIA_DEPOSIT_METHODS__=${serializeInlineScript(depositMethods)};window.__AUVRENTHIA_PROFILE__=${serializeInlineScript(profile)};</script><style>${wealthHubTypography}</style></head>`,
    )
    .replace(
      '</body>',
      `<script>(${installMemberDepositMethods.toString()})();${profileMenuControl}${headerLogoControl}</script></body>`,
    );

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

  useEffect(() => {
    let active = true;
    async function loadDashboardData() {
      if (!supabase) {
        setLoadError('Supabase is not configured for this deployment.');
        setReady(true);
        return;
      }

      const [stateResult, methodsResult] = await Promise.all([
        supabase
          .from('member_dashboard_state')
          .select('data')
          .eq('user_id', userId)
          .maybeSingle(),
        supabase
          .from('deposit_methods')
          .select('id,asset,network,address,qr_data_url,is_active')
          .eq('is_active', true)
          .order('asset'),
      ]);
      if (!active) return;

      if (stateResult.error || methodsResult.error) {
        setLoadError(
          'Dashboard data could not be loaded. Run the Supabase setup SQL and check the RLS policies.',
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
      });
      setDepositMethods(
        (methodsResult.data || []).map((method) => ({
          id: method.id,
          asset: method.asset,
          network: method.network,
          address: method.address,
          qrDataUrl: method.qr_data_url || undefined,
        })),
      );
      setLoadError('');
      setReady(true);
    }

    void loadDashboardData().catch((error: unknown) => {
      if (active) {
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Dashboard data could not be loaded.',
        );
        setReady(true);
      }
    });

    return () => {
      active = false;
    };
  }, [profile.demo_balance, userId]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== window.location.origin
      ) {
        return;
      }

      if (event.data?.type === 'auvrenthia-member-logout') {
        onLogout();
      } else if (
        event.data?.type === 'auvrenthia-member-state-update' &&
        event.data.state &&
        typeof event.data.state === 'object'
      ) {
        const nextState = event.data.state as MemberDashboardState;
        if (
          !Array.isArray(nextState.plans) ||
          !Array.isArray(nextState.tx) ||
          !Array.isArray(nextState.depositRequests)
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
            setSaveError('Your dashboard changes could not be saved to Supabase.');
            console.error('Supabase dashboard-state save failed.', error);
          }
        })();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onLogout, profile.demo_balance, userId]);

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
    return (
      <main className="member-dashboard-source">
        <p role="status" className="dashboard-data-loading">Loading your account…</p>
      </main>
    );
  }
  return (
    <main className="member-dashboard-source">
      {saveError && <p className="dashboard-sync-error" role="alert">{saveError}</p>}
      <iframe
        ref={frameRef}
        className="member-dashboard-frame"
        title="Auvrenthia Markets member dashboard"
        srcDoc={sourceDocument}
      />
    </main>
  );
}
