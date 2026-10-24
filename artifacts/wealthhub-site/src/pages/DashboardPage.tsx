import { useEffect, useMemo, useRef } from 'react';
import harborDashboardHtml from '@assets/Harbor_–_Investing_(1)_1792836967110.html?raw';
import './dashboard-page.css';

type DashboardPageProps = {
  onLogout: () => void;
};

const themeTokens = [
  'background',
  'foreground',
  'muted-foreground',
  'border',
  'brand-primary',
  'primary-foreground',
  'sidebar',
  'sidebar-foreground',
  'brand-green',
  'destructive',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const;

type ThemeValues = Record<(typeof themeTokens)[number], string>;

function readThemeValues(className = ''): ThemeValues {
  const probe = document.createElement('div');
  if (className) probe.className = className;
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const values = Object.fromEntries(
    themeTokens.map((token) => [
      token,
      style.getPropertyValue(`--${token}`).trim(),
    ]),
  ) as ThemeValues;
  probe.remove();
  return values;
}

function cssVariables(values: ThemeValues, mode: 'light' | 'dark') {
  const declarations = [
    `--bg:${values.background}`,
    `--ink:${values.foreground}`,
    `--mute:${values['muted-foreground']}`,
    `--line:${values.border}`,
    `--brand:${values['brand-primary']}`,
    `--side:${values.sidebar}`,
    `--side-t:${values['sidebar-foreground']}`,
    `--up:${values['brand-green']}`,
    `--dn:${values.destructive}`,
    `--primary-foreground:${values['primary-foreground']}`,
    ...themeTokens
      .filter((token) => token.startsWith('chart-'))
      .map((token) => `--${token}:${values[token]}`),
  ].join(';');
  return `:root[data-theme="${mode}"]{${declarations};color-scheme:${mode}}`;
}

function buildDashboardDocument() {
  const light = readThemeValues();
  const dark = readThemeValues('dark');
  const font = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--app-font-sans')
    .trim();
  const themeStyles = `
    ${cssVariables(light, 'light')}
    ${cssVariables(dark, 'dark')}
    body{font-family:${font || 'system-ui,sans-serif'}!important}
    #mix div:nth-child(1){background:var(--brand)!important;color:var(--primary-foreground)!important}
    #mix div:nth-child(2){background:var(--chart-2)!important;color:var(--primary-foreground)!important}
    #mix div:nth-child(3){background:var(--chart-3)!important;color:var(--primary-foreground)!important}
    #mix div:nth-child(4){background:var(--chart-4)!important;color:var(--ink)!important}
    #mix div:nth-child(5){background:var(--line)!important;color:var(--ink)!important}
  `;
  const logoutControl = `
    const memberAvatar=document.querySelector(".av");
    if(memberAvatar){
      memberAvatar.setAttribute("role","button");
      memberAvatar.setAttribute("tabindex","0");
      memberAvatar.setAttribute("aria-label","Sign out");
      memberAvatar.title="Sign out";
      const requestLogout=()=>window.parent.postMessage({type:"auvrenthia-member-logout"},"*");
      memberAvatar.addEventListener("click",requestLogout);
      memberAvatar.addEventListener("keydown",event=>{
        if(event.key==="Enter"||event.key===" "){event.preventDefault();requestLogout()}
      });
    }
  `;
  let html = harborDashboardHtml
    .replace('<title>Harbor – Investing</title>', '<title>Auvrenthia Markets</title>')
    .replace('<div class="logo">Harbor</div>', '<div class="logo">Auvrenthia Markets</div>')
    .replace(
      /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/,
      '',
    )
    .replaceAll('#fff', 'var(--primary-foreground)')
    .replaceAll('#6D93FF', 'var(--brand)')
    .replaceAll(
      'rgba(109,147,255,.22)',
      'color-mix(in srgb,var(--brand) 22%,transparent)',
    )
    .replaceAll(
      'fontFamily:"Schibsted Grotesk,system-ui,sans-serif"',
      'fontFamily:getComputedStyle(document.body).fontFamily',
    )
    .replaceAll(
      'const CL={Stocks:["#1F4FFF","var(--primary-foreground)",48200],ETFs:["#6B93FF","#06134A",27600],Crypto:["#0A2A9E","var(--primary-foreground)",19400],"Real estate":["#A9D2FF","#06134A",14100],Forex:["#3D7BFF","var(--primary-foreground)",0],Commodities:["#14388F","var(--primary-foreground)",0],Agriculture:["#5FB4E8","#06134A",0],Bonds:["#7B8FD6","#06134A",0],Plans:["#3D7BFF","var(--primary-foreground)",0],Cash:["#C5D3F5","#06134A",0]};',
      'const CL={Stocks:["var(--brand)","var(--primary-foreground)",48200],ETFs:["var(--chart-2)","var(--primary-foreground)",27600],Crypto:["var(--chart-3)","var(--primary-foreground)",19400],"Real estate":["var(--chart-4)","var(--ink)",14100],Forex:["var(--chart-1)","var(--primary-foreground)",0],Commodities:["var(--chart-5)","var(--primary-foreground)",0],Agriculture:["var(--chart-2)","var(--primary-foreground)",0],Bonds:["var(--chart-4)","var(--ink)",0],Plans:["var(--brand)","var(--primary-foreground)",0],Cash:["var(--line)","var(--ink)",0]};',
    )
    .replace(
      /function lg\(t\)\{[\s\S]*?\nfunction renderRail/,
      'function lg(t){return `<b class="lg" style="background:var(--brand);color:var(--primary-foreground)">${t.replace(/[^A-Za-z0-9]/g,"").slice(0,3)}</b>`}\nfunction renderRail',
    )
    .replace(
      /async function loadCrypto\(\)\{[\s\S]*?\nfunction lg/,
      'async function loadCrypto(){LIVE={ok:false,msg:"Sample market prices are shown."};tickRender();renderRail();renderList()}\nfunction lg',
    )
    .replace(
      /async function loadPublic\(\)\{[\s\S]*?\}\ntickRender\(\);/,
      'async function loadPublic(){LIVE={ok:false,msg:"Sample market prices are shown."}}\ntickRender();',
    )
    .replace(
      'ST.wallet=(await window.ethereum.request({method:"eth_requestAccounts"}))[0]',
      'throw new Error("Wallet connection is disabled in this preview.")',
    )
    .replace('</head>', `<style>${themeStyles}</style></head>`)
    .replace('</body>', `<script>${logoutControl}</script></body>`);

  const darkMode = document.documentElement.classList.contains('dark');
  html = html.replace(
    '<html lang="en">',
    `<html lang="en" data-theme="${darkMode ? 'dark' : 'light'}">`,
  );
  return html;
}

export default function DashboardPage({ onLogout }: DashboardPageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sourceDocument = useMemo(() => buildDashboardDocument(), []);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (
        event.source === frameRef.current?.contentWindow &&
        event.data?.type === 'auvrenthia-member-logout'
      ) {
        onLogout();
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onLogout]);

  return (
    <main className="member-dashboard-source">
      <iframe
        ref={frameRef}
        className="member-dashboard-frame"
        title="Auvrenthia Markets member dashboard"
        srcDoc={sourceDocument}
      />
    </main>
  );
}
