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
