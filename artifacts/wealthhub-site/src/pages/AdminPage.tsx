import { useMemo } from 'react';
import adminHtml from '@assets/admin_1793083123310.html?raw';
import {
  adminEmailBehavior,
  adminEmailStyles,
} from './admin-email-composer';
import { adminManagementBehavior } from './admin-management';
import './admin-page.css';

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

function buildAdminDocument() {
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

  html = replaceRequired(
    html,
    '<div class="top"><button class="ic menu" data-a="menu" aria-label="Open menu">&#9776;</button><b id="who"></b><button class="ic" data-a="theme" aria-label="Switch light or dark mode">&#9680;</button><button class="btn alt sm" data-a="logout">Sign out</button></div>',
    adminTopBar,
    'admin header',
  );
  html = replaceRequired(
    html,
    '$("#who").textContent=ME.email+" \\u00b7 "+(ROLES[ME.role]?ME.role:"Owner");render()',
    '$("#admin-profile-role").textContent=ROLES[ME.role]?ME.role:"Owner";$("#admin-profile-email").textContent=ME.email;$("#admin-profile-initial").textContent=(ME.email||"A").trim().slice(0,1).toUpperCase();render()',
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

  const darkMode = document.documentElement.classList.contains('dark');
  return html
    .replace(
      '<html lang="en">',
      `<html lang="en" data-theme="${darkMode ? 'dark' : 'light'}">`,
    )
    .replace('</head>', `<style>${appTypography}${adminEmailStyles}</style></head>`)
    .replace(
      '</body>',
      `<script>${adminProfileBehavior}</script><script>${adminEmailBehavior}</script><script>${adminManagementBehavior}</script></body>`,
    );
}

export default function AdminPage() {
  const sourceDocument = useMemo(() => buildAdminDocument(), []);

  return (
    <main className="admin-page-source">
      <iframe
        className="admin-page-frame"
        title="Auvrenthia Markets admin console"
        srcDoc={sourceDocument}
      />
    </main>
  );
}
