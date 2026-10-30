import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import adminHtml from '@assets/admin_1793083123310.html?raw';
import { useAuth } from '../lib/auth-context';
import {
  appRedirectUrl,
  serializeInlineScript,
  supabase,
  supabaseImageBucket,
  type AppProfile,
} from '../lib/supabase';
import {
  adminEmailBehavior,
  adminEmailStyles,
} from './admin-email-composer';
import { adminFinanceBehavior } from './admin-finance.behavior';
import { adminManagementBehavior } from './admin-management';
import { adminInvestmentsBehavior } from './admin-investments.behavior';
import { buildAdminOps, handleInvestmentsMessage } from './investments-bridge';
import './admin-page.css';

type AdminUserRecord = {
  id: string;
  name: string;
  email: string;
  joined: number;
  kyc: string;
  status: string;
  wd: boolean;
  bal: number;
  country: string;
  address: string;
  phone: string;
  notes: string;
  ledger: unknown[];
};

type AdminDepositMethod = {
  id: string;
  asset: string;
  network: string;
  address: string;
  qrDataUrl?: string;
  qrStoragePath?: string;
  createdAt: string;
  updatedAt: string;
};

type AdminPaymentRecord = {
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
  memberRequest?: boolean;
  memberRequestId?: string;
  receiptPath?: string;
  receiptUrl?: string;
  receiptName?: string;
  receiptError?: string;
};

type AdminBootstrap = {
  me: { email: string; role: string; displayName: string };
  state: Record<string, unknown> & {
    users: AdminUserRecord[];
    team: Array<{ id: string; email: string; role: string; on: boolean }>;
  };
  depositMethods: AdminDepositMethod[];
};

const EMPTY_ADMIN_STATE: Record<string, unknown> = {
  deposits: [],
  withdrawals: [],
  plans: [],
  catalog: [],
  audit: [],
  tickets: [],
  announcements: [],
  settings: {
    needKyc: true,
    wdPaused: false,
    depPaused: false,
    maint: false,
    wdFee: 0,
    minWd: 0,
    autoDep: 0,
  },
};

const STAFF_ROLE_LABELS: Record<AppProfile['role'], string> = {
  member: 'Member',
  admin: 'Admin',
  owner: 'Owner',
  finance: 'Finance',
  support: 'Support',
};

const STAFF_ROLE_KEYS: Record<string, AppProfile['role']> = {
  Admin: 'admin',
  Owner: 'owner',
  Finance: 'finance',
  Support: 'support',
  Member: 'member',
};

function toAdminUser(profile: AppProfile): AdminUserRecord {
  return {
    id: profile.id,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    email: profile.email,
    joined: new Date(profile.created_at).getTime() || Date.now(),
    kyc: profile.kyc_status,
    status: profile.account_status,
    wd: profile.withdrawals_enabled,
    bal: Number(profile.demo_balance) || 0,
    country: profile.country,
    address: profile.address,
    phone: profile.phone,
    notes: profile.admin_note || '',
    ledger: [],
  };
}

