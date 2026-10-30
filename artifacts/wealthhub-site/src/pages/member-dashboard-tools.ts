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
declare function closeMenu(): void;
declare function loadCrypto(): Promise<void>;
declare function save(): void;
declare function fmt(amount: number): string;
declare function lg(symbol: string): string;

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

  // ---- Profile (frontend only) ------------------------------------------
  // Nothing is saved yet. Set PROFILE_CONNECTED to true once saving and
  // avatar upload are wired to Supabase. The picture is only previewed in
  // this browser until then.
  const PROFILE_CONNECTED = false;
  const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
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
      </div>`;
  };

  const showProfileNotice = (message: string) => {
    const notice = root.querySelector<HTMLElement>('#profile-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
  };

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

  const handleProfileAvatar = (input: HTMLInputElement) => {
    const error = root.querySelector<HTMLElement>('#profile-avatar-error');
    const file = input.files?.[0];
    if (!file) return;
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
    if (profileAvatarUrl) URL.revokeObjectURL(profileAvatarUrl);
    profileAvatarUrl = URL.createObjectURL(file);
    applyAvatar();
    renderProfile();
    showProfileNotice('Photo previewed on this device only. Saving profile pictures is not connected yet.');
  };

  const handleProfileAction = (action: string) => {
    if (action === 'profile-remove-avatar') {
      if (profileAvatarUrl) URL.revokeObjectURL(profileAvatarUrl);
      profileAvatarUrl = null;
      applyAvatar();
      renderProfile();
    } else if (action === 'profile-reset') {
      profileDraftLoaded = false;
      profileDraft.state = '';
      profileDraft.postal = '';
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
      if (!PROFILE_CONNECTED) {
        showProfileNotice('Saving is not connected yet, so nothing was changed.');
        return;
      }
    }
  };

  // ---- Signals (frontend only) -------------------------------------------
  // Nothing is connected yet. Edit signalPlans for your real prices and
  // features. Fill signalFeed and set the subscription from your database,
  // then set SIGNALS_CONNECTED to true once checkout is wired up.
  const SIGNALS_CONNECTED = false;
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
  const signalPlans: SignalPlan[] = [
    {
      id: 'starter',
      name: 'Starter',
      blurb: 'Core market signals for getting started.',
      price: 49,
      period: 'per month',
      features: ['Crypto and forex signals', 'Entry, take-profit and stop-loss levels', 'Email delivery'],
    },
    {
      id: 'pro',
      name: 'Pro',
      blurb: 'More markets and faster delivery.',
      price: 99,
      period: 'per month',
      badge: 'Most popular',
      features: ['Everything in Starter', 'Stocks, ETFs and commodities', 'Instant dashboard alerts', 'Signal history and results'],
    },
    {
      id: 'vip',
      name: 'VIP',
      blurb: 'Full coverage with priority support.',
      price: 199,
      period: 'per month',
      features: ['Everything in Pro', 'Priority support', 'Market notes from our analysts', 'Early access to new products'],
    },
  ];
  const signalFeed: SignalItem[] = [];
  const signalSubscription = null as { planId: string; renewsAt: number } | null;

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
      .join('');

    const feedRows = signalFeed.length
      ? signalFeed
          .map((item) => {
            const [label, tone] = signalStatus[item.status] || signalStatus.active;
            const level = (name: string, value: number) =>
              `<span><small>${name}</small><b>${escapeHtml(priceText(item.category, value))}</b></span>`;
            return `<div class="help-ticket-row"><div class="help-ticket-main"><b>${escapeHtml(item.symbol)} · ${item.direction === 'buy' ? 'Buy' : 'Sell'}</b><small>${escapeHtml(item.category)} · ${escapeHtml(new Date(item.postedAt).toLocaleString())}</small><div class="signal-levels">${level('Entry', item.entry)}${level('Take profit', item.takeProfit)}${level('Stop loss', item.stopLoss)}</div></div><span class="risk ${tone}">${label}</span></div>`;
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
    const notice = root.querySelector<HTMLElement>('#signal-notice');
    if (!SIGNALS_CONNECTED) {
      if (notice) {
        notice.textContent = 'Subscriptions are not available yet. Nothing was charged.';
        notice.hidden = false;
      }
      return;
    }
    void button;
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
    symbols: { Stocks: 'AAPL', ETFs: 'VOO', Forex: 'EUR/USD', Crypto: 'BTC', Commodities: 'XAU' } as Record<string, string>,
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
      const result = await bridge({
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
      const history: FxTick[] = rows.slice(-300).map((row) => ({ t: row.t, p: row.c }));
      fx.ticks = [...history, ...fx.ticks.filter((tick) => tick.t > newest)];
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

  const fxBadges = (symbol: string, small = false) => {
    const parts = symbol.includes('/') ? symbol.split('/') : [symbol.slice(0, 4)];
    return `<span class="fx-flags${small ? ' sm' : ''}${parts.length === 1 ? ' one' : ''}" aria-hidden="true">${parts
      .map((part) => `<i>${escapeHtml(part)}</i>`)
      .join('')}</span>`;
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
          `<button class="fx-row${pair.symbol === symbol ? ' on' : ''}" type="button" data-tool-action="fx-pair" data-symbol="${escapeHtml(pair.symbol)}"><span class="fx-row-name">${fxBadges(pair.symbol, true)}<span><b>${escapeHtml(pair.symbol)}</b><small>${escapeHtml(pair.name)}</small></span></span><span class="fx-row-num" id="fx-p-${index}">—</span><span class="fx-row-num" id="fx-c-${index}">—</span></button>`,
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
            <label class="fx-pair">${fxBadges(symbol)}<select id="fx-pair" aria-label="Choose asset">${pairOptions}</select></label>
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
      else if (page === 'Profile') handleProfileInput(event);
      else if (FX_MARKETS[page]) handleForexInput(event);
    });
    root.addEventListener('change', (event) => {
      if (page === 'Screener') drawScreenerRows();
      else if (page === 'Statements and tax') handleStatementsChange(event);
      else if (FX_MARKETS[page]) handleForexChange(event);
      else if (page === 'Economic calendar') handleCalendarChange(event);
      else if (page === 'Profile' && event.target instanceof HTMLInputElement && event.target.id === 'profile-avatar-input') {
        handleProfileAvatar(event.target);
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

  R.Screener = renderScreener;
  R['Price alerts'] = () => renderAlerts();
  R.Watchlist = renderWatchlist;
  R.News = renderNews;
  R['Economic calendar'] = renderCalendar;
  R['Statements and tax'] = renderStatements;
  R.Referral = renderReferral;
  R.Profile = renderProfile;
  R.Signals = renderSignals;
  R['Help center'] = renderHelp;
  R['Security and verification'] = () => {
    securityView = 'overview';
    renderSecurity();
  };

  if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
  if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];
}
