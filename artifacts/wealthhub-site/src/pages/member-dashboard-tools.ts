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
declare let page: string;
declare let tab: string;
declare function renderList(): void;
declare function lg(symbol: string): string;
declare function closeMenu(): void;
declare function loadCrypto(): Promise<void>;
declare function save(): void;
declare function fmt(amount: number): string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let PS: Record<string, any> | null;
declare let PCAT: string;
declare const PL: Record<string, unknown[][]>;
declare const CL: Record<string, unknown[]>;

type Row = Record<string, unknown>;
type ServerData = {
  profile?: { demo_balance?: number | string; withdrawals_enabled?: boolean; kyc_status?: string } | null;
  deposits: Row[];
  withdrawals: Row[];
  ledger: Row[];
  plans: Row[];
  userPlans: Row[];
  positionPlans?: Row[];
  signalPlans: Row[];
  signals: Row[];
  signalSubs: Row[];
  loanProducts: Row[];
  loans: Row[];
  settings?: Row | null;
};

export function installMemberDashboardTools() {
  // ---- Live data from the real tables (through the React host) -------------
  let server: ServerData | null = null;
  const invCall = (op: string, ...args: unknown[]): Promise<any> => {
    const fn = (window as unknown as { __AUVRENTHIA_INV__?: (op: string, ...args: unknown[]) => Promise<unknown> })
      .__AUVRENTHIA_INV__;
    if (typeof fn !== 'function') return Promise.reject(new Error('Account services are not available.'));
    return fn(op, ...args);
  };
  const syncServerViews: Array<() => void> = [];
  const refreshServer = async (repaintAnyPage = true) => {
    server = (await invCall('load')) as ServerData;
    const balance = Number(server?.profile?.demo_balance);
    if (Number.isFinite(balance)) ST.cash0 = balance;
    syncServerViews.forEach((sync) => sync());
    const globalsRef = window as unknown as Record<string, unknown>;
    // Background refreshes only repaint the Signals page, so forms the member is typing in are never wiped.
    const repaint = R[page];
    if (typeof repaint === 'function' && (repaintAnyPage || page === 'Signals')) repaint();
    if (typeof globalsRef.renderRail === 'function') (globalsRef.renderRail as () => void)();
    window.dispatchEvent(new CustomEvent('auvrenthia-server-data', { detail: server }));
  };
  // Other pages (Withdraw, Plans, Lending) can use these:
  //   window.__AUVRENTHIA_MEMBER__.server()  -> latest loaded data
  //   window.__AUVRENTHIA_MEMBER__.call(op, ...args) then .refresh()
  (window as unknown as Record<string, unknown>).__AUVRENTHIA_MEMBER__ = {
    server: () => server,
    call: invCall,
    refresh: refreshServer,
  };

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
    if (page === 'Portfolio' && tab === 'Default') renderList();
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
      <div style="display:flex;align-items:center;gap:12px;min-width:0">${typeof lg === 'function' ? lg(row.symbol) : ''}<div class="member-tool-symbol"><b>${escapeHtml(row.symbol)}</b><small>${escapeHtml(row.name)} · ${escapeHtml(row.category)}</small>${quoteDetails ? `<small class="member-tool-quote-details">${escapeHtml(quoteDetails)}</small>` : ''}</div></div>
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

  const drawWatchSearch = () => {
    const results = root.querySelector<HTMLElement>('[data-watch-results]');
    if (!results) return;
    const query =
      root.querySelector<HTMLInputElement>('#member-watch-search')?.value.trim().toLowerCase() || '';
    const category =
      root.querySelector<HTMLSelectElement>('#member-watch-category')?.value || 'All';
    const all = liveRows();
    const rows = all
      .filter(
        (row) =>
          (category === 'All' || row.category === category) &&
          (!query ||
            row.symbol.toLowerCase().includes(query) ||
            row.name.toLowerCase().includes(query)),
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(0, 30);
    results.innerHTML = rows.length
      ? rows.map((row) => rowMarkup(row)).join('')
      : all.length
        ? '<p class="note">No assets match that search.</p>'
        : noMarketData();
  };

  const renderWatchlist = () => {
    const previousQuery =
      root.querySelector<HTMLInputElement>('#member-watch-search')?.value || '';
    const previousCategory =
      root.querySelector<HTMLSelectElement>('#member-watch-category')?.value || 'All';
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
      <p class="note">Your watchlist is saved with your member dashboard and shows as the Default tab on Portfolio. Add or remove assets below.</p>
      <h2 class="sec">Your watchlist</h2>
      <div class="member-tool-list">${rows.length ? rows.map((row) => rowMarkup(row)).join('') : selected.length ? '<p class="note">Your saved assets are not in the latest market feed. They remain saved and can be removed below.</p>' + selected.map((entry) => `<div class="member-tool-row"><div style="display:flex;align-items:center;gap:12px;min-width:0">${typeof lg === 'function' ? lg(entry.symbol) : ''}<div class="member-tool-symbol"><b>${escapeHtml(entry.symbol)}</b><small>${escapeHtml(entry.category)} · no current quote</small></div></div><span></span><span></span><button class="btn alt member-tool-action" type="button" data-tool-action="toggle-watch" data-category="${escapeHtml(entry.category)}" data-symbol="${escapeHtml(entry.symbol)}">Remove</button></div>`).join('') : '<p class="note">Nothing saved yet. Search below and tap “Add to watchlist.”</p>'}</div>
      <h2 class="sec">Add assets</h2>
      <div class="member-tool-filters" style="grid-template-columns:2fr 1fr">
        <label>Search<input id="member-watch-search" type="search" placeholder="Search symbol or name"></label>
        <label>Category<select id="member-watch-category"><option>All</option>${categories
          .map((category) => `<option>${category}</option>`)
          .join('')}</select></label>
      </div>
      <div class="member-tool-list" data-watch-results></div>`;
    const searchInput = root.querySelector<HTMLInputElement>('#member-watch-search');
    const categorySelect = root.querySelector<HTMLSelectElement>('#member-watch-category');
    if (searchInput) searchInput.value = previousQuery;
    if (categorySelect) categorySelect.value = previousCategory;
    drawWatchSearch();

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
          return `<div class="member-tool-row"><div style="display:flex;align-items:center;gap:12px;min-width:0">${typeof lg === 'function' ? lg(alert.symbol) : ''}<div class="member-tool-symbol"><b>${escapeHtml(alert.symbol)}</b><small>${escapeHtml(alert.category)} · ${alert.direction === 'above' ? 'above' : 'below'} ${escapeHtml(priceText(alert.category, alert.target))}</small>${triggered}</div></div><span></span><span></span><button class="btn alt member-tool-action" type="button" data-tool-action="remove-alert" data-alert-id="${escapeHtml(alert.id)}">Remove</button></div>`;
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

  // ---- Statements and tax (frontend only) -------------------------------
  // Statements are built from the activity saved in the dashboard state
  // (ST.tx and ST.depositRequests). Tax documents are not connected yet:
  // fill taxDocuments from your database and they will be listed per year.
  type StatementKind = 'deposit' | 'withdrawal' | 'request';
  type StatementRecord = {
    id: string;
    kind: StatementKind;
    t: number;
    asset: string;
    network: string;
    amount: number;
    usd: number;
    status: string;
  };
  const taxDocuments: { id: string; year: number; name: string; type: string; url: string }[] = [];

  const STATEMENT_PAGE_SIZE = 25;
  const statementDefaults = { period: '90d', type: 'all', asset: 'all', status: 'all', from: '', to: '' };
  const statementFilters = { ...statementDefaults };
  let statementLimit = STATEMENT_PAGE_SIZE;
  let statementsTab: 'statements' | 'tax' = 'statements';
  let taxYear = new Date().getFullYear();

  const kindLabel: Record<StatementKind, string> = {
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    request: 'Deposit request',
  };

  const statementRecords = (): StatementRecord[] => {
    if (server) {
      const stamp = (value: unknown) => {
        const parsed = Date.parse(String(value ?? ''));
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const fromDeposits = server.deposits.map((row): StatementRecord => {
        const status = String(row.status || 'pending');
        return {
          id: String(row.id),
          kind: status === 'approved' ? 'deposit' : 'request',
          t: stamp(row.created_at),
          asset: String(row.asset ?? ''),
          network: String(row.network ?? ''),
          amount: Number(row.amount) || 0,
          usd: Number(row.usd_amount) || 0,
          status,
        };
      });
      const fromWithdrawals = server.withdrawals.map((row): StatementRecord => ({
        id: String(row.id),
        kind: 'withdrawal',
        t: stamp(row.created_at),
        asset: String(row.asset ?? ''),
        network: String(row.network ?? ''),
        amount: Number(row.amount) || 0,
        usd: Number(row.usd_amount) || 0,
        status: String(row.status || 'pending'),
      }));
      return [...fromDeposits, ...fromWithdrawals].sort((first, second) => second.t - first.t);
    }
    const toRecord = (
      raw: unknown,
      kind: (value: Record<string, unknown>) => StatementKind,
      fallbackStatus: string,
      prefix: string,
    ): StatementRecord[] => {
      if (!raw || typeof raw !== 'object') return [];
      const value = raw as Record<string, unknown>;
      const t = typeof value.t === 'number' && Number.isFinite(value.t) ? value.t : 0;
      const amount = Number(value.amt);
      const usd = Number(value.usd);
      return [
        {
          id: String(value.id ?? `${prefix}-${t}`),
          kind: kind(value),
          t,
          asset: String(value.a ?? ''),
          network: String(value.net ?? ''),
          amount: Number.isFinite(amount) ? amount : 0,
          usd: Number.isFinite(usd) ? usd : 0,
          status: String(value.status || fallbackStatus),
        },
      ];
    };
    const recorded = (Array.isArray(ST.tx) ? ST.tx : []).flatMap((raw) =>
      toRecord(raw, (value) => (value.k === 'dep' ? 'deposit' : 'withdrawal'), 'Recorded', 'TX'),
    );
    const requests = (Array.isArray(ST.depositRequests) ? ST.depositRequests : []).flatMap((raw) =>
      toRecord(raw, () => 'request', 'Pending', 'REQ'),
    );
    return [...recorded, ...requests].sort((first, second) => second.t - first.t);
  };

  const statusText = (status: string) => {
    const text = status.replace(/[_-]+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Recorded';
  };
  const statusTone = (status: string) => {
    const value = status.toLowerCase();
    if (/(reject|fail|declin|denied|cancel)/.test(value)) return 'r3';
    if (/(pending|review|process)/.test(value)) return 'r2';
    if (/(complete|approv|credit|record|success|paid)/.test(value)) return 'r1';
    return 'security-badge-muted';
  };

  const periodRange = (): [number, number] => {
    const day = 86_400_000;
    const year = new Date().getFullYear();
    switch (statementFilters.period) {
      case '30d':
        return [Date.now() - 30 * day, Infinity];
      case '90d':
        return [Date.now() - 90 * day, Infinity];
      case 'ytd':
        return [new Date(year, 0, 1).getTime(), Infinity];
      case 'lastyear':
        return [new Date(year - 1, 0, 1).getTime(), new Date(year, 0, 1).getTime() - 1];
      case 'custom': {
        const from = statementFilters.from ? new Date(`${statementFilters.from}T00:00:00`).getTime() : -Infinity;
        const to = statementFilters.to ? new Date(`${statementFilters.to}T23:59:59.999`).getTime() : Infinity;
        return [Number.isNaN(from) ? -Infinity : from, Number.isNaN(to) ? Infinity : to];
      }
      default:
        return [-Infinity, Infinity];
    }
  };

  const filteredStatementRecords = (all: StatementRecord[]) => {
    const [from, to] = periodRange();
    return all.filter(
      (record) =>
        record.t >= from &&
        record.t <= to &&
        (statementFilters.type === 'all' || record.kind === statementFilters.type) &&
        (statementFilters.asset === 'all' || record.asset === statementFilters.asset) &&
        (statementFilters.status === 'all' || record.status.toLowerCase() === statementFilters.status),
    );
  };

  const summarizeStatement = (records: StatementRecord[]) => {
    const totals = { deposits: 0, depositCount: 0, withdrawals: 0, withdrawalCount: 0, requestCount: 0, reviewCount: 0, reviewUsd: 0 };
    records.forEach((record) => {
      if (record.kind === 'deposit') {
        totals.deposits += record.usd;
        totals.depositCount += 1;
      } else if (record.kind === 'withdrawal') {
        totals.withdrawals += record.usd;
        totals.withdrawalCount += 1;
      } else {
        totals.requestCount += 1;
        if (statusTone(record.status) === 'r2') {
          totals.reviewCount += 1;
          totals.reviewUsd += record.usd;
        }
      }
    });
    return totals;
  };

  const summaryTiles = (records: StatementRecord[]) => {
    const totals = summarizeStatement(records);
    const tile = (label: string, value: string, note: string) =>
      `<div class="statement-tile"><span>${label}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(note)}</small></div>`;
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return `<div class="statement-summary">
      ${tile('Deposits', fmt(totals.deposits), plural(totals.depositCount, 'record'))}
      ${tile('Withdrawals', fmt(totals.withdrawals), plural(totals.withdrawalCount, 'record'))}
      ${tile('Net flow', `${totals.deposits - totals.withdrawals < 0 ? '−' : ''}${fmt(Math.abs(totals.deposits - totals.withdrawals))}`, 'Deposits minus withdrawals')}
      ${tile('Requests in review', String(totals.reviewCount), totals.reviewCount ? `≈ ${fmt(totals.reviewUsd)} estimated` : 'No requests pending')}
    </div>`;
  };

  const formatAmount = (value: number) =>
    value.toLocaleString(undefined, { maximumFractionDigits: 8 });

  const statementRow = (record: StatementRecord) => {
    const date = record.t ? new Date(record.t) : null;
    const usd =
      record.kind === 'request'
        ? `<span class="statement-muted">≈ ${escapeHtml(fmt(record.usd))}</span>`
        : record.kind === 'deposit'
          ? `<span class="statement-in">+${escapeHtml(fmt(record.usd))}</span>`
          : `<span class="statement-out">−${escapeHtml(fmt(record.usd))}</span>`;
    return `<tr>
      <td><div>${date ? escapeHtml(date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })) : 'Unknown date'}</div><small>${date ? escapeHtml(date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })) : ''}</small></td>
      <td><b>${kindLabel[record.kind]}</b><small>${escapeHtml(record.asset)}${record.network ? ` · ${escapeHtml(record.network)}` : ''}</small></td>
      <td class="statement-ref">${escapeHtml(record.id)}</td>
      <td><span class="risk ${statusTone(record.status)}">${escapeHtml(statusText(record.status))}</span></td>
      <td class="statement-num">${escapeHtml(formatAmount(record.amount))} ${escapeHtml(record.asset)}</td>
      <td class="statement-num">${usd}</td>
    </tr>`;
  };

  const downloadStatement = (records: StatementRecord[], name: string) => {
    const rows: unknown[][] = [
      ['Record type', 'ID', 'Date', 'Asset', 'Network', 'Amount', 'USD estimate', 'Status'],
      ...records.map((record) => [
        kindLabel[record.kind],
        record.id,
        record.t ? new Date(record.t).toISOString() : '',
        record.asset,
        record.network,
        record.amount,
        record.usd,
        statusText(record.status),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const optionList = (options: [string, string][], current: string) =>
    options
      .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`)
      .join('');

  const drawStatementResults = () => {
    const container = root.querySelector<HTMLElement>('#statement-results');
    if (!container) return;
    const records = filteredStatementRecords(statementRecords());
    const visible = records.slice(0, statementLimit);
    const table = records.length
      ? `<div class="statement-table-wrap"><table class="statement-table">
          <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Reference</th><th scope="col">Status</th><th scope="col" class="statement-num">Amount</th><th scope="col" class="statement-num">Est. USD</th></tr></thead>
          <tbody>${visible.map(statementRow).join('')}</tbody></table></div>
        <p class="hint">Showing ${visible.length} of ${records.length} record${records.length === 1 ? '' : 's'}. USD values are estimates saved with each record.</p>
        ${records.length > visible.length ? '<button class="btn alt" type="button" data-tool-action="st-more">Show more</button>' : ''}`
      : '<div class="mp"><div class="help-empty"><b>No records match these filters</b><p>Try a longer period or reset the filters.</p></div></div>';
    container.innerHTML = `${summaryTiles(records)}<h2 class="sec">Transactions</h2>${table}
      <p class="note">This statement lists the transactions and deposit requests saved in your dashboard. It is for your records only and is not an official account statement, tax document, or tax advice. Investment-plan projections are not included as completed transactions.</p>`;
  };

  const taxYears = (all: StatementRecord[]) => {
    const current = new Date().getFullYear();
    const years = new Set<number>([current, current - 1]);
    all.forEach((record) => {
      if (record.t) years.add(new Date(record.t).getFullYear());
    });
    return Array.from(years).sort((first, second) => second - first);
  };

  const taxYearRecords = (all: StatementRecord[]) =>
    all.filter((record) => record.t && new Date(record.t).getFullYear() === taxYear);

  const drawTaxResults = () => {
    const container = root.querySelector<HTMLElement>('#tax-results');
    if (!container) return;
    const records = taxYearRecords(statementRecords());
    const docs = taxDocuments.filter((doc) => doc.year === taxYear);
    const docsMarkup = docs.length
      ? docs
          .map((doc) => {
            const url = safeExternalUrl(doc.url);
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b>${escapeHtml(doc.name)}</b><small>${escapeHtml(doc.type)} · Tax year ${doc.year}</small></div>${url ? `<a class="btn alt" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Download</a>` : '<span class="risk security-badge-muted">Unavailable</span>'}</div>`;
          })
          .join('')
      : `<div class="help-empty"><b>No tax documents for ${taxYear}</b><p>Documents will appear here when they are published for this tax year.</p></div>`;
    container.innerHTML = `<h2 class="sec">${taxYear} activity summary</h2>
      ${summaryTiles(records)}
      <div class="deposit-actions"><button class="btn alt" type="button" data-tool-action="st-export-year"${records.length ? '' : ' disabled aria-disabled="true"'}>Download ${taxYear} summary (CSV)</button></div>
      <h2 class="sec">Tax documents</h2>
      <div class="mp help-tickets">${docsMarkup}</div>
      <div class="member-tool-card"><h3>Important</h3><p>This summary is for your records only. It is not tax advice, and it may not include all activity relevant to your tax situation. USD values are estimates saved with each record. Tax rules depend on where you live, so speak with a qualified tax professional.</p></div>`;
  };

  const drawStatementsBody = () => {
    const body = root.querySelector<HTMLElement>('#statements-body');
    if (!body) return;
    const all = statementRecords();

    if (statementsTab === 'tax') {
      const years = taxYears(all);
      if (!years.includes(taxYear)) taxYear = years[0];
      body.innerHTML = `<div class="mp statement-card">
          <div class="mph"><div><h3>Tax year</h3><small>Choose the year you want to review.</small></div></div>
          <label class="fl" for="st-year">Tax year</label>
          <select class="sel statement-year" id="st-year">${optionList(years.map((year) => [String(year), String(year)]), String(taxYear))}</select>
        </div><div id="tax-results"></div>`;
      drawTaxResults();
      return;
    }

    const assets = Array.from(new Set(all.map((record) => record.asset).filter(Boolean))).sort();
    const statuses = Array.from(new Set(all.map((record) => record.status.toLowerCase()))).sort();
    if (statementFilters.asset !== 'all' && !assets.includes(statementFilters.asset)) statementFilters.asset = 'all';
    if (statementFilters.status !== 'all' && !statuses.includes(statementFilters.status)) statementFilters.status = 'all';
    body.innerHTML = `<div class="mp statement-card">
        <div class="mph"><div><h3>Filter your statement</h3><small>Narrow the period, type, asset, or status.</small></div></div>
        <div class="statement-filters">
          <div><label class="fl" for="st-period">Period</label><select class="sel" id="st-period">${optionList([['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['ytd', 'Year to date'], ['lastyear', 'Last year'], ['all', 'All time'], ['custom', 'Custom range']], statementFilters.period)}</select></div>
          <div><label class="fl" for="st-type">Type</label><select class="sel" id="st-type">${optionList([['all', 'All activity'], ['deposit', 'Deposits'], ['withdrawal', 'Withdrawals'], ['request', 'Deposit requests']], statementFilters.type)}</select></div>
          <div><label class="fl" for="st-asset">Asset</label><select class="sel" id="st-asset">${optionList([['all', 'All assets'], ...assets.map((asset): [string, string] => [asset, asset])], statementFilters.asset)}</select></div>
          <div><label class="fl" for="st-status">Status</label><select class="sel" id="st-status">${optionList([['all', 'All statuses'], ...statuses.map((status): [string, string] => [status, statusText(status)])], statementFilters.status)}</select></div>
          <div class="statement-custom" id="st-custom"${statementFilters.period === 'custom' ? '' : ' hidden'}>
            <div><label class="fl" for="st-from">From</label><input class="help-input" id="st-from" type="date" value="${escapeHtml(statementFilters.from)}"></div>
            <div><label class="fl" for="st-to">To</label><input class="help-input" id="st-to" type="date" value="${escapeHtml(statementFilters.to)}"></div>
          </div>
        </div>
        <div class="deposit-actions">
          <button class="btn" type="button" data-tool-action="st-export">Download CSV</button>
          <button class="btn alt" type="button" data-tool-action="st-reset">Reset filters</button>
        </div>
      </div><div id="statement-results"></div>`;
    drawStatementResults();
  };

  const renderStatements = () => {
    root.innerHTML = `<div class="head"><div><div class="lbl">Your recorded dashboard activity</div><div class="bal">Statements and tax</div></div></div>
      <div class="statement-tabs" role="tablist" aria-label="Statements and tax">
        <button class="statement-tab ${statementsTab === 'statements' ? 'on' : ''}" type="button" role="tab" aria-selected="${statementsTab === 'statements'}" data-tool-action="st-tab" data-tab="statements">Statements</button>
        <button class="statement-tab ${statementsTab === 'tax' ? 'on' : ''}" type="button" role="tab" aria-selected="${statementsTab === 'tax'}" data-tool-action="st-tab" data-tab="tax">Tax</button>
      </div>
      <div id="statements-body"></div>`;
    drawStatementsBody();
  };

  const handleStatementsChange = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const value = target.value;
    switch (target.id) {
      case 'st-period':
        statementFilters.period = value;
        root.querySelector<HTMLElement>('#st-custom')?.toggleAttribute('hidden', value !== 'custom');
        break;
      case 'st-type':
        statementFilters.type = value;
        break;
      case 'st-asset':
        statementFilters.asset = value;
        break;
      case 'st-status':
        statementFilters.status = value;
        break;
      case 'st-from':
        statementFilters.from = value;
        break;
      case 'st-to':
        statementFilters.to = value;
        break;
      case 'st-year': {
        const year = Number(value);
        if (Number.isInteger(year)) taxYear = year;
        drawTaxResults();
        return;
      }
      default:
        return;
    }
    statementLimit = STATEMENT_PAGE_SIZE;
    drawStatementResults();
  };

  const handleStatementsAction = (action: string, button: HTMLElement) => {
    if (action === 'st-tab') {
      statementsTab = button.dataset.tab === 'tax' ? 'tax' : 'statements';
      renderStatements();
    } else if (action === 'st-more') {
      statementLimit += STATEMENT_PAGE_SIZE;
      drawStatementResults();
    } else if (action === 'st-reset') {
      Object.assign(statementFilters, statementDefaults);
      statementLimit = STATEMENT_PAGE_SIZE;
      drawStatementsBody();
    } else if (action === 'st-export') {
      downloadStatement(filteredStatementRecords(statementRecords()), 'statement');
    } else if (action === 'st-export-year') {
      downloadStatement(taxYearRecords(statementRecords()), `activity-summary-${taxYear}`);
    }
  };

  // ---- Referral (saved in referrals, code on profiles.referral_code) -----
  // The code and the list come from the my_referrals() function through the host.
  // Rewards are paid by staff (admin_reward_referral) and land in the ledger.
  // Change this if your sign-up page lives at a different path.
  const REFERRAL_SIGNUP_PATH = '/signup';
  type ReferralStatus = 'joined' | 'rewarded';
  const referralState: {
    link: string;
    code: string;
    joined: number;
    rewarded: number;
    earned: string;
    loaded: boolean;
  } = { link: '', code: '', joined: 0, rewarded: 0, earned: '$0.00', loaded: false };
  const referralHistory: { name: string; status: ReferralStatus; date: number; reward: number }[] = [];

  const referralStatusLabel: Record<ReferralStatus, [string, string]> = {
    joined: ['Joined', 'r2'],
    rewarded: ['Rewarded', 'r1'],
  };

  const loadReferral = async () => {
    const reply = await sendProfileRequest('load-referral');
    const info = (reply.referral ?? {}) as { code?: unknown; referrals?: unknown };
    const code = typeof info.code === 'string' ? info.code : '';
    const list = Array.isArray(info.referrals) ? (info.referrals as Array<Record<string, unknown>>) : [];
    referralHistory.length = 0;
    let total = 0;
    let paid = 0;
    for (const row of list) {
      const status: ReferralStatus = row.status === 'rewarded' ? 'rewarded' : 'joined';
      const reward = Number(row.reward_usd) || 0;
      if (status === 'rewarded') {
        paid += 1;
        total += reward;
      }
      referralHistory.push({
        name: textValue(row.name) || 'Member',
        status,
        date: Date.parse(textValue(row.created_at)),
        reward,
      });
    }
    const host = (window as unknown as { __AUVHOST__?: string }).__AUVHOST__ || '';
    referralState.code = code;
    referralState.link = code && host ? `${host}${REFERRAL_SIGNUP_PATH}?ref=${encodeURIComponent(code)}` : '';
    referralState.joined = list.length;
    referralState.rewarded = paid;
    referralState.earned = `$${total.toFixed(2)}`;
    referralState.loaded = true;
    if (page === 'Referral') renderReferral();
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
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(new Date(entry.date).toLocaleDateString())}${entry.status === 'rewarded' ? ` · Reward $${entry.reward.toFixed(2)}` : ''}</small></div><span class="risk ${tone}">${label}</span></div>`;
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
        ${hasLink || hasCode ? '' : `<p class="hint">${referralState.loaded ? 'Your referral code is being prepared. Please check back shortly.' : 'Loading your referral details…'}</p>`}
      </div>

      <div class="referral-stats">
        <div class="referral-stat"><span>Friends joined</span><b>${referralState.joined}</b></div>
        <div class="referral-stat"><span>Rewarded</span><b>${referralState.rewarded}</b></div>
        <div class="referral-stat"><span>Rewards earned</span><b>${escapeHtml(referralState.earned)}</b></div>
      </div>

      <h2 class="sec">How it works</h2>
      <div class="referral-steps">
        <div class="member-tool-card"><h3>1. Share your link</h3><p>Send your referral link or code to friends and family.</p></div>
        <div class="member-tool-card"><h3>2. They join</h3><p>Your friend creates an account using your link or code.</p></div>
        <div class="member-tool-card"><h3>3. Earn rewards</h3><p>Rewards are credited to your balance once your friend qualifies. Track every referral below.</p></div>
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

  // ---- Help center: support tickets (saved in support_tickets) -----------

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
    replies: { body: string; createdAt: number }[];
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
  let supportTickets: SupportTicketRow[] = [];

  const sendSupportTicket = async (ticket: SupportTicketInput) => {
    const reply = await sendProfileRequest('create-ticket', { ...ticket });
    void loadTickets().catch(() => {
      // The list refreshes the next time the Help center opens.
    });
    return reply.message;
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
            const replies = ticket.replies
              .map(
                (reply) =>
                  `<div class="hint" style="white-space:pre-wrap;margin:6px 0 0 0"><b>Reply from support</b> · ${escapeHtml(new Date(reply.createdAt).toLocaleDateString())}<br>${escapeHtml(reply.body)}</div>`,
              )
              .join('');
            return `<div class="help-ticket-row" style="flex-wrap:wrap"><div class="help-ticket-main"><b>${escapeHtml(ticket.subject)}</b><small>${escapeHtml(ticket.id)} · ${escapeHtml(ticket.category)} · ${escapeHtml(new Date(ticket.createdAt).toLocaleDateString())}</small></div><span class="risk ${tone}">${label}</span>${replies ? `<div style="flex-basis:100%">${replies}</div>` : ''}</div>`;
          })
          .join('')
      : '<div class="help-empty"><b>No tickets yet</b><p>Tickets you open will appear here with their current status.</p></div>';

  const loadTickets = async () => {
    const reply = await sendProfileRequest('list-tickets');
    supportTickets = (reply.tickets ?? []).map((row) => ({
      id: 'T-' + String(row.ticket_no).padStart(5, '0'),
      subject: textValue(row.subject),
      category: textValue(row.category),
      status: (['open', 'in_review', 'resolved'].includes(String(row.status)) ? row.status : 'open') as SupportTicketRow['status'],
      createdAt: Date.parse(textValue(row.created_at)),
      replies: ((row.replies as Array<Record<string, unknown>> | undefined) ?? []).map((item) => ({
        body: textValue(item.body),
        createdAt: Date.parse(textValue(item.created_at)),
      })),
    }));
    const list = root.querySelector<HTMLElement>('#help-ticket-list');
    if (list) list.innerHTML = ticketRowsMarkup();
  };

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
      'Verification has two tiers: email verification, then a government ID (passport, national ID card or driving licence). No selfie is needed. You can see your status on the Security and verification page.',
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
      const sent = await sendSupportTicket(ticket);
      ['help-subject', 'help-reference', 'help-message'].forEach((id) => {
        const field = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
        if (field) field.value = '';
      });
      if (successBox) {
        successBox.textContent = sent || 'Your ticket was submitted. We will reply by email.';
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

  // ---- Security and verification: two tiers (email, then government ID) ----
  type TierStatus = 'not_started' | 'pending' | 'verified' | 'rejected';
  const securityState: {
    tiers: [TierStatus, TierStatus];
    rejectionReasons: [string, string];
    twoFactorEnabled: boolean;
  } = {
    tiers: ['not_started', 'not_started'],
    rejectionReasons: ['', ''],
    twoFactorEnabled: false,
  };
  let emailVerifiedCache = false;
  let idFormOpen = false;
  const ID_MAX_BYTES = 5 * 1024 * 1024;

  const syncSecurityState = (emailVerified: boolean, submission?: Record<string, unknown> | null) => {
    const status = String(authProfile().kyc_status || 'none');
    securityState.tiers[0] = emailVerified ? 'verified' : 'not_started';
    securityState.tiers[1] =
      status === 'verified' ? 'verified' : status === 'pending' ? 'pending' : status === 'rejected' ? 'rejected' : 'not_started';
    if (submission !== undefined) {
      securityState.rejectionReasons[1] =
        status === 'rejected' && submission ? textValue(submission.rejection_reason) : '';
    }
  };

  const tierStatusLabel: Record<TierStatus, [string, string]> = {
    not_started: ['Not started', 'security-badge-muted'],
    pending: ['Pending review', 'r2'],
    verified: ['Verified', 'r1'],
    rejected: ['Action required', 'r3'],
  };

  const verificationTiers: [string, string, string, string][] = [
    ['Tier 1 · Email verification', 'Confirm the email address on your account.', 'Resend confirmation email', 'verify-email'],
    ['Tier 2 · Government ID', "Submit a valid passport, national ID card or driver's licence. No selfie is needed.", 'Submit your ID', 'upload-documents'],
  ];

  const maskedEmail = () => {
    const email = memberEmail();
    const at = email.indexOf('@');
    if (at < 1) return 'Not available';
    return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
  };

  const loadKyc = async () => {
    const reply = await sendProfileRequest('kyc-status');
    applyProfileReply(reply);
    const kyc = reply.kyc as { emailVerified?: boolean; submission?: Record<string, unknown> | null } | undefined;
    emailVerifiedCache = Boolean(kyc?.emailVerified);
    syncSecurityState(emailVerifiedCache, kyc?.submission ?? null);
    if (page === 'Security and verification') renderSecurity();
  };

  const submitIdForm = async (): Promise<string> => {
    const field = (id: string) =>
      (root.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)?.value || '').trim();
    const showError = (message: string) => {
      const target = root.querySelector<HTMLElement>('#id-error');
      if (target) target.textContent = message;
      return '';
    };
    showError('');
    const docType = field('id-type');
    const number = field('id-number');
    const country = field('id-country');
    const dob = field('id-dob');
    const expiry = field('id-expiry');
    const front = root.querySelector<HTMLInputElement>('#id-front')?.files?.[0];
    const back = root.querySelector<HTMLInputElement>('#id-back')?.files?.[0];
    if (number.length < 4) return showError('Enter the document number.');
    if (country.length < 2) return showError('Enter the issuing country.');
    if (!dob || !expiry) return showError('Enter your date of birth and the expiry date.');
    if (!front) return showError('Upload the front of your document.');
    if (docType !== 'passport' && !back) return showError('Upload the back of your document.');
    for (const file of [front, back]) {
      if (!file) continue;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return showError('Use PNG, JPG or WebP images.');
      if (file.size === 0 || file.size > ID_MAX_BYTES) return showError('Each image must be under 5 MB.');
    }
    const reply = await sendProfileRequest('submit-kyc', {
      documentType: docType,
      documentNumber: number,
      country,
      dob,
      expiry,
      front: await front.arrayBuffer(),
      back: back ? await back.arrayBuffer() : null,
    });
    applyProfileReply(reply);
    idFormOpen = false;
    emailVerifiedCache = true;
    syncSecurityState(true, null);
    renderSecurity();
    const notice = root.querySelector<HTMLElement>('#security-notice');
    if (notice) {
      notice.textContent = reply.message || 'Your ID was submitted for review.';
      notice.hidden = false;
    }
    return '';
  };

  const runSecurityAction = async (action: string): Promise<string> => {
    if (action === 'verify-email') return (await sendProfileRequest('resend-confirmation')).message;
    if (action === 'upload-documents') {
      idFormOpen = true;
      renderSecurity();
      return '';
    }
    if (action === 'cancel-id') {
      idFormOpen = false;
      renderSecurity();
      return '';
    }
    if (action === 'submit-id') return submitIdForm();
    if (action === 'change-password' || action === 'sign-out-all') {
      document.querySelectorAll<HTMLButtonElement>('#nav .nav').forEach((nav) => {
        if (nav.dataset.p === 'Profile') nav.click();
      });
      return '';
    }
    if (action === 'two-factor') return 'Two-factor authentication is not available yet.';
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

  const idFormMarkup = () => {
    const open =
      idFormOpen &&
      securityState.tiers[0] === 'verified' &&
      (securityState.tiers[1] === 'not_started' || securityState.tiers[1] === 'rejected');
    if (!open) return '';
    const file = (id: string, label: string) =>
      `<div><label class="fl" for="${id}">${label}</label><input class="help-input" id="${id}" type="file" accept="image/png,image/jpeg,image/webp"></div>`;
    const text = (id: string, label: string, extra = '') =>
      `<div><label class="fl" for="${id}">${label}</label><input class="help-input" id="${id}" ${extra}></div>`;
    return `<div class="mp security-card"><h3>Submit your ID</h3>
      <p class="hint">Use a clear, uncropped photo of the whole document. PNG, JPG or WebP, up to 5 MB each.</p>
      <div class="help-grid">
        <div><label class="fl" for="id-type">Document type</label><select class="sel" id="id-type"><option value="passport">Passport</option><option value="national_id">National ID card</option><option value="drivers_license">Driver's licence</option></select></div>
        ${text('id-number', 'Document number', 'type="text" maxlength="40" autocomplete="off"')}
        ${text('id-country', 'Issuing country', 'type="text" maxlength="60"')}
        ${text('id-dob', 'Date of birth', 'type="date"')}
        ${text('id-expiry', 'Expiry date', 'type="date"')}
        ${file('id-front', 'Front of document')}
        ${file('id-back', 'Back of document (not needed for passports)')}
      </div>
      <div class="err" id="id-error" role="alert"></div>
      <div class="deposit-actions">
        <button class="btn" type="button" data-tool-action="security-action" data-security-action="submit-id">Submit for review</button>
        <button class="btn alt" type="button" data-tool-action="security-action" data-security-action="cancel-id">Cancel</button>
      </div>
    </div>`;
  };

  const renderSecurity = () => {
    const verifiedCount = securityState.tiers.filter((status) => status === 'verified').length;

    if (securityView === 'verification') {
      root.innerHTML = `<button class="btn alt security-back" type="button" data-tool-action="security-back">← Back to security</button>
        <div class="head"><div><div class="lbl">Account protection</div><div class="bal">Identity verification</div></div><span class="risk ${verifiedCount === 2 ? 'r1' : 'security-badge-muted'}">${verifiedCount} of 2 tiers verified</span></div>
        <p class="note">Complete the tiers in order. Each tier adds another identity check.</p>
        <div class="security-notice" id="security-notice" role="status" hidden></div>
        <div class="mp security-card">
          <ol class="security-list" aria-label="Verification tiers">${tiersMarkup()}</ol>
          <p class="hint">Documents you submit are reviewed by our team and are visible only to you and authorized staff.</p>
        </div>${idFormMarkup()}`;
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
        <span class="security-status-text"><b>Identity verification</b><small>${verifiedCount} of 2 tiers verified</small></span>
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

  // ---- Profile -------------------------------------------------------------
  // Saves and the profile picture go through the React host
  // (auvrenthia-profile-request, handled by profile-requests.ts).
  const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
  type ProfileAuthAction = 'change-password' | 'sign-out-all-devices';
  const pendingProfileAuthRequests = new Map<
    string,
    {
      action: ProfileAuthAction;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const profileDraft = {
    firstName: '',
    lastName: '',
    phone: '',
    country: '',
    state: '',
    postal: '',
    address: '',
  };
  let profileDraftLoaded = false;
  let profileAvatarUrl: string | null = null;

  const authProfile = (): Record<string, unknown> =>
    (window as unknown as { __AUVRENTHIA_PROFILE__?: Record<string, unknown> })
      .__AUVRENTHIA_PROFILE__ || {};
  const textValue = (value: unknown) => (typeof value === 'string' ? value : '');

  const loadProfileDraft = () => {
    if (profileDraftLoaded) return;
    const profile = authProfile();
    profileDraft.firstName = textValue(profile.first_name);
    profileDraft.lastName = textValue(profile.last_name);
    profileDraft.phone = textValue(profile.phone);
    profileDraft.country = textValue(profile.country);
    profileDraft.address = textValue(profile.address);
    profileDraft.state = textValue(profile.state);
    profileDraft.postal = textValue(profile.postal);
    profileDraftLoaded = true;
  };

  const applyAvatar = () => {
    document
      .querySelectorAll<HTMLElement>(
        '.top .av, [data-profile-view="menu"] .profile-dropdown__initial',
      )
      .forEach((node) => {
        if (node.dataset.initial === undefined) node.dataset.initial = node.textContent || '';
        if (profileAvatarUrl) {
          node.textContent = '';
          node.style.backgroundImage = `url("${profileAvatarUrl}")`;
          node.style.backgroundSize = 'cover';
          node.style.backgroundPosition = 'center';
        } else {
          node.style.backgroundImage = '';
          node.textContent = node.dataset.initial || '';
        }
      });
  };

  const profileKycBadge = (): [string, string] => {
    switch (String(authProfile().kyc_status || 'none')) {
      case 'verified':
        return ['Verified', 'r1'];
      case 'pending':
        return ['Pending review', 'r2'];
      case 'rejected':
        return ['Action required', 'r3'];
      default:
        return ['Not verified', 'security-badge-muted'];
    }
  };

  const renderProfile = () => {
    loadProfileDraft();
    const profile = authProfile();
    const verified = String(profile.kyc_status || '') === 'verified';
    const [kycLabel, kycTone] = profileKycBadge();
    const accountStatus = textValue(profile.account_status) || 'active';
    const initial = (profileDraft.firstName || textValue(profile.email) || 'M').charAt(0).toUpperCase();
    const lock = verified ? ' disabled aria-disabled="true"' : '';
    const input = (id: string, label: string, value: string, extra = '', locked = false) =>
      `<div><label class="fl" for="${id}">${label}</label><input class="help-input" id="${id}" type="text" value="${escapeHtml(value)}"${extra}${locked ? lock : ''}></div>`;
    const avatar = profileAvatarUrl
      ? `<img src="${escapeHtml(profileAvatarUrl)}" alt="Your profile picture">`
      : `<span aria-hidden="true">${escapeHtml(initial)}</span>`;

    root.innerHTML = `<div class="head"><div><div class="lbl">Your personal details</div><div class="bal">Profile</div></div></div>
      <p class="note">Keep your details up to date so support can help you quickly.</p>
      <div class="security-notice" id="profile-notice" role="status" hidden></div>

      <div class="mp profile-card">
        <div class="profile-avatar-row">
          <div class="profile-avatar">${avatar}</div>
          <div class="profile-avatar-info">
            <b>Profile picture</b>
            <small>PNG, JPG or WebP · up to 2 MB</small>
            <div class="deposit-actions">
              <label class="btn alt profile-upload" for="profile-avatar-input">${profileAvatarUrl ? 'Change photo' : 'Upload photo'}</label>
              <input id="profile-avatar-input" type="file" accept="image/png,image/jpeg,image/webp" hidden>
              ${profileAvatarUrl ? '<button class="btn alt" type="button" data-tool-action="profile-remove-avatar">Remove</button>' : ''}
            </div>
            <div class="err" id="profile-avatar-error" role="alert"></div>
          </div>
        </div>
      </div>

      <h2 class="sec">Personal information</h2>
      <div class="mp profile-card">
        ${verified ? '<p class="hint">Your name and address are locked because your identity is verified. Contact support to change them.</p>' : ''}
        <div class="help-grid">
          ${input('profile-first', 'First name', profileDraft.firstName, ' maxlength="60" autocomplete="given-name"', true)}
          ${input('profile-last', 'Last name', profileDraft.lastName, ' maxlength="60" autocomplete="family-name"', true)}
          <div><label class="fl" for="profile-email">Email address</label><input class="help-input" id="profile-email" type="email" value="${escapeHtml(textValue(profile.email))}" readonly aria-readonly="true"></div>
          ${input('profile-phone', 'Phone number', profileDraft.phone, ' maxlength="30" inputmode="tel" autocomplete="tel"')}
          ${input('profile-country', 'Country', profileDraft.country, ' maxlength="60" autocomplete="country-name"', true)}
          ${input('profile-state', 'State / province', profileDraft.state, ' maxlength="60" autocomplete="address-level1"')}
          ${input('profile-postal', 'Postal / ZIP code', profileDraft.postal, ' maxlength="20" autocomplete="postal-code"')}
        </div>
        <label class="fl" for="profile-address">Address</label>
        <textarea class="help-input help-textarea" id="profile-address" rows="3" maxlength="300" placeholder="Street, city"${verified ? lock : ''}>${escapeHtml(profileDraft.address)}</textarea>
        <div class="hint">Your email can only be changed through a confirmation email. Contact support if you need to change it.</div>
        <div class="err" id="profile-error" role="alert"></div>
        <div class="deposit-actions">
          <button class="btn" type="button" data-tool-action="profile-save">Save changes</button>
          <button class="btn alt" type="button" data-tool-action="profile-reset">Reset</button>
        </div>
      </div>

      <h2 class="sec">Account status</h2>
      <div class="mp profile-card">
        <ul class="security-list" aria-label="Account status">
          <li class="security-item"><div class="security-item-main"><b>Account</b><small>Your account standing.</small></div><div class="security-item-side"><span class="risk ${accountStatus === 'active' ? 'r1' : 'r3'}">${escapeHtml(statusText(accountStatus))}</span></div></li>
          <li class="security-item"><div class="security-item-main"><b>Identity verification</b><small>Required to unlock all account features.</small></div><div class="security-item-side"><span class="risk ${kycTone}">${kycLabel}</span><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Security and verification">View</button></div></li>
        </ul>
      </div>

      <h2 class="sec">Password and sessions</h2>
      <div class="mp profile-card">
        <h3>Change password</h3>
        <p class="hint">Choose a new password that is at least 8 characters long.</p>
        <div class="help-grid">
          <div><label class="fl" for="profile-new-password">New password</label><input class="help-input" id="profile-new-password" type="password" autocomplete="new-password" minlength="8" maxlength="72"></div>
          <div><label class="fl" for="profile-confirm-password">Confirm new password</label><input class="help-input" id="profile-confirm-password" type="password" autocomplete="new-password" minlength="8" maxlength="72"></div>
        </div>
        <div class="err" id="profile-password-error" role="alert"></div>
        <p class="hint" id="profile-password-status" role="status" aria-live="polite"></p>
        <div class="deposit-actions">
          <button class="btn" type="button" data-tool-action="profile-change-password">Change password</button>
        </div>
      </div>

      <div class="mp profile-card">
        <h3>Sign out all devices</h3>
        <p class="hint">This ends your current session and signs your account out on other devices.</p>
        <div class="err" id="profile-signout-error" role="alert"></div>
        <p class="hint" id="profile-signout-status" role="status" aria-live="polite"></p>
        <div class="deposit-actions">
          <button class="btn alt" type="button" data-tool-action="profile-confirm-signout-all" aria-controls="profile-signout-confirmation" aria-expanded="false">Sign out all devices</button>
        </div>
        <div class="security-notice" id="profile-signout-confirmation" role="group" aria-labelledby="profile-signout-confirmation-title" hidden>
          <b id="profile-signout-confirmation-title">Confirm sign out</b>
          <p>You will be signed out here and on your other devices. You will need to sign in again.</p>
          <div class="deposit-actions">
            <button class="btn alt" type="button" data-tool-action="profile-cancel-signout">Cancel</button>
            <button class="btn" type="button" data-tool-action="profile-signout-all">Confirm sign out</button>
          </div>
        </div>
      </div>`;
  };

  const showProfileNotice = (message: string) => {
    const notice = root.querySelector<HTMLElement>('#profile-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
  };

  const profileAuthButton = (action: ProfileAuthAction) =>
    root.querySelector<HTMLButtonElement>(
      action === 'change-password'
        ? '[data-tool-action="profile-change-password"]'
        : '[data-tool-action="profile-signout-all"]',
    );

  const updateProfileAuthFeedback = (
    action: ProfileAuthAction,
    ok: boolean,
    message: string,
  ) => {
    if (action === 'change-password') {
      const error = root.querySelector<HTMLElement>('#profile-password-error');
      const status = root.querySelector<HTMLElement>('#profile-password-status');
      if (error) error.textContent = ok ? '' : message;
      if (status) status.textContent = ok ? message : '';
      return;
    }

    const error = root.querySelector<HTMLElement>('#profile-signout-error');
    const status = root.querySelector<HTMLElement>('#profile-signout-status');
    if (error) error.textContent = ok ? '' : message;
    if (status) status.textContent = ok ? message : '';
  };

  const sendProfileAuthRequest = (
    action: ProfileAuthAction,
    payload: Record<string, string> = {},
  ) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      const pending = pendingProfileAuthRequests.get(requestId);
      if (!pending) return;
      pendingProfileAuthRequests.delete(requestId);
      const button = profileAuthButton(pending.action);
      if (button) {
        button.disabled = false;
        button.textContent =
          pending.action === 'change-password'
            ? 'Change password'
            : 'Sign out all devices';
      }
      updateProfileAuthFeedback(
        pending.action,
        false,
        'The request timed out. Check your connection and try again.',
      );
    }, 30_000);
    pendingProfileAuthRequests.set(requestId, { action, timeout });
    window.parent.postMessage(
      {
        type: 'auvrenthia-profile-auth-request',
        requestId,
        action,
        ...payload,
      },
      (window as unknown as { __AUVHOST__: string }).__AUVHOST__,
    );
  };

  window.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      !(window as unknown as { __AUVORIGINOK__: (e: MessageEvent) => boolean }).__AUVORIGINOK__(event) ||
      event.data?.type !== 'auvrenthia-profile-auth-response' ||
      typeof event.data.requestId !== 'string'
    ) {
      return;
    }
    const pending = pendingProfileAuthRequests.get(event.data.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingProfileAuthRequests.delete(event.data.requestId);
    const ok = event.data.ok === true;
    const message =
      typeof event.data.message === 'string'
        ? event.data.message.slice(0, 300)
        : ok
          ? 'Done.'
          : 'The request could not be completed. Please try again.';
    const button = profileAuthButton(pending.action);
    if (button) {
      button.disabled = false;
      button.textContent =
        pending.action === 'change-password'
          ? 'Change password'
          : 'Sign out all devices';
    }
    updateProfileAuthFeedback(pending.action, ok, message);
  });

  type ProfileReply = { message: string; profile?: Record<string, unknown>; avatarUrl?: string; kyc?: Record<string, unknown>;
    tickets?: Array<Record<string, unknown>>; announcements?: Array<Record<string, unknown>>;
    referral?: Record<string, unknown> };
  const pendingProfileRequests = new Map<
    string,
    { resolve: (reply: ProfileReply) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  const sendProfileRequest = (action: string, payload: Record<string, unknown> = {}): Promise<ProfileReply> =>
    new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        if (pendingProfileRequests.delete(requestId)) {
          reject(new Error('The request timed out. Check your connection and try again.'));
        }
      }, 30_000);
      pendingProfileRequests.set(requestId, { resolve, reject, timeout });
      window.parent.postMessage(
        { type: 'auvrenthia-profile-request', requestId, action, ...payload },
        (window as unknown as { __AUVHOST__: string }).__AUVHOST__,
      );
    });
  window.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      !(window as unknown as { __AUVORIGINOK__: (e: MessageEvent) => boolean }).__AUVORIGINOK__(event) ||
      event.data?.type !== 'auvrenthia-profile-response' ||
      typeof event.data.requestId !== 'string'
    ) {
      return;
    }
    const pending = pendingProfileRequests.get(event.data.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingProfileRequests.delete(event.data.requestId);
    if (event.data.ok === true) {
      pending.resolve({
        message: typeof event.data.message === 'string' ? event.data.message : '',
        profile: event.data.profile && typeof event.data.profile === 'object' ? event.data.profile : undefined,
        avatarUrl: typeof event.data.avatarUrl === 'string' ? event.data.avatarUrl : undefined,
        kyc: event.data.kyc && typeof event.data.kyc === 'object' ? event.data.kyc : undefined,
        tickets: Array.isArray(event.data.tickets) ? event.data.tickets : undefined,
        announcements: Array.isArray(event.data.announcements) ? event.data.announcements : undefined,
        referral: event.data.referral && typeof event.data.referral === 'object' ? event.data.referral : undefined,
      });
    } else {
      pending.reject(
        new Error(
          typeof event.data.message === 'string' && event.data.message
            ? event.data.message.slice(0, 300)
            : 'The request could not be completed. Please try again.',
        ),
      );
    }
  });
  const applyProfileReply = (reply: ProfileReply) => {
    if (reply.profile) {
      (window as unknown as { __AUVRENTHIA_PROFILE__: Record<string, unknown> }).__AUVRENTHIA_PROFILE__ = {
        ...authProfile(),
        ...reply.profile,
      };
    }
    if (typeof reply.avatarUrl === 'string') {
      profileAvatarUrl = reply.avatarUrl || null;
      applyAvatar();
    }
  };
  // Pull the saved picture, state and postal code once when the dashboard opens.
  // A code remembered from a referral link (Google sign-ups cannot send it with the form).
  try {
    const remembered = window.localStorage.getItem('auv_ref') || '';
    if (remembered) {
      void sendProfileRequest('claim-referral', { code: remembered })
        .catch(() => undefined)
        .finally(() => window.localStorage.removeItem('auv_ref'));
    }
  } catch {
    // Storage can be blocked inside the dashboard frame; the form path still works.
  }
  sendProfileRequest('load')
    .then((reply) => {
      applyProfileReply(reply);
      const saved = authProfile();
      if (!profileDraft.state) profileDraft.state = textValue(saved.state);
      if (!profileDraft.postal) profileDraft.postal = textValue(saved.postal);
      if (page === 'Profile') renderProfile();
    })
    .catch(() => {
      // The profile page still works; the picture appears after the next load.
    });
  loadKyc().catch(() => {
    // Verification status loads again when the member opens that page.
  });

  // Announcements from the admin console appear under Notifications in the profile menu.
  const renderAnnouncements = (rows: Array<Record<string, unknown>>) => {
    const view = document.querySelector<HTMLElement>('[data-profile-view="notifications"]');
    if (!view) return;
    const empty = view.querySelector<HTMLElement>('.profile-dropdown__empty');
    let list = view.querySelector<HTMLElement>('.auv-notes');
    if (!list) {
      list = document.createElement('div');
      list.className = 'auv-notes';
      list.style.cssText = 'max-height:280px;overflow:auto';
      view.appendChild(list);
    }
    if (empty) empty.hidden = rows.length > 0;
    list.innerHTML = rows
      .map((row) => {
        const when = new Date(textValue(row.created_at)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<div style="padding:10px 12px;border-top:1px solid var(--line)"><b style="display:block;font-size:14px">${escapeHtml(row.title)}</b><span style="display:block;font-size:13px;color:var(--mute);white-space:pre-wrap">${escapeHtml(row.body)}</span><small style="color:var(--mute)">${escapeHtml(when)}</small></div>`;
      })
      .join('');
    const recent = rows.filter((row) => Date.now() - Date.parse(textValue(row.created_at)) < 7 * 864e5).length;
    const label = document.querySelector<HTMLElement>('[data-profile-action="notifications"] span');
    if (label) label.textContent = recent ? `Notifications (${recent})` : 'Notifications';
  };
  const loadAnnouncements = () => {
    sendProfileRequest('list-announcements')
      .then((reply) => renderAnnouncements(reply.announcements ?? []))
      .catch(() => {
        // Notifications stay as they were.
      });
  };
  loadAnnouncements();
  window.addEventListener('auvrenthia-server-data', loadAnnouncements);

  const handleProfileInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const map: Record<string, keyof typeof profileDraft> = {
      'profile-first': 'firstName',
      'profile-last': 'lastName',
      'profile-phone': 'phone',
      'profile-country': 'country',
      'profile-state': 'state',
      'profile-postal': 'postal',
      'profile-address': 'address',
    };
    const key = map[target.id];
    if (key) profileDraft[key] = target.value;
  };

  const handleProfileAvatar = async (input: HTMLInputElement) => {
    const error = root.querySelector<HTMLElement>('#profile-avatar-error');
    const file = input.files?.[0];
    if (!file) return;
    if (error) error.textContent = '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      if (error) error.textContent = 'Choose a PNG, JPG or WebP image.';
      input.value = '';
      return;
    }
    if (file.size === 0 || file.size > AVATAR_MAX_BYTES) {
      if (error) error.textContent = 'Choose an image under 2 MB.';
      input.value = '';
      return;
    }
    try {
      showProfileNotice('Uploading your photo…');
      const bytes = await file.arrayBuffer();
      const reply = await sendProfileRequest('save-avatar', { bytes });
      applyProfileReply(reply);
      renderProfile();
      showProfileNotice('Profile picture updated.');
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'The photo could not be saved.';
      const target = root.querySelector<HTMLElement>('#profile-avatar-error');
      if (target) target.textContent = message;
      const notice = root.querySelector<HTMLElement>('#profile-notice');
      if (notice) notice.hidden = true;
    } finally {
      input.value = '';
    }
  };

  const handleProfileAction = (action: string) => {
    if (action === 'profile-remove-avatar') {
      sendProfileRequest('remove-avatar')
        .then((reply) => {
          applyProfileReply(reply);
          renderProfile();
          showProfileNotice('Profile picture removed.');
        })
        .catch((failure: unknown) => {
          const target = root.querySelector<HTMLElement>('#profile-avatar-error');
          if (target) target.textContent = failure instanceof Error ? failure.message : 'The photo could not be removed.';
        });
    } else if (action === 'profile-reset') {
      profileDraftLoaded = false;
      renderProfile();
    } else if (action === 'profile-save') {
      const error = root.querySelector<HTMLElement>('#profile-error');
      if (error) error.textContent = '';
      if (profileDraft.firstName.trim().length < 1 || profileDraft.lastName.trim().length < 1) {
        if (error) error.textContent = 'Enter your first and last name.';
        return;
      }
      if (profileDraft.phone.trim() && !/^[+\d][\d\s().-]{5,}$/.test(profileDraft.phone.trim())) {
        if (error) error.textContent = 'Enter a valid phone number.';
        return;
      }
      const saveButton = root.querySelector<HTMLButtonElement>('[data-tool-action="profile-save"]');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
      }
      sendProfileRequest('save-profile', {
        fields: {
          first_name: profileDraft.firstName,
          last_name: profileDraft.lastName,
          phone: profileDraft.phone,
          country: profileDraft.country,
          state: profileDraft.state,
          postal: profileDraft.postal,
          address: profileDraft.address,
        },
      })
        .then((reply) => {
          applyProfileReply(reply);
          profileDraftLoaded = false;
          renderProfile();
          showProfileNotice('Your profile was saved.');
        })
        .catch((failure: unknown) => {
          if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = 'Save changes';
          }
          const target = root.querySelector<HTMLElement>('#profile-error');
          if (target) target.textContent = failure instanceof Error ? failure.message : 'Your profile could not be saved.';
        });
    } else if (action === 'profile-change-password') {
      const error = root.querySelector<HTMLElement>('#profile-password-error');
      const status = root.querySelector<HTMLElement>('#profile-password-status');
      const passwordInput = root.querySelector<HTMLInputElement>(
        '#profile-new-password',
      );
      const confirmInput = root.querySelector<HTMLInputElement>(
        '#profile-confirm-password',
      );
      if (error) error.textContent = '';
      if (status) status.textContent = '';
      const password = passwordInput?.value || '';
      const confirmation = confirmInput?.value || '';
      if (password.length < 8 || password.length > 72) {
        if (error) error.textContent = 'Use a password between 8 and 72 characters.';
        return;
      }
      if (password !== confirmation) {
        if (error) error.textContent = 'The password entries do not match.';
        return;
      }
      const button = profileAuthButton('change-password');
      if (!button || button.disabled) return;
      if (passwordInput) passwordInput.value = '';
      if (confirmInput) confirmInput.value = '';
      button.disabled = true;
      button.textContent = 'Changing password…';
      if (status) status.textContent = 'Changing your password…';
      sendProfileAuthRequest('change-password', { password });
    } else if (action === 'profile-confirm-signout-all') {
      const confirmation = root.querySelector<HTMLElement>(
        '#profile-signout-confirmation',
      );
      const trigger = root.querySelector<HTMLButtonElement>(
        '[data-tool-action="profile-confirm-signout-all"]',
      );
      const error = root.querySelector<HTMLElement>('#profile-signout-error');
      const status = root.querySelector<HTMLElement>('#profile-signout-status');
      if (error) error.textContent = '';
      if (status) status.textContent = '';
      if (confirmation) confirmation.hidden = false;
      trigger?.setAttribute('aria-expanded', 'true');
      root
        .querySelector<HTMLButtonElement>(
          '#profile-signout-confirmation [data-tool-action="profile-signout-all"]',
        )
        ?.focus();
    } else if (action === 'profile-cancel-signout') {
      const confirmation = root.querySelector<HTMLElement>(
        '#profile-signout-confirmation',
      );
      const trigger = root.querySelector<HTMLButtonElement>(
        '[data-tool-action="profile-confirm-signout-all"]',
      );
      if (confirmation) confirmation.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
      trigger?.focus();
    } else if (action === 'profile-signout-all') {
      const confirmation = root.querySelector<HTMLElement>(
        '#profile-signout-confirmation',
      );
      const button = profileAuthButton('sign-out-all-devices');
      const error = root.querySelector<HTMLElement>('#profile-signout-error');
      const status = root.querySelector<HTMLElement>('#profile-signout-status');
      if (!confirmation || confirmation.hidden || !button || button.disabled) {
        return;
      }
      if (error) error.textContent = '';
      if (status) status.textContent = 'Signing out of your sessions…';
      button.disabled = true;
      button.textContent = 'Signing out…';
      sendProfileAuthRequest('sign-out-all-devices');
    }
  };

  // ---- Signals (plans, feed and subscription come from the real tables) ---
  type SignalPlan = {
    id: string;
    name: string;
    blurb: string;
    price: number;
    period: string;
    features: string[];
    badge?: string;
  };
  type SignalItem = {
    id: string;
    category: string;
    symbol: string;
    direction: 'buy' | 'sell';
    entry: number;
    takeProfit: number;
    stopLoss: number;
    postedAt: number;
    status: 'active' | 'hit' | 'stopped' | 'closed';
  };
  let signalPlans: SignalPlan[] = [];
  let signalFeed: SignalItem[] = [];
  let signalSubscription = null as { planId: string; renewsAt: number } | null;
  syncServerViews.push(() => {
    if (!server) return;
    signalPlans = server.signalPlans.map((row) => {
      const days = Number(row.period_days) || 30;
      return {
        id: String(row.id),
        name: String(row.name ?? ''),
        blurb: String(row.blurb ?? ''),
        price: Number(row.price) || 0,
        period: days === 30 ? 'per month' : `per ${days} days`,
        badge: row.badge ? String(row.badge) : undefined,
        features: Array.isArray(row.features) ? row.features.map((feature) => String(feature)) : [],
      };
    });
    signalFeed = server.signals.map((row) => ({
      id: String(row.id),
      category: String(row.category ?? ''),
      symbol: String(row.symbol ?? ''),
      direction: row.direction === 'sell' ? 'sell' : 'buy',
      entry: Number(row.entry) || 0,
      takeProfit: Number(row.take_profit) || 0,
      stopLoss: Number(row.stop_loss) || 0,
      postedAt: Date.parse(String(row.posted_at ?? '')) || 0,
      status: (['active', 'hit', 'stopped', 'closed'].includes(String(row.status)) ? row.status : 'active') as SignalItem['status'],
    }));
    const live = server.signalSubs
      .filter((row) => row.status === 'active' && Date.parse(String(row.expires_at ?? '')) > Date.now())
      .sort((first, second) => Date.parse(String(second.expires_at)) - Date.parse(String(first.expires_at)))[0];
    signalSubscription = live
      ? { planId: String(live.plan_id), renewsAt: Date.parse(String(live.expires_at)) }
      : null;
  });

  const signalStatus: Record<SignalItem['status'], [string, string]> = {
    active: ['Active', 'r2'],
    hit: ['Target hit', 'r1'],
    stopped: ['Stopped out', 'r3'],
    closed: ['Closed', 'security-badge-muted'],
  };

  const renderSignals = () => {
    const subscribed = signalSubscription !== null;
    const current = signalPlans.find((plan) => plan.id === signalSubscription?.planId);
    const planCards = signalPlans
      .map((plan) => {
        const owned = current?.id === plan.id;
        return `<div class="pc"><div class="tag"><span>${escapeHtml(plan.name)}</span>${plan.badge ? `<span class="risk r2">${escapeHtml(plan.badge)}</span>` : ''}</div>
          <div><h3>${escapeHtml(plan.name)} signals</h3><p>${escapeHtml(plan.blurb)}</p></div>
          <div class="ret">${escapeHtml(fmt(plan.price))}<small>${escapeHtml(plan.period)}</small></div>
          <ul class="signal-features">${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
          <button class="btn${owned ? ' alt' : ''}" type="button" data-tool-action="signal-subscribe" data-plan="${escapeHtml(plan.id)}"${owned ? ' disabled aria-disabled="true"' : ''}>${owned ? 'Current plan' : subscribed ? 'Switch plan' : 'Subscribe'}</button></div>`;
      })
      .join('') || '<div class="help-empty"><b>No signal plans are available</b><p>Plans will appear here when they are published.</p></div>';

    const feedRows = signalFeed.length
      ? signalFeed
          .map((item) => {
            const [label, tone] = signalStatus[item.status] || signalStatus.active;
            const level = (name: string, value: number) =>
              `<span><small>${name}</small><b>${escapeHtml(priceText(item.category, value))}</b></span>`;
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b><span class="mini-logo">${typeof lg === 'function' ? lg(item.symbol) : ''}</span>${escapeHtml(item.symbol)} · ${item.direction === 'buy' ? 'Buy' : 'Sell'}</b><small>${escapeHtml(item.category)} · ${escapeHtml(new Date(item.postedAt).toLocaleString())}</small><div class="signal-levels">${level('Entry', item.entry)}${level('Take profit', item.takeProfit)}${level('Stop loss', item.stopLoss)}</div></div><span class="risk ${tone}">${label}</span></div>`;
          })
          .join('')
      : '<div class="help-empty"><b>No signals published yet</b><p>New signals will appear here as soon as they are posted.</p></div>';

    root.innerHTML = `<div class="head"><div><div class="lbl">Market signals</div><div class="bal">Signals</div></div><span class="risk ${subscribed ? 'r1' : 'security-badge-muted'}">${subscribed && current ? escapeHtml(current.name) + ' plan' : 'No active plan'}</span></div>
      <p class="note">Subscribe to receive trade ideas with entry, take-profit and stop-loss levels. Signals are general information, not personal advice.</p>
      <div class="security-notice" id="signal-notice" role="status" hidden></div>

      <h2 class="sec">Choose a plan</h2>
      <div class="plans signal-plan-grid">${planCards}</div>

      <h2 class="sec">Latest signals</h2>
      <div class="mp help-tickets">${subscribed ? feedRows : '<div class="help-empty"><b>Subscribe to see live signals</b><p>Pick a plan above to unlock the signal feed.</p></div>'}</div>

      <h2 class="sec">How it works</h2>
      <div class="referral-steps">
        <div class="member-tool-card"><h3>1. Pick a plan</h3><p>Choose the coverage and delivery speed that suits you.</p></div>
        <div class="member-tool-card"><h3>2. Receive signals</h3><p>Each signal lists the asset, direction, entry, take-profit and stop-loss.</p></div>
        <div class="member-tool-card"><h3>3. Decide for yourself</h3><p>Review each idea and manage your own risk before you trade.</p></div>
      </div>
      <div class="member-tool-card"><h3>Risk warning</h3><p>Trading involves risk, including the loss of your capital. Signals do not guarantee profit, and past results do not predict future performance. Only trade with money you can afford to lose. Subscriptions are not investment advice.</p></div>`;
  };

  const handleSignalAction = (button: HTMLElement) => {
    const showNotice = (message: string) => {
      const notice = root.querySelector<HTMLElement>('#signal-notice');
      if (notice) {
        notice.textContent = message;
        notice.hidden = false;
      }
    };
    const plan = signalPlans.find((candidate) => candidate.id === button.dataset.plan);
    if (!plan || !server) {
      showNotice('Subscriptions are not available right now. Nothing was charged.');
      return;
    }
    const ok = window.confirm(
      `Subscribe to ${plan.name} for ${fmt(plan.price)} ${plan.period}? This amount is taken from your available balance.`,
    );
    if (!ok) return;
    button.setAttribute('disabled', 'true');
    showNotice('Processing your subscription…');
    void invCall('subscribeSignals', plan.id)
      .then(() => refreshServer())
      .then(() => showNotice(`You are subscribed to ${plan.name}.`))
      .catch((error: unknown) => {
        button.removeAttribute('disabled');
        showNotice(error instanceof Error ? error.message : 'The subscription could not be completed. Nothing was charged.');
      });
  };

  const newsImage = (article: Record<string, unknown>) => {
    for (const key of ['imageUrl', 'image', 'thumbnail', 'urlToImage', 'imageURL']) {
      const candidate = safeExternalUrl(article[key]);
      if (candidate) return candidate;
    }
    return null;
  };

  const renderNews = () => {
    const requestId = ++publicContentRequest;
    const header = `<div class="head"><div><div class="lbl">Live market coverage</div><div class="bal">News</div></div></div>`;
    root.innerHTML = `${header}<p class="note">Loading current market headlines…</p>`;
    void (async () => {
      try {
        const payload = await requestPublicJson(
          'market-news',
          'https://biquote.io/api/News/market?maxResults=50&language=en&country=US',
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
          const imageUrl = newsImage(article);
          const initials =
            publisher
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((word) => word.charAt(0).toUpperCase())
              .join('') || 'N';
          const thumb = `<a class="member-tool-news-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><span class="member-tool-news-ph">${escapeHtml(initials)}</span>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</a>`;
          return [
            `<article class="member-tool-card member-tool-news-card has-image">
              ${thumb}
              <div class="member-tool-news-body">
                <p class="member-tool-news-meta">${escapeHtml(publisher)}${publishedAt ? ` · ${escapeHtml(publishedAt)}` : ''}</p>
                <h3><a class="member-tool-news-title" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></h3>
              </div>
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

  // ---- Economic calendar --------------------------------------------------
  type CalImpact = 'high' | 'medium' | 'low' | 'none';
  type CalEvent = {
    timestamp: number;
    title: string;
    currency: string;
    impact: CalImpact;
    actual: string;
    forecast: string;
    previous: string;
    source: string;
    sourceUrl: string | null;
  };
  const cal = {
    events: [] as CalEvent[],
    impact: 'all' as 'all' | 'high' | 'medium' | 'low',
    range: 'all' as 'today' | 'week' | 'all',
    currency: 'all',
    state: 'loading' as 'loading' | 'ready' | 'error',
    timer: 0 as ReturnType<typeof setInterval> | 0,
  };

  const calImpact = (value: unknown): CalImpact => {
    const text = String(value ?? '').toLowerCase();
    if (text.includes('high') || text === '3') return 'high';
    if (text.includes('med') || text === '2') return 'medium';
    if (text.includes('low') || text === '1') return 'low';
    return 'none';
  };
  const calImpactLabel: Record<CalImpact, string> = {
    high: 'High impact',
    medium: 'Medium impact',
    low: 'Low impact',
    none: 'Impact not rated',
  };
  const calValue = (value: unknown) => {
    if (value === null || value === undefined) return '—';
    const text = String(value).trim();
    return text ? text : '—';
  };
  const calCountdown = (target: number) => {
    const minutes = Math.max(0, Math.round((target - Date.now()) / 60_000));
    if (minutes < 1) return 'now';
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const rest = minutes % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${rest}m`;
    return `${rest}m`;
  };
  const calDayKey = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  const calDayLabel = (timestamp: number) => {
    const today = Date.now();
    if (calDayKey(timestamp) === calDayKey(today)) return 'Today';
    if (calDayKey(timestamp) === calDayKey(today + 86_400_000)) return 'Tomorrow';
    return new Date(timestamp).toLocaleDateString(undefined, { weekday: 'long' });
  };

  const calFiltered = () => {
    const now = Date.now();
    return cal.events.filter((event) => {
      if (cal.impact !== 'all' && event.impact !== cal.impact) return false;
      if (cal.currency !== 'all' && event.currency !== cal.currency) return false;
      if (cal.range === 'today' && calDayKey(event.timestamp) !== calDayKey(now)) return false;
      if (cal.range === 'week' && event.timestamp > now + 7 * 86_400_000) return false;
      return true;
    });
  };

  const updateCalendarCountdown = () => {
    const node = root.querySelector<HTMLElement>('#cal-next-count');
    if (!node || page !== 'Economic calendar') {
      if (cal.timer) clearInterval(cal.timer);
      cal.timer = 0;
      return;
    }
    const target = Number(node.dataset.target);
    if (Number.isFinite(target)) node.textContent = calCountdown(target);
  };

  const drawCalendar = () => {
    if (page !== 'Economic calendar') return;
    const header = `<div class="head"><div><div class="lbl">Upcoming public releases</div><div class="bal">Economic calendar</div></div></div>`;
    if (cal.state === 'loading') {
      root.innerHTML = `${header}<p class="note">Loading upcoming economic events…</p>`;
      return;
    }
    if (cal.state === 'error') {
      root.innerHTML = `${header}<p class="note" role="alert">The economic calendar is temporarily unavailable from the public provider. Try again later.</p><button class="btn alt" type="button" data-tool-action="cal-retry">Try again</button>`;
      return;
    }

    const filtered = calFiltered();
    const currencies = Array.from(new Set(cal.events.map((event) => event.currency))).sort();
    if (cal.currency !== 'all' && !currencies.includes(cal.currency)) cal.currency = 'all';
    const highCount = filtered.filter((event) => event.impact === 'high').length;
    const next = filtered[0];

    const chip = (action: string, value: string, label: string, current: string, dot = '') =>
      `<button type="button" class="${value === current ? 'on' : ''}" data-tool-action="${action}" data-value="${value}" aria-pressed="${value === current}">${dot ? `<i class="cal-dot ${dot}"></i>` : ''}${label}</button>`;

    const groups: { key: string; timestamp: number; rows: CalEvent[] }[] = [];
    filtered.forEach((event) => {
      const key = calDayKey(event.timestamp);
      const group = groups[groups.length - 1];
      if (group && group.key === key) group.rows.push(event);
      else groups.push({ key, timestamp: event.timestamp, rows: [event] });
    });

    const rowMarkup = (event: CalEvent) => {
      const time = new Date(event.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const source = event.sourceUrl
        ? `<a href="${escapeHtml(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.source)}</a>`
        : escapeHtml(event.source);
      return `<div class="cal-row" role="row">
        <span class="cal-time">${escapeHtml(time)}</span>
        <span class="cal-curwrap"><i class="cal-cur">${escapeHtml(event.currency)}</i></span>
        <div class="cal-ev"><b>${escapeHtml(event.title)}</b><small>${source}</small></div>
        <span class="cal-impact imp-${event.impact}" role="img" aria-label="${calImpactLabel[event.impact]}"><i></i><i></i><i></i></span>
        <span class="cal-num cal-actual" data-label="Actual">${escapeHtml(event.actual)}</span>
        <span class="cal-num" data-label="Forecast">${escapeHtml(event.forecast)}</span>
        <span class="cal-num" data-label="Previous">${escapeHtml(event.previous)}</span>
      </div>`;
    };

    const body = groups.length
      ? groups
          .map(
            (group) =>
              `<div class="cal-day"><b>${escapeHtml(calDayLabel(group.timestamp))}</b><span>${escapeHtml(new Date(group.timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))} · ${group.rows.length} event${group.rows.length === 1 ? '' : 's'}</span></div>${group.rows.map(rowMarkup).join('')}`,
          )
          .join('')
      : '<div class="help-empty"><b>No events match these filters</b><p>Try another impact level, currency or date range.</p></div>';

    root.innerHTML = `${header}
      <div class="cal">
        <div class="cal-summary">
          <div class="cal-tile"><span>Events shown</span><b>${filtered.length}</b></div>
          <div class="cal-tile"><span>High impact</span><b class="${highCount ? 'dn' : ''}">${highCount}</b></div>
          <div class="cal-tile cal-next"><span>Next event</span>${
            next
              ? `<b><span id="cal-next-count" data-target="${next.timestamp}">${calCountdown(next.timestamp)}</span></b><small>${escapeHtml(next.currency)} · ${escapeHtml(next.title)}</small>`
              : '<b>—</b><small>Nothing scheduled</small>'
          }</div>
        </div>
        <div class="cal-filters">
          <div class="cal-chips" role="group" aria-label="Impact">
            ${chip('cal-impact', 'all', 'All', cal.impact)}${chip('cal-impact', 'high', 'High', cal.impact, 'imp-high')}${chip('cal-impact', 'medium', 'Medium', cal.impact, 'imp-medium')}${chip('cal-impact', 'low', 'Low', cal.impact, 'imp-low')}
          </div>
          <div class="cal-chips" role="group" aria-label="Date range">
            ${chip('cal-range', 'today', 'Today', cal.range)}${chip('cal-range', 'week', 'Next 7 days', cal.range)}${chip('cal-range', 'all', 'All upcoming', cal.range)}
          </div>
          <label class="cal-select"><span>Currency</span><select id="cal-currency"><option value="all">All</option>${currencies
            .map((currency) => `<option value="${escapeHtml(currency)}"${currency === cal.currency ? ' selected' : ''}>${escapeHtml(currency)}</option>`)
            .join('')}</select></label>
        </div>
        <div class="cal-table" role="table" aria-label="Economic calendar">
          <div class="cal-head" role="row"><span>Time</span><span>Cur.</span><span>Event</span><span>Impact</span><span class="r">Actual</span><span class="r">Forecast</span><span class="r">Previous</span></div>
          ${body}
        </div>
        <p class="note">Times are shown in your local time (${escapeHtml(fxOffset())}). Confirm releases with the listed source. Calendar data by <a href="https://biquote.io/" target="_blank" rel="noopener noreferrer">biquote</a>.</p>
      </div>`;
    if (cal.timer) clearInterval(cal.timer);
    cal.timer = setInterval(updateCalendarCountdown, 30_000);
  };

  const renderCalendar = () => {
    const requestId = ++publicContentRequest;
    cal.state = 'loading';
    drawCalendar();
    void (async () => {
      try {
        const payload = await requestPublicJson(
          'economic-calendar',
          'https://biquote.io/api/Calendar/upcoming?limit=100',
        );
        if (!Array.isArray(payload)) {
          throw new Error('The public calendar provider returned an unexpected response.');
        }
        if (requestId !== publicContentRequest || page !== 'Economic calendar') return;
        const now = Date.now();
        cal.events = payload
          .flatMap((value): CalEvent[] => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
            const event = value as Record<string, unknown>;
            const timestamp = new Date(typeof event.time === 'string' ? event.time : '').getTime();
            const title = String(event.name ?? event.title ?? '').trim();
            if (!title || !Number.isFinite(timestamp) || timestamp < now) return [];
            return [
              {
                timestamp,
                title,
                currency: String(event.currency ?? event.countryCode ?? 'Global').trim() || 'Global',
                impact: calImpact(event.importance),
                actual: calValue(event.actual),
                forecast: calValue(event.forecast),
                previous: calValue(event.previous),
                source: String(event.source ?? 'Economic calendar'),
                sourceUrl: safeExternalUrl(event.sourceUrl),
              },
            ];
          })
          .sort((first, second) => first.timestamp - second.timestamp);
        cal.state = 'ready';
      } catch {
        if (requestId !== publicContentRequest || page !== 'Economic calendar') return;
        cal.state = 'error';
      }
      drawCalendar();
    })();
  };

  const handleCalendarAction = (action: string, button: HTMLElement) => {
    const value = button.dataset.value || '';
    if (action === 'cal-impact' && ['all', 'high', 'medium', 'low'].includes(value)) {
      cal.impact = value as typeof cal.impact;
    } else if (action === 'cal-range' && ['today', 'week', 'all'].includes(value)) {
      cal.range = value as typeof cal.range;
    } else if (action === 'cal-retry') {
      renderCalendar();
      return;
    } else {
      return;
    }
    drawCalendar();
  };

  const handleCalendarChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === 'cal-currency') {
      cal.currency = target.value;
      drawCalendar();
    }
  };

  const calendarStyle = document.createElement('style');
  calendarStyle.textContent = `
    .cal{max-width:1100px}
    .cal{--cal-mid:#D99A00}
    .cal-summary{display:grid;grid-template-columns:1fr 1fr 2fr;margin-top:22px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .cal-tile{display:grid;gap:3px;padding:14px 18px;min-width:0}
    .cal-tile+.cal-tile{border-left:1px solid var(--line)}
    .cal-tile span{color:var(--mute);font-size:12px}
    .cal-tile b{font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    .cal-tile small{color:var(--mute);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cal-filters{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:18px 0 14px}
    .cal-chips{display:flex;gap:3px;padding:3px;border-radius:11px;background:color-mix(in srgb,var(--ink) 7%,transparent);max-width:100%;overflow-x:auto}
    .cal-chips button{display:inline-flex;align-items:center;gap:7px;padding:6px 13px;border-radius:8px;color:var(--mute);font-size:13px;font-weight:700;white-space:nowrap}
    .cal-chips button:hover{color:var(--ink)}
    .cal-chips button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .cal-dot{display:inline-block;width:8px;height:8px;border-radius:50%}
    .cal-dot.imp-high{background:var(--dn)}
    .cal-dot.imp-medium{background:var(--cal-mid)}
    .cal-dot.imp-low{background:var(--mute)}
    .cal-select{display:inline-flex;align-items:center;gap:8px;margin-left:auto;color:var(--mute);font-size:13px}
    .cal-select select{padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit;font-weight:600}
    .cal-table{border:1px solid var(--line);border-radius:16px;overflow:hidden}
    .cal-head,.cal-row{display:grid;grid-template-columns:64px 66px minmax(0,1fr) 70px 92px 92px 92px;align-items:center;gap:12px;padding:12px 18px}
    .cal-head{color:var(--mute);font-size:12px;font-weight:600;border-bottom:1px solid var(--line)}
    .cal-head .r,.cal-num{text-align:right}
    .cal-day{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:10px 18px;background:color-mix(in srgb,var(--ink) 5%,transparent);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .cal-head+.cal-day{border-top:0}
    .cal-day b{font-size:14px}
    .cal-day span{color:var(--mute);font-size:12px}
    .cal-row{border-top:1px solid var(--line)}
    .cal-day+.cal-row{border-top:0}
    .cal-row:hover{background:color-mix(in srgb,var(--ink) 4%,transparent)}
    .cal-time{font-weight:700;font-variant-numeric:tabular-nums}
    .cal-cur{display:inline-block;padding:3px 9px;border-radius:7px;background:color-mix(in srgb,var(--brand) 13%,transparent);color:var(--brand);font-size:12px;font-style:normal;font-weight:800}
    .cal-ev{display:grid;gap:2px;min-width:0}
    .cal-ev b{line-height:1.35}
    .cal-ev small{color:var(--mute);font-size:12px;font-weight:500}
    .cal-ev small a{color:inherit;text-decoration:underline;text-underline-offset:2px}
    .cal-impact{display:inline-flex;gap:3px;align-items:flex-end;height:16px}
    .cal-impact i{display:block;width:5px;border-radius:2px;background:var(--line)}
    .cal-impact i:nth-child(1){height:7px}
    .cal-impact i:nth-child(2){height:11px}
    .cal-impact i:nth-child(3){height:16px}
    .cal-impact.imp-high i{background:var(--dn)}
    .cal-impact.imp-medium i:nth-child(-n+2){background:var(--cal-mid)}
    .cal-impact.imp-low i:nth-child(1){background:var(--mute)}
    .cal-num{font-variant-numeric:tabular-nums;color:var(--mute);font-weight:600}
    .cal-actual{color:var(--ink);font-weight:800}
    @media(max-width:760px){
      .cal-summary{grid-template-columns:1fr 1fr}
      .cal-next{grid-column:1/-1;border-left:0!important;border-top:1px solid var(--line)}
      .cal-select{margin-left:0;width:100%;justify-content:space-between}
      .cal-table{margin-inline:calc(-1 * clamp(18px,3.5vw,44px));border-radius:0;border-left:0;border-right:0}
      .cal-head{display:none}
      .cal-row{grid-template-columns:auto auto 1fr;grid-template-areas:"time cur imp" "ev ev ev" "act fc prev";row-gap:10px;padding:14px 18px}
      .cal-time{grid-area:time}
      .cal-curwrap{grid-area:cur}
      .cal-impact{grid-area:imp;justify-self:end}
      .cal-ev{grid-area:ev}
      .cal-num{text-align:left;display:grid;gap:2px}
      .cal-num::before{content:attr(data-label);color:var(--mute);font-size:11px;font-weight:500}
      .cal-num[data-label="Actual"]{grid-area:act}
      .cal-num[data-label="Forecast"]{grid-area:fc}
      .cal-num[data-label="Previous"]{grid-area:prev}
    }
  `;
  document.head.appendChild(calendarStyle);

  // ---- Market terminal: Forex, Crypto, Commodities (live quotes) --------
  // The chart is fed only by real TradingView quotes (polled every few
  // seconds) on top of recent history from the market-data function. No
  // price movement is simulated. Order placement is NOT connected: set
  // TRADING_CONNECTED to true and fill FX_PAYOUT_PERCENT once a trading
  // backend exists; until then Buy / Sell only show a notice.
  const TRADING_CONNECTED = false;
  const FX_PAYOUT_PERCENT: number | null = null;

  type FxPair = { symbol: string; name: string; ticker: string; history: string };
  type FxMarket = {
    chip: string;
    scanner: string;
    category: string;
    listTitle: string;
    note: string;
    decimals: (price: number) => number;
    pairs: FxPair[];
  };
  const FX_MARKETS: Record<string, FxMarket> = {
    Stocks: {
      chip: 'US equities · market hours',
      scanner: 'america',
      category: 'stocks',
      listTitle: 'US stocks',
      note: 'Stock quotes are US-listed shares from TradingView and may be delayed. US markets trade 9:30 to 16:00 New York time on weekdays, so prices pause outside those hours.',
      decimals: () => 2,
      pairs: [
        { symbol: 'AAPL', name: 'Apple Inc.', ticker: 'NASDAQ:AAPL', history: 'AAPL' },
        { symbol: 'MSFT', name: 'Microsoft', ticker: 'NASDAQ:MSFT', history: 'MSFT' },
        { symbol: 'NVDA', name: 'NVIDIA', ticker: 'NASDAQ:NVDA', history: 'NVDA' },
        { symbol: 'AMZN', name: 'Amazon', ticker: 'NASDAQ:AMZN', history: 'AMZN' },
        { symbol: 'TSLA', name: 'Tesla', ticker: 'NASDAQ:TSLA', history: 'TSLA' },
        { symbol: 'GOOGL', name: 'Alphabet (Class A)', ticker: 'NASDAQ:GOOGL', history: 'GOOGL' },
        { symbol: 'META', name: 'Meta Platforms', ticker: 'NASDAQ:META', history: 'META' },
        { symbol: 'NFLX', name: 'Netflix', ticker: 'NASDAQ:NFLX', history: 'NFLX' },
        { symbol: 'AMD', name: 'Advanced Micro Devices', ticker: 'NASDAQ:AMD', history: 'AMD' },
        { symbol: 'JPM', name: 'JPMorgan Chase', ticker: 'NYSE:JPM', history: 'JPM' },
        { symbol: 'V', name: 'Visa', ticker: 'NYSE:V', history: 'V' },
      ],
    },
    ETFs: {
      chip: 'Index & sector funds · market hours',
      scanner: 'america',
      category: 'etfs',
      listTitle: 'ETFs',
      note: 'ETF quotes are US-listed funds from TradingView and may be delayed. US markets trade 9:30 to 16:00 New York time on weekdays, so prices pause outside those hours.',
      decimals: () => 2,
      pairs: [
        { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', ticker: 'AMEX:VOO', history: 'VOO' },
        { symbol: 'QQQ', name: 'Invesco QQQ Trust', ticker: 'NASDAQ:QQQ', history: 'QQQ' },
        { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', ticker: 'AMEX:VTI', history: 'VTI' },
        { symbol: 'SPY', name: 'SPDR S&P 500 ETF', ticker: 'AMEX:SPY', history: 'SPY' },
        { symbol: 'IVV', name: 'iShares Core S&P 500 ETF', ticker: 'AMEX:IVV', history: 'IVV' },
        { symbol: 'IWM', name: 'iShares Russell 2000 ETF', ticker: 'AMEX:IWM', history: 'IWM' },
        { symbol: 'DIA', name: 'SPDR Dow Jones Industrial Average ETF', ticker: 'AMEX:DIA', history: 'DIA' },
        { symbol: 'GLD', name: 'SPDR Gold Shares', ticker: 'AMEX:GLD', history: 'GLD' },
        { symbol: 'XLF', name: 'Financial Select Sector SPDR', ticker: 'AMEX:XLF', history: 'XLF' },
        { symbol: 'ARKK', name: 'ARK Innovation ETF', ticker: 'AMEX:ARKK', history: 'ARKK' },
      ],
    },
    Forex: {
      chip: 'Currency pairs · weekdays',
      scanner: 'forex',
      category: 'forex',
      listTitle: 'Forex pairs',
      note: 'Forex quotes are live market quotes from TradingView and may be delayed. The forex market is closed on weekends.',
      decimals: (price) => (price > 500 ? 2 : price > 50 ? 3 : 5),
      pairs: [
        { symbol: 'EUR/USD', name: 'Euro / US dollar', ticker: 'FX_IDC:EURUSD', history: 'EUR-USD' },
        { symbol: 'GBP/USD', name: 'British pound / US dollar', ticker: 'FX_IDC:GBPUSD', history: 'GBP-USD' },
        { symbol: 'USD/JPY', name: 'US dollar / Japanese yen', ticker: 'FX_IDC:USDJPY', history: 'USD-JPY' },
        { symbol: 'AUD/USD', name: 'Australian dollar / US dollar', ticker: 'FX_IDC:AUDUSD', history: 'AUD-USD' },
        { symbol: 'USD/CAD', name: 'US dollar / Canadian dollar', ticker: 'FX_IDC:USDCAD', history: 'USD-CAD' },
        { symbol: 'USD/CHF', name: 'US dollar / Swiss franc', ticker: 'FX_IDC:USDCHF', history: 'USD-CHF' },
        { symbol: 'NZD/USD', name: 'New Zealand dollar / US dollar', ticker: 'FX_IDC:NZDUSD', history: 'NZD-USD' },
        { symbol: 'EUR/GBP', name: 'Euro / British pound', ticker: 'FX_IDC:EURGBP', history: 'EUR-GBP' },
        { symbol: 'EUR/JPY', name: 'Euro / Japanese yen', ticker: 'FX_IDC:EURJPY', history: 'EUR-JPY' },
        { symbol: 'GBP/JPY', name: 'British pound / Japanese yen', ticker: 'FX_IDC:GBPJPY', history: 'GBP-JPY' },
        { symbol: 'USD/CNY', name: 'US dollar / Chinese yuan', ticker: 'FX_IDC:USDCNY', history: 'USD-CNY' },
        { symbol: 'USD/ZAR', name: 'US dollar / South African rand', ticker: 'FX_IDC:USDZAR', history: 'USD-ZAR' },
        { symbol: 'USD/NGN', name: 'US dollar / Nigerian naira', ticker: 'FX_IDC:USDNGN', history: 'USD-NGN' },
      ],
    },
    Crypto: {
      chip: 'Digital assets · 24/7',
      scanner: 'crypto',
      category: 'crypto',
      listTitle: 'Crypto assets',
      note: 'Crypto quotes are Binance USDT markets via TradingView and may be delayed. Prices can move sharply at any hour.',
      decimals: (price) => (price >= 1000 ? 2 : price >= 1 ? 3 : price >= 0.1 ? 4 : 6),
      pairs: [
        { symbol: 'BTC', name: 'Bitcoin', ticker: 'BINANCE:BTCUSDT', history: 'bitcoin' },
        { symbol: 'ETH', name: 'Ethereum', ticker: 'BINANCE:ETHUSDT', history: 'ethereum' },
        { symbol: 'SOL', name: 'Solana', ticker: 'BINANCE:SOLUSDT', history: 'solana' },
        { symbol: 'BNB', name: 'BNB', ticker: 'BINANCE:BNBUSDT', history: 'binancecoin' },
        { symbol: 'XRP', name: 'XRP', ticker: 'BINANCE:XRPUSDT', history: 'ripple' },
        { symbol: 'DOGE', name: 'Dogecoin', ticker: 'BINANCE:DOGEUSDT', history: 'dogecoin' },
        { symbol: 'ADA', name: 'Cardano', ticker: 'BINANCE:ADAUSDT', history: 'cardano' },
        { symbol: 'TRX', name: 'TRON', ticker: 'BINANCE:TRXUSDT', history: 'tron' },
        { symbol: 'AVAX', name: 'Avalanche', ticker: 'BINANCE:AVAXUSDT', history: 'avalanche-2' },
        { symbol: 'LINK', name: 'Chainlink', ticker: 'BINANCE:LINKUSDT', history: 'chainlink' },
        { symbol: 'UNI', name: 'Uniswap', ticker: 'BINANCE:UNIUSDT', history: 'uniswap' },
        { symbol: 'ARB', name: 'Arbitrum', ticker: 'BINANCE:ARBUSDT', history: 'arbitrum' },
        { symbol: 'SHIB', name: 'Shiba Inu', ticker: 'BINANCE:SHIBUSDT', history: 'shiba-inu' },
        { symbol: 'USDC', name: 'USD Coin', ticker: 'BINANCE:USDCUSDT', history: 'usd-coin' },
      ],
    },
    Commodities: {
      chip: 'Metals & energy · futures',
      scanner: 'futures',
      category: 'commodities',
      listTitle: 'Commodities',
      note: 'Commodity quotes are front-month futures from TradingView and may be delayed. Prices follow exchange hours and can pause overnight and on weekends.',
      decimals: (price) => (price < 10 ? 3 : 2),
      pairs: [
        { symbol: 'XAU', name: 'Gold futures', ticker: 'COMEX:GC1!', history: 'XAU' },
        { symbol: 'XAG', name: 'Silver futures', ticker: 'COMEX:SI1!', history: 'XAG' },
        { symbol: 'XPT', name: 'Platinum futures', ticker: 'NYMEX:PL1!', history: 'XPT' },
        { symbol: 'XPD', name: 'Palladium futures', ticker: 'NYMEX:PA1!', history: 'XPD' },
        { symbol: 'WTI', name: 'Crude oil (WTI) futures', ticker: 'NYMEX:CL1!', history: 'WTI' },
        { symbol: 'NG', name: 'Natural gas futures', ticker: 'NYMEX:NG1!', history: 'NG' },
        { symbol: 'HG', name: 'Copper futures', ticker: 'COMEX:HG1!', history: 'HG' },
      ],
    },
    Agriculture: {
      chip: 'Grains & softs · futures',
      scanner: 'futures',
      category: 'agriculture',
      listTitle: 'Agriculture',
      note: 'Agriculture quotes are front-month futures from TradingView and may be delayed. Grains are quoted in US cents per bushel and softs in US cents per lb (cocoa in US dollars per tonne). Prices follow exchange hours and can pause overnight and on weekends.',
      decimals: (price) => (price < 10 ? 3 : 2),
      pairs: [
        { symbol: 'ZW', name: 'Wheat futures', ticker: 'CBOT:ZW1!', history: 'ZW' },
        { symbol: 'ZC', name: 'Corn futures', ticker: 'CBOT:ZC1!', history: 'ZC' },
        { symbol: 'ZS', name: 'Soybean futures', ticker: 'CBOT:ZS1!', history: 'ZS' },
        { symbol: 'KC', name: 'Coffee futures', ticker: 'ICEUS:KC1!', history: 'KC' },
        { symbol: 'CC', name: 'Cocoa futures', ticker: 'ICEUS:CC1!', history: 'CC' },
        { symbol: 'SB', name: 'Sugar #11 futures', ticker: 'ICEUS:SB1!', history: 'SB' },
        { symbol: 'CT', name: 'Cotton futures', ticker: 'ICEUS:CT1!', history: 'CT' },
      ],
    },
    Bonds: {
      chip: 'Treasury & corporate bond funds · market hours',
      scanner: 'america',
      category: 'bonds',
      listTitle: 'Bonds',
      note: 'TradingView does not carry individual bond yields in the live feed, so bond quotes are the prices of US-listed bond ETFs and may be delayed. A rising price means yields are falling. US markets trade 9:30 to 16:00 New York time on weekdays.',
      decimals: () => 2,
      pairs: [
        { symbol: 'IEF', name: 'US Treasury 7-10 year (iShares)', ticker: 'NASDAQ:IEF', history: 'IEF' },
        { symbol: 'TLT', name: 'US Treasury 20+ year (iShares)', ticker: 'NASDAQ:TLT', history: 'TLT' },
        { symbol: 'SHY', name: 'US Treasury 1-3 year (iShares)', ticker: 'NASDAQ:SHY', history: 'SHY' },
        { symbol: 'BIL', name: 'Treasury bills, 1-3 month (SPDR)', ticker: 'AMEX:BIL', history: 'BIL' },
        { symbol: 'SGOV', name: 'Treasury bills, 0-3 month (iShares)', ticker: 'AMEX:SGOV', history: 'SGOV' },
        { symbol: 'LQD', name: 'Investment-grade corporates (iShares)', ticker: 'AMEX:LQD', history: 'LQD' },
        { symbol: 'AGG', name: 'US aggregate bonds (iShares)', ticker: 'AMEX:AGG', history: 'AGG' },
        { symbol: 'BND', name: 'Total bond market (Vanguard)', ticker: 'NASDAQ:BND', history: 'BND' },
        { symbol: 'HYG', name: 'High-yield corporates (iShares)', ticker: 'AMEX:HYG', history: 'HYG' },
        { symbol: 'TIP', name: 'Inflation-protected Treasuries (iShares)', ticker: 'AMEX:TIP', history: 'TIP' },
      ],
    },
    'Real estate': {
      chip: 'Listed property funds · market hours',
      scanner: 'america',
      category: 'realestate',
      listTitle: 'Real estate',
      note: 'TradingView only covers publicly listed property, so these are US-listed REITs and real estate ETFs, and quotes may be delayed. Private property funds are not on TradingView and have no live price. US markets trade 9:30 to 16:00 New York time on weekdays.',
      decimals: () => 2,
      pairs: [
        { symbol: 'VNQ', name: 'Vanguard Real Estate ETF', ticker: 'AMEX:VNQ', history: 'VNQ' },
        { symbol: 'IYR', name: 'iShares US Real Estate ETF', ticker: 'AMEX:IYR', history: 'IYR' },
        { symbol: 'XLRE', name: 'Real Estate Select Sector SPDR', ticker: 'AMEX:XLRE', history: 'XLRE' },
        { symbol: 'PLD', name: 'Prologis (logistics)', ticker: 'NYSE:PLD', history: 'PLD' },
        { symbol: 'O', name: 'Realty Income (rental income)', ticker: 'NYSE:O', history: 'O' },
        { symbol: 'AMT', name: 'American Tower', ticker: 'NYSE:AMT', history: 'AMT' },
        { symbol: 'EQIX', name: 'Equinix (data centres)', ticker: 'NASDAQ:EQIX', history: 'EQIX' },
        { symbol: 'SPG', name: 'Simon Property Group (malls)', ticker: 'NYSE:SPG', history: 'SPG' },
      ],
    },
  };
  const FX_TIMERS = [5, 15, 30, 60, 180, 300];
  const FX_AMOUNTS = [1, 5, 10, 25, 50, 100];

  type FxTick = { t: number; p: number; live?: boolean };
  type FxCandle = { t: number; o: number; h: number; l: number; c: number };
  type FxQuote = {
    p: number;
    change: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
  };
  const fx = {
    market: 'Forex',
    symbols: {
      Stocks: 'AAPL',
      ETFs: 'VOO',
      Forex: 'EUR/USD',
      Crypto: 'BTC',
      Commodities: 'XAU',
      Agriculture: 'ZW',
      Bonds: 'IEF',
      'Real estate': 'VNQ',
    } as Record<string, string>,
    logos: {} as Record<string, { main?: string; base?: string; quote?: string }>,
    logoState: {} as Record<string, 'loading' | 'done'>,
    style: 'line' as 'line' | 'candles',
    ticks: [] as FxTick[],
    candles: [] as FxCandle[],
    interval: 60,
    quotes: {} as Record<string, FxQuote>,
    timerIndex: 2,
    amount: 1,
    run: 0,
    raf: 0,
    pollTimer: 0 as ReturnType<typeof setTimeout> | 0,
    status: 'Connecting to live quotes…',
    lastSecond: 0,
    colors: null as null | { at: number; values: Record<string, string> },
  };
  const fxConfig = () => FX_MARKETS[fx.market] || FX_MARKETS.Forex;
  const fxSymbol = () => fx.symbols[fx.market] || fxConfig().pairs[0].symbol;

  const fxTime = (totalSeconds: number) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor((totalSeconds % 3600) / 60))}:${pad(totalSeconds % 60)}`;
  };
  const fxClock = (date: Date) => date.toLocaleTimeString([], { hour12: false });
  const fxPrice = (price: number) => price.toFixed(fxConfig().decimals(price));
  const fxChange = (change: number | null) =>
    change === null ? '—' : `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`;
  const fxCompact = (value: number | null) =>
    value === null || value <= 0
      ? '—'
      : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const fxOffset = () => {
    const minutes = -new Date().getTimezoneOffset();
    const sign = minutes >= 0 ? '+' : '−';
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    return `UTC${sign}${hours}${rest ? ':' + String(rest).padStart(2, '0') : ''}`;
  };
  const fxAlpha = (color: string, alpha: number) => {
    const match = /^#([0-9a-f]{6})$/i.exec(color);
    if (!match) return color;
    const value = parseInt(match[1], 16);
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
  };

  const stopForex = () => {
    fx.run += 1;
    if (fx.raf) cancelAnimationFrame(fx.raf);
    if (fx.pollTimer) clearTimeout(fx.pollTimer);
    fx.raf = 0;
    fx.pollTimer = 0;
  };

  const fxColors = () => {
    const now = Date.now();
    if (fx.colors && now - fx.colors.at < 500) return fx.colors.values;
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const values = {
      ink: read('--ink', '#0A1230'),
      mute: read('--mute', '#62708F'),
      line: read('--line', '#D6DDEC'),
      brand: read('--brand', '#1F4FFF'),
      up: read('--up', '#0B7F52'),
      dn: read('--dn', '#C8344A'),
      bg: read('--bg', '#F3F5FA'),
    };
    fx.colors = { at: now, values };
    return values;
  };

  const updateForexPayout = () => {
    const payout = root.querySelector<HTMLElement>('#fx-payout');
    const percent = root.querySelector<HTMLElement>('#fx-percent');
    const profit = root.querySelector<HTMLElement>('#fx-profit');
    if (!payout || !percent || !profit) return;
    if (FX_PAYOUT_PERCENT === null || !(fx.amount > 0)) {
      payout.textContent = '$—';
      percent.textContent = '—';
      profit.textContent = '+$—';
      return;
    }
    const gain = (fx.amount * FX_PAYOUT_PERCENT) / 100;
    payout.textContent = `$${(fx.amount + gain).toFixed(2)}`;
    percent.textContent = `+${FX_PAYOUT_PERCENT}%`;
    profit.textContent = `+$${gain.toFixed(2)}`;
  };

  const updateForexList = () => {
    fxConfig().pairs.forEach((pair, index) => {
      const quote = fx.quotes[pair.ticker];
      const price = root.querySelector<HTMLElement>(`#fx-p-${index}`);
      const change = root.querySelector<HTMLElement>(`#fx-c-${index}`);
      if (price) price.textContent = quote ? fxPrice(quote.p) : '—';
      if (change) {
        change.textContent = fxChange(quote ? quote.change : null);
        change.className = `fx-row-num ${quote && quote.change !== null ? (quote.change >= 0 ? 'up' : 'dn') : ''}`;
      }
    });
    const current = fx.quotes[(fxConfig().pairs.find((pair) => pair.symbol === fxSymbol()) || fxConfig().pairs[0]).ticker];
    const set = (id: string, value: string, tone = '') => {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) return;
      node.textContent = value;
      node.className = tone;
    };
    set('fx-s-change', fxChange(current ? current.change : null), current && current.change !== null ? (current.change >= 0 ? 'up' : 'dn') : '');
    set('fx-s-open', current && current.open !== null ? fxPrice(current.open) : '—');
    set('fx-s-high', current && current.high !== null ? fxPrice(current.high) : '—');
    set('fx-s-low', current && current.low !== null ? fxPrice(current.low) : '—');
    set('fx-s-vol', fxCompact(current ? current.volume : null));
  };

  const fxBuildCandles = () => {
    const ms = fx.interval * 1000;
    const bucket = (t: number) => Math.floor(t / ms) * ms;
    const map = new Map<number, FxCandle>();
    fx.candles.forEach((candle) => map.set(bucket(candle.t), { ...candle, t: bucket(candle.t) }));
    fx.ticks.forEach((tick) => {
      if (!tick.live) return;
      const key = bucket(tick.t);
      const current = map.get(key);
      if (current) {
        current.h = Math.max(current.h, tick.p);
        current.l = Math.min(current.l, tick.p);
        current.c = tick.p;
      } else {
        map.set(key, { t: key, o: tick.p, h: tick.p, l: tick.p, c: tick.p });
      }
    });
    return [...map.values()].sort((a, b) => a.t - b.t);
  };

  const drawForex = (canvas: HTMLCanvasElement) => {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const c = fxColors();
    const font = 'Ppmori, Arial, sans-serif';
    const candleMode = fx.style === 'candles';

    const now = Date.now();
    const second = Math.floor(now / 1000);
    const timer = FX_TIMERS[fx.timerIndex];
    if (second !== fx.lastSecond) {
      fx.lastSecond = second;
      const stamp = root.querySelector<HTMLElement>('#fx-stamp');
      if (stamp) stamp.textContent = `${fxClock(new Date(now))} ${fxOffset()}`;
      const expiry = root.querySelector<HTMLElement>('#fx-exp');
      if (expiry) expiry.textContent = fxClock(new Date(now + timer * 1000));
      const recent = fx.ticks.filter((tick) => tick.t >= now - 60_000);
      let upMoves = 0;
      let downMoves = 0;
      for (let index = 1; index < recent.length; index += 1) {
        const diff = recent[index].p - recent[index - 1].p;
        if (diff > 0) upMoves += 1;
        else if (diff < 0) downMoves += 1;
      }
      const total = upMoves + downMoves;
      const share = total >= 3 ? Math.round((upMoves / total) * 100) : null;
      const upLabel = root.querySelector<HTMLElement>('#fx-up');
      const downLabel = root.querySelector<HTMLElement>('#fx-dn');
      const fill = root.querySelector<HTMLElement>('#fx-sentfill');
      if (upLabel) upLabel.textContent = share === null ? '—' : `${share}%`;
      if (downLabel) downLabel.textContent = share === null ? '—' : `${100 - share}%`;
      if (fill) fill.style.width = `${share === null ? 50 : share}%`;
    }

    const future = candleMode ? fx.interval * 3 : Math.max(20, timer * 1.2);
    const past = candleMode ? fx.interval * 45 : Math.max(90, future * 2.4);
    const tMin = now - past * 1000;
    const span = (past + future) * 1000;
    const x = (t: number) => ((t - tMin) / span) * w;
    const yTop = 44;
    const yBottom = h - 30;

    const visible = fx.ticks.filter((tick) => tick.t >= tMin - 120_000);
    const candles = candleMode ? fxBuildCandles().filter((candle) => candle.t + fx.interval * 1000 >= tMin) : [];
    if (!visible.length && !candles.length) {
      ctx.fillStyle = c.mute;
      ctx.font = `14px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText('Waiting for live quotes…', 16, h / 2);
      return;
    }
    const last = visible.length ? visible[visible.length - 1].p : candles[candles.length - 1].c;
    const pts = [...visible, { t: now, p: last }];
    const inWindow = pts.filter((pt) => pt.t >= tMin);
    const basis = inWindow.length ? inWindow : pts.slice(-2);
    const tone = last >= basis[0].p ? c.up : c.dn;
    let lo: number;
    let hi: number;
    if (candleMode && candles.length) {
      lo = Math.min(...candles.map((candle) => candle.l));
      hi = Math.max(...candles.map((candle) => candle.h));
    } else {
      lo = Math.min(...basis.map((pt) => pt.p));
      hi = Math.max(...basis.map((pt) => pt.p));
    }
    const pad = Math.max((hi - lo) * 0.2, last * 0.00003);
    lo -= pad;
    hi += pad;
    const y = (p: number) => yBottom - ((p - lo) / (hi - lo || 1)) * (yBottom - yTop);

    // grid
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.line;
    ctx.fillStyle = c.mute;
    ctx.font = `13px ${font}`;
    ctx.textAlign = 'right';
    for (let line = 0; line <= 4; line += 1) {
      const price = lo + ((hi - lo) * line) / 4;
      const gy = Math.round(y(price)) + 0.5;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fxPrice(price), w - 10, gy - 6);
    }
    const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    const step = steps.find((value) => (past + future) / value <= 8) || 7200;
    ctx.textAlign = 'center';
    for (let t = Math.ceil(tMin / (step * 1000)) * step * 1000; t < tMin + span; t += step * 1000) {
      const gx = Math.round(x(t)) + 0.5;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, yBottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const date = new Date(t);
      const label = step < 60 ? fxClock(date) : fxClock(date).slice(0, 5);
      ctx.fillText(label, Math.min(Math.max(gx, 34), w - 34), h - 9);
    }

    const nowX = x(now);
    const py = y(last);

    if (candleMode) {
      const bodyWidth = Math.max(2, Math.min(18, (x(tMin + fx.interval * 1000) - x(tMin)) * 0.7));
      candles.forEach((candle) => {
        const cx = x(candle.t + (fx.interval * 1000) / 2);
        const color = candle.c >= candle.o ? c.up : c.dn;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(cx, y(candle.h));
        ctx.lineTo(cx, y(candle.l));
        ctx.stroke();
        const top = y(Math.max(candle.o, candle.c));
        const bodyHeight = Math.max(1.5, Math.abs(y(candle.o) - y(candle.c)));
        ctx.fillRect(cx - bodyWidth / 2, top, bodyWidth, bodyHeight);
      });
    } else {
      // expiration zone, gradient area and glowing trend line
      const expiryX = x(now + timer * 1000);
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = c.brand;
      ctx.fillRect(nowX, yTop - 20, Math.max(0, expiryX - nowX), yBottom - yTop + 20);
      ctx.globalAlpha = 1;

      ctx.beginPath();
      pts.forEach((pt, index) => {
        if (index === 0) ctx.moveTo(x(pt.t), y(pt.p));
        else ctx.lineTo(x(pt.t), y(pt.p));
      });
      ctx.lineTo(nowX, yBottom);
      ctx.lineTo(x(pts[0].t), yBottom);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, yTop, 0, yBottom);
      gradient.addColorStop(0, fxAlpha(tone, 0.34));
      gradient.addColorStop(1, fxAlpha(tone, 0));
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      pts.forEach((pt, index) => {
        if (index === 0) ctx.moveTo(x(pt.t), y(pt.p));
        else ctx.lineTo(x(pt.t), y(pt.p));
      });
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.shadowColor = tone;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = c.brand;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(expiryX, 8);
      ctx.lineTo(expiryX, yBottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.moveTo(expiryX, 8);
      ctx.lineTo(expiryX + 22, 8);
      ctx.lineTo(expiryX + 14, 17);
      ctx.lineTo(expiryX + 22, 26);
      ctx.lineTo(expiryX, 26);
      ctx.closePath();
      ctx.fill();
    }

    // current price line and tag
    const accent = candleMode ? c.brand : tone;
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const label = fxPrice(last);
    ctx.font = `700 15px ${font}`;
    const tagWidth = ctx.measureText(label).width + 22;
    const tagY = Math.min(Math.max(py - 15, 4), h - 38);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(w - tagWidth - 6, tagY, tagWidth, 30, 6);
    ctx.fill();
    ctx.fillStyle = c.bg;
    ctx.textAlign = 'center';
    ctx.fillText(label, w - tagWidth / 2 - 6, tagY + 20);

    if (!candleMode) {
      const pulse = 9 + 3 * Math.sin(now / 280);
      ctx.fillStyle = tone;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(nowX, py, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(nowX, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.bg;
      ctx.stroke();
    }
  };

  const loadForexHistory = async (run: number) => {
    const bridge = (
      window as unknown as {
        __AUVRENTHIA_MARKET_REQUEST__?: (
          payload: Record<string, unknown>,
        ) => Promise<{ candles?: unknown }>;
      }
    ).__AUVRENTHIA_MARKET_REQUEST__;
    if (!bridge) return;
    const symbol = fxSymbol();
    const market = fx.market;
    const config = fxConfig();
    const pair = config.pairs.find((item) => item.symbol === symbol) || config.pairs[0];
    try {
      const history = (
        window as unknown as {
          __AUVRENTHIA_HISTORY__?: (c: string, s: string, d: number, label: string) => Promise<unknown[]>;
        }
      ).__AUVRENTHIA_HISTORY__;
      const result = history
        ? { candles: await history(config.category, pair.history, 1, pair.symbol) }
        : await bridge({
            action: 'history',
            category: config.category,
            symbol: pair.history,
            days: 1,
          });
      if (run !== fx.run || symbol !== fxSymbol() || market !== fx.market) return;
      const raw = Array.isArray(result?.candles) ? result.candles : [];
      const rows: FxCandle[] = raw.flatMap((candle: unknown) => {
        if (!candle || typeof candle !== 'object') return [];
        const value = candle as Record<string, unknown>;
        const time = Number(value.time);
        const close = Number(value.close);
        if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) return [];
        const open = Number(value.open);
        const high = Number(value.high);
        const low = Number(value.low);
        return [
          {
            t: time * 1000,
            o: Number.isFinite(open) && open > 0 ? open : close,
            h: Number.isFinite(high) && high > 0 ? high : close,
            l: Number.isFinite(low) && low > 0 ? low : close,
            c: close,
          },
        ];
      });
      rows.sort((a, b) => a.t - b.t);
      if (rows.length >= 2) {
        const gaps = rows.slice(1).map((row, index) => (row.t - rows[index].t) / 1000);
        gaps.sort((a, b) => a - b);
        const median = gaps[Math.floor(gaps.length / 2)];
        if (Number.isFinite(median) && median > 0) fx.interval = Math.min(3600, Math.max(60, median));
      }
      fx.candles = rows;
      const newest = rows.length ? rows[rows.length - 1].t : 0;
      const historyTicks: FxTick[] = rows.slice(-300).map((row) => ({ t: row.t, p: row.c }));
      fx.ticks = [...historyTicks, ...fx.ticks.filter((tick) => tick.t > newest)];
    } catch {
      // History is optional; live quotes alone still draw the chart.
    }
  };

  const pollForex = async (run: number) => {
    if (run !== fx.run) return;
    const config = fxConfig();
    const selected = config.pairs.find((pair) => pair.symbol === fxSymbol()) || config.pairs[0];
    try {
      const response = await fetch(`https://scanner.tradingview.com/${config.scanner}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'application/json' },
        body: JSON.stringify({
          symbols: { tickers: config.pairs.map((pair) => pair.ticker), query: { types: [] } },
          columns: ['close', 'change', 'open', 'high', 'low', 'volume'],
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { data?: { s?: string; d?: unknown[] }[] };
      if (run !== fx.run) return;
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
      rows.forEach((row) => {
        const pair = config.pairs.find((item) => item.ticker === row.s);
        const price = num(row.d?.[0]);
        if (!pair || price === null || price <= 0) return;
        fx.quotes[pair.ticker] = {
          p: price,
          change: num(row.d?.[1]),
          open: num(row.d?.[2]),
          high: num(row.d?.[3]),
          low: num(row.d?.[4]),
          volume: num(row.d?.[5]),
        };
      });
      const current = fx.quotes[selected.ticker];
      if (!current) throw new Error('No quote returned');
      fx.ticks.push({ t: Date.now(), p: current.p, live: true });
      if (fx.ticks.length > 900) fx.ticks.splice(0, fx.ticks.length - 900);
      fx.status = `TradingView quote · updated ${fxClock(new Date())}`;
      updateForexList();
    } catch {
      if (run !== fx.run) return;
      fx.status = 'Live quotes are temporarily unavailable. Retrying…';
    }
    const status = root.querySelector<HTMLElement>('#fx-status');
    if (status) status.textContent = fx.status;
    fx.pollTimer = setTimeout(() => void pollForex(run), 2500);
  };

  const startForex = () => {
    stopForex();
    const run = fx.run;
    const market = fx.market;
    const frame = () => {
      if (run !== fx.run) return;
      const canvas = root.querySelector<HTMLCanvasElement>('#fx-canvas');
      if (!canvas || !canvas.isConnected || page !== market) {
        stopForex();
        return;
      }
      drawForex(canvas);
      fx.raf = requestAnimationFrame(frame);
    };
    fx.raf = requestAnimationFrame(frame);
    void loadForexHistory(run);
    void pollForex(run);
  };

  // Real TradingView symbol images (flags, coin and company logos). Text
  // badges stay underneath, so a missing or blocked image falls back cleanly.
  const TV_LOGO_HOST = 'https://s3-symbol-logo.tradingview.com/';
  const fxLogoUrl = (id: unknown) =>
    typeof id === 'string' && /^[A-Za-z0-9_\-./]{1,80}$/.test(id) && !id.includes('..')
      ? `${TV_LOGO_HOST}${id}--big.svg`
      : null;

  const fxBadges = (symbol: string, small = false, ticker = '') => {
    const parts = symbol.includes('/') ? symbol.split('/') : [symbol.slice(0, 4)];
    const logo = ticker ? fx.logos[ticker] : undefined;
    const urls = symbol.includes('/') ? [logo?.base, logo?.quote] : [logo?.main || logo?.base];
    return `<span class="fx-flags${small ? ' sm' : ''}${parts.length === 1 ? ' one' : ''}" data-fx-badge="${escapeHtml(symbol)}" data-fx-ticker="${escapeHtml(ticker)}" data-fx-small="${small ? '1' : ''}" aria-hidden="true">${parts
      .map((part, index) => {
        const url = urls[index];
        const image = url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="if(!this.dataset.t&&this.src.indexOf('--big.svg')>0){this.dataset.t=1;this.src=this.src.replace('--big.svg','.svg')}else{this.remove()}">` : '';
        return `<i>${escapeHtml(part)}${image}</i>`;
      })
      .join('')}</span>`;
  };

  // One small request per market for symbol image ids. It is separate from
  // the price poll, so a failure here can never affect quotes.
  const loadForexLogos = async (market: string) => {
    const config = FX_MARKETS[market];
    if (!config || fx.logoState[market]) return;
    fx.logoState[market] = 'loading';
    const attempts = [['logoid', 'base_currency_logoid', 'currency_logoid'], ['logoid', 'base_currency_logoid'], ['logoid']];
    for (const columns of attempts) {
      try {
        const response = await fetch(`https://scanner.tradingview.com/${config.scanner}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8', Accept: 'application/json' },
          body: JSON.stringify({ symbols: { tickers: config.pairs.map((pair) => pair.ticker), query: { types: [] } }, columns }),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as { data?: { s?: string; d?: unknown[] }[] };
        const holder = window as unknown as { TV_LOGOS?: Record<string, string> };
        if (!holder.TV_LOGOS) holder.TV_LOGOS = {};
        const shared = holder.TV_LOGOS;
        (Array.isArray(payload.data) ? payload.data : []).forEach((row) => {
          const pair = config.pairs.find((item) => item.ticker === row.s);
          if (!pair) return;
          const main = fxLogoUrl(row.d?.[0]) || undefined;
          const base = fxLogoUrl(row.d?.[1]) || undefined;
          const quote = fxLogoUrl(row.d?.[2]) || undefined;
          fx.logos[pair.ticker] = { main, base, quote };
          const single = main || base;
          if (single) shared[pair.symbol] = single;
        });
        fx.logoState[market] = 'done';
        root.querySelectorAll<HTMLElement>('[data-fx-badge]').forEach((badge) => {
          const ticker = badge.dataset.fxTicker || '';
          if (ticker) badge.outerHTML = fxBadges(badge.dataset.fxBadge || '', badge.dataset.fxSmall === '1', ticker);
        });
        // Refresh other lists that show asset logos.
        if (page === 'Screener') drawScreenerRows();
        else if (page === 'Watchlist') renderWatchlist();
        else if (page === 'Portfolio' && tab === 'Default') renderList();
        return;
      } catch {
        // Try the smaller column set, then fall back to text badges.
      }
    }
    delete fx.logoState[market];
  };

  const resetForexSeries = () => {
    fx.ticks = [];
    fx.candles = [];
    fx.interval = 60;
    fx.status = 'Connecting to live quotes…';
  };

  const renderForex = () => {
    const config = fxConfig();
    const symbol = fxSymbol();
    const pairOptions = config.pairs
      .map(
        (pair) =>
          `<option value="${escapeHtml(pair.symbol)}"${pair.symbol === symbol ? ' selected' : ''}>${escapeHtml(pair.symbol)}</option>`,
      )
      .join('');
    const arrow = (path: string) =>
      `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
    const rows = config.pairs
      .map(
        (pair, index) =>
          `<button class="fx-row${pair.symbol === symbol ? ' on' : ''}" type="button" data-tool-action="fx-pair" data-symbol="${escapeHtml(pair.symbol)}"><span class="fx-row-name">${fxBadges(pair.symbol, true, pair.ticker)}<span><b>${escapeHtml(pair.symbol)}</b><small>${escapeHtml(pair.name)}</small></span></span><span class="fx-row-num" id="fx-p-${index}">—</span><span class="fx-row-num" id="fx-c-${index}">—</span></button>`,
      )
      .join('');
    const tabs = Object.keys(FX_MARKETS)
      .map(
        (name) =>
          `<button type="button" class="${name === fx.market ? 'on' : ''}" data-tool-action="navigate" data-destination="${escapeHtml(name)}"${name === fx.market ? ' aria-current="page"' : ''}>${escapeHtml(name)}</button>`,
      )
      .join('');
    const stat = (label: string, id: string) =>
      `<div class="fx-stat"><span>${label}</span><b id="${id}">—</b></div>`;
    root.innerHTML = `<div class="fx">
      <div class="fx-tabs"><div class="fx-tabset" role="tablist" aria-label="Markets">${tabs}</div><span class="fx-chip">${escapeHtml(config.chip)}</span></div>
      <div class="fx-main">
        <div class="fx-left">
          <div class="fx-bar">
            <label class="fx-pair">${fxBadges(symbol, false, (config.pairs.find((pair) => pair.symbol === symbol) || config.pairs[0]).ticker)}<select id="fx-pair" aria-label="Choose asset">${pairOptions}</select></label>
            <div class="fx-exp"><small>Expiration time</small><b id="fx-exp">--:--:--</b></div>
          </div>
          <div class="fx-chartwrap">
            <canvas id="fx-canvas" aria-label="Live ${escapeHtml(symbol)} price chart"></canvas>
            <div class="fx-stamp" id="fx-stamp"></div>
            <div class="fx-styles" role="group" aria-label="Chart style">
              <button type="button" class="${fx.style === 'line' ? 'on' : ''}" data-tool-action="fx-style" data-style="line" aria-pressed="${fx.style === 'line'}">Line</button>
              <button type="button" class="${fx.style === 'candles' ? 'on' : ''}" data-tool-action="fx-style" data-style="candles" aria-pressed="${fx.style === 'candles'}">Candles</button>
            </div>
          </div>
          <div class="fx-stats">${stat('Change', 'fx-s-change')}${stat('Open', 'fx-s-open')}${stat('High', 'fx-s-high')}${stat('Low', 'fx-s-low')}${stat('Volume', 'fx-s-vol')}</div>
          <div class="fx-sent" aria-label="Recent price direction">
            <span class="up" id="fx-up">—</span>
            <div class="fx-sentbar"><u id="fx-sentfill"></u></div>
            <span class="dn" id="fx-dn">—</span>
          </div>
          <p class="fx-sent-note">Share of rising vs falling quotes over the last minute.</p>
        </div>
        <div class="fx-right">
          <div class="fx-panel">
            <div class="fx-fields">
              <div><span class="fx-label">Time</span><div class="fx-field"><div class="fx-input" id="fx-time">${fxTime(FX_TIMERS[fx.timerIndex])}</div><button class="fx-iconbtn" type="button" data-tool-action="fx-time" aria-label="Change expiration time"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></button></div></div>
              <div><label class="fx-label" for="fx-amount">Amount</label><div class="fx-field"><input class="fx-input" id="fx-amount" type="number" inputmode="decimal" min="0" step="any" value="${fx.amount}"><button class="fx-iconbtn" type="button" data-tool-action="fx-amount" aria-label="Change amount"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.2c-.4-.8-1.3-1.2-2.5-1.2-1.4 0-2.4.7-2.4 1.8 0 2.7 5 1.2 5 3.9 0 1.1-1.1 1.8-2.6 1.8-1.2 0-2.2-.5-2.6-1.4M12 6.5V8m0 8v1.5"/></svg></button></div></div>
            </div>
            <div class="fx-payout"><div><span>Payout</span><b id="fx-payout">$—</b></div><strong id="fx-percent">—</strong><div class="fx-profit"><span>Profit</span><b id="fx-profit">+$—</b></div></div>
            <div class="security-notice" id="fx-notice" role="status" hidden></div>
            <div class="fx-trade">
              <button class="fx-buy" type="button" data-tool-action="fx-buy"><i>${arrow('M7 17 17 7M8 7h9v9')}</i>Buy</button>
              <button class="fx-sell" type="button" data-tool-action="fx-sell"><i>${arrow('M7 7l10 10M17 8v9H8')}</i>Sell</button>
            </div>
          </div>
          <p class="hint" id="fx-status" role="status">${escapeHtml(fx.status)}</p>
        </div>
      </div>
      <h2 class="sec">${escapeHtml(config.listTitle)}</h2>
      <div class="fx-list">
        <div class="fx-list-head"><span>Asset</span><span>Price</span><span>Change</span></div>
        ${rows}
      </div>
      <p class="note">${escapeHtml(config.note)} Trading carries risk, including loss of your capital.</p>
    </div>`;
    updateForexPayout();
    updateForexList();
    startForex();
    void loadForexLogos(fx.market);
  };

  const handleForexAction = (action: string, button: HTMLElement) => {
    if (action === 'fx-time') {
      fx.timerIndex = (fx.timerIndex + 1) % FX_TIMERS.length;
      const field = root.querySelector<HTMLElement>('#fx-time');
      if (field) field.textContent = fxTime(FX_TIMERS[fx.timerIndex]);
      fx.lastSecond = 0;
    } else if (action === 'fx-amount') {
      const index = FX_AMOUNTS.indexOf(fx.amount);
      fx.amount = FX_AMOUNTS[(index + 1) % FX_AMOUNTS.length];
      const input = root.querySelector<HTMLInputElement>('#fx-amount');
      if (input) input.value = String(fx.amount);
      updateForexPayout();
    } else if (action === 'fx-style') {
      fx.style = button.dataset.style === 'candles' ? 'candles' : 'line';
      root.querySelectorAll<HTMLElement>('.fx-styles button').forEach((item) => {
        const on = item.dataset.style === fx.style;
        item.classList.toggle('on', on);
        item.setAttribute('aria-pressed', String(on));
      });
    } else if (action === 'fx-pair') {
      const symbol = button.dataset.symbol || '';
      if (!fxConfig().pairs.some((pair) => pair.symbol === symbol) || symbol === fxSymbol()) return;
      fx.symbols[fx.market] = symbol;
      resetForexSeries();
      renderForex();
      window.scrollTo(0, 0);
    } else if (action === 'fx-buy' || action === 'fx-sell') {
      const notice = root.querySelector<HTMLElement>('#fx-notice');
      if (!TRADING_CONNECTED) {
        if (notice) {
          notice.textContent = 'Trading is not connected yet, so no trade was placed and nothing was charged.';
          notice.hidden = false;
        }
        return;
      }
    }
  };

  const handleForexInput = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === 'fx-amount') {
      fx.amount = Number(target.value) || 0;
      updateForexPayout();
    }
  };

  const handleForexChange = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === 'fx-pair') {
      if (!fxConfig().pairs.some((pair) => pair.symbol === target.value) || target.value === fxSymbol()) return;
      fx.symbols[fx.market] = target.value;
      resetForexSeries();
      renderForex();
    }
  };

  // Open the terminal instead of the plain market page for these sections.
  document.getElementById('nav')?.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>('.nav');
      const name = button?.dataset.p || '';
      if (!button || !FX_MARKETS[name]) return;
      event.stopImmediatePropagation();
      if (fx.market !== name) {
        fx.market = name;
        resetForexSeries();
      }
      page = name;
      document
        .querySelectorAll<HTMLElement>('.nav')
        .forEach((item) => item.classList.toggle('on', item === button));
      const hide = (id: string, hidden: boolean) => {
        const node = document.getElementById(id);
        if (node) node.hidden = hidden;
      };
      hide('dash', true);
      hide('plans', true);
      hide('mkt', true);
      hide('misc', false);
      closeMenu();
      renderForex();
      window.scrollTo(0, 0);
    },
    true,
  );

  // Prefetch symbol images for every market so lists elsewhere get them too.
  Object.keys(FX_MARKETS).forEach((name, index) => {
    setTimeout(() => void loadForexLogos(name), 1200 + index * 700);
  });

  const forexStyle = document.createElement('style');
  forexStyle.textContent = `
    .fx{max-width:760px;margin:0 auto}
    .fx-main{display:block}
    .fx-tabs{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px}
    .fx-tabset{display:flex;gap:4px;padding:4px;border-radius:12px;background:color-mix(in srgb,var(--ink) 7%,transparent);max-width:100%;overflow-x:auto}
    .fx-tabset button{padding:7px 14px;border-radius:9px;color:var(--mute);font-size:14px;font-weight:700;white-space:nowrap}
    .fx-tabset button:hover{color:var(--ink)}
    .fx-tabset button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 4px rgba(0,0,0,.2)}
    .fx-chip{display:inline-flex;align-items:center;gap:7px;color:var(--mute);font-size:12px;font-weight:600}
    .fx-chip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 0 3px color-mix(in srgb,var(--up) 22%,transparent)}
    .fx-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .fx-pair{position:relative;display:inline-flex;align-items:center;gap:10px;padding:8px 36px 8px 10px;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--ink) 5%,transparent);cursor:pointer}
    .fx-pair:focus-within{box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 25%,transparent)}
    .fx-pair::after{content:"▾";position:absolute;right:13px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink)}
    .fx-flags{display:flex;flex:none}
    .fx-flags i{position:relative;overflow:hidden}
    .fx-flags i img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#fff}
    .fx-flags i{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;border:2px solid var(--bg);background:var(--brand);color:#fff;font-style:normal;font-size:10px;font-weight:800}
    .fx-flags i+i{margin-left:-11px;background:var(--ink);color:var(--bg)}
    .fx-flags.one i{background:linear-gradient(135deg,var(--brand),color-mix(in srgb,var(--brand) 55%,var(--ink)));font-size:9px}
    .fx-flags.sm i{width:28px;height:28px;font-size:9px}
    .fx-pair select{appearance:none;-webkit-appearance:none;border:0;outline:none;background:transparent;color:var(--ink);font:inherit;font-size:18px;font-weight:700;cursor:pointer}
    .fx-pair select option{background:var(--bg);color:var(--ink)}
    .fx-exp{text-align:right;color:var(--mute);font-size:13px;line-height:1.35}
    .fx-exp small{display:block;font-size:13px}
    .fx-exp b{display:block;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
    .fx-chartwrap{position:relative;height:clamp(320px,52vh,520px);border:1px solid var(--line);border-radius:16px;overflow:hidden;background:radial-gradient(120% 90% at 85% 0%,color-mix(in srgb,var(--brand) 11%,transparent),transparent 60%),color-mix(in srgb,var(--brand) 4%,var(--bg));touch-action:pan-y}
    .fx-chartwrap canvas{position:absolute;left:0;top:0;display:block}
    .fx-stamp{position:absolute;left:12px;top:12px;color:var(--mute);font-size:13px;font-variant-numeric:tabular-nums;pointer-events:none}
    .fx-styles{position:absolute;left:12px;top:38px;display:flex;gap:3px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--ink) 9%,transparent);z-index:2}
    .fx-styles button{padding:5px 11px;border-radius:8px;color:var(--mute);font-size:12px;font-weight:700}
    .fx-styles button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.2)}
    .fx-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:12px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
    .fx-stat{display:grid;gap:3px;padding:11px 12px;min-width:0}
    .fx-stat+.fx-stat{border-left:1px solid var(--line)}
    .fx-stat span{color:var(--mute);font-size:11px}
    .fx-stat b{font-size:14px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fx-sent{display:flex;align-items:center;gap:10px;margin-top:14px;font-size:13px;font-weight:700}
    .fx-sentbar{position:relative;flex:1;height:10px;border-radius:5px;background:color-mix(in srgb,var(--dn) 55%,transparent);overflow:hidden}
    .fx-sentbar u{display:block;width:50%;height:100%;background:var(--up);border-radius:5px;transition:width .6s ease}
    .fx-sent-note{margin:6px 0 0;color:var(--mute);font-size:12px}
    .fx-panel{margin-top:12px;padding:14px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--ink) 4%,transparent)}
    .fx-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .fx-label{display:block;margin-bottom:8px;color:var(--mute);font-size:15px}
    .fx-field{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:12px;background:var(--bg);overflow:hidden}
    .fx-input{flex:1;min-width:0;padding:14px;border:0;outline:none;background:transparent;color:var(--ink);font:inherit;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
    .fx-field:focus-within{border-color:var(--brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 25%,transparent)}
    .fx-iconbtn{display:grid;place-items:center;width:52px;flex:none;border-left:1px solid var(--line);color:var(--ink)}
    .fx-iconbtn:hover{background:color-mix(in srgb,var(--ink) 8%,transparent)}
    .fx-payout{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-top:12px;padding:10px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--mute);font-size:15px}
    .fx-payout b{display:block;font-weight:600}
    .fx-payout strong{color:var(--up);font-size:26px;letter-spacing:-.02em}
    .fx-profit{text-align:right}
    .fx-trade{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
    .fx-buy,.fx-sell{display:flex;align-items:center;gap:14px;padding:18px;border-radius:12px;color:var(--bg);font-size:20px;font-weight:700;transition:filter .15s,transform .15s}
    .fx-buy{background:var(--up)}
    .fx-sell{background:var(--dn)}
    .fx-buy:hover,.fx-sell:hover{filter:brightness(1.08);transform:translateY(-1px)}
    .fx-buy:active,.fx-sell:active{transform:none;filter:brightness(.94)}
    .fx-buy i,.fx-sell i{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:color-mix(in srgb,var(--bg) 22%,transparent)}
    .fx .hint{margin-top:10px}
    .fx-list{border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:12px}
    .fx-list-head,.fx-row{display:grid;grid-template-columns:minmax(0,1fr) 110px 84px;align-items:center;gap:12px;padding:13px 16px;text-align:left}
    .fx-list-head{color:var(--mute);font-size:12px;font-weight:600;border-bottom:1px solid var(--line)}
    .fx-list-head span:nth-child(n+2){text-align:right}
    .fx-row{width:100%;border-top:1px solid var(--line)}
    .fx-list-head+.fx-row{border-top:0}
    .fx-row:hover{background:color-mix(in srgb,var(--ink) 5%,transparent)}
    .fx-row.on{background:color-mix(in srgb,var(--brand) 10%,transparent)}
    .fx-row-name{display:flex;align-items:center;gap:12px;min-width:0}
    .fx-row-name b{display:block}
    .fx-row-name small{display:block;color:var(--mute);font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fx-row-num{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
    @media(max-width:700px){
      .fx-chartwrap{margin-inline:calc(-1 * clamp(18px,3.5vw,44px));border-radius:0;border-left:0;border-right:0;height:clamp(340px,56vh,520px)}
      .fx-list{margin-inline:calc(-1 * clamp(18px,3.5vw,44px));border-radius:0;border-left:0;border-right:0}
      .fx-stats{grid-template-columns:repeat(3,minmax(0,1fr))}
      .fx-stat:nth-child(4){border-left:0}
      .fx-stat:nth-child(n+4){border-top:1px solid var(--line)}
      .fx-input{font-size:18px;padding:12px}
      .fx-buy,.fx-sell{padding:15px;font-size:18px}
      .fx-list-head,.fx-row{grid-template-columns:minmax(0,1fr) 92px 72px;padding:12px 18px}
    }
    @media(min-width:1024px){
      .fx{max-width:1180px}
      .fx-main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start}
      .fx-chartwrap{height:520px}
      .fx-right{position:sticky;top:16px}
      .fx-right .fx-panel{margin-top:0}
      .fx-fields{grid-template-columns:1fr}
      .fx-trade{gap:10px}
      .fx-buy,.fx-sell{padding:16px;font-size:18px}
      .fx-list-head,.fx-row{grid-template-columns:minmax(0,1fr) 160px 120px}
    }
  `;
  document.head.appendChild(forexStyle);

  const style = document.createElement('style');
  style.textContent = `
    .member-tool-filters,.member-tool-alert-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}
    .member-tool-filters label,.member-tool-alert-form label{display:grid;gap:7px;color:var(--mute);font-size:12px}
    .member-tool-filters input,.member-tool-filters select,.member-tool-alert-form input,.member-tool-alert-form select{width:100%;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink);font:inherit}
    .member-tool-list{display:grid;gap:8px;margin-top:14px}
    .member-tool-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(95px,.45fr) minmax(75px,.35fr) minmax(145px,auto);align-items:center;gap:12px;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
    .member-tool-heading{color:var(--mute);font-size:12px}
    .member-tool-symbol{display:grid;gap:4px;min-width:0}
    .mini-logo{display:inline-flex;vertical-align:middle;margin-right:8px}
    .mini-logo .lg{width:24px;height:24px;font-size:9px}
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
    .member-tool-news-card{margin:0}
    .member-tool-news-card.has-image{display:grid;grid-template-columns:132px minmax(0,1fr);gap:16px;align-items:center}
    .member-tool-news-card .member-tool-news-thumb{position:relative;display:grid;place-items:center;width:132px;height:88px;border-radius:10px;overflow:hidden;background:var(--line)}
    .member-tool-news-card .member-tool-news-thumb img{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover}
    .member-tool-news-ph{color:var(--mute);font-size:22px;font-weight:700;letter-spacing:.04em}
    .nw a{color:inherit;text-decoration:none}.nw a:hover{text-decoration:underline}
    .sec .more{cursor:pointer}
    .member-tool-news-card h3{margin:4px 0 0}
    .member-tool-news-card .member-tool-news-meta{margin:0}
    @media (max-width:560px){.member-tool-news-card.has-image{grid-template-columns:96px minmax(0,1fr);gap:12px}.member-tool-news-card .member-tool-news-thumb{width:96px;height:72px}}
    .member-tool-calendar-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:10px;color:var(--mute);font-size:12px}
    .member-tool-calendar-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
    .member-tool-calendar-facts span{display:grid;gap:4px}
    .member-tool-calendar-facts small{color:var(--mute);font-size:11px}
    .member-tool-calendar-facts b{font-variant-numeric:tabular-nums}
    .member-tool-calendar-source{margin:8px 0 0!important}
    .member-tool-alert-form{grid-template-columns:1.4fr 1fr 1fr auto;align-items:end}
    .signal-features{margin:0;padding:0;list-style:none;display:grid;gap:8px;font-size:14px}
    .signal-features li{position:relative;padding-left:22px;color:var(--mute)}
    .signal-features li::before{content:"✓";position:absolute;left:0;color:var(--up);font-weight:700}
    .signal-levels{display:flex;flex-wrap:wrap;gap:18px;margin-top:8px}
    .signal-levels span{display:grid;gap:2px}
    .signal-levels small{font-size:11px}
    .signal-levels b{font-variant-numeric:tabular-nums}
    .profile-card{max-width:900px}
    .profile-avatar-row{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
    .profile-avatar{display:grid;place-items:center;width:96px;height:96px;flex:none;border-radius:50%;overflow:hidden;background:var(--ink);color:var(--bg);font-size:36px;font-weight:800}
    .profile-avatar img{width:100%;height:100%;object-fit:cover;display:block}
    .profile-avatar-info{display:grid;gap:4px;min-width:0}
    .profile-avatar-info small{color:var(--mute);font-size:13px}
    .profile-upload{display:inline-flex;align-items:center;cursor:pointer}
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
    .security-notice{margin:0 0 8px;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;background:color-mix(in srgb,var(--brand) 12%,transparent);color:var(--brand)}
    .security-notice[hidden]{display:none}
    .security-card .hint{margin-top:14px}
    .security-status-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;margin-top:12px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:none;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
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
    #tax-results .help-tickets{max-width:none}
    .statement-tabs{display:flex;gap:26px;margin:20px 0 0;border-bottom:1px solid var(--line);overflow-x:auto}
    .statement-tab{padding:0 0 10px;margin-bottom:-1px;border:0;border-bottom:2px solid transparent;background:none;color:var(--mute);font:inherit;font-size:16px;font-weight:700;white-space:nowrap;cursor:pointer}
    .statement-tab.on{color:var(--ink);border-bottom-color:var(--brand)}
    .statement-tab:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
    .statement-filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0 16px}
    .statement-filters .fl{margin-top:14px}
    .statement-custom{grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}
    .statement-custom[hidden]{display:none}
    .statement-year{max-width:240px}
    .statement-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}
    .statement-tile{display:grid;gap:6px;padding:16px 18px;border:1px solid var(--line);border-radius:14px;min-width:0}
    .statement-tile span{color:var(--mute);font-size:13px}
    .statement-tile b{font-size:22px;letter-spacing:-.02em;overflow-wrap:anywhere}
    .statement-tile small{color:var(--mute);font-size:12px}
    .statement-table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;margin-top:12px}
    .statement-table{width:100%;min-width:760px;border-collapse:collapse;font-size:14px}
    .statement-table th{padding:12px 16px;text-align:left;color:var(--mute);font-size:12px;font-weight:600;border-bottom:1px solid var(--line);white-space:nowrap}
    .statement-table td{padding:14px 16px;border-top:1px solid var(--line);vertical-align:top}
    .statement-table tbody tr:first-child td{border-top:0}
    .statement-table td small{display:block;margin-top:3px;color:var(--mute);font-size:12px}
    .statement-table .statement-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .statement-ref{max-width:200px;color:var(--mute);font-size:12px;overflow-wrap:anywhere}
    .statement-in{color:var(--up);font-weight:600}
    .statement-out{color:var(--dn);font-weight:600}
    .statement-muted{color:var(--mute)}
    @media(max-width:760px){.statement-filters,.statement-custom{grid-template-columns:1fr}.statement-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.referral-stats,.referral-steps{grid-template-columns:1fr}.referral-field{flex-wrap:wrap}.help-grid{grid-template-columns:1fr}.security-item{flex-direction:column;align-items:flex-start}.security-item-side{justify-content:flex-start}}
    @media(max-width:760px){.member-tool-filters,.member-tool-alert-form{grid-template-columns:1fr}.member-tool-row{grid-template-columns:minmax(0,1fr) auto;gap:8px}.member-tool-heading{display:none}.member-tool-number{text-align:left}.member-tool-action{grid-column:1/-1;justify-self:start}.member-tool-calendar-facts{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  if (!root.dataset.memberToolsBound) {
    root.dataset.memberToolsBound = 'true';
    root.addEventListener('input', (event) => {
      if (page === 'Screener') drawScreenerRows();
      else if (page === 'Watchlist') drawWatchSearch();
      else if (page === 'Profile') handleProfileInput(event);
      else if (FX_MARKETS[page]) handleForexInput(event);
    });
    root.addEventListener('change', (event) => {
      if (page === 'Screener') drawScreenerRows();
      else if (page === 'Watchlist') drawWatchSearch();
      else if (page === 'Statements and tax') handleStatementsChange(event);
      else if (FX_MARKETS[page]) handleForexChange(event);
      else if (page === 'Economic calendar') handleCalendarChange(event);
      else if (page === 'Profile' && event.target instanceof HTMLInputElement && event.target.id === 'profile-avatar-input') {
        void handleProfileAvatar(event.target);
      }
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
      } else if (action?.startsWith('st-')) {
        handleStatementsAction(action, button);
      } else if (action === 'submit-ticket') {
        void submitSupportTicket(button);
      } else if (action === 'security-action') {
        void handleSecurityAction(button);
      } else if (action === 'open-verification') {
        openVerification();
      } else if (action === 'security-back') {
        openSecurityView('overview');
      } else if (action === 'signal-subscribe') {
        handleSignalAction(button);
      } else if (action?.startsWith('profile-')) {
        handleProfileAction(action);
      } else if (action?.startsWith('cal-')) {
        handleCalendarAction(action, button);
      } else if (action?.startsWith('fx-')) {
        handleForexAction(action, button);
      } else if (action === 'copy-referral') {
        void copyReferral(button);
      }
    });
  }


  // ---- Portfolio page: Default watchlist tab, Edit / See all links, live news
  const goToPage = (destination: string) => {
    document
      .querySelector<HTMLButtonElement>(`#nav .nav[data-p="${destination}"]`)
      ?.click();
  };

  const drawDefaultWatchlist = () => {
    const list = document.getElementById('list');
    if (!list) return;
    const selected = watchlist();
    if (!selected.length) {
      list.innerHTML =
        '<p class="note">Your watchlist is empty. <button class="more" type="button" data-home-action="edit-watchlist">Add assets</button></p>';
      return;
    }
    const available = liveRows();
    list.innerHTML =
      '<div class="th"><span>Asset</span><span></span><span>Price</span><span>Change</span><span></span></div>' +
      selected
        .map((entry) => {
          const row = available.find(
            (asset) =>
              asset.category === entry.category && asset.symbol === entry.symbol,
          );
          const changeClass =
            !row || row.change === null ? '' : row.change >= 0 ? 'up' : 'dn';
          const changeText =
            !row || row.change === null
              ? '—'
              : `${row.change >= 0 ? '+' : '−'}${Math.abs(row.change).toFixed(1)}%`;
          return `<div class="a"><div class="nm">${lg(entry.symbol)}<div>${escapeHtml(entry.symbol)}<small>${escapeHtml(row ? row.name : entry.category)}</small></div></div><div class="spk"></div><div class="r">${row ? escapeHtml(priceText(row.category, row.price)) : '—'}</div><div class="r ${changeClass}">${changeText}</div><span></span></div>`;
        })
        .join('');
  };

  type HomeNewsItem = { title: string; url: string; publisher: string; date: string };
  let homeNews: HomeNewsItem[] | null = null;
  let homeNewsLoading = false;
  let homeNewsRetryAt = 0;

  const paintHomeNews = () => {
    const box = document.getElementById('nw');
    if (!box) return;
    if (homeNews && homeNews.length) {
      box.innerHTML = homeNews
        .map(
          (item) =>
            `<div class="nw"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a><small>${escapeHtml(item.publisher)}${item.date ? ` · ${escapeHtml(item.date)}` : ''}</small></div>`,
        )
        .join('');
      return;
    }
    box.innerHTML = `<div class="nw">${homeNews ? 'No current headlines were returned.' : homeNewsRetryAt > Date.now() ? 'Market headlines are temporarily unavailable.' : 'Loading market headlines…'}</div>`;
  };

  const loadHomeNews = () => {
    if (homeNews || homeNewsLoading || homeNewsRetryAt > Date.now()) return;
    homeNewsLoading = true;
    void requestPublicJson(
      'market-news-home',
      'https://biquote.io/api/News/market?maxResults=6&language=en&country=US',
    )
      .then((payload) => {
        if (!Array.isArray(payload)) throw new Error('Unexpected news response.');
        homeNews = payload.flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const article = value as Record<string, unknown>;
          const title = String(article.title ?? '').trim();
          const url = safeExternalUrl(article.url);
          if (!title || !url) return [];
          return [
            {
              title,
              url,
              publisher: String(article.publisher ?? 'Market news'),
              date: formatPublicDate(article.publishedDate ?? article.publishedAt),
            },
          ];
        });
      })
      .catch(() => {
        homeNewsRetryAt = Date.now() + 60_000;
      })
      .finally(() => {
        homeNewsLoading = false;
        paintHomeNews();
      });
  };

  const globals = window as unknown as Record<string, unknown>;
  const originalRenderList = globals.renderList as (() => void) | undefined;
  if (typeof originalRenderList === 'function') {
    globals.renderList = () => {
      if (tab === 'Default' && !globals.host) {
        document.querySelectorAll<HTMLElement>('.tab').forEach((button) => {
          const on = button.dataset.t === 'Default';
          button.classList.toggle('on', on);
          button.setAttribute('aria-selected', String(on));
        });
        drawDefaultWatchlist();
        return;
      }
      originalRenderList();
    };
  }
  const originalRenderRail = globals.renderRail as (() => void) | undefined;
  if (typeof originalRenderRail === 'function') {
    globals.renderRail = () => {
      originalRenderRail();
      paintHomeNews();
      loadHomeNews();
    };
  }

  const dashboard = document.getElementById('dash');
  if (dashboard && !dashboard.dataset.homeLinksBound) {
    dashboard.dataset.homeLinksBound = 'true';
    dashboard.querySelectorAll<HTMLElement>('.sec .more').forEach((button) => {
      const heading = (button.parentElement?.firstChild?.textContent || '').trim();
      if (heading === 'Watchlist') {
        button.setAttribute('type', 'button');
        button.setAttribute('aria-label', 'Edit watchlist');
        button.dataset.homeAction = 'edit-watchlist';
      } else if (heading === 'News') {
        button.setAttribute('type', 'button');
        button.setAttribute('aria-label', 'See all news');
        button.dataset.homeAction = 'see-news';
      }
    });
    dashboard.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest<HTMLElement>('[data-home-action]')?.dataset.homeAction;
      if (action === 'edit-watchlist') goToPage('Watchlist');
      else if (action === 'see-news') goToPage('News');
    });
  }

  document.getElementById('nav')?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest<HTMLElement>('.nav')?.dataset.p === 'Portfolio') {
      tab = 'Default';
      renderList();
    }
  });

  const portfolioTabs = document.getElementById('tabs');
  if (portfolioTabs && !portfolioTabs.querySelector('[data-t="Default"]')) {
    portfolioTabs.insertAdjacentHTML(
      'afterbegin',
      '<button class="tab" role="tab" data-t="Default">Default</button>',
    );
  }
  tab = 'Default';
  renderList();
  paintHomeNews();
  loadHomeNews();

  R.Screener = renderScreener;
  R['Price alerts'] = () => renderAlerts();
  R.Watchlist = renderWatchlist;
  R.News = renderNews;
  R['Economic calendar'] = renderCalendar;
  R['Statements and tax'] = renderStatements;
  R.Referral = () => {
    renderReferral();
    void loadReferral().catch(() => {
      // The page keeps its empty state until the next visit.
    });
  };
  R.Profile = renderProfile;
  R.Signals = renderSignals;
  R['Help center'] = () => {
    renderHelp();
    void loadTickets().catch(() => {
      // The list stays empty until the next attempt.
    });
  };
  R['Security and verification'] = () => {
    securityView = 'overview';
    syncSecurityState(emailVerifiedCache);
    renderSecurity();
    void loadKyc().catch(() => {
      // The page still shows the last known status.
    });
  };

  if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
  if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];

  // ---- Wallet balance, Investment plans and My plans: live from Supabase -----
  // The balance, plan catalog and each member's plans now come from the server
  // (profiles, plans, user_plans, balance_ledger) instead of the old local demo
  // engine. The Harbor page still draws everything, so these functions replace
  // the pieces of it that used local sample data.
  type PlanMeta = {
    id: string;
    frequency: string;
    termMonths: number;
    min: number;
    max: number | null;
    returnMin: number;
    returnMax: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hostFns = window as unknown as Record<string, (...args: any[]) => any>;
  const dollars = (value: number) =>
    '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const serverBalance = () => {
    const balance = Number(server?.profile?.demo_balance);
    return server && Number.isFinite(balance) ? balance : null;
  };
  const planDate = (start: string, months: number) => {
    const date = new Date(`${start}T00:00:00`);
    date.setMonth(date.getMonth() + months);
    return date;
  };
  const formatDate = (date: Date) =>
    Number.isNaN(date.getTime())
      ? '–'
      : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  // Balance: the server balance already includes plan investments and withdrawal holds.
  const originalCashNow = hostFns.cashNow;
  hostFns.cashNow = (...args: unknown[]) => serverBalance() ?? originalCashNow(...args);

  // Reasons the member cannot start a plan right now (the database checks the same rules).
  const investBlockReason = () => {
    if (!server) return 'Your account is still loading. Try again in a moment.';
    if (server.settings?.investing_paused) {
      return 'Investing is temporarily paused. Please try again later.';
    }
    if (server.settings?.need_kyc !== false && server.profile?.kyc_status !== 'verified') {
      return 'Complete identity verification before investing.';
    }
    return '';
  };

  // Plan catalog: start empty so the old hardcoded plans never flash on screen.
  let plansLoaded = false;
  Object.keys(PL).forEach((key) => delete PL[key]);
  ST.plans = [];

  const originalRenderPlans = hostFns.renderPlans;
  hostFns.renderPlans = () => {
    originalRenderPlans();
    const list = document.getElementById('plist');
    if (list && Object.keys(PL).length === 0) {
      list.innerHTML = `<p class="note">${
        plansLoaded
          ? 'No investment plans are open right now. Please check back soon.'
          : 'Loading investment plans…'
      }</p>`;
    }
  };
  hostFns.renderPlans();

  const originalOpenPlan = hostFns.openPlan;
  hostFns.openPlan = (category: string, index: number) => {
    originalOpenPlan(category, index);
    const meta = PL[category]?.[index]?.[7] as PlanMeta | undefined;
    if (!meta || !PS) return;
    PS.planId = meta.id;
    PS.freq = meta.frequency;
    PS.months = meta.termMonths;
    PS.min = meta.min;
    PS.max = meta.max;
    PS.returnMin = meta.returnMin;
    PS.returnMax = meta.returnMax;
    PS.amt = Math.max(meta.min, PS.amt || 0);
    PS.src = 'Wallet';
    PS.rein = true;
    hostFns.drawSheet();
  };

  // The server charges the full amount once, from the wallet, when the plan starts.
  const originalDrawSheet = hostFns.drawSheet;
  hostFns.drawSheet = () => {
    originalDrawSheet();
    const source = document.getElementById('src') as HTMLSelectElement | null;
    if (source) {
      source.innerHTML = `<option value="Wallet" selected>Wallet balance (${fmt(
        Math.max(0, Number(serverBalance() ?? 0)),
      )})</option>`;
      source.disabled = true;
    }
    const amountLabel = document.querySelector('#ov label.fl[for="am"]');
    if (amountLabel && PS) {
      amountLabel.textContent = `Amount to invest now (minimum ${dollars(Number(PS.min) || 0)}${
        PS.max != null ? `, maximum ${dollars(Number(PS.max))}` : ''
      })`;
    }
    const often = Array.from(document.querySelectorAll('#ov .fl')).find(
      (node) => node.textContent === 'How often',
    );
    if (often) {
      often.nextElementSibling?.remove();
      often.remove();
    }
    const blocked = investBlockReason();
    const errorBox = document.getElementById('er');
    if (blocked && errorBox) errorBox.textContent = blocked;
  };

  hostFns.sumHTML = () => {
    if (!PS) return '';
    const years = (Number(PS.months) || 12) / 12;
    const low = PS.amt * Math.pow(1 + (Number(PS.returnMin) || 0) / 100, years);
    const high = PS.amt * Math.pow(1 + (Number(PS.returnMax) || 0) / 100, years);
    const ends = PS.start ? formatDate(planDate(String(PS.start), Number(PS.months) || 12)) : '–';
    return `<div><span>You invest now</span><b>${dollars(Number(PS.amt) || 0)}</b></div><div><span>Charged from</span><b>Wallet balance</b></div><div><span>Projected value (target, not guaranteed)</span><b>${dollars(low)} to ${dollars(high)}</b></div><div><span>Plan ends</span><b>${ends}</b></div>`;
  };

  hostFns.confirmPlan = () => {
    const errorBox = document.getElementById('er');
    const goButton = document.getElementById('go2') as HTMLButtonElement | null;
    const plan = PS;
    if (!plan || !errorBox || !goButton) return;
    const fail = (message: string) => {
      errorBox.textContent = message;
    };
    const blocked = investBlockReason();
    if (blocked) return fail(blocked);
    if (!plan.planId) return fail('This plan is not available.');
    if (!(plan.amt >= plan.min)) return fail(`The minimum for this plan is ${dollars(plan.min)}.`);
    if (plan.max != null && plan.amt > plan.max) {
      return fail(`The maximum for this plan is ${dollars(plan.max)}.`);
    }
    if (!plan.start) return fail('Choose a start date.');
    const balance = serverBalance();
    if (balance !== null && plan.amt > balance) {
      return fail('That is more than your wallet balance. Deposit funds first or lower the amount.');
    }
    errorBox.textContent = '';
    goButton.disabled = true;
    goButton.textContent = 'Starting plan…';
    const started = { ...plan };
    void invCall(
      'investInPlan',
      started.planId,
      started.amt,
      started.freq,
      started.months,
      started.start,
      started.rein,
    ).then(
      async () => {
        try {
          await refreshServer(false);
        } catch {
          // The balance and plan list refresh on the next sync.
        }
        const sheet = document.getElementById('ov');
        if (sheet) {
          sheet.innerHTML = `<div class="sheet"><div class="ok"><i>✓</i><h3>Plan started</h3><p class="lbl" style="margin:6px 0 20px">${escapeHtml(
            started.n,
          )}: ${dollars(Number(started.amt) || 0)} invested from your wallet, starting ${escapeHtml(
            formatDate(new Date(`${started.start}T00:00:00`)),
          )}. Track it under My plans.</p></div><button class="btn" id="done" style="width:100%">Done</button></div>`;
        }
      },
      (error: unknown) => {
        goButton.disabled = false;
        goButton.textContent = 'Confirm plan';
        errorBox.textContent =
          error instanceof Error ? error.message : 'This plan could not be started. Please try again.';
      },
    );
  };

  // My plans: rows from user_plans are mirrored into the shape the Harbor page already draws.
  // Money is charged once at the start; profit credited by an admin lands in the wallet.
  const originalPst = hostFns.pst;
  hostFns.pst = (plan: Record<string, unknown>, now: number = Date.now()) => {
    if (!plan || !plan.server) return originalPst(plan, now);
    const amount = Number(plan.amt) || 0;
    const profit = Number(plan.profit) || 0;
    const status = String(plan.status);
    const closed = status === 'completed' || status === 'cancelled';
    const startMs = new Date(`${plan.start}T00:00:00`).getTime();
    const endMs = planDate(String(plan.start), Number(plan.months) || 12).getTime();
    const progress =
      closed ? 1 : endMs > startMs ? Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs))) : 0;
    const payout = plan.payout == null ? 0 : Number(plan.payout);
    return {
      k: 1,
      nT: 1,
      inv: amount,
      val: closed ? 0 : amount,
      gain: closed ? profit + payout - amount : profit,
      st:
        status === 'completed'
          ? 'Completed'
          : status === 'cancelled'
            ? 'Cancelled'
            : status === 'paused'
              ? 'Paused'
              : startMs > now
                ? 'Scheduled'
                : 'Active',
      pct: progress,
    };
  };

  const originalPlanCard = hostFns.planCard;
  hostFns.planCard = (plan: Record<string, unknown>, state: unknown) => {
    const html = originalPlanCard(plan, state) as string;
    return plan && plan.server
      ? html.replace(
          /<p class="err">Paused\.[^<]*<\/p>/,
          '<p class="err">This plan is paused. Contact support for details.</p>',
        )
      : html;
  };

  const originalRenderMyPlans = hostFns.renderMyPlans;
  hostFns.renderMyPlans = () => {
    originalRenderMyPlans();
    const label = document.querySelector('#misc .head .lbl');
    if (label) label.textContent = 'Live from your account. Profit credits are added to your wallet.';
  };
  R['My plans'] = () => hostFns.renderMyPlans();
  // The nav calls R[page](), which held the original function, so point Withdraw at the
  // wrapped version that shows withdrawal status and history.
  R.Withdraw = () => hostFns.renderWallet();

  // Orders and history: every balance movement, straight from the ledger.
  const ledgerLabels: Record<string, string> = {
    deposit: 'Deposit',
    withdrawal_hold: 'Withdrawal',
    withdrawal_release: 'Withdrawal',
    referral_reward: 'Referral reward',
    plan_investment: 'Plan contribution',
    plan_payout: 'Plan payout',
    plan_profit: 'Plan profit',
    trade_buy: 'Trade (buy)',
    trade_sell: 'Trade (sell)',
    signal_subscription: 'Signal subscription',
    loan_disbursement: 'Loan',
    loan_repayment: 'Loan repayment',
    admin_adjust: 'Balance adjustment',
  };
  hostFns.allEvents = () => {
    if (!server) return [];
    return server.ledger.map((row) => {
      const amount = Number(row.amount) || 0;
      const kind = String(row.kind ?? '');
      return {
        t: Date.parse(String(row.created_at ?? '')) || 0,
        ic: ledgerLabels[kind] ?? 'Balance change',
        d: escapeHtml(row.note || ledgerLabels[kind] || kind),
        u: (amount >= 0 ? '+' : '\u2212') + fmt(Math.abs(amount)),
      };
    });
  };

  syncServerViews.push(() => {
    if (!server) return;
    plansLoaded = true;

    // Catalog the admin manages in "Plan catalog".
    Object.keys(PL).forEach((key) => delete PL[key]);
    const details = new Map<string, { name: string; category: string; ret: string; risk: number }>();
    const retText = (low: number, high: number) =>
      low === high ? `${low}%` : `${low}\u2013${high}%`;
    [...server.plans, ...(server.positionPlans ?? [])].forEach((row) => {
      details.set(String(row.id), {
        name: String(row.name ?? 'Investment plan'),
        category: String(row.category ?? 'Plans'),
        ret: `${Number(row.return_min) || 0}\u2013${Number(row.return_max) || 0}%`,
        risk: Math.min(3, Math.max(1, Number(row.risk) || 2)),
      });
    });
    server.plans.forEach((row) => {
      const category = String(row.category ?? 'Other');
      const low = Number(row.return_min) || 0;
      const high = Number(row.return_max) || 0;
      const min = Number(row.min_amount) || 0;
      const meta: PlanMeta = {
        id: String(row.id),
        frequency: ['Weekly', 'Monthly', 'Quarterly', 'One-time'].includes(String(row.frequency))
          ? String(row.frequency)
          : 'Monthly',
        termMonths: Math.max(1, Number(row.term_months) || 12),
        min,
        max: row.max_amount == null ? null : Number(row.max_amount),
        returnMin: low,
        returnMax: high,
      };
      const mixKey = category in CL ? category : 'Stocks';
      if (!PL[category]) PL[category] = [];
      PL[category].push([
        String(row.name ?? ''),
        String(row.description ?? ''),
        Math.min(3, Math.max(1, Number(row.risk) || 2)),
        retText(low, high),
        dollars(min),
        meta.frequency,
        [[mixKey, 100]],
        meta,
      ]);
    });
    if (PCAT !== 'All' && !PL[PCAT]) PCAT = 'All';
    hostFns.renderPlans();

    // The member's own plans.
    ST.plans = server.userPlans.map((row) => {
      const info = details.get(String(row.plan_id));
      const hex = String(row.id).replace(/-/g, '').slice(0, 8);
      return {
        id: parseInt(hex, 16) || 0,
        uid: String(row.id),
        server: true,
        n: info?.name ?? 'Investment plan',
        c: info?.category ?? 'Plans',
        ret: info?.ret ?? '0\u20130%',
        risk: info?.risk ?? 2,
        amt: Number(row.amount) || 0,
        freq: String(row.frequency ?? 'Monthly'),
        months: Number(row.term_months) || 12,
        start: String(row.start_date ?? '').slice(0, 10),
        src: 'Wallet',
        rein: false,
        t0: Date.parse(String(row.created_at ?? '')) || Date.now(),
        delay: 0,
        cap: 1e9,
        status: String(row.status ?? 'active'),
        profit: Number(row.profit_paid) || 0,
        payout: row.payout_usd == null ? null : Number(row.payout_usd),
      };
    });
    if (typeof hostFns.tickAll === 'function') hostFns.tickAll();
  });

  // ---- Loans: live from loan_products and loans -----------------------------
  const loanDraft = { product: '', amount: '', purpose: '' };
  let loanNotice = '';
  let loanBusy = false;
  const loanStatusLabel: Record<string, [string, string]> = {
    pending: ['Pending review', 'r2'],
    active: ['Active', 'r1'],
    repaid: ['Repaid', 'r1'],
    declined: ['Declined', 'r3'],
    defaulted: ['Defaulted', 'r3'],
    cancelled: ['Cancelled', 'security-badge-muted'],
  };
  const loanBlockReason = () => {
    if (!server) return 'Your account is still loading. Try again in a moment.';
    if (server.settings?.loans_paused) return 'Loan requests are temporarily paused. Please try again later.';
    if (server.settings?.need_kyc !== false && server.profile?.kyc_status !== 'verified') {
      return 'Complete identity verification before requesting a loan.';
    }
    return '';
  };
  const loanQuote = () => {
    const product = (server?.loanProducts ?? []).find((row) => String(row.id) === loanDraft.product);
    const amount = Number(loanDraft.amount);
    if (!product || !(amount > 0)) return '';
    const total = Math.round(amount * (1 + Number(product.interest_pct) / 100) * 100) / 100;
    return `You would repay ${dollars(total)} over ${Number(product.term_months)} months (${Number(product.interest_pct)}% flat interest).`;
  };

  const renderLoanPage = () => {
    const blocked = loanBlockReason();
    const products = server?.loanProducts ?? [];
    const loans = server?.loans ?? [];
    const hasPending = loans.some((loan) => loan.status === 'pending');
    if (!products.some((row) => String(row.id) === loanDraft.product)) {
      loanDraft.product = products.length ? String(products[0].id) : '';
    }
    const productCards = products
      .map((product) => {
        const id = String(product.id);
        const on = id === loanDraft.product;
        return `<button class="mp loan-product" type="button" data-loan-product="${escapeHtml(id)}" aria-pressed="${on}" style="display:block;width:100%;text-align:left;background:none;color:inherit;font:inherit;${on ? 'border-color:var(--ink);' : ''}"><div class="mph"><div><h3>${escapeHtml(product.name)}</h3><small>${escapeHtml(product.description)}</small></div><span class="risk r1">${Number(product.interest_pct)}% flat</span></div><div class="meta"><span>Amount<b>${dollars(Number(product.min_amount))} – ${dollars(Number(product.max_amount))}</b></span><span>Term<b>${Number(product.term_months)} months</b></span></div></button>`;
      })
      .join('');
    const form = products.length
      ? `<h2 class="sec">Request a loan</h2>
        ${productCards}
        <div class="mp">
          <label class="fl" for="loan-amount">Amount (USD)</label>
          <input class="sel" id="loan-amount" type="number" inputmode="decimal" min="0" step="0.01" value="${escapeHtml(loanDraft.amount)}" placeholder="0.00">
          <div class="hint" id="loan-quote">${escapeHtml(loanQuote())}</div>
          <label class="fl" for="loan-purpose">Purpose (optional)</label>
          <textarea class="sel" id="loan-purpose" rows="3" maxlength="1000" placeholder="What will the loan be used for?">${escapeHtml(loanDraft.purpose)}</textarea>
          <div class="err" id="loan-error" role="alert"></div>
          <button class="btn" type="button" id="loan-submit" data-loan-action="request" style="width:100%"${blocked || hasPending ? ' disabled' : ''}>${hasPending ? 'A request is already under review' : 'Request loan'}</button>
          <p class="hint">Approved loans are paid into your account balance. Interest is a flat percentage of the amount borrowed.</p>
        </div>`
      : '<p class="note">No loan products are available right now.</p>';

    const rows = loans
      .map((loan) => {
        const id = String(loan.id);
        const [label, tone] = loanStatusLabel[String(loan.status)] ?? [String(loan.status), 'security-badge-muted'];
        const due = Number(loan.total_due) || 0;
        const repaid = Number(loan.repaid) || 0;
        const left = Math.max(0, Math.round((due - repaid) * 100) / 100);
        const dueDate = loan.due_date ? formatDate(new Date(`${String(loan.due_date)}T00:00:00`)) : '–';
        let actions = '';
        if (loan.status === 'pending') {
          actions = `<div class="deposit-actions"><button class="btn alt" type="button" data-loan-action="cancel" data-loan-id="${escapeHtml(id)}">Cancel request</button></div>`;
        } else if (loan.status === 'active') {
          actions = `<label class="fl" for="loan-repay-${escapeHtml(id)}">Repayment amount (USD)</label>
            <div class="amt"><input id="loan-repay-${escapeHtml(id)}" type="number" inputmode="decimal" min="0" step="0.01" value="${left}"><button class="go" type="button" data-loan-action="repay" data-loan-id="${escapeHtml(id)}" style="padding:8px 14px;font-size:14px">Repay</button></div>
            <div class="err" id="loan-repay-error-${escapeHtml(id)}" role="alert"></div>`;
        }
        const note = loan.note && (loan.status === 'declined' || loan.status === 'defaulted') ? `<p class="hint">${escapeHtml(loan.note)}</p>` : '';
        return `<div class="mp"><div class="mph"><div><h3>${escapeHtml(loan.product_name || 'Loan')}</h3><small>${dollars(Number(loan.principal) || 0)} · ${Number(loan.term_months)} months · due ${dueDate}</small></div><span class="risk ${tone}">${label}</span></div><div class="meta"><span>Total due<b>${dollars(due)}</b></span><span>Repaid<b>${dollars(repaid)}</b></span><span>Remaining<b>${dollars(left)}</b></span></div>${note}${actions}</div>`;
      })
      .join('');

    root.innerHTML = `<div class="head"><div><div class="lbl">Borrowing</div><div class="bal">Loan</div></div><span class="risk ${blocked ? 'r3' : 'r1'}">${blocked ? 'Unavailable' : 'Open'}</span></div>
      ${blocked ? `<div class="security-notice" role="status">${escapeHtml(blocked)}</div>` : ''}
      ${loanNotice ? `<div class="security-notice" role="status">${escapeHtml(loanNotice)}</div>` : ''}
      ${form}
      <h2 class="sec">Your loans</h2>
      ${rows || '<p class="note">You have no loans yet.</p>'}`;
    loanNotice = '';
  };
  R.Loan = renderLoanPage;

  const finishLoanAction = async (message: string) => {
    loanNotice = message;
    try {
      await refreshServer(false);
    } catch {
      // The next background refresh will catch up.
    }
    if (page === 'Loan') renderLoanPage();
  };

  root.addEventListener('input', (event) => {
    if (page !== 'Loan') return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target.id === 'loan-amount') {
      loanDraft.amount = target.value;
      const quote = root.querySelector<HTMLElement>('#loan-quote');
      if (quote) quote.textContent = loanQuote();
    } else if (target.id === 'loan-purpose') {
      loanDraft.purpose = target.value;
    }
  });

  root.addEventListener('click', (event) => {
    if (page !== 'Loan') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLElement>('[data-loan-product],[data-loan-action]');
    if (!button) return;
    if (button.dataset.loanProduct) {
      loanDraft.product = button.dataset.loanProduct;
      renderLoanPage();
      return;
    }
    if (loanBusy) return;
    const action = button.dataset.loanAction;
    const id = button.dataset.loanId || '';
    const run = async (task: () => Promise<unknown>, done: string, errorBox: HTMLElement | null) => {
      loanBusy = true;
      button.setAttribute('disabled', 'true');
      try {
        await task();
        await finishLoanAction(done);
      } catch (failure) {
        button.removeAttribute('disabled');
        if (errorBox) errorBox.textContent = failure instanceof Error ? failure.message : 'The request failed. Please try again.';
      } finally {
        loanBusy = false;
      }
    };

    if (action === 'request') {
      const error = root.querySelector<HTMLElement>('#loan-error');
      if (error) error.textContent = '';
      const product = (server?.loanProducts ?? []).find((row) => String(row.id) === loanDraft.product);
      const amount = Math.round(Number(loanDraft.amount) * 100) / 100;
      const blocked = loanBlockReason();
      if (blocked) {
        if (error) error.textContent = blocked;
      } else if (!product) {
        if (error) error.textContent = 'Choose a loan product.';
      } else if (!(amount > 0)) {
        if (error) error.textContent = 'Enter an amount.';
      } else if (amount < Number(product.min_amount) || amount > Number(product.max_amount)) {
        if (error) error.textContent = `Enter an amount between ${dollars(Number(product.min_amount))} and ${dollars(Number(product.max_amount))}.`;
      } else {
        void run(
          async () => {
            await invCall('requestLoan', loanDraft.product, amount, loanDraft.purpose.trim());
            loanDraft.amount = '';
            loanDraft.purpose = '';
          },
          'Loan request submitted. Our team will review it.',
          error,
        );
      }
    } else if (action === 'cancel' && id) {
      void run(() => invCall('cancelLoanRequest', id), 'Loan request cancelled.', null);
    } else if (action === 'repay' && id) {
      const error = root.querySelector<HTMLElement>(`#loan-repay-error-${id}`);
      if (error) error.textContent = '';
      const amount = Math.round(Number((root.querySelector<HTMLInputElement>(`#loan-repay-${id}`)?.value) || 0) * 100) / 100;
      const loan = (server?.loans ?? []).find((row) => String(row.id) === id);
      const left = loan ? Math.round(((Number(loan.total_due) || 0) - (Number(loan.repaid) || 0)) * 100) / 100 : 0;
      const balance = serverBalance();
      if (!(amount > 0)) {
        if (error) error.textContent = 'Enter an amount.';
      } else if (amount > left) {
        if (error) error.textContent = `You only owe ${dollars(left)}.`;
      } else if (balance !== null && amount > balance) {
        if (error) error.textContent = 'Not enough balance for this repayment.';
      } else {
        void run(() => invCall('repayLoan', id, amount), 'Repayment received. Thank you.', error);
      }
    }
  });

  // Load the real data now, then keep it fresh (balance, approvals, new signals).
  const reload = (repaintAnyPage = false) => {
    void refreshServer(repaintAnyPage).catch((error: unknown) => {
      console.error('Member data could not be loaded.', error);
    });
  };
  reload(true);
  window.setInterval(() => {
    if (!document.hidden) reload();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) reload();
  });
}
