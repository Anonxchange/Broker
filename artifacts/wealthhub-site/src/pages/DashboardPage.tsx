import { useEffect, useMemo, useRef } from 'react';
import harborDashboardHtml from '@assets/Harbor_–_Investing_(1)_1792836967110.html?raw';
import './dashboard-page.css';

type DashboardPageProps = {
  onLogout: () => void;
};

function buildDashboardDocument() {
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
    .logo .dashboard-brand-mark,
    #title .dashboard-brand-mark {
      display: block;
      width: 171px;
      max-width: 100%;
      height: auto;
    }
    #title {
      display: flex;
      min-width: 0;
      align-items: center;
    }
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
  const headerLogoControl = `
    const dashboardTitle=document.querySelector("#title");
    const syncHeaderLogo=()=>{
      if(!dashboardTitle||dashboardTitle.querySelector("[data-dashboard-brand]"))return;
      const logo=document.createElement("img");
      logo.src="/wealthhub/auvrenthia-logo.svg";
      logo.alt="Auvrenthia Markets";
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
      /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+">/,
      '',
    )
    .replaceAll('#6D93FF', 'var(--brand)')
    .replaceAll(
      'rgba(109,147,255,.22)',
      'color-mix(in srgb,var(--brand) 22%,transparent)',
    )
    .replace(
      /function lg\(t\)\{[\s\S]*?\nfunction renderRail/,
      'function lg(t){return `<b class="lg" style="background:var(--brand);color:#fff">${t.replace(/[^A-Za-z0-9]/g,"").slice(0,3)}</b>`}\nfunction renderRail',
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
    .replace('</head>', `<style>${wealthHubTypography}</style></head>`)
    .replace(
      '</body>',
      `<script>${logoutControl}${headerLogoControl}</script></body>`,
    );

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
