type MarketRow = unknown[];
type WatchlistEntry = { category: string; symbol: string };
type PriceAlert = {
  id: string;
  category: string;
  symbol: string;
  target: number;
  direction: 'above' | 'below';
  triggeredAt?: number;
  observedPrice?: number;
};

declare const D: Record<string, MarketRow[]>;
declare const R: Record<string, () => void>;
declare const ST: {
  watchlist?: unknown[];
  priceAlerts?: unknown[];
  tx?: unknown[];
  depositRequests?: unknown[];
  [key: string]: unknown;
};
declare const page: string;
declare function loadCrypto(): Promise<void>;
declare function save(): void;
declare function fmt(amount: number): string;

export function installMemberDashboardTools() {
  const categories = ['Stocks', 'ETFs', 'Crypto', 'Forex', 'Commodities'];
  const root = document.getElementById('misc');
  if (!root) return;

  const escapeHtml = (value: unknown) =>
    String(value ?? '').replace(/[&<>"']/g, (character) => {
      const escaped: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return escaped[character] || character;
    });

  const publicResponseCache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();
  const publicResponseInFlight = new Map<string, Promise<unknown>>();
  let publicContentRequest = 0;

  const requestPublicJson = async (
    key: string,
    url: string,
    ttlMs = 120_000,
  ): Promise<unknown> => {
    const cached = publicResponseCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let pending = publicResponseInFlight.get(key);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Public market provider returned HTTP ${response.status}.`);
        }
        const value: unknown = await response.json();
        publicResponseCache.set(key, {
          expiresAt: Date.now() + ttlMs,
          value,
        });
        return value;
      })();
      publicResponseInFlight.set(key, pending);
    }

    try {
      return await pending;
    } finally {
      if (publicResponseInFlight.get(key) === pending) {
        publicResponseInFlight.delete(key);
      }
    }
  };

  const safeExternalUrl = (value: unknown) => {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  };

  const formatPublicDate = (value: unknown) => {
    if (typeof value !== 'string' || !value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : '';
  };

  const liveRows = () =>
    categories.flatMap((category) => {
      const values = Array.isArray(D[category]) ? D[category] : [];
      return values.flatMap((raw) => {
        if (!Array.isArray(raw) || typeof raw[0] !== 'string') return [];
        const price = Number(raw[2]);
        if (!Number.isFinite(price)) return [];
        return [
          {
            category,
            symbol: raw[0],
            name: String(raw[1] ?? raw[0]),
            price,
            change:
              typeof raw[3] === 'number' && Number.isFinite(raw[3])
                ? raw[3]
                : null,
            open:
              typeof raw[6] === 'number' && Number.isFinite(raw[6])
                ? raw[6]
                : null,
            high:
              typeof raw[7] === 'number' && Number.isFinite(raw[7])
                ? raw[7]
                : null,
            low:
              typeof raw[8] === 'number' && Number.isFinite(raw[8])
                ? raw[8]
                : null,
            volume:
              typeof raw[10] === 'number' && Number.isFinite(raw[10])
                ? raw[10]
                : null,
          },
        ];
      });
    });

  const watchlist = (): WatchlistEntry[] => {
    if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
    return (ST.watchlist as unknown[]).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const value = entry as Record<string, unknown>;
      if (
        typeof value.category !== 'string' ||
        !categories.includes(value.category) ||
        typeof value.symbol !== 'string'
      ) {
        return [];
      }
      return [{ category: value.category, symbol: value.symbol }];
    });
  };

  const alerts = (): PriceAlert[] => {
    if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];
    return (ST.priceAlerts as unknown[]).flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const value = entry as Record<string, unknown>;
      if (
        typeof value.id !== 'string' ||
        typeof value.category !== 'string' ||
        !categories.includes(value.category) ||
        typeof value.symbol !== 'string' ||
        typeof value.target !== 'number' ||
        !Number.isFinite(value.target) ||
        (value.direction !== 'above' && value.direction !== 'below')
      ) {
        return [];
      }
      return [
        {
          id: value.id,
          category: value.category,
          symbol: value.symbol,
          target: value.target,
          direction: value.direction,
          ...(typeof value.triggeredAt === 'number'
            ? { triggeredAt: value.triggeredAt }
            : {}),
          ...(typeof value.observedPrice === 'number'
            ? { observedPrice: value.observedPrice }
            : {}),
        },
      ];
    });
  };

  const priceText = (category: string, price: number) =>
    category === 'Forex'
      ? price.toFixed(4)
      : category === 'Crypto' && Math.abs(price) < 0.01
        ? `$${price.toPrecision(4)}`
        : fmt(price);

  const isWatched = (category: string, symbol: string) =>
    watchlist().some(
      (entry) => entry.category === category && entry.symbol === symbol,
    );

  const toggleWatchlist = (category: string, symbol: string) => {
    const current = watchlist();
    const exists = current.some(
      (entry) => entry.category === category && entry.symbol === symbol,
    );
    ST.watchlist = exists
      ? current.filter(
          (entry) => entry.category !== category || entry.symbol !== symbol,
        )
      : [...current, { category, symbol }].slice(0, 100);
    save();
    if (page === 'Screener') drawScreenerRows();
    if (page === 'Watchlist') renderWatchlist();
  };

  const rowMarkup = (
    row: ReturnType<typeof liveRows>[number],
    showAction = true,
  ) => {
    const changeClass =
      row.change === null ? '' : row.change >= 0 ? 'up' : 'dn';
    const changeText =
      row.change === null
        ? '—'
        : `${row.change >= 0 ? '+' : '−'}${Math.abs(row.change).toFixed(2)}%`;
    const watched = isWatched(row.category, row.symbol);
    const quoteDetails = [
      row.open === null ? '' : `Open ${priceText(row.category, row.open)}`,
      row.high === null ? '' : `High ${priceText(row.category, row.high)}`,
      row.low === null ? '' : `Low ${priceText(row.category, row.low)}`,
      row.volume === null || row.volume <= 0
        ? ''
        : `Vol ${new Intl.NumberFormat(undefined, {
            notation: 'compact',
            maximumFractionDigits: 1,
          }).format(row.volume)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    return `<div class="member-tool-row">
      <div class="member-tool-symbol"><b>${escapeHtml(row.symbol)}</b><small>${escapeHtml(row.name)} · ${escapeHtml(row.category)}</small>${quoteDetails ? `<small class="member-tool-quote-details">${escapeHtml(quoteDetails)}</small>` : ''}</div>
      <div class="member-tool-number">${escapeHtml(priceText(row.category, row.price))}</div>
      <div class="member-tool-number ${changeClass}">${changeText}</div>
      ${
        showAction
          ? `<button class="btn alt member-tool-action" type="button" data-tool-action="toggle-watch" data-category="${escapeHtml(row.category)}" data-symbol="${escapeHtml(row.symbol)}">${watched ? 'Remove from watchlist' : 'Add to watchlist'}</button>`
          : ''
      }
    </div>`;
  };

  const noMarketData = () =>
    '<p class="note">Live TradingView quotes are not available right now. Check the public market-data connection and try again.</p>';

  const drawScreenerRows = () => {
    const results = root.querySelector<HTMLElement>('[data-tool-results]');
    if (!results) return;
    const query =
      root.querySelector<HTMLInputElement>('#member-screener-search')?.value
        .trim()
        .toLowerCase() || '';
    const category =
      root.querySelector<HTMLSelectElement>('#member-screener-category')
        ?.value || 'All';
    const sort =
      root.querySelector<HTMLSelectElement>('#member-screener-sort')?.value ||
      'name';
    const rows = liveRows()
      .filter(
        (row) =>
          (category === 'All' || row.category === category) &&
          (!query ||
            row.symbol.toLowerCase().includes(query) ||
            row.name.toLowerCase().includes(query)),
      )
      .sort((a, b) => {
        if (sort === 'price') return b.price - a.price;
        if (sort === 'change') return (b.change ?? -Infinity) - (a.change ?? -Infinity);
        return a.symbol.localeCompare(b.symbol);
      });

    results.innerHTML = rows.length
      ? `<div class="member-tool-row member-tool-heading"><b>Asset</b><b>Price</b><b>24h</b><span></span></div>${rows
          .slice(0, 100)
          .map((row) => rowMarkup(row))
          .join('')}`
      : liveRows().length
        ? '<p class="note">No assets match those filters.</p>'
        : noMarketData();
  };

  const renderScreener = () => {
    root.innerHTML = `<div class="head"><div><div class="lbl">Live market data</div><div class="bal">Screener</div></div></div>
      <p class="note">Search and sort current TradingView quotes. Prices are informational and are not trade instructions.</p>
      <div class="member-tool-filters">
        <label>Search<input id="member-screener-search" type="search" placeholder="Search symbol or name"></label>
        <label>Category<select id="member-screener-category"><option>All</option>${categories
          .map((category) => `<option>${category}</option>`)
          .join('')}</select></label>
        <label>Sort<select id="member-screener-sort"><option value="name">Symbol</option><option value="price">Price</option><option value="change">24h change</option></select></label>
      </div>
      <div class="member-tool-list" data-tool-results></div>`;
    drawScreenerRows();
    if (!liveRows().length) {
      void loadCrypto().then(() => {
        if (page === 'Screener') drawScreenerRows();
      });
    }
  };

  const renderWatchlist = () => {
    const selected = watchlist();
    const available = liveRows();
    const rows = selected.flatMap((entry) => {
      const row = available.find(
        (asset) =>
          asset.category === entry.category && asset.symbol === entry.symbol,
      );
      return row ? [row] : [];
    });
    root.innerHTML = `<div class="head"><div><div class="lbl">Saved across sessions</div><div class="bal">Watchlist</div></div><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Screener">Find assets</button></div>
      <p class="note">Your watchlist is saved with your member dashboard. Prices refresh from TradingView when quotes are available.</p>
      <div class="member-tool-list">${rows.length ? rows.map((row) => rowMarkup(row)).join('') : selected.length ? '<p class="note">Your saved assets are not in the latest market feed. They remain saved and can be removed below.</p>' + selected.map((entry) => `<div class="member-tool-row"><div class="member-tool-symbol"><b>${escapeHtml(entry.symbol)}</b><small>${escapeHtml(entry.category)} · no current quote</small></div><span></span><span></span><button class="btn alt member-tool-action" type="button" data-tool-action="toggle-watch" data-category="${escapeHtml(entry.category)}" data-symbol="${escapeHtml(entry.symbol)}">Remove</button></div>`).join('') : '<p class="note">No saved assets yet. Open Screener and choose “Add to watchlist.”</p>'}</div>`;
    if (!available.length) {
      void loadCrypto().then(() => {
        if (page === 'Watchlist') renderWatchlist();
      });
    }
  };

  const renderAlerts = (message = '') => {
    const rows = liveRows();
    const savedAlerts = alerts();
    const options = rows
      .map(
        (row) =>
          `<option value="${escapeHtml(JSON.stringify({ category: row.category, symbol: row.symbol }))}">${escapeHtml(row.symbol)} · ${escapeHtml(row.category)} · ${escapeHtml(priceText(row.category, row.price))}</option>`,
      )
      .join('');
    root.innerHTML = `<div class="head"><div><div class="lbl">Manual checks while this dashboard is open</div><div class="bal">Price alerts</div></div><button class="btn alt" type="button" data-tool-action="check-alerts">Check prices now</button></div>
      <p class="note">Alerts are saved to your dashboard and checked when you press the button. This does not send email or push notifications.</p>
      <div class="member-tool-alert-form">
        <label>Asset<select id="member-alert-asset" ${rows.length ? '' : 'disabled'}>${options || '<option value="">Waiting for live market data…</option>'}</select></label>
        <label>Condition<select id="member-alert-direction"><option value="above">Price rises above</option><option value="below">Price falls below</option></select></label>
        <label>Target price<input id="member-alert-target" type="number" min="0.00000001" step="any" placeholder="Enter a target" ${rows.length ? '' : 'disabled'}></label>
        <button class="btn" type="button" data-tool-action="create-alert" ${rows.length ? '' : 'disabled'}>Create alert</button>
      </div>
      <p class="note" role="status" data-alert-message>${escapeHtml(message)}</p>
      <div class="member-tool-list">${savedAlerts.length ? savedAlerts
        .map((alert) => {
          const triggered =
            typeof alert.triggeredAt === 'number'
              ? `<small class="member-tool-alert-state">Triggered at ${escapeHtml(priceText(alert.category, alert.observedPrice ?? alert.target))} · ${escapeHtml(new Date(alert.triggeredAt).toLocaleString())}</small>`
              : '<small class="member-tool-alert-state">Waiting for a manual price check</small>';
          return `<div class="member-tool-row"><div class="member-tool-symbol"><b>${escapeHtml(alert.symbol)}</b><small>${escapeHtml(alert.category)} · ${alert.direction === 'above' ? 'above' : 'below'} ${escapeHtml(priceText(alert.category, alert.target))}</small>${triggered}</div><span></span><span></span><button class="btn alt member-tool-action" type="button" data-tool-action="remove-alert" data-alert-id="${escapeHtml(alert.id)}">Remove</button></div>`;
        })
        .join('') : '<p class="note">No price alerts yet.</p>'}</div>`;
    if (!rows.length) {
      void loadCrypto().then(() => {
        if (page === 'Price alerts') renderAlerts(message);
      });
    }
  };

  const checkAlerts = async () => {
    const status = root.querySelector<HTMLElement>('[data-alert-message]');
    if (status) status.textContent = 'Loading current prices…';
    await loadCrypto();
    const prices = liveRows();
    let changed = false;
    const next = alerts().map((alert) => {
      if (typeof alert.triggeredAt === 'number') return alert;
      const row = prices.find(
        (asset) =>
          asset.category === alert.category && asset.symbol === alert.symbol,
      );
      const reached =
        row &&
        (alert.direction === 'above'
          ? row.price >= alert.target
          : row.price <= alert.target);
      if (!row || !reached) return alert;
      changed = true;
      return {
        ...alert,
        triggeredAt: Date.now(),
        observedPrice: row.price,
      };
    });
    if (changed) {
      ST.priceAlerts = next;
      save();
    }
    renderAlerts(
      changed
        ? 'One or more price alerts were triggered.'
        : 'No alert targets were reached at the latest prices.',
    );
  };

  const csvCell = (value: unknown) =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;
  const downloadActivity = () => {
    const rows: unknown[][] = [
      ['Record type', 'ID', 'Date', 'Asset', 'Network', 'Amount', 'USD estimate', 'Status'],
    ];
    const transactions = Array.isArray(ST.tx) ? ST.tx : [];
    transactions.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const value = raw as Record<string, unknown>;
      rows.push([
        'Recorded activity',
        value.id,
        typeof value.t === 'number' ? new Date(value.t).toISOString() : '',
        value.a,
        value.net,
        value.amt,
        value.usd,
        value.status || 'Recorded',
      ]);
    });
    const requests = Array.isArray(ST.depositRequests) ? ST.depositRequests : [];
    requests.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const value = raw as Record<string, unknown>;
      rows.push([
        'Deposit request',
        value.id,
        typeof value.t === 'number' ? new Date(value.t).toISOString() : '',
        value.a,
        value.net,
        value.amt,
        value.usd,
        value.status || 'Pending',
      ]);
    });
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `account-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderStatements = () => {
    const recordCount =
      (Array.isArray(ST.tx) ? ST.tx.length : 0) +
      (Array.isArray(ST.depositRequests) ? ST.depositRequests.length : 0);
    root.innerHTML = `<div class="head"><div><div class="lbl">Your recorded dashboard activity</div><div class="bal">Statements and tax</div></div></div>
      <div class="member-tool-card"><h3>Account activity export</h3><p>Download the transactions and deposit requests currently saved in your member dashboard (${recordCount} records).</p><button class="btn" type="button" data-tool-action="export-activity">Download activity CSV</button></div>
      <p class="note">This export is for your records only. It is not an official statement, tax document, or tax advice. Investment-plan projections are not included as completed transactions.</p>`;
  };

  // ---- Referral (frontend only) -----------------------------------------
  // Nothing here is connected yet. Fill referralState and referralHistory
  // from your database; the link and code come from the member's account.
  type ReferralStatus = 'invited' | 'joined' | 'rewarded';
  const referralState: {
    link: string;
    code: string;
    invited: number;
    joined: number;
    earned: string;
  } = { link: '', code: '', invited: 0, joined: 0, earned: '—' };
  const referralHistory: { name: string; status: ReferralStatus; date: number }[] = [];

  const referralStatusLabel: Record<ReferralStatus, [string, string]> = {
    invited: ['Invited', 'security-badge-muted'],
    joined: ['Joined', 'r2'],
    rewarded: ['Rewarded', 'r1'],
  };

  const copyReferralText = async (text: string, field: HTMLInputElement | null) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      if (!field) return false;
      field.focus();
      field.select();
      try {
        return document.execCommand('copy');
      } catch {
        return false;
      }
    }
  };

  const renderReferral = () => {
    const hasLink = referralState.link.length > 0;
    const hasCode = referralState.code.length > 0;
    const field = (id: string, label: string, value: string, empty: string, target: string, button: string) =>
      `<label class="fl" for="${id}">${label}</label><div class="referral-field"><input class="help-input" id="${id}" type="text" readonly value="${escapeHtml(value)}" placeholder="${escapeHtml(empty)}"><button class="btn alt" type="button" data-tool-action="copy-referral" data-copy-target="${target}"${value ? '' : ' disabled aria-disabled="true"'}>${button}</button></div>`;
    const historyMarkup = referralHistory.length
      ? referralHistory
          .map((entry) => {
            const [label, tone] = referralStatusLabel[entry.status] || referralStatusLabel.invited;
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(new Date(entry.date).toLocaleDateString())}</small></div><span class="risk ${tone}">${label}</span></div>`;
          })
          .join('')
      : '<div class="help-empty"><b>No referrals yet</b><p>Friends who join with your link will appear here with their status.</p></div>';

    root.innerHTML = `<div class="head"><div><div class="lbl">Invite friends</div><div class="bal">Referral</div></div></div>
      <p class="note">Share your personal referral link. When friends join with it, you can follow their progress here.</p>

      <h2 class="sec">Your referral link</h2>
      <div class="mp referral-card">
        ${field('referral-link', 'Referral link', referralState.link, 'Your referral link is not available yet', 'link', 'Copy link')}
        ${field('referral-code', 'Referral code', referralState.code, 'Your referral code is not available yet', 'code', 'Copy code')}
        <div class="security-notice" id="referral-notice" role="status" hidden></div>
        ${hasLink || hasCode ? '' : '<p class="hint">Your link will appear here once referrals are available on your account.</p>'}
      </div>

      <div class="referral-stats">
        <div class="referral-stat"><span>Friends invited</span><b>${referralState.invited}</b></div>
        <div class="referral-stat"><span>Friends joined</span><b>${referralState.joined}</b></div>
        <div class="referral-stat"><span>Rewards earned</span><b>${escapeHtml(referralState.earned)}</b></div>
      </div>

      <h2 class="sec">How it works</h2>
      <div class="referral-steps">
        <div class="member-tool-card"><h3>1. Share your link</h3><p>Send your referral link or code to friends and family.</p></div>
        <div class="member-tool-card"><h3>2. They join</h3><p>Your friend creates an account using your link or code.</p></div>
        <div class="member-tool-card"><h3>3. Track progress</h3><p>See each referral and any rewards in the list below.</p></div>
      </div>

      <h2 class="sec">Your referrals</h2>
      <div class="mp help-tickets" id="referral-history">${historyMarkup}</div>
      <p class="hint">Program terms apply. If you have a question about a referral, contact support.</p>
      <button class="btn alt" type="button" data-tool-action="navigate" data-destination="Help center">Contact support</button>`;
  };

  const copyReferral = async (button: HTMLElement) => {
    const target = button.dataset.copyTarget === 'code' ? 'code' : 'link';
    const input = root.querySelector<HTMLInputElement>(target === 'code' ? '#referral-code' : '#referral-link');
    const notice = root.querySelector<HTMLElement>('#referral-notice');
    const ok = !!input?.value && (await copyReferralText(input.value, input));
    if (notice) {
      notice.textContent = ok
        ? `Referral ${target} copied.`
        : 'Could not copy automatically. Select the text and copy it manually.';
      notice.hidden = false;
    }
  };

  // ---- Help center: support tickets -------------------------------------
  // Tickets are not stored anywhere yet. Flip this to true once
  // sendSupportTicket below is connected to Supabase.
  const SUPPORT_TICKETS_CONNECTED = false;

  type SupportTicketInput = {
    email: string;
    category: string;
    priority: string;
    subject: string;
    reference: string;
    message: string;
  };
  type SupportTicketRow = {
    id: string;
    subject: string;
    category: string;
    status: 'open' | 'in_review' | 'resolved';
    createdAt: number;
  };

  const SUPPORT_CATEGORIES = [
    'General question',
    'Deposits',
    'Account and verification',
    'Market data',
    'Technical issue',
    'Other',
  ];
  const SUPPORT_PRIORITIES = ['Low', 'Normal', 'High'];
  // Filled from Supabase later. Shape: SupportTicketRow.
  const supportTickets: SupportTicketRow[] = [];

  // TODO(supabase): send the ticket to the parent page with postMessage
  // (same pattern as the deposit request), then insert it into a tickets
  // table under the signed-in user's id. Resolve when saved, throw on error.
  const sendSupportTicket = async (_ticket: SupportTicketInput) => {
    if (!SUPPORT_TICKETS_CONNECTED) {
      throw new Error(
        'Support tickets are not connected yet, so nothing was sent. Please try again later.',
      );
    }
  };

  const memberEmail = () => {
    const profile = (window as unknown as { __AUVRENTHIA_PROFILE__?: { email?: unknown } })
      .__AUVRENTHIA_PROFILE__;
    return typeof profile?.email === 'string' ? profile.email : '';
  };

  const ticketStatus: Record<SupportTicketRow['status'], [string, string]> = {
    open: ['Open', 'r2'],
    in_review: ['In review', 'r2'],
    resolved: ['Resolved', 'r1'],
  };

  const ticketRowsMarkup = () =>
    supportTickets.length
      ? supportTickets
          .map((ticket) => {
            const [label, tone] = ticketStatus[ticket.status] || ticketStatus.open;
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b>${escapeHtml(ticket.subject)}</b><small>${escapeHtml(ticket.id)} · ${escapeHtml(ticket.category)} · ${escapeHtml(new Date(ticket.createdAt).toLocaleDateString())}</small></div><span class="risk ${tone}">${label}</span></div>`;
          })
          .join('')
      : '<div class="help-empty"><b>No tickets yet</b><p>Tickets you open will appear here with their current status.</p></div>';

  const helpFaqs: [string, string, [string, string]?][] = [
    [
      'Deposits',
      'Use an active payment method and follow the on-screen receipt steps. A request remains pending until it is reviewed.',
      ['Open deposits', 'Deposit funds'],
    ],
    [
      'Account activity',
      'See recorded transactions and export the dashboard activity you have saved.',
      ['Open activity export', 'Statements and tax'],
    ],
    [
      'Identity and security',
      'Review the verification status shown for your account.',
      ['Open verification', 'Security and verification'],
    ],
    [
      'Market data',
      'Quotes are fetched directly from TradingView, with headlines and calendar events from public feeds. Historical chart candles still use the Supabase market-data function.',
      ['Open screener', 'Screener'],
    ],
    [
      'How do I make a deposit?',
      'Open Deposit funds, choose an active payment method, send your payment, then attach a screenshot of the receipt. Always confirm the asset and network before paying, because transfers may be irreversible.',
    ],
    [
      'Why has my deposit not been credited yet?',
      'Deposits are not credited automatically. Each request stays pending until a staff member reviews it. If you need help with a specific request, open a ticket and include its request ID in the reference field.',
    ],
    [
      'What can I upload as proof of payment?',
      'A transfer screenshot or payment slip in PNG, JPG, or WebP format, up to 8 MB.',
    ],
    [
      'How does account verification work?',
      'Verification has three tiers: email verification, face verification, and a government ID showing your current address. You can see your status on the Security and verification page.',
    ],
    [
      'Can I connect a crypto wallet?',
      'Wallet connections are currently unavailable. Deposits are made by sending a payment to one of the listed payment methods.',
    ],
    [
      'Where does the market data come from?',
      'Quotes are fetched from TradingView, and headlines and calendar events come from public feeds. Prices can be delayed or temporarily unavailable.',
    ],
    [
      'How do I download my account activity?',
      'Open Statements and tax and choose Download activity CSV. The export is for your own records and is not an official statement, tax document, or tax advice.',
    ],
    [
      'My question is not listed here. What should I do?',
      'Open a support ticket using the form above. Describe what you were trying to do and what happened, so the team can help without asking you to repeat yourself.',
    ],
  ];

  const renderHelp = () => {
    const categoryOptions = SUPPORT_CATEGORIES.map(
      (category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`,
    ).join('');
    const priorityOptions = SUPPORT_PRIORITIES.map(
      (priority) =>
        `<option value="${escapeHtml(priority)}"${priority === 'Normal' ? ' selected' : ''}>${escapeHtml(priority)}</option>`,
    ).join('');
    const faqMarkup = helpFaqs
      .map(([question, answer, action]) => {
        const button = action
          ? `<div class="help-faq-action"><button class="btn alt" type="button" data-tool-action="navigate" data-destination="${escapeHtml(action[1])}">${escapeHtml(action[0])}</button></div>`
          : '';
        return `<details class="help-faq-item"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p>${button}</details>`;
      })
      .join('');

    root.innerHTML = `<div class="head"><div><div class="lbl">Member support</div><div class="bal">Help center</div></div></div>
      <p class="note">Find quick answers below, or open a ticket and our support team will follow up by email.</p>

      <h2 class="sec">Contact support</h2>
      <div class="mp help-ticket" id="help-ticket-card">
        <div class="mph"><div><h3>Open a support ticket</h3><small>Tell us what you need help with. We reply to the email address below.</small></div></div>
        <div class="help-grid">
          <div><label class="fl" for="help-email">Your email</label><input class="help-input" id="help-email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" value="${escapeHtml(memberEmail())}"></div>
          <div><label class="fl" for="help-category">Category</label><select class="sel" id="help-category">${categoryOptions}</select></div>
          <div><label class="fl" for="help-priority">Priority</label><select class="sel" id="help-priority">${priorityOptions}</select></div>
          <div><label class="fl" for="help-reference">Reference <span class="help-optional">(optional)</span></label><input class="help-input" id="help-reference" type="text" maxlength="80" placeholder="e.g. a deposit request ID"></div>
        </div>
        <label class="fl" for="help-subject">Subject</label>
        <input class="help-input" id="help-subject" type="text" maxlength="120" placeholder="Short summary of the issue">
        <label class="fl" for="help-message">Message</label>
        <textarea class="help-input help-textarea" id="help-message" rows="6" maxlength="2000" placeholder="Describe what you were trying to do and what happened."></textarea>
        <div class="hint">Never share your password or full recovery details in a ticket.</div>
        <div class="err" id="help-ticket-error" role="alert"></div>
        <div class="help-success" id="help-ticket-success" role="status" hidden></div>
        <div class="deposit-actions"><button class="btn" type="button" id="help-ticket-submit" data-tool-action="submit-ticket">Submit ticket</button></div>
      </div>

      <h2 class="sec">Your tickets</h2>
      <div class="mp help-tickets" id="help-ticket-list">${ticketRowsMarkup()}</div>

      <h2 class="sec">Frequently asked questions</h2>
      <div class="help-faq">${faqMarkup}</div>`;
  };

  const submitSupportTicket = async (button: HTMLElement) => {
    const read = (id: string) =>
      (root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)
        ?.value || '').trim();
    const errorBox = root.querySelector<HTMLElement>('#help-ticket-error');
    const successBox = root.querySelector<HTMLElement>('#help-ticket-success');
    const fail = (message: string) => {
      if (successBox) successBox.hidden = true;
      if (errorBox) errorBox.textContent = message;
    };
    if (errorBox) errorBox.textContent = '';
    if (successBox) successBox.hidden = true;

    const ticket: SupportTicketInput = {
      email: read('help-email'),
      category: read('help-category'),
      priority: read('help-priority'),
      subject: read('help-subject'),
      reference: read('help-reference'),
      message: read('help-message'),
    };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ticket.email) || ticket.email.length > 254) {
      fail('Enter a valid email address so we can reply to you.');
      return;
    }
    if (!SUPPORT_CATEGORIES.includes(ticket.category) || !SUPPORT_PRIORITIES.includes(ticket.priority)) {
      fail('Choose a category and priority.');
      return;
    }
    if (ticket.subject.length < 3 || ticket.subject.length > 120) {
      fail('Enter a subject between 3 and 120 characters.');
      return;
    }
    if (ticket.message.length < 20 || ticket.message.length > 2000) {
      fail('Describe the issue in 20 to 2,000 characters so we can help.');
      return;
    }

    button.setAttribute('disabled', 'true');
    try {
      await sendSupportTicket(ticket);
      ['help-subject', 'help-reference', 'help-message'].forEach((id) => {
        const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
        if (field) field.value = '';
      });
      if (successBox) {
        successBox.textContent = 'Your ticket was submitted. We will reply by email.';
        successBox.hidden = false;
      }
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : 'We could not submit your ticket. Please try again.',
      );
    } finally {
      button.removeAttribute('disabled');
    }
  };

  // ---- Security and verification (frontend only) ------------------------
  // Nothing here is connected yet. Set SECURITY_CONNECTED to true once the
  // actions in runSecurityAction are wired up, and fill securityState from
  // your database so the statuses are real.
  const SECURITY_CONNECTED = false;

  type TierStatus = 'not_started' | 'pending' | 'verified' | 'rejected';
  const securityState: {
    tiers: [TierStatus, TierStatus, TierStatus];
    rejectionReasons: [string, string, string];
    twoFactorEnabled: boolean;
  } = {
    tiers: ['not_started', 'not_started', 'not_started'],
    rejectionReasons: ['', '', ''],
    twoFactorEnabled: false,
  };

  const tierStatusLabel: Record<TierStatus, [string, string]> = {
    not_started: ['Not started', 'security-badge-muted'],
    pending: ['Pending review', 'r2'],
    verified: ['Verified', 'r1'],
    rejected: ['Action required', 'r3'],
  };

  const verificationTiers: [string, string, string, string][] = [
    ['Tier 1 · Email verification', 'Confirm the email address on your account.', 'Verify email', 'verify-email'],
    ['Tier 2 · Face verification', 'Complete a face check after your email is verified.', 'Start face check', 'start-face-check'],
    ['Tier 3 · Government ID with address', 'Submit an eligible ID showing your current residential address.', 'Upload documents', 'upload-documents'],
  ];

  const maskedEmail = () => {
    const email = memberEmail();
    const at = email.indexOf('@');
    if (at < 1) return 'Not available';
    return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
  };

  // TODO: connect each action (email verification, face check provider,
  // document upload, password change, two-factor setup, sign out everywhere).
  const runSecurityAction = async (action: string): Promise<string> => {
    void action;
    if (!SECURITY_CONNECTED) {
      return 'This action is not available yet. Nothing was changed.';
    }
    return '';
  };

  // Name of your existing verification page (its nav label, e.g. the value of
  // data-p on that nav item). Leave as null to show the tiers inside this page.
  const VERIFICATION_PAGE: string | null = null;
  let securityView: 'overview' | 'verification' = 'overview';

  const verificationSummary = (): [string, string] => {
    const tiers = securityState.tiers;
    if (tiers.every((status) => status === 'verified')) return ['Verified', 'r1'];
    if (tiers.includes('rejected')) return ['Action required', 'r3'];
    if (tiers.includes('pending')) return ['Pending review', 'r2'];
    return ['Not verified', 'security-badge-muted'];
  };

  const tiersMarkup = () =>
    verificationTiers
      .map(([title, detail, buttonLabel, action], index) => {
        const status = securityState.tiers[index];
        const [label, tone] = tierStatusLabel[status];
        const previousDone = index === 0 || securityState.tiers[index - 1] === 'verified';
        const reason = status === 'rejected' && securityState.rejectionReasons[index]
          ? `<small class="security-reason">${escapeHtml(securityState.rejectionReasons[index])}</small>`
          : '';
        let control = '';
        if (status === 'not_started' || status === 'rejected') {
          const text = status === 'rejected' ? 'Try again' : buttonLabel;
          control = `<button class="btn alt" type="button" data-tool-action="security-action" data-security-action="${escapeHtml(action)}"${previousDone ? '' : ' disabled aria-disabled="true"'}>${escapeHtml(text)}</button>`;
        }
        const lockNote = !previousDone && status === 'not_started'
          ? `<small class="security-lock">Complete Tier ${index} first.</small>`
          : '';
        return `<li class="security-item"><div class="security-item-main"><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small>${reason}${lockNote}</div><div class="security-item-side"><span class="risk ${tone}">${label}</span>${control}</div></li>`;
      })
      .join('');

  const renderSecurity = () => {
    const verifiedCount = securityState.tiers.filter((status) => status === 'verified').length;

    if (securityView === 'verification') {
      root.innerHTML = `<button class="btn alt security-back" type="button" data-tool-action="security-back">← Back to security</button>
        <div class="head"><div><div class="lbl">Account protection</div><div class="bal">Identity verification</div></div><span class="risk ${verifiedCount === 3 ? 'r1' : 'security-badge-muted'}">${verifiedCount} of 3 tiers verified</span></div>
        <p class="note">Complete the tiers in order. Each tier adds another identity check.</p>
        <div class="security-notice" id="security-notice" role="status" hidden></div>
        <div class="mp security-card">
          <ol class="security-list" aria-label="Verification tiers">${tiersMarkup()}</ol>
          <p class="hint">Documents you submit are reviewed by our team and are visible only to you and authorized staff.</p>
        </div>`;
      return;
    }

    const [summaryLabel, summaryTone] = verificationSummary();
    const twoFactorLabel = securityState.twoFactorEnabled ? ['On', 'r1'] : ['Off', 'security-badge-muted'];
    const row = (title: string, detail: string, side: string) =>
      `<li class="security-item"><div class="security-item-main"><b>${escapeHtml(title)}</b><small>${detail}</small></div><div class="security-item-side">${side}</div></li>`;
    const actionButton = (label: string, action: string) =>
      `<button class="btn alt" type="button" data-tool-action="security-action" data-security-action="${action}">${escapeHtml(label)}</button>`;

    root.innerHTML = `<div class="head"><div><div class="lbl">Account protection</div><div class="bal">Security and verification</div></div></div>
      <p class="note">Keep your account protected and check the status of your identity verification.</p>
      <div class="security-notice" id="security-notice" role="status" hidden></div>

      <h2 class="sec">Account security</h2>
      <div class="mp security-card">
        <ul class="security-list" aria-label="Account security">
          ${row('Email address', escapeHtml(maskedEmail()), '')}
          ${row('Password', 'Use a strong password that you do not use anywhere else.', actionButton('Change password', 'change-password'))}
          ${row('Two-factor authentication', 'Add a one-time code from an authenticator app when you sign in.', `<span class="risk ${twoFactorLabel[1]}">${twoFactorLabel[0]}</span>${actionButton(securityState.twoFactorEnabled ? 'Manage' : 'Enable', 'two-factor')}`)}
          ${row('Active sessions', 'Sign out of every device where you are currently signed in.', actionButton('Sign out of all devices', 'sign-out-all'))}
        </ul>
      </div>

      <div class="member-tool-card"><h3>Protect your account</h3><p>Never share your password or one-time codes with anyone. Our staff will never ask for them. Always check the address and network before sending a payment.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Help center">Contact support</button></div>

      <h2 class="sec">Identity verification</h2>
      <button class="security-status-bar" type="button" data-tool-action="open-verification" aria-label="Open identity verification. Status: ${escapeHtml(summaryLabel)}">
        <span class="security-status-text"><b>Identity verification</b><small>${verifiedCount} of 3 tiers verified</small></span>
        <span class="security-status-side"><span class="risk ${summaryTone}">${summaryLabel}</span><span class="security-chevron" aria-hidden="true">›</span></span>
      </button>`;
  };

  const openSecurityView = (view: 'overview' | 'verification') => {
    securityView = view;
    renderSecurity();
    window.scrollTo(0, 0);
  };

  const openVerification = () => {
    if (VERIFICATION_PAGE) {
      document.querySelectorAll<HTMLButtonElement>('#nav .nav').forEach((nav) => {
        if (nav.dataset.p === VERIFICATION_PAGE) nav.click();
      });
      return;
    }
    openSecurityView('verification');
  };

  const handleSecurityAction = async (button: HTMLElement) => {
    const action = button.dataset.securityAction || '';
    const notice = root.querySelector<HTMLElement>('#security-notice');
    button.setAttribute('disabled', 'true');
    try {
      const message = await runSecurityAction(action);
      if (notice && message) {
        notice.textContent = message;
        notice.hidden = false;
      }
    } catch (error) {
      if (notice) {
        notice.textContent =
          error instanceof Error ? error.message : 'Something went wrong. Please try again.';
        notice.hidden = false;
      }
    } finally {
      button.removeAttribute('disabled');
    }
  };

  const renderNews = () => {
    const requestId = ++publicContentRequest;
    const header = `<div class="head"><div><div class="lbl">Live market coverage</div><div class="bal">News</div></div></div>`;
    root.innerHTML = `${header}<p class="note">Loading current market headlines…</p>`;
    void (async () => {
      try {
        const payload = await requestPublicJson(
          'market-news',
          'https://biquote.io/api/News/market?maxResults=20&language=en&country=US',
        );
        if (!Array.isArray(payload)) {
          throw new Error('The public news provider returned an unexpected response.');
        }
        if (requestId !== publicContentRequest || page !== 'News') return;

        const cards = payload.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const article = value as Record<string, unknown>;
          const title = String(article.title ?? '').trim();
          const url = safeExternalUrl(article.url);
          if (!title || !url) return [];
          const publisher = String(article.publisher ?? 'Market news');
          const publishedAt = formatPublicDate(
            article.publishedDate ?? article.publishedAt,
          );
          return [
            `<article class="member-tool-card">
              <p class="member-tool-news-meta">${escapeHtml(publisher)}${publishedAt ? ` · ${escapeHtml(publishedAt)}` : ''}</p>
              <h3><a class="member-tool-news-title" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
            </article>`,
          ];
        });
        root.innerHTML = `${header}
          <p class="note">Latest headlines from the public market-news feed. Headline links open the associated story page. Market data by <a href="https://biquote.io/" target="_blank" rel="noopener noreferrer">biquote</a>.</p>
          <div class="member-tool-list">${cards.length ? cards.join('') : '<p class="note">No current headlines were returned.</p>'}</div>`;
      } catch {
        if (requestId !== publicContentRequest || page !== 'News') return;
        root.innerHTML = `${header}<p class="note" role="alert">Market headlines are temporarily unavailable from the public provider. Try again later.</p>`;
      }
    })();
  };

  const renderCalendar = () => {
    const requestId = ++publicContentRequest;
    const header = `<div class="head"><div><div class="lbl">Upcoming public releases</div><div class="bal">Economic calendar</div></div></div>`;
    root.innerHTML = `${header}<p class="note">Loading upcoming economic events…</p>`;
    void (async () => {
      try {
        const payload = await requestPublicJson(
          'economic-calendar',
          'https://biquote.io/api/Calendar/upcoming?limit=50',
        );
        if (!Array.isArray(payload)) {
          throw new Error('The public calendar provider returned an unexpected response.');
        }
        if (requestId !== publicContentRequest || page !== 'Economic calendar') return;

        const now = Date.now();
        const events = payload.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const event = value as Record<string, unknown>;
          const time = typeof event.time === 'string' ? event.time : '';
          const timestamp = new Date(time).getTime();
          const title = String(event.name ?? event.title ?? '').trim();
          if (!title || !Number.isFinite(timestamp) || timestamp < now) return [];
          const currency = String(event.currency ?? event.countryCode ?? 'Global');
          const importance = String(event.importance ?? '—');
          const source = String(event.source ?? 'Economic calendar');
          const sourceUrl = safeExternalUrl(event.sourceUrl);
          const eventFacts = (label: string, item: unknown) =>
            `<span><small>${label}</small><b>${escapeHtml(item == null ? '—' : String(item))}</b></span>`;
          return [
            {
              timestamp,
              markup: `<article class="member-tool-card">
                <div class="member-tool-calendar-meta"><strong>${escapeHtml(currency)} · ${escapeHtml(importance)} impact</strong><time datetime="${escapeHtml(time)}">${escapeHtml(formatPublicDate(time))}</time></div>
                <h3>${escapeHtml(title)}</h3>
                <div class="member-tool-calendar-facts">${eventFacts('Actual', event.actual)}${eventFacts('Forecast', event.forecast)}${eventFacts('Previous', event.previous)}</div>
                <p class="member-tool-calendar-source">${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>` : escapeHtml(source)}</p>
              </article>`,
            },
          ];
        });
        events.sort((first, second) => first.timestamp - second.timestamp);
        const rows = events.slice(0, 30).map((event) => event.markup);
        root.innerHTML = `${header}
          <p class="note">Times are shown in your browser’s local time. Confirm releases with the listed source. Calendar data by <a href="https://biquote.io/" target="_blank" rel="noopener noreferrer">biquote</a>.</p>
          <div class="member-tool-list">${rows.length ? rows.join('') : '<p class="note">No upcoming events were returned.</p>'}</div>`;
      } catch {
        if (requestId !== publicContentRequest || page !== 'Economic calendar') return;
        root.innerHTML = `${header}<p class="note" role="alert">The economic calendar is temporarily unavailable from the public provider. Try again later.</p>`;
      }
    })();
  };

  const style = document.createElement('style');
  style.textContent = `
    .member-tool-filters,.member-tool-alert-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}
    .member-tool-filters label,.member-tool-alert-form label{display:grid;gap:7px;color:var(--mute);font-size:12px}
    .member-tool-filters input,.member-tool-filters select,.member-tool-alert-form input,.member-tool-alert-form select{width:100%;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit}
    .member-tool-list{display:grid;gap:8px;margin-top:14px}
    .member-tool-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(95px,.45fr) minmax(75px,.35fr) minmax(145px,auto);align-items:center;gap:12px;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
    .member-tool-heading{color:var(--mute);font-size:12px}
    .member-tool-symbol{display:grid;gap:4px;min-width:0}
    .member-tool-symbol small,.member-tool-alert-state{color:var(--mute);font-size:12px}
    .member-tool-symbol .member-tool-quote-details{font-size:11px;line-height:1.4}
    .member-tool-number{text-align:right;font-variant-numeric:tabular-nums}
    .member-tool-action{white-space:nowrap}
    .member-tool-card{margin:12px 0;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
    .member-tool-card h3{margin:0 0 8px;font-size:16px}
    .member-tool-card p{margin:0 0 14px;color:var(--mute);line-height:1.55}
    .member-tool-card a{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
    .member-tool-news-meta,.member-tool-calendar-source{color:var(--mute);font-size:12px}
    .member-tool-news-title{color:var(--ink);line-height:1.45}
    .member-tool-calendar-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:10px;color:var(--mute);font-size:12px}
    .member-tool-calendar-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
    .member-tool-calendar-facts span{display:grid;gap:4px}
    .member-tool-calendar-facts small{color:var(--mute);font-size:11px}
    .member-tool-calendar-facts b{font-variant-numeric:tabular-nums}
    .member-tool-calendar-source{margin:8px 0 0!important}
    .member-tool-alert-form{grid-template-columns:1.4fr 1fr 1fr auto;align-items:end}
    .help-ticket{max-width:900px}
    .help-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:16px}
    .help-input{width:100%;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
    .help-input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 25%,transparent)}
    .help-textarea{resize:vertical;min-height:132px;line-height:1.5}
    .help-optional{font-weight:400}
    .help-success{margin:8px 0;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;background:color-mix(in srgb,var(--up) 15%,transparent);color:var(--up)}
    .help-success[hidden]{display:none}
    .help-tickets{max-width:900px;padding:6px 18px}
    .help-ticket-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px solid var(--line)}
    .help-ticket-row:first-child{border-top:0}
    .help-ticket-main{display:grid;gap:4px;min-width:0}
    .help-ticket-main small{color:var(--mute);font-size:12px}
    .help-empty{padding:18px 0;text-align:center}
    .help-empty p{margin:6px 0 0;color:var(--mute);font-size:14px}
    .help-faq{max-width:900px;border:1px solid var(--line);border-radius:14px;overflow:hidden;margin-top:12px}
    .help-faq-item{border-top:1px solid var(--line)}
    .help-faq-item:first-child{border-top:0}
    .help-faq-item summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;cursor:pointer;font-weight:600;list-style:none}
    .help-faq-item summary::-webkit-details-marker{display:none}
    .help-faq-item summary::after{content:"+";flex:none;color:var(--mute);font-size:20px;line-height:1}
    .help-faq-item[open] summary::after{content:"−"}
    .help-faq-item summary:hover{background:color-mix(in srgb,var(--ink) 4%,transparent)}
    .help-faq-item summary:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
    .help-faq-item p{margin:0;padding:0 18px 14px;color:var(--mute);line-height:1.6;max-width:70ch}
    .help-faq-item p:last-child{padding-bottom:18px}
    .help-faq-action{padding:0 18px 18px}
    .security-card{max-width:900px}
    .security-list{display:grid;gap:10px;list-style:none;padding:0;margin:14px 0 0}
    .security-item{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid var(--line);border-radius:12px}
    .security-item-main{display:grid;gap:4px;min-width:0}
    .security-item-main small{color:var(--mute);font-size:13px;line-height:1.5}
    .security-item-main .security-reason{color:var(--dn)}
    .security-item-main .security-lock{font-size:12px}
    .security-item-side{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:10px;flex:none}
    .security-item-side .btn{padding:9px 16px;font-size:14px;white-space:nowrap}
    .security-item-side .btn[disabled]{opacity:.5;cursor:not-allowed;transform:none;filter:none}
    .security-badge-muted{background:color-mix(in srgb,var(--mute) 15%,transparent);color:var(--mute)}
    .security-notice{max-width:900px;margin:0 0 8px;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--brand)}
    .security-notice[hidden]{display:none}
    .security-card .hint{margin-top:14px}
    .security-status-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;max-width:900px;margin-top:12px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .security-status-bar:hover{background:color-mix(in srgb,var(--ink) 4%,transparent)}
    .security-status-bar:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
    .security-status-text{display:grid;gap:4px;min-width:0}
    .security-status-text small{color:var(--mute);font-size:13px}
    .security-status-side{display:flex;align-items:center;gap:12px;flex:none}
    .security-chevron{color:var(--mute);font-size:24px;line-height:1}
    .security-back{margin-bottom:18px;padding:9px 16px;font-size:14px}
    .referral-card{max-width:900px}
    .referral-field{display:flex;align-items:center;gap:10px}
    .referral-field .help-input{flex:1}
    .referral-field .btn{flex:none;padding:10px 18px;font-size:14px}
    .referral-field .btn[disabled]{opacity:.5;cursor:not-allowed;transform:none;filter:none}
    .referral-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:900px;margin-top:12px}
    .referral-stat{display:grid;gap:6px;padding:16px 18px;border:1px solid var(--line);border-radius:14px}
    .referral-stat span{color:var(--mute);font-size:13px}
    .referral-stat b{font-size:24px;letter-spacing:-.02em}
    .referral-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:900px}
    .referral-steps .member-tool-card{margin:0}
    .referral-steps .member-tool-card p{margin:0}
    @media(max-width:760px){.referral-stats,.referral-steps{grid-template-columns:1fr}.referral-field{flex-wrap:wrap}.help-grid{grid-template-columns:1fr}.security-item{flex-direction:column;align-items:flex-start}.security-item-side{justify-content:flex-start}}
    @media(max-width:760px){.member-tool-filters,.member-tool-alert-form{grid-template-columns:1fr}.member-tool-row{grid-template-columns:minmax(0,1fr) auto;gap:8px}.member-tool-heading{display:none}.member-tool-number{text-align:left}.member-tool-action{grid-column:1/-1;justify-self:start}.member-tool-calendar-facts{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  if (!root.dataset.memberToolsBound) {
    root.dataset.memberToolsBound = 'true';
    root.addEventListener('input', () => {
      if (page === 'Screener') drawScreenerRows();
    });
    root.addEventListener('change', () => {
      if (page === 'Screener') drawScreenerRows();
    });
    root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLElement>('[data-tool-action]');
      if (!button) return;
      const action = button.dataset.toolAction;

      if (action === 'toggle-watch') {
        toggleWatchlist(button.dataset.category || '', button.dataset.symbol || '');
      } else if (action === 'navigate') {
        const destination = button.dataset.destination;
        if (!destination) return;
        document.querySelectorAll<HTMLButtonElement>('#nav .nav').forEach((nav) => {
          if (nav.dataset.p === destination) nav.click();
        });
      } else if (action === 'create-alert') {
        const select = root.querySelector<HTMLSelectElement>('#member-alert-asset');
        const targetInput = root.querySelector<HTMLInputElement>('#member-alert-target');
        const direction = root.querySelector<HTMLSelectElement>('#member-alert-direction')?.value;
        const amount = Number(targetInput?.value);
        if (!select?.value || !Number.isFinite(amount) || amount <= 0) {
          renderAlerts('Choose an asset and enter a target price greater than zero.');
          return;
        }
        try {
          const selected = JSON.parse(select.value) as {
            category?: unknown;
            symbol?: unknown;
          };
          if (
            typeof selected.category !== 'string' ||
            !categories.includes(selected.category) ||
            typeof selected.symbol !== 'string' ||
            (direction !== 'above' && direction !== 'below')
          ) {
            renderAlerts('That asset selection is not valid. Please choose it again.');
            return;
          }
          ST.priceAlerts = [
            ...alerts(),
            {
              id: crypto.randomUUID(),
              category: selected.category,
              symbol: selected.symbol,
              target: amount,
              direction,
            },
          ].slice(0, 100);
          save();
          renderAlerts('Price alert saved to your dashboard.');
        } catch {
          renderAlerts('That asset selection could not be read. Please try again.');
        }
      } else if (action === 'remove-alert') {
        const id = button.dataset.alertId;
        ST.priceAlerts = alerts().filter((alert) => alert.id !== id);
        save();
        renderAlerts('Price alert removed.');
      } else if (action === 'check-alerts') {
        button.setAttribute('disabled', 'true');
        void checkAlerts().finally(() => button.removeAttribute('disabled'));
      } else if (action === 'export-activity') {
        downloadActivity();
      } else if (action === 'submit-ticket') {
        void submitSupportTicket(button);
      } else if (action === 'security-action') {
        void handleSecurityAction(button);
      } else if (action === 'open-verification') {
        openVerification();
      } else if (action === 'security-back') {
        openSecurityView('overview');
      } else if (action === 'copy-referral') {
        void copyReferral(button);
      }
    });
  }

  R.Screener = renderScreener;
  R['Price alerts'] = () => renderAlerts();
  R.Watchlist = renderWatchlist;
  R.News = renderNews;
  R['Economic calendar'] = renderCalendar;
  R['Statements and tax'] = renderStatements;
  R.Referral = renderReferral;
  R['Help center'] = renderHelp;
  R['Security and verification'] = () => {
    securityView = 'overview';
    renderSecurity();
  };

  if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
  if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];
}
