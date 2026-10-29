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

  const renderRewards = () => {
    root.innerHTML = `<div class="head"><div><div class="lbl">Account benefits</div><div class="bal">Rewards</div></div></div>
      <div class="member-tool-card"><h3>No rewards program is configured</h3><p>This dashboard does not currently have reward rules or a rewards balance connected. No points or rewards are being calculated.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Help center">Open help center</button></div>`;
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

  const helpFaqs: [string, string][] = [
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
      .map(
        ([question, answer]) =>
          `<details class="help-faq-item"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`,
      )
      .join('');

    root.innerHTML = `<div class="head"><div><div class="lbl">Member support</div><div class="bal">Help center</div></div></div>
      <p class="note">Find quick answers below, or open a ticket and our support team will follow up by email.</p>

      <div class="help-quick">
        <div class="member-tool-card"><h3>Deposits</h3><p>Use an active payment method and follow the on-screen receipt steps. A request remains pending until it is reviewed.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Deposit funds">Open deposits</button></div>
        <div class="member-tool-card"><h3>Account activity</h3><p>See recorded transactions and export the dashboard activity you have saved.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Statements and tax">Open activity export</button></div>
        <div class="member-tool-card"><h3>Identity and security</h3><p>Review the verification status shown for your account.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Security and verification">Open verification</button></div>
        <div class="member-tool-card"><h3>Market data</h3><p>Quotes are fetched directly from TradingView, with headlines and calendar events from public feeds. Historical chart candles still use the Supabase market-data function.</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Screener">Open screener</button></div>
      </div>

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
    .help-quick{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .help-quick .member-tool-card{margin:0;display:flex;flex-direction:column;align-items:flex-start}
    .help-quick .member-tool-card p{flex:1}
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
    .help-faq-item p{margin:0;padding:0 18px 18px;color:var(--mute);line-height:1.6;max-width:70ch}
    @media(max-width:760px){.help-quick,.help-grid{grid-template-columns:1fr}}
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
      }
    });
  }

  R.Screener = renderScreener;
  R['Price alerts'] = () => renderAlerts();
  R.Watchlist = renderWatchlist;
  R.News = renderNews;
  R['Economic calendar'] = renderCalendar;
  R['Statements and tax'] = renderStatements;
  R.Rewards = renderRewards;
  R['Help center'] = renderHelp;

  if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
  if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];
}