function toAdminDepositMethod(row: {
  id: string;
  asset: string;
  network: string;
  address: string;
  qr_data_url: string | null;
  qr_storage_path: string | null;
  created_at: string;
  updated_at: string;
}): AdminDepositMethod {
  return {
    id: row.id,
    asset: row.asset,
    network: row.network,
    address: row.address,
    qrDataUrl: row.qr_data_url || undefined,
    qrStoragePath: row.qr_storage_path || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Only roles the database accepts. Anything else returns null so callers skip it
// instead of silently turning a person into 'support' (or failing the whole save).
const DB_STAFF_ROLES = ['owner', 'finance', 'support'] as const;
function roleFromAdminLabel(role: unknown): AppProfile['role'] | null {
  const key = STAFF_ROLE_KEYS[String(role)];
  return key && (DB_STAFF_ROLES as readonly string[]).includes(key) ? key : null;
}

function mergePaymentRecords(
  fresh: AdminPaymentRecord[],
  previousValue: unknown,
): AdminPaymentRecord[] {
  const previous = Array.isArray(previousValue)
    ? (previousValue as AdminPaymentRecord[])
    : [];
  const previousById = new Map(previous.map((record) => [record.id, record]));
  const freshIds = new Set(fresh.map((record) => record.id));
  return [
    ...fresh.map((record) => {
      const saved = previousById.get(record.id);
      return saved
        ? { ...record, status: saved.status, note: saved.note }
        : record;
    }),
    ...previous.filter((record) => !freshIds.has(record.id)),
  ];
}

const appTypography = `
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
  #login {
    background: var(--bg);
  }
  #login .lg .logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 0 0 18px;
    text-align: center;
  }
  .admin-brand-mark {
    display: block;
    width: 171px;
    max-width: 100%;
    height: auto;
  }
  .admin-header-brand {
    display: block;
    width: 26px;
    max-width: 26px;
    height: 26px;
    flex: none;
    margin-right: auto;
    object-fit: cover;
    object-position: left center;
  }
  .admin-top-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    margin-left: 0;
  }
  .admin-theme-button {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mute);
  }
  .admin-theme-button:hover,
  .admin-theme-button:focus-visible {
    color: var(--ink);
  }
  .admin-theme-button svg {
    width: 18px;
    height: 18px;
  }
  .admin-profile-control {
    position: relative;
    z-index: 40;
    flex: none;
  }
  .admin-profile-trigger {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--ink);
    color: var(--bg);
  }
  .admin-profile-trigger:focus-visible {
    outline: 2px solid var(--brand);
    outline-offset: 3px;
  }
  .admin-profile-trigger svg {
    width: 18px;
    height: 18px;
  }
  .admin-profile-menu {
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
  .admin-profile-menu[hidden] {
    display: none;
  }
  .admin-profile-identity {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 10px 12px;
    margin-bottom: 5px;
    border-bottom: 1px solid var(--line);
  }
  .admin-profile-initial {
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
  .admin-profile-identity strong,
  .admin-profile-identity small {
    display: block;
  }
  .admin-profile-identity strong {
    color: var(--ink);
    font-size: 14px;
  }
  .admin-profile-identity small {
    color: var(--mute);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .admin-profile-menu button {
    display: flex;
    width: 100%;
    align-items: center;
    padding: 10px;
    border-radius: 8px;
    color: var(--ink);
    font-size: 14px;
    text-align: left;
  }
  .admin-profile-menu button svg {
    width: 18px;
    height: 18px;
    flex: none;
    margin-right: 10px;
    color: var(--mute);
  }
  .admin-profile-menu button:hover,
  .admin-profile-menu button:focus-visible {
    background: color-mix(in srgb, var(--brand) 10%, transparent);
  }
  @media (max-width: 460px) {
    .admin-top-actions {
      gap: 8px;
    }
  }
`;

const adminTopBar = `
  <div class="top">
    <button class="ic menu" data-a="menu" aria-label="Open menu">&#9776;</button>
    <img id="admin-header-brand" class="admin-header-brand" src="/wealthhub/auvrenthia-logo.svg" alt="Auvrenthia Markets">
    <div class="admin-top-actions">
      <button class="admin-theme-button" type="button" data-a="theme" aria-label="Switch light or dark mode" title="Switch light or dark mode">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
      </button>
      <div class="admin-profile-control">
        <button class="admin-profile-trigger" id="admin-profile-trigger" type="button" aria-label="Open profile and account settings" aria-haspopup="menu" aria-expanded="false">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>
        </button>
        <div class="admin-profile-menu" id="admin-profile-menu" role="menu" hidden>
          <div class="admin-profile-identity">
            <span class="admin-profile-initial" id="admin-profile-initial" aria-hidden="true">A</span>
            <div><strong id="admin-profile-role">Admin</strong><small id="admin-profile-email"></small></div>
          </div>
          <button type="button" role="menuitem" data-v="Account settings">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>
            <span>Account settings</span>
          </button>
          <button type="button" role="menuitem" data-v="Deposit methods">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Deposit methods</span>
          </button>
          <button type="button" role="menuitem" data-a="logout">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></svg>
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  </div>`;

const adminProfileBehavior = `
  (() => {
    const control = document.querySelector(".admin-profile-control");
    const trigger = document.querySelector("#admin-profile-trigger");
    const menu = document.querySelector("#admin-profile-menu");
    if (!control || !trigger || !menu) return;

    const setOpen = open => {
      menu.hidden = !open;
      trigger.setAttribute("aria-expanded", String(open));
    };
    trigger.addEventListener("click", event => {
      event.stopPropagation();
      setOpen(menu.hidden);
    });
    trigger.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        menu.querySelector('[role="menuitem"]')?.focus();
      }
    });
    document.addEventListener("click", event => {
      if (!control.contains(event.target)) setOpen(false);
    });
    menu.addEventListener("click", event => {
      if (event.target.closest('[role="menuitem"]')) setOpen(false);
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !menu.hidden) {
        setOpen(false);
        trigger.focus();
      }
    });
  })();
`;

function replaceRequired(source: string, target: string, replacement: string, label: string) {
  const firstIndex = source.indexOf(target);
  if (firstIndex === -1 || firstIndex !== source.lastIndexOf(target)) {
    throw new Error(`Expected one ${label} in the supplied admin HTML.`);
  }
  return source.slice(0, firstIndex) + replacement + source.slice(firstIndex + target.length);
}

function buildAdminDocument(bootstrap: AdminBootstrap) {
  let html = adminHtml
    .replace('<title>Harbor Admin</title>', '<title>Auvrenthia Markets Admin</title>')
    .replace(
      /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/,
      '',
    )
    .replace(
      '<div class="logo">Harbor Admin</div>',
      '<div class="logo admin-login-brand"><img src="/wealthhub/auvrenthia-logo.svg" alt="Auvrenthia Markets" class="admin-brand-mark"><small>Admin console</small></div>',
    )
    .replace(
      '<div class="logo">Harbor<small>Admin console</small></div>',
      '<div class="logo"><img src="/wealthhub/auvrenthia-logo.svg" alt="Auvrenthia Markets" class="admin-brand-mark"><small>Admin console</small></div>',
    )
    .replaceAll('#6D93FF', 'var(--brand)')
    .replaceAll(
      'rgba(109,147,255,.22)',
      'color-mix(in srgb,var(--brand) 22%,transparent)',
    );

  html = html.replace(
    /<div id="login" hidden>[\s\S]*?(?=<div class="app" id="app" hidden>)/,
    '',
  );

  html = replaceRequired(
    html,
    'const ROLES={Owner:["*"],Finance:["money"],Support:["kyc","support","announce"]},can=',
    'const ROLES={Owner:["*"],Admin:["*"],Finance:["money"],Support:["kyc","support","announce"]},can=',
    'full-access admin role',
  );
  html = replaceRequired(
    html,
    'o:["Finance","Support","Owner"]',
    'o:["Finance","Support","Owner","Admin"]',
    'admin invitation role',
  );
  html = replaceRequired(
    html,
    'o:["Owner","Finance","Support"]',
    'o:["Owner","Admin","Finance","Support"]',
    'admin team role',
  );

  html = replaceRequired(
    html,
    '<div class="top"><button class="ic menu" data-a="menu" aria-label="Open menu">&#9776;</button><b id="who"></b><button class="ic" data-a="theme" aria-label="Switch light or dark mode">&#9680;</button><button class="btn alt sm" data-a="logout">Sign out</button></div>',
    adminTopBar,
    'admin header',
  );
  html = replaceRequired(
    html,
    '$("#who").textContent=ME.email+" \\u00b7 "+(ROLES[ME.role]?ME.role:"Owner");render()',
    'let profileName="";try{profileName=localStorage.getItem("auvrenthia-admin-profile:"+ME.email.toLowerCase())||""}catch(e){}$("#admin-profile-role").textContent=profileName||(ROLES[ME.role]?ME.role:"Owner");$("#admin-profile-email").textContent=ME.email;$("#admin-profile-initial").textContent=(profileName||ME.email||"A").trim().slice(0,1).toUpperCase();render()',
    'admin profile identity update',
  );
  html = replaceRequired(
    html,
    `f.t==="number"?'step="0.01" min="0"':""`,
    `f.t==="number"?'step="'+(f.step||"0.01")+'" min="0"':""`,
    'custom numeric input steps',
  );

  const duplicateNavLine =
    /\n\$\("#nav"\)\.innerHTML=L\.map\(x=>typeof x==="string"\?.*\n(?=const closeSide=)/;
  if (!duplicateNavLine.test(html)) {
    throw new Error('The duplicated navigation line in the supplied admin HTML was not found.');
  }
  html = html.replace(duplicateNavLine, '\n');

  const duplicateNeedHelper = /\nconst need=\(r,k\)=>r&&r\[k\]&&r\[k\]\.trim\(\);/;
  if (!duplicateNeedHelper.test(html)) {
    throw new Error('The unused conflicting helper in the supplied admin HTML was not found.');
  }
  html = html.replace(duplicateNeedHelper, '\n');

  html = replaceRequired(
    html,
    'try{DB=JSON.parse(localStorage.getItem(KEY)||"null")}catch(e){}',
    'DB=null;',
    'legacy admin data storage read',
  );
  html = replaceRequired(
    html,
    'const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(DB))}catch(e){}}',
    'const save=()=>{window.parent.postMessage({type:"auvrenthia-admin-state-update",state:DB},window.__AUVHOST__)}',
    'admin state persistence bridge',
  );
  html = replaceRequired(
    html,
    `async signIn(e,p){/* supabase: supabase.auth.signInWithPassword, then read profiles.role==='admin' */if(p!=="admin")fail("Wrong email or password. Prototype password: admin");return{email:e,role:/finance/i.test(e)?"Finance":/support/i.test(e)?"Support":"Owner"}},`,
    'async signIn(){fail("Use your Supabase account to access the admin console.")},',
    'demo admin sign-in removal',
  );
  html = html.replace(
    'try{sessionStorage.setItem("hadm",JSON.stringify(ME))}catch(x){}',
    '',
  );
  html = html.replace(
    'try{ME=ME||JSON.parse(sessionStorage.getItem("hadm")||"null")}catch(e){}',
    '',
  );
  html = replaceRequired(html, 'boot();\n</script>', '\n</script>', 'automatic demo admin boot');

  const bootstrapScript = `
    (() => {
      const bootData=${serializeInlineScript(bootstrap)};
      DB=bootData.state;
      ME=bootData.me;
      api.createUser=async()=>fail("Users must sign up first. An owner can then assign a staff role.");
      api.deleteUser=async(id)=>{need("users");const u=U(id);u.status="archived";log("User archived",u.email,"Account access archived; auth data retained.");save()};
      api.decideDep=async(id,approved,note)=>{need("money");const d=DB.deposits.find(x=>x.id===id);if(!d)fail("Deposit request not found.");if(d.status!=="pending")fail("Already reviewed.");d.status=approved?"approved":"declined";d.note=note;log("Deposit decision recorded: "+d.status,d.id,"Account balances are not changed automatically. "+(note||""));save()};
      api.decideWd=async(id,approved,note)=>{need("money");const w=DB.withdrawals.find(x=>x.id===id);if(!w)fail("Withdrawal request not found.");if(w.status!=="pending")fail("Already reviewed.");w.status=approved?"approved":"declined";w.note=note;log("Withdrawal decision recorded: "+w.status,w.id,"No transfer was initiated. "+(note||""));save()};
      api.invite=async(email,role)=>{need("team");const user=DB.users.find(u=>u.email.toLowerCase()===String(email).trim().toLowerCase());if(!user)fail("That person must create an account before you can assign a staff role.");const existing=DB.team.find(x=>x.email.toLowerCase()===user.email.toLowerCase());if(existing)fail("That admin is already on the team.");DB.team.push({id:user.id,email:user.email,role,on:true});log("Staff role assigned",user.email,role);save()};
      api.reset=()=>fail("Password changes must be completed through account recovery.");
      api.userAction=async(id,action)=>{need("support");const target=U(id);if(!/password/i.test(String(action)))fail("This action is unavailable. Contact support for assistance.");window.parent.postMessage({type:"auvrenthia-admin-password-reset",userId:id},window.__AUVHOST__);log("Password reset requested",target.email,"Password reset email requested.");save()};
      const login=document.querySelector("#login");
      const app=document.querySelector("#app");
      if(login)login.hidden=true;
      if(app){
        app.hidden=false;
        const notice=document.createElement("div");
        notice.textContent="Money actions on this console post to the member ledger immediately and are written to the audit log.";
        notice.setAttribute("role","note");
        notice.style.cssText="margin:12px 18px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;color:var(--mute);font-size:13px";
        app.prepend(notice);
      }
      window.addEventListener("message",event=>{
        if(event.source!==window.parent||!window.__AUVORIGINOK__(event))return;
        if(event.data?.type==="auvrenthia-admin-persist-result"&&!event.data.ok)toast("This change could not be saved. Please try again.");
      });
      boot();
    })();
  `;

  const darkMode = document.documentElement.classList.contains('dark');
  return html
    .replace(
      '<html lang="en">',
      `<html lang="en" data-theme="${darkMode ? 'dark' : 'light'}">`,
    )
    .replace(
      '</head>',
      `<script>window.__AUVHOST__=(window.origin&&window.origin!=="null")?window.origin:"*";window.__AUVORIGINOK__=function(e){return window.__AUVHOST__==="*"||e.origin===window.__AUVHOST__};window.__AUVRENTHIA_DEPOSIT_METHODS__=${serializeInlineScript(bootstrap.depositMethods)};</script><style>${appTypography}${adminEmailStyles}</style></head>`,
    )
    .replace(
      '</body>',
      () =>
        `<script>${adminProfileBehavior}</script><script>${adminEmailBehavior}</script><script>${adminFinanceBehavior}</script><script>${adminManagementBehavior}</script><script>${bootstrapScript}</script><script>${adminInvestmentsBehavior}</script></body>`,
    );
}

export default function AdminPage({
  onLogout,
}: {
  onLogout: () => Promise<void>;
}) {
  const { user, profile, refreshProfile } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const profilesRef = useRef<AppProfile[]>([]);
  const depositMethodsRef = useRef<AdminDepositMethod[]>([]);
  const dashboardStatesRef = useRef<Map<string, Record<string, unknown>>>(
    new Map(),
  );
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [bootstrap, setBootstrap] = useState<AdminBootstrap | null>(null);
  const [pageError, setPageError] = useState('');

  const handleFrameLoad = useCallback(() => {
    const frameDocument = frameRef.current?.contentDocument;
    if (!frameDocument) return;

    const interceptLogout = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (
        !target ||
        typeof target.closest !== 'function' ||
        !target.closest('[data-a="logout"]')
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      void onLogout();
    };

    frameDocument.addEventListener('click', interceptLogout, true);
  }, [onLogout]);

  useEffect(() => {
    let active = true;
    async function loadAdminData() {
      if (!supabase || !user || !profile) {
        setPageError('Your session has expired. Sign in again.');
        return;
      }
      const client = supabase;
      const [
        profilesResult,
        stateResult,
        methodsResult,
        dashboardStatesResult,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id,email,first_name,last_name,address,country,phone,admin_note,role,account_status,kyc_status,withdrawals_enabled,demo_balance,created_at,updated_at',
          )
          .order('created_at', { ascending: false }),
        supabase
          .from('admin_console_state')
          .select('data')
          .eq('id', 'global')
          .maybeSingle(),
        supabase
          .from('deposit_methods')
          .select(
            'id,asset,network,address,qr_data_url,qr_storage_path,created_at,updated_at',
          )
          .order('asset'),
        supabase.from('member_dashboard_state').select('user_id,data'),
      ]);
      if (!active) return;
      if (
        profilesResult.error ||
        stateResult.error ||
        methodsResult.error ||
        dashboardStatesResult.error
      ) {
        setPageError(
          'Admin data could not be loaded. Check your access and try again. Contact support if this continues.',
        );
        return;
      }

      const profiles = (profilesResult.data || []) as AppProfile[];
      const dashboardRows = dashboardStatesResult.data || [];
      dashboardStatesRef.current = new Map(
        dashboardRows.map((row) => [
          row.user_id,
          row.data && typeof row.data === 'object'
            ? (row.data as Record<string, unknown>)
            : {},
        ]),
      );
      const storedState =
        stateResult.data?.data && typeof stateResult.data.data === 'object'
          ? (stateResult.data.data as Record<string, unknown>)
          : {};
      const methods = await Promise.all(
        (methodsResult.data || []).map(async (row) => {
          let qrDataUrl = row.qr_data_url || undefined;
          let qrStoragePath = row.qr_storage_path || '';
          if (
            !qrStoragePath &&
            qrDataUrl?.startsWith('data:image/') &&
            ['admin', 'owner', 'finance'].includes(profile.role)
          ) {
            if (!/^[A-Za-z0-9_-]{1,120}$/.test(row.id)) {
              throw new Error(
                'A deposit method has an invalid ID and its QR image cannot be stored.',
              );
            }
            const image = await fetch(qrDataUrl).then((response) => {
              if (!response.ok) throw new Error('The saved QR image is invalid.');
              return response.blob();
            });
            const extension =
              image.type === 'image/png'
                ? 'png'
                : image.type === 'image/webp'
                  ? 'webp'
                  : image.type === 'image/jpeg'
                    ? 'jpg'
                    : '';
            if (!extension) {
              throw new Error('A saved QR image has an unsupported format.');
            }
            qrStoragePath = `deposit-methods/${row.id}/qr.${extension}`;
            const { error: uploadError } = await client.storage
              .from(supabaseImageBucket)
              .upload(qrStoragePath, image, {
                cacheControl: '3600',
                contentType: image.type,
                upsert: true,
              });
            if (uploadError) {
              throw new Error(
                'Could not save the QR image. Please upload it again.',
              );
            }
            const { error: updateError } = await client
              .from('deposit_methods')
              .update({ qr_storage_path: qrStoragePath, qr_data_url: '' })
              .eq('id', row.id);
            if (updateError) {
              throw new Error(
                `The QR image was uploaded but its deposit method could not be updated: ${updateError.message}`,
              );
            }
            qrDataUrl = undefined;
          }
          if (qrStoragePath) {
            const { data, error } = await client.storage
              .from(supabaseImageBucket)
              .createSignedUrl(qrStoragePath, 60 * 60);
            if (error) throw error;
            qrDataUrl = data.signedUrl;
          }
          return {
            ...toAdminDepositMethod({
              ...row,
              qr_storage_path: qrStoragePath,
              qr_data_url: qrDataUrl?.startsWith('data:image/')
                ? qrDataUrl
                : '',
            }),
            qrDataUrl,
            qrStoragePath,
          };
        }),
      );
      const memberDeposits: AdminPaymentRecord[] = [];
      for (const dashboardRow of dashboardRows) {
        const data =
          dashboardRow.data && typeof dashboardRow.data === 'object'
            ? (dashboardRow.data as Record<string, unknown>)
            : {};
        const requests = Array.isArray(data.depositRequests)
          ? data.depositRequests
          : [];
        for (const value of requests) {
          if (!value || typeof value !== 'object') continue;
          const request = value as Record<string, unknown>;
          const memberRequestId =
            typeof request.id === 'string'
              ? request.id
              : `DEP-${dashboardRow.user_id}-${Number(request.t) || 0}`;
          const receiptPath =
            typeof request.receiptPath === 'string'
              ? request.receiptPath
              : '';
          let receiptUrl: string | undefined;
          let receiptError: string | undefined;
          if (
            receiptPath &&
            receiptPath.startsWith(
              `deposit-proofs/${dashboardRow.user_id}/`,
            ) &&
            !receiptPath.includes('..')
          ) {
            const { data: signed, error } = await supabase.storage
              .from(supabaseImageBucket)
              .createSignedUrl(receiptPath, 60 * 60);
            if (error) {
              receiptError = 'Receipt image could not be opened.';
            } else {
              receiptUrl = signed.signedUrl;
            }
          } else {
            receiptError = receiptPath
              ? 'The receipt storage path is invalid.'
              : 'No payment image was attached.';
          }
          memberDeposits.push({
            id: memberRequestId,
            memberRequestId,
            memberRequest: true,
            uid: dashboardRow.user_id,
            asset: String(request.a || 'Unknown'),
            net: String(request.net || '—'),
            amt: Number(request.amt) || 0,
            usd: Math.max(0, Number(request.usd) || 0),
            status: String(request.status || 'pending'),
            t: Number(request.t) || 0,
            note: String(request.note || ''),
            tx: 'Payment receipt submitted',
            receiptPath: receiptPath || undefined,
            receiptUrl,
            receiptName:
              typeof request.receiptName === 'string'
                ? request.receiptName
                : 'Payment receipt',
            receiptError,
          });
        }
      }
      const savedDeposits = Array.isArray(storedState.deposits)
        ? (storedState.deposits as AdminPaymentRecord[])
        : [];
      const currentMemberDepositIds = new Set(
        memberDeposits.map((record) => record.id),
      );
      const state = {
        ...EMPTY_ADMIN_STATE,
        ...storedState,
        deposits: [
          ...memberDeposits,
          ...savedDeposits.filter(
            (record) =>
              !record.memberRequest &&
              !currentMemberDepositIds.has(record.id),
          ),
        ],
        settings: {
          ...(EMPTY_ADMIN_STATE.settings as Record<string, unknown>),
          ...(storedState.settings as Record<string, unknown> | undefined),
        },
        users: profiles.map(toAdminUser),
        team: profiles
          .filter((row) => row.role !== 'member')
          .map((row) => ({
            id: row.id,
            email: row.email,
            role: STAFF_ROLE_LABELS[row.role],
            on:
              row.account_status !== 'suspended' &&
              row.account_status !== 'archived',
          })),
      };
      profilesRef.current = profiles;
      depositMethodsRef.current = methods;
      setBootstrap({
        me: {
          email: user.email || profile.email,
          role: STAFF_ROLE_LABELS[profile.role],
          displayName: [profile.first_name, profile.last_name]
            .filter(Boolean)
            .join(' '),
        },
        state,
        depositMethods: methods,
      });
      setPageError('');
    }

    void loadAdminData().catch((error: unknown) => {
      if (active) {
        setPageError(
          error instanceof Error
            ? error.message
            : 'Admin data could not be loaded.',
        );
      }
    });

    return () => {
      active = false;
    };
  }, [profile, user]);

  async function persistAdminState(nextState: Record<string, unknown>) {
    if (!supabase) throw new Error('Account services are temporarily unavailable.');
    const users = Array.isArray(nextState.users)
      ? (nextState.users as AdminUserRecord[])
      : [];
    const team = Array.isArray(nextState.team)
      ? (nextState.team as Array<{
          id: string;
          email: string;
          role: string;
          on: boolean;
        }>)
      : [];
    let changedOwnProfile = false;

    for (const adminUser of users) {
      const current = profilesRef.current.find(
        (row) => row.id === adminUser.id,
      );
      if (!current) {
        throw new Error('Only accounts that have signed up can be managed here.');
      }
      const nameParts = String(adminUser.name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const desired: Record<string, unknown> = {
        first_name: nameParts[0] || '',
        last_name: nameParts.slice(1).join(' '),
        address: String(adminUser.address || ''),
        country: String(adminUser.country || ''),
        phone: String(adminUser.phone || ''),
        admin_note: String(adminUser.notes || '').slice(0, 3000),
        account_status: ['active', 'hold', 'suspended', 'archived'].includes(
          String(adminUser.status).toLowerCase(),
        )
          ? String(adminUser.status).toLowerCase()
          : 'active',
        kyc_status: (() => {
          const status = String(adminUser.kyc || '').toLowerCase();
          if (status === 'approved') return 'verified';
          return ['none', 'pending', 'verified', 'rejected'].includes(status)
            ? status
            : 'none';
        })(),
        withdrawals_enabled: Boolean(adminUser.wd),
      };
      const currentValues: Record<string, unknown> = {
        first_name: current.first_name,
        last_name: current.last_name,
        address: current.address,
        country: current.country,
        phone: current.phone,
        admin_note: current.admin_note || '',
        account_status: current.account_status,
        kyc_status: current.kyc_status,
        withdrawals_enabled: current.withdrawals_enabled,
      };
      const patch = Object.fromEntries(
        Object.entries(desired).filter(
          ([key, value]) => currentValues[key] !== value,
        ),
      );
      if (Object.keys(patch).length === 0) continue;

      const { error } = await supabase.rpc('admin_update_profile', {
        p_user_id: adminUser.id,
        p_patch: patch,
      });
      if (error) throw error;
      profilesRef.current = profilesRef.current.map((row) =>
        row.id === adminUser.id ? ({ ...row, ...patch } as AppProfile) : row,
      );
      if (adminUser.id === user?.id) changedOwnProfile = true;
    }

    // Team sync is skipped when the console sent no team list, so an empty or
    // missing list can never demote every staff account (including yours).
    const desiredTeam = new Map<string, AppProfile['role']>();
    for (const member of team) {
      const role = member.on ? roleFromAdminLabel(member.role) : 'member';
      if (role) desiredTeam.set(String(member.email).trim().toLowerCase(), role);
    }
    for (const staffProfile of team.length === 0
      ? []
      : profilesRef.current.filter((row) => row.role !== 'member')) {
      // Never change the signed-in user's own role from here, and never demote
      // someone just because they are missing from the list.
      if (staffProfile.id === user?.id) continue;
      const role = desiredTeam.get(staffProfile.email.toLowerCase());
      if (!role) continue;
      if (role === staffProfile.role) continue;
      const { error } = await supabase.rpc('admin_set_profile_role', {
        p_user_id: staffProfile.id,
        p_role: role,
      });
      if (error) throw error;
      profilesRef.current = profilesRef.current.map((row) =>
        row.id === staffProfile.id ? { ...row, role } : row,
      );
    }
    for (const [email, role] of desiredTeam) {
      const memberProfile = profilesRef.current.find(
        (row) => row.email.toLowerCase() === email,
      );
      if (!memberProfile) {
        throw new Error(
          'The person must create an account before receiving a staff role.',
        );
      }
      if (memberProfile.id === user?.id) continue;
      if (memberProfile.role === role || role === 'member') continue;
      const { error } = await supabase.rpc('admin_set_profile_role', {
        p_user_id: memberProfile.id,
        p_role: role,
      });
      if (error) throw error;
      profilesRef.current = profilesRef.current.map((row) =>
        row.id === memberProfile.id ? { ...row, role } : row,
      );
      if (memberProfile.id === user?.id) changedOwnProfile = true;
    }

    const deposits = Array.isArray(nextState.deposits)
      ? (nextState.deposits as AdminPaymentRecord[])
      : [];
    for (const payment of deposits) {
      if (!payment.memberRequest || !payment.uid || !payment.memberRequestId) {
        continue;
      }
      const currentData = dashboardStatesRef.current.get(payment.uid);
      if (!currentData || !Array.isArray(currentData.depositRequests)) {
        continue;
      }
      const requests = currentData.depositRequests as Array<
        Record<string, unknown>
      >;
      const requestIndex = requests.findIndex(
        (request) => request.id === payment.memberRequestId,
      );
      if (requestIndex < 0) continue;
      const currentRequest = requests[requestIndex];
      const status = String(payment.status || 'pending');
      const note = String(payment.note || '').slice(0, 1000);
      if (currentRequest.status === status && currentRequest.note === note) {
        continue;
      }
      const nextRequests = requests.map((request, index) =>
        index === requestIndex
          ? {
              ...request,
              status,
              note,
              reviewedAt: new Date().toISOString(),
            }
          : request,
      );
      const nextData = { ...currentData, depositRequests: nextRequests };
      const { error } = await supabase
        .from('member_dashboard_state')
        .upsert(
          { user_id: payment.uid, data: nextData },
          { onConflict: 'user_id' },
        );
      if (error) throw error;
      dashboardStatesRef.current.set(payment.uid, nextData);
    }

    const persisted = { ...nextState };
    delete persisted.users;
    delete persisted.team;
    // Deposits, withdrawals, investments and the plan catalog now live in real tables.
    delete persisted.deposits;
    delete persisted.withdrawals;
    delete persisted.plans;
    delete persisted.catalog;
    if (Array.isArray(persisted.audit)) {
      persisted.audit = (persisted.audit as Array<Record<string, unknown>>).filter(
        (entry) => !entry.srv,
      );
    }
    if (Array.isArray(persisted.deposits)) {
      persisted.deposits = (
        persisted.deposits as Array<Record<string, unknown>>
      ).map((record) => {
        const { receiptUrl: _receiptUrl, receiptError: _receiptError, ...safe } =
          record;
        return safe;
      });
    }
    const { error } = await supabase
      .from('admin_console_state')
      .upsert({ id: 'global', data: persisted }, { onConflict: 'id' });
    if (error) throw error;
    if (changedOwnProfile) await refreshProfile();
  }

  async function persistDepositMethods(value: unknown) {
    if (!supabase || !Array.isArray(value)) {
      throw new Error('Deposit methods could not be saved.');
    }
    const methods = value as AdminDepositMethod[];
    const isSignedQrUrl = (value: string) => {
      try {
        const url = new URL(value);
        return (
          value.length <= 4_096 &&
          url.protocol === 'https:' &&
          url.hostname.endsWith('.supabase.co') &&
          url.pathname.includes('/storage/v1/object/sign/')
        );
      } catch {
        return false;
      }
    };
    const currentById = new Map(
      depositMethodsRef.current.map((method) => [method.id, method]),
    );
    const rows: Array<Record<string, unknown>> = [];
    const savedMethods: AdminDepositMethod[] = [];
    for (const method of methods) {
      const qrDataUrl = method?.qrDataUrl || '';
      if (
        !method ||
        typeof method.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(method.id) ||
        typeof method.asset !== 'string' ||
        typeof method.network !== 'string' ||
        typeof method.address !== 'string' ||
        method.address.length > 512 ||
        (method.qrStoragePath && method.qrStoragePath.length > 512) ||
        (qrDataUrl &&
          !(
            (qrDataUrl.length <= 720_000 &&
              /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(
                qrDataUrl,
              )) ||
            isSignedQrUrl(qrDataUrl)
          ))
      ) {
        throw new Error('A deposit method contains invalid or oversized data.');
      }
      const previous = currentById.get(method.id);
      let qrStoragePath =
        method.qrStoragePath === undefined
          ? previous?.qrStoragePath || ''
          : method.qrStoragePath;
      if (qrDataUrl.startsWith('data:image/')) {
        const image = await fetch(qrDataUrl).then((response) => {
          if (!response.ok) throw new Error('The selected QR image is invalid.');
          return response.blob();
        });
        if (!image.size || image.size > 512 * 1024) {
          throw new Error('The QR image must be smaller than 512 KB.');
        }
        const extension =
          image.type === 'image/png'
            ? 'png'
            : image.type === 'image/webp'
              ? 'webp'
              : image.type === 'image/jpeg'
                ? 'jpg'
                : '';
        if (!extension) {
          throw new Error('Choose a PNG, JPG, or WebP QR image.');
        }
        qrStoragePath = `deposit-methods/${method.id}/qr.${extension}`;
        const { error } = await supabase.storage
          .from(supabaseImageBucket)
          .upload(qrStoragePath, image, {
            cacheControl: '3600',
            contentType: image.type,
            upsert: true,
          });
        if (error) {
          throw new Error(`The QR image could not be uploaded: ${error.message}`);
        }
      } else if (qrDataUrl && !qrStoragePath) {
        throw new Error('The selected QR image has no storage path.');
      } else if (!qrDataUrl && method.qrStoragePath === undefined) {
        qrStoragePath = previous?.qrStoragePath || '';
      }
      rows.push({
        id: method.id,
        asset: method.asset.trim(),
        network: method.network.trim(),
        address: method.address.trim(),
        qr_data_url: '',
        qr_storage_path: qrStoragePath,
        is_active: true,
      });
      savedMethods.push({
        ...method,
        qrStoragePath,
        qrDataUrl: qrDataUrl || undefined,
      });
    }
    if (rows.length) {
      const { error } = await supabase
        .from('deposit_methods')
        .upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }

    const nextIds = new Set(methods.map((method) => method.id));
    const removedQrPaths = depositMethodsRef.current
      .map((method) => method.qrStoragePath || '')
      .filter(
        (path) =>
          path &&
          !savedMethods.some((method) => method.qrStoragePath === path),
      );
    const removedIds = depositMethodsRef.current
      .filter((method) => !nextIds.has(method.id))
      .map((method) => method.id);
    if (removedIds.length) {
      const { error } = await supabase
        .from('deposit_methods')
        .delete()
        .in('id', removedIds);
      if (error) throw error;
    }
    if (removedQrPaths.length) {
      const { error } = await supabase.storage
        .from(supabaseImageBucket)
        .remove(removedQrPaths);
      if (error) {
        throw new Error(
          `Methods were saved, but an old QR image could not be removed: ${error.message}`,
        );
      }
    }
    depositMethodsRef.current = savedMethods;
  }

  useEffect(() => {
    function postResult(type: string, ok: boolean, message?: string) {
      frameRef.current?.contentWindow?.postMessage(
        { type, ok, message },
        window.location.origin,
      );
    }

    function handleMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== window.location.origin
      ) {
        return;
      }
      if (
        handleInvestmentsMessage(
          event,
          frameRef.current,
          supabase,
          buildAdminOps(user?.id || ''),
        )
      ) {
        return;
      }
      if (
        event.data?.type === 'auvrenthia-admin-state-update' &&
        event.data.state &&
        typeof event.data.state === 'object'
      ) {
        const nextState = event.data.state as Record<string, unknown>;
        saveQueueRef.current = saveQueueRef.current
          .catch(() => undefined)
          .then(() => persistAdminState(nextState))
          .then(() => {
            setPageError('');
            postResult('auvrenthia-admin-persist-result', true);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : 'This admin change could not be saved. Please try again.';
            setPageError(message);
            postResult('auvrenthia-admin-persist-result', false, message);
          });
      } else if (
        event.data?.type === 'auvrenthia-admin-deposit-methods-update'
      ) {
        void persistDepositMethods(event.data.methods)
          .then(() => {
            setPageError('');
            postResult('auvrenthia-admin-persist-result', true);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : 'Deposit methods could not be saved.';
            setPageError(message);
            postResult('auvrenthia-admin-persist-result', false, message);
          });
      } else if (
        event.data?.type === 'auvrenthia-admin-password-reset' &&
        typeof event.data.userId === 'string' &&
        supabase
      ) {
        const target = profilesRef.current.find(
          (row) => row.id === event.data.userId,
        );
        if (!target?.email) {
          setPageError('No email address is available for this account.');
          return;
        }
        void supabase.auth
          .resetPasswordForEmail(target.email, {
            redirectTo: appRedirectUrl('/login'),
          })
          .then(({ error }) => {
            if (error) throw error;
            setPageError('');
            postResult('auvrenthia-admin-persist-result', true);
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : 'Password reset could not be sent.';
            setPageError(message);
            postResult('auvrenthia-admin-persist-result', false, message);
          });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshProfile, user?.id]);

  const sourceDocument = useMemo(
    () => (bootstrap ? buildAdminDocument(bootstrap) : ''),
    [bootstrap],
  );

  if (pageError && !bootstrap) {
    return (
      <main className="admin-page-source">
        <section role="alert" className="admin-data-error">
          <h1>Admin console unavailable</h1>
          <p>{pageError}</p>
        </section>
      </main>
    );
  }
  if (!bootstrap) {
    return (
      <main className="admin-page-source">
        <p role="status" className="admin-data-loading">Loading admin data…</p>
      </main>
    );
  }
  return (
    <main className="admin-page-source">
      {pageError && <p role="alert" className="admin-sync-error">{pageError}</p>}
      <iframe
        ref={frameRef}
        className="admin-page-frame"
        title="Auvrenthia Markets admin console"
        srcDoc={sourceDocument}
        onLoad={handleFrameLoad}
      />
    </main>
  );
}
