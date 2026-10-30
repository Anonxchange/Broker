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

  // ---- Lending ------------------------------------------------------------
  // Frontend only until LENDING_CONNECTED is true. Rates, fees and the total
  // repayable amount are never shown here because they are set per application
  // by your lending team. Once the backend exists:
  //   1. fill lendingApplications from the database (shape: LendingApplication),
  //   2. implement sendLendingRequest (post to the parent page, insert a row for
  //      the signed-in user, resolve when saved, throw on error),
  //   3. set LENDING_CONNECTED to true.
  // Approval status must come from the server, never from member-editable state.
  const LENDING_CONNECTED = false;

  type LendingStatus = 'submitted' | 'in_review' | 'approved' | 'declined' | 'withdrawn';
  type LendingApplication = {
    id: string;
    amount: number;
    termMonths: number;
    purpose: string;
    status: LendingStatus;
    createdAt: number;
    decisionNote?: string;
  };
  type LendingRequestInput = {
    amount: number;
    termMonths: number;
    purpose: string;
    notes: string;
  };

  // Set these to the limits your lending team has approved.
  const LENDING_LIMITS = { min: 500, max: 250000 };
  const LENDING_TERMS = [3, 6, 12, 24, 36];
  const LENDING_PURPOSES = [
    'Working capital',
    'Business expansion',
    'Personal expenses',
    'Education',
    'Property',
    'Other',
  ];

  // Filled from the database later. Shape: LendingApplication.
  const lendingApplications: LendingApplication[] = [];

  const lendingStatus: Record<LendingStatus, [string, string]> = {
    submitted: ['Submitted', 'r2'],
    in_review: ['In review', 'r2'],
    approved: ['Approved', 'r1'],
    declined: ['Declined', 'r3'],
    withdrawn: ['Withdrawn', 'security-badge-muted'],
  };

  const memberKycStatus = () => {
    const profile = (window as unknown as { __AUVRENTHIA_PROFILE__?: { kyc_status?: unknown } })
      .__AUVRENTHIA_PROFILE__;
    return String(profile?.kyc_status ?? 'none');
  };

  const lendingEligibility = (): { ok: boolean; label: string; tone: string; detail: string } => {
    switch (memberKycStatus()) {
      case 'verified':
        return {
          ok: true,
          label: 'Eligible to apply',
          tone: 'r1',
          detail: 'Your identity verification is complete.',
        };
      case 'pending':
        return {
          ok: false,
          label: 'Verification in review',
          tone: 'r2',
          detail: 'You can apply once your identity verification has been approved.',
        };
      case 'rejected':
        return {
          ok: false,
          label: 'Action required',
          tone: 'r3',
          detail: 'Your identity verification needs attention before you can apply.',
        };
      default:
        return {
          ok: false,
          label: 'Verification required',
          tone: 'security-badge-muted',
          detail: 'Complete identity verification before you can apply for lending.',
        };
    }
  };

  const formatMoney = (amount: number) => {
    try {
      return fmt(amount);
    } catch {
      return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
  };

  const lendingRowsMarkup = () =>
    lendingApplications.length
      ? lendingApplications
          .map((application) => {
            const [label, tone] = lendingStatus[application.status] || lendingStatus.submitted;
            const note = application.decisionNote
              ? `<small>${escapeHtml(application.decisionNote)}</small>`
              : '';
            return `<div class="lending-row"><div class="lending-row-main"><b>${escapeHtml(formatMoney(application.amount))} · ${escapeHtml(application.termMonths)} months</b><small>${escapeHtml(application.id)} · ${escapeHtml(application.purpose)} · ${escapeHtml(new Date(application.createdAt).toLocaleDateString())}</small>${note}</div><span class="risk ${tone}">${label}</span></div>`;
          })
          .join('')
      : '<div class="help-empty"><b>No applications yet</b><p>Applications you submit will appear here with their current status.</p></div>';

  const renderLending = () => {
    const eligibility = lendingEligibility();
    const openCount = lendingApplications.filter(
      (application) => application.status === 'submitted' || application.status === 'in_review',
    ).length;
    const approvedCount = lendingApplications.filter(
      (application) => application.status === 'approved',
    ).length;
    const canApply = LENDING_CONNECTED && eligibility.ok;

    let banner = '';
    if (!LENDING_CONNECTED) {
      banner =
        '<div class="lending-banner" role="status"><b>Applications are not open yet</b><p>Lending is not available on your account at the moment. You can review how it works below.</p></div>';
    } else if (!eligibility.ok) {
      banner = `<div class="lending-banner" role="status"><b>${escapeHtml(eligibility.label)}</b><p>${escapeHtml(eligibility.detail)}</p><button class="btn alt" type="button" data-tool-action="navigate" data-destination="Security and verification">Open verification</button></div>`;
    }

    const termOptions = LENDING_TERMS.map(
      (months) => `<option value="${months}"${months === 12 ? ' selected' : ''}>${months} months</option>`,
    ).join('');
    const purposeOptions = LENDING_PURPOSES.map(
      (purpose) => `<option value="${escapeHtml(purpose)}">${escapeHtml(purpose)}</option>`,
    ).join('');
    const disabled = canApply ? '' : ' disabled aria-disabled="true"';

    root.innerHTML = `<div class="head"><div><div class="lbl">Borrowing</div><div class="bal">Lending</div></div><span class="risk ${eligibility.tone}">${escapeHtml(eligibility.label)}</span></div>
      <p class="note">Apply for a lending facility and track each application from submission to decision. The rate, fees and total repayable amount are confirmed in writing before you accept any offer.</p>
      ${banner}

      <div class="lending-stats">
        <div class="lending-stat"><small>Open applications</small><b>${openCount}</b></div>
        <div class="lending-stat"><small>Approved facilities</small><b>${approvedCount}</b></div>
        <div class="lending-stat"><small>Requested amount</small><b>${escapeHtml(formatMoney(LENDING_LIMITS.min))} – ${escapeHtml(formatMoney(LENDING_LIMITS.max))}</b></div>
      </div>

      <h2 class="sec">Request a facility</h2>
      <div class="mp" id="lending-form-card">
        <div class="mph"><div><h3>Application details</h3><small>Tell us how much you would like to borrow and for how long.</small></div></div>
        <fieldset class="lending-fieldset"${disabled}>
          <div class="help-grid">
            <div><label class="fl" for="lending-amount">Amount (USD)</label><input class="help-input" id="lending-amount" type="number" inputmode="decimal" min="${LENDING_LIMITS.min}" max="${LENDING_LIMITS.max}" step="0.01" placeholder="${LENDING_LIMITS.min}"></div>
            <div><label class="fl" for="lending-term">Term</label><select class="sel" id="lending-term">${termOptions}</select></div>
            <div><label class="fl" for="lending-purpose">Purpose</label><select class="sel" id="lending-purpose">${purposeOptions}</select></div>
          </div>
          <label class="fl" for="lending-notes">Additional information <span class="help-optional">(optional)</span></label>
          <textarea class="help-input help-textarea" id="lending-notes" rows="4" maxlength="1000" placeholder="Anything that will help us assess your application."></textarea>
          <label class="lending-ack" for="lending-ack"><input type="checkbox" id="lending-ack"><span>I understand that submitting an application does not guarantee approval, and that I will receive the full terms to review before I accept.</span></label>
        </fieldset>
        <div class="err" id="lending-error" role="alert"></div>
        <div class="help-success" id="lending-success" role="status" hidden></div>
        <div class="deposit-actions"><button class="btn" type="button" data-tool-action="submit-lending"${disabled}>Submit application</button></div>
      </div>

      <h2 class="sec">Your applications</h2>
      <div class="mp" id="lending-list">${lendingRowsMarkup()}</div>

      <h2 class="sec">How lending works</h2>
      <ol class="lending-steps">
        <li><b>Verify your identity</b><span>Lending is available to members with completed identity verification.</span></li>
        <li><b>Submit an application</b><span>Choose an amount, term and purpose. Our team reviews every application individually.</span></li>
        <li><b>Review your offer</b><span>If approved, you will see the rate, fees, repayment schedule and total repayable amount before you decide.</span></li>
        <li><b>Accept and manage repayments</b><span>Funds are released only after you accept. Repayments and balances are shown here once a facility is active.</span></li>
      </ol>

      <h2 class="sec">Important information</h2>
      <ul class="lending-notes">
        <li>Borrowing involves risk. You are responsible for repaying the full amount, including any interest and fees.</li>
        <li>Late or missed repayments can result in additional charges and may affect your account and future access to lending.</li>
        <li>Lending is subject to eligibility and approval, and may not be available in all regions.</li>
        <li>Do not borrow money you cannot afford to repay. Do not use borrowed funds for speculation you cannot afford to lose.</li>
      </ul>`;
  };

  const submitLendingRequest = async (button: HTMLElement) => {
    const field = (id: string) =>
      root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`);
    const errorBox = root.querySelector<HTMLElement>('#lending-error');
    const successBox = root.querySelector<HTMLElement>('#lending-success');
    const fail = (message: string) => {
      if (successBox) successBox.hidden = true;
      if (errorBox) errorBox.textContent = message;
    };
    if (errorBox) errorBox.textContent = '';
    if (successBox) successBox.hidden = true;

    if (!lendingEligibility().ok) {
      fail('Complete identity verification before you apply for lending.');
      return;
    }
    const amount = Number((field('lending-amount')?.value || '').trim());
    const termMonths = Number(field('lending-term')?.value);
    const purpose = (field('lending-purpose')?.value || '').trim();
    const notes = (field('lending-notes')?.value || '').trim();
    const acknowledged = (field('lending-ack') as HTMLInputElement | null)?.checked === true;

    if (!Number.isFinite(amount) || amount < LENDING_LIMITS.min || amount > LENDING_LIMITS.max) {
      fail(
        `Enter an amount between ${formatMoney(LENDING_LIMITS.min)} and ${formatMoney(LENDING_LIMITS.max)}.`,
      );
      return;
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      fail('Enter an amount with no more than two decimal places.');
      return;
    }
    if (!LENDING_TERMS.includes(termMonths)) {
      fail('Choose a term.');
      return;
    }
    if (!LENDING_PURPOSES.includes(purpose)) {
      fail('Choose a purpose.');
      return;
    }
    if (notes.length > 1000) {
      fail('Additional information must be 1,000 characters or fewer.');
      return;
    }
    if (!acknowledged) {
      fail('Please confirm that you understand the terms above before submitting.');
      return;
    }

    button.setAttribute('disabled', 'true');
    try {
      await sendLendingRequest({ amount, termMonths, purpose, notes });
      ['lending-amount', 'lending-notes'].forEach((id) => {
        const input = field(id);
        if (input) input.value = '';
      });
      const ack = field('lending-ack') as HTMLInputElement | null;
      if (ack) ack.checked = false;
      if (successBox) {
        successBox.textContent =
          'Your application was submitted. We will notify you when there is a decision.';
        successBox.hidden = false;
      }
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : 'We could not submit your application. Please try again.',
      );
    } finally {
      button.removeAttribute('disabled');
    }
  };

  // TODO(supabase): send the application to the parent page with postMessage
  // (same pattern as the deposit request), then insert it into a lending
  // applications table under the signed-in user's id with status 'submitted'.
  // Validate the limits again on the server. Resolve when saved, throw on error.
  const sendLendingRequest = async (_request: LendingRequestInput) => {
    if (!LENDING_CONNECTED) {
      throw new Error(
        'Lending applications are not open yet, so nothing was submitted. Please try again later.',
      );
    }
  };

  // ---- Crypto trading modes -------------------------------------------------
  // Adds a mode strip to the Crypto page: Spot (the existing chart and order
  // ticket), AI trading bot, Copy trading and Recurring buys. Frontend only
  // until TRADE_MODES_CONNECTED is true. To wire a mode, implement
  // sendTradeModeRequest (post to the parent page, save for the signed-in user,
  // resolve when saved, throw on error), then set the flag. Add or edit a mode
  // by changing TRADE_MODES only; the panel, form and validation are generated.
  // Never show results, rankings or returns here unless they come from the server.
  const TRADE_MODES_CONNECTED = false;

  type TradeModeId = 'bot' | 'copy' | 'recurring';
  type TradeField = {
    id: string;
    label: string;
    type: 'select' | 'number';
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    hint?: string;
  };
  type TradeMode = {
    id: TradeModeId;
    tab: string;
    eyebrow: string;
    title: string;
    blurb: string;
    fields: TradeField[];
    action: string;
    notes: string[];
    stats: string[];
  };

  // Set the limits to the ones your trading team has approved.
  const TRADE_MODES: TradeMode[] = [
    {
      id: 'bot',
      tab: 'AI trading bot',
      eyebrow: 'Automated trading',
      title: 'AI trading bot',
      blurb:
        'Choose a risk level, a budget and a loss limit. The bot only trades inside the limits you set.',
      fields: [
        { id: 'asset', label: 'Trading pair', type: 'select' },
        { id: 'risk', label: 'Risk level', type: 'select', options: ['Low', 'Medium', 'High'] },
        { id: 'amount', label: 'Amount to allocate (USD)', type: 'number', min: 50, max: 100000, step: 0.01, placeholder: '50' },
        { id: 'stop', label: 'Stop-loss (%)', type: 'number', min: 1, max: 50, step: 0.1, placeholder: '10', hint: 'The bot stops if losses reach this level.' },
        { id: 'target', label: 'Take-profit (%)', type: 'number', min: 1, max: 500, step: 0.1, placeholder: '20' },
      ],
      action: 'Start bot',
      notes: [
        'Automated trading carries risk. You can lose some or all of the funds you allocate.',
        'Results are not guaranteed, and past performance does not indicate future results.',
        'Only allocate funds you can afford to lose, and set a stop-loss you are comfortable with.',
      ],
      stats: ['Bot status', 'Allocated', 'Profit and loss'],
    },
    {
      id: 'copy',
      tab: 'Copy trading',
      eyebrow: 'Follow a trader',
      title: 'Copy trading',
      blurb: 'Follow an approved trader and mirror their trades with a budget and loss limit you control.',
      fields: [
        { id: 'trader', label: 'Trader', type: 'select', options: [] },
        { id: 'amount', label: 'Amount to allocate (USD)', type: 'number', min: 50, max: 100000, step: 0.01, placeholder: '50' },
        { id: 'stop', label: 'Stop-loss (%)', type: 'number', min: 1, max: 50, step: 0.1, placeholder: '10' },
      ],
      action: 'Start copying',
      notes: [
        'Copied trades can lose money. A trader\u2019s past results do not guarantee future results.',
        'Only allocate funds you can afford to lose.',
      ],
      stats: ['Copy status', 'Allocated', 'Profit and loss'],
    },
    {
      id: 'recurring',
      tab: 'Recurring buys',
      eyebrow: 'Scheduled purchases',
      title: 'Recurring buys',
      blurb: 'Buy a fixed amount of a crypto asset on a schedule, so you do not have to time the market.',
      fields: [
        { id: 'asset', label: 'Asset', type: 'select' },
        { id: 'amount', label: 'Amount per purchase (USD)', type: 'number', min: 10, max: 100000, step: 0.01, placeholder: '10' },
        { id: 'frequency', label: 'Frequency', type: 'select', options: ['Daily', 'Weekly', 'Monthly'] },
      ],
      action: 'Start schedule',
      notes: [
        'Prices change between purchases, and the value of your holdings can fall as well as rise.',
        'Each purchase uses your available balance.',
      ],
      stats: ['Schedule status', 'Total bought', 'Next purchase'],
    },
  ];

  // TODO: connect. Send the request to the parent page with postMessage (same
  // pattern as the deposit request), save it under the signed-in user's id,
  // validate again on the server, then resolve. Throw an Error on failure.
  const sendTradeModeRequest = async (
    _mode: TradeModeId,
    _values: Record<string, string | number>,
  ) => {
    if (!TRADE_MODES_CONNECTED) {
      throw new Error('This feature is not available yet, so nothing was started.');
    }
  };

  const installCryptoModes = () => {
    const win = window as unknown as {
      renderMkt?: (category: string) => void;
      __cryptoModesInstalled?: boolean;
    };
    const originalRenderMkt = win.renderMkt;
    if (typeof originalRenderMkt !== 'function' || win.__cryptoModesInstalled) return;
    win.__cryptoModesInstalled = true;

    let activeMode = 'spot';
    const panels: Record<string, HTMLElement> = {};

    const cryptoSymbols = () => {
      const rows = (D.Crypto || []) as unknown[][];
      const symbols = rows.map((row) => String(row[0])).filter(Boolean);
      return symbols.length ? symbols : ['BTC', 'ETH'];
    };

    const fieldMarkup = (mode: TradeMode, field: TradeField) => {
      const id = `tm-${mode.id}-${field.id}`;
      const hint = field.hint ? `<div class="hint">${escapeHtml(field.hint)}</div>` : '';
      if (field.type === 'select') {
        const options = field.options ?? cryptoSymbols();
        const markup = options.length
          ? options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')
          : '<option value="">None available yet</option>';
        return `<div><label class="fl" for="${id}">${escapeHtml(field.label)}</label><select class="sel" id="${id}" data-field="${field.id}">${markup}</select>${hint}</div>`;
      }
      return `<div><label class="fl" for="${id}">${escapeHtml(field.label)}</label><input class="help-input" id="${id}" data-field="${field.id}" type="number" inputmode="decimal" min="${field.min}" max="${field.max}" step="${field.step}" placeholder="${escapeHtml(field.placeholder ?? '')}">${hint}</div>`;
    };

    const buildPanel = (mode: TradeMode) => {
      const disabled = TRADE_MODES_CONNECTED ? '' : ' disabled aria-disabled="true"';
      const badge = TRADE_MODES_CONNECTED
        ? ''
        : '<span class="risk security-badge-muted">Not available yet</span>';
      const banner = TRADE_MODES_CONNECTED
        ? ''
        : `<div class="tm-banner" role="status"><b>${escapeHtml(mode.title)} is not open yet</b><p>You can review how it works below. Nothing can be started until it is enabled for your account.</p></div>`;
      const stats = mode.stats
        .map((label) => `<div class="tm-stat"><small>${escapeHtml(label)}</small><b>\u2014</b></div>`)
        .join('');
      const notes = mode.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('');
      const panel = document.createElement('div');
      panel.className = 'tm-panel';
      panel.dataset.mode = mode.id;
      panel.innerHTML = `<div class="head"><div><div class="lbl">${escapeHtml(mode.eyebrow)}</div><div class="bal tm-title">${escapeHtml(mode.title)}</div></div>${badge}</div>
        <p class="note">${escapeHtml(mode.blurb)}</p>
        ${banner}
        <div class="tm-stats">${stats}</div>
        <div class="mp">
          <div class="mph"><div><h3>Set up</h3><small>Review each setting before you start.</small></div></div>
          <fieldset class="tm-fieldset"${disabled}>
            <div class="help-grid">${mode.fields.map((field) => fieldMarkup(mode, field)).join('')}</div>
            <label class="tm-ack" for="tm-${mode.id}-ack"><input type="checkbox" id="tm-${mode.id}-ack"><span>I understand this involves risk and I may lose the funds I allocate.</span></label>
          </fieldset>
          <div class="err" data-role="error" role="alert"></div>
          <div class="help-success" data-role="success" role="status" hidden></div>
          <div class="deposit-actions"><button class="btn" type="button" data-trade-submit="${mode.id}"${disabled}>${escapeHtml(mode.action)}</button></div>
        </div>
        <h2 class="sec">Activity</h2>
        <div class="mp"><div class="help-empty"><b>No activity yet</b><p>Orders and results will appear here once you start.</p></div></div>
        <h2 class="sec">Important information</h2>
        <ul class="tm-notes">${notes}</ul>`;

      panel.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest<HTMLButtonElement>('[data-trade-submit]');
        if (!button) return;
        void submitMode(mode, panel, button);
      });
      return panel;
    };

    const submitMode = async (mode: TradeMode, panel: HTMLElement, button: HTMLButtonElement) => {
      const errorBox = panel.querySelector<HTMLElement>('[data-role="error"]');
      const successBox = panel.querySelector<HTMLElement>('[data-role="success"]');
      const fail = (message: string) => {
        if (successBox) successBox.hidden = true;
        if (errorBox) errorBox.textContent = message;
      };
      if (errorBox) errorBox.textContent = '';
      if (successBox) successBox.hidden = true;

      const values: Record<string, string | number> = {};
      for (const field of mode.fields) {
        const input = panel.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field.id}"]`);
        const raw = (input?.value || '').trim();
        if (field.type === 'select') {
          const allowed = field.options ?? cryptoSymbols();
          if (!allowed.includes(raw)) {
            fail(`Choose a value for \u201c${field.label}\u201d.`);
            return;
          }
          values[field.id] = raw;
        } else {
          const number = Number(raw);
          if (!raw || !Number.isFinite(number) || number < (field.min ?? 0) || number > (field.max ?? Infinity)) {
            fail(`Enter a value for \u201c${field.label}\u201d between ${field.min} and ${field.max}.`);
            return;
          }
          values[field.id] = number;
        }
      }
      if (!panel.querySelector<HTMLInputElement>(`#tm-${mode.id}-ack`)?.checked) {
        fail('Please confirm that you understand the risks before you start.');
        return;
      }

      button.setAttribute('disabled', 'true');
      try {
        await sendTradeModeRequest(mode.id, values);
        if (successBox) {
          successBox.textContent = 'Your request was submitted.';
          successBox.hidden = false;
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : 'We could not complete that request. Please try again.');
      } finally {
        button.removeAttribute('disabled');
      }
    };

    const showMode = (id: string, rebuild: boolean) => {
      activeMode = id;
      const mkt = document.getElementById('mkt');
      const spot = document.getElementById('crypto-spot');
      const host = document.getElementById('crypto-panel');
      if (!mkt || !spot || !host) return;
      mkt.querySelectorAll<HTMLElement>('#crypto-modes [data-mode]').forEach((tab) => {
        const on = tab.dataset.mode === id;
        tab.classList.toggle('on', on);
        tab.setAttribute('aria-selected', String(on));
      });
      spot.hidden = id !== 'spot';
      host.hidden = id === 'spot';
      host.replaceChildren();
      const mode = TRADE_MODES.find((candidate) => candidate.id === id);
      if (!mode) return;
      if (rebuild || !panels[id]) panels[id] = buildPanel(mode);
      host.append(panels[id]);
    };

    const decorate = () => {
      const mkt = document.getElementById('mkt');
      if (!mkt || mkt.querySelector('#crypto-modes')) return;
      const head = mkt.querySelector(':scope > .head');
      if (!head) return;
      const spot = document.createElement('div');
      spot.id = 'crypto-spot';
      while (head.nextSibling) spot.appendChild(head.nextSibling);
      const tabs = document.createElement('div');
      tabs.id = 'crypto-modes';
      tabs.className = 'tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Crypto trading modes');
      tabs.innerHTML = [{ id: 'spot', tab: 'Spot trading' }, ...TRADE_MODES]
        .map(
          (mode) =>
            `<button class="tab" type="button" role="tab" data-mode="${mode.id}">${escapeHtml(mode.tab)}</button>`,
        )
        .join('');
      tabs.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const tab = target.closest<HTMLElement>('[data-mode]');
        if (tab?.dataset.mode) showMode(tab.dataset.mode, true);
      });
      const host = document.createElement('div');
      host.id = 'crypto-panel';
      head.after(tabs);
      mkt.append(spot, host);
      showMode(activeMode, false);
    };

    win.renderMkt = function renderMktWithTradeModes(category: string) {
      originalRenderMkt(category);
      if (category === 'Crypto') decorate();
    };
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
    .lending-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}
    .lending-stat{padding:16px;border:1px solid var(--line);border-radius:14px;min-width:0}
    .lending-stat small{display:block;color:var(--mute);font-size:12px}
    .lending-stat b{display:block;margin-top:6px;font-size:20px;letter-spacing:-.02em;overflow-wrap:anywhere}
    .lending-banner{display:grid;gap:6px;justify-items:start;margin:0 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:12px}
    .lending-banner b{font-size:14px}
    .lending-banner p{margin:0;color:var(--mute);font-size:13px;line-height:1.5}
    .lending-fieldset{border:0;margin:0;padding:0;min-width:0}
    .lending-fieldset:disabled{opacity:.55}
    .lending-ack{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;color:var(--mute);font-size:13px;line-height:1.5;cursor:pointer}
    .lending-ack input{margin-top:3px;flex:none}
    .lending-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0;border-top:1px solid var(--line)}
    .lending-row:first-child{border-top:0;padding-top:0}
    .lending-row-main{display:grid;gap:3px;min-width:0}
    .lending-row-main small{color:var(--mute);font-size:12px}
    .lending-steps{list-style:none;counter-reset:lending;display:grid;gap:10px;margin:0;padding:0}
    .lending-steps li{counter-increment:lending;display:grid;grid-template-columns:28px minmax(0,1fr);column-gap:12px;row-gap:2px;padding:14px;border:1px solid var(--line);border-radius:12px}
    .lending-steps li::before{content:counter(lending);grid-row:span 2;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:var(--ink);color:var(--bg);font-size:13px;font-weight:700}
    .lending-steps span{color:var(--mute);font-size:13px;line-height:1.5}
    .lending-notes{margin:0;padding-left:20px;color:var(--mute);font-size:13px;line-height:1.7;max-width:70ch}
    @media(max-width:760px){.lending-stats{grid-template-columns:1fr}}
    #crypto-modes{margin:18px 0 6px;overflow-x:auto;flex-wrap:nowrap}
    #crypto-modes .tab{white-space:nowrap}
    .tm-title{font-size:clamp(28px,5vw,40px)}
    .tm-banner{display:grid;gap:6px;margin:0 0 18px;padding:14px 16px;border:1px solid var(--line);border-radius:12px}
    .tm-banner b{font-size:14px}
    .tm-banner p{margin:0;color:var(--mute);font-size:13px;line-height:1.5}
    .tm-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 6px}
    .tm-stat{min-width:0;padding:14px 16px;border:1px solid var(--line);border-radius:14px}
    .tm-stat small{display:block;color:var(--mute);font-size:12px}
    .tm-stat b{display:block;margin-top:6px;font-size:20px}
    .tm-fieldset{border:0;margin:0;padding:0;min-width:0}
    .tm-fieldset:disabled{opacity:.55}
    .tm-ack{display:flex;gap:10px;align-items:flex-start;margin:16px 0 4px;color:var(--mute);font-size:13px;line-height:1.5;cursor:pointer}
    .tm-ack input{margin-top:3px;flex:none}
    .tm-notes{margin:0;padding-left:20px;color:var(--mute);font-size:13px;line-height:1.7;max-width:70ch}
    @media(max-width:760px){.tm-stats{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);

  if (!root.dataset.memberToolsBound) {
    root.dataset.memberToolsBound = 'true';
    root.addEventListener('input', (event) => {
      if (page === 'Screener') drawScreenerRows();
      else if (page === 'Profile') handleProfileInput(event);
    });
    root.addEventListener('change', (event) => {
      if (page === 'Screener') drawScreenerRows();
      else if (page === 'Statements and tax') handleStatementsChange(event);
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
      } else if (action === 'submit-lending') {
        void submitLendingRequest(button);
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
  R.Lending = renderLending;
  installCryptoModes();
  R['Security and verification'] = () => {
    securityView = 'overview';
    renderSecurity();
  };

  if (!Array.isArray(ST.watchlist)) ST.watchlist = [];
  if (!Array.isArray(ST.priceAlerts)) ST.priceAlerts = [];
}
