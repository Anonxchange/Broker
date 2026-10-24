import { Router, type IRouter } from "express";
import {
  GetMarketFeedParams,
  GetMarketFeedResponse,
  GetMarketHistoryParams,
  GetMarketHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type MarketCategory = "stocks" | "etfs" | "crypto" | "forex" | "commodities";
type MarketAsset = {
  id?: string | null;
  symbol: string;
  name: string;
  price: number;
  change24h: number | null;
  icon: string | null;
  sparkline: number[];
};
type MarketFeed = {
  category: MarketCategory;
  source: string;
  asOf: string | null;
  fetchedAt: string;
  assets: MarketAsset[];
};
type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number | null;
};
type CacheEntry = {
  feed: MarketFeed;
  freshUntil: number;
  staleUntil: number;
};

const cache = new Map<MarketCategory, CacheEntry>();
const inFlight = new Map<MarketCategory, Promise<MarketFeed>>();
const historyCache = new Map<
  string,
  {
    expiresAt: number;
    data: { source: string; asOf: string | null; candles: MarketCandle[] };
  }
>();
const freshForMs: Record<MarketCategory, number> = {
  stocks: 60_000,
  etfs: 60_000,
  crypto: 60_000,
  forex: 30 * 60_000,
  commodities: 60_000,
};
const staleForMs: Record<MarketCategory, number> = {
  stocks: 15 * 60_000,
  etfs: 15 * 60_000,
  crypto: 6 * 60 * 60_000,
  forex: 48 * 60 * 60_000,
  commodities: 6 * 60 * 60_000,
};

async function fetchJson<T>(
  url: string,
  options: { method?: "GET" | "POST"; body?: string } = {},
): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AuvrenthiaMarkets/1.0",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...options,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Market provider returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function safeCoinIcon(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const icon = new URL(value);
    if (
      icon.protocol === "https:" &&
      ["coin-images.coingecko.com", "assets.coingecko.com"].includes(
        icon.hostname,
      )
    ) {
      return icon.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function commodityIcon(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="23" fill="${color}"/><path d="m10 30 5-14h18l5 14-5 6H15z" fill="#fff" fill-opacity=".95"/><path d="M15 22h18M13 29h22" fill="none" stroke="${color}" stroke-linecap="round" stroke-width="2"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function loadEquities(
  category: "stocks" | "etfs",
): Promise<MarketFeed> {
  type TradingViewRow = {
    s?: string;
    d?: [string, number, number, number, string];
  };
  type TradingViewResponse = {
    data?: TradingViewRow[];
  };

  const symbols =
    category === "stocks"
      ? [
          "NASDAQ:AAPL",
          "NASDAQ:MSFT",
          "NASDAQ:NVDA",
          "NASDAQ:AMZN",
          "NASDAQ:TSLA",
        ]
      : ["AMEX:VOO", "NASDAQ:QQQ", "AMEX:VTI", "AMEX:SPY", "AMEX:IVV"];
  const response = await fetchJson<TradingViewResponse>(
    "https://scanner.tradingview.com/america/scan",
    {
      method: "POST",
      body: JSON.stringify({
        symbols: { tickers: symbols, query: { types: [] } },
        columns: ["name", "close", "change", "volume", "description"],
      }),
    },
  );

  const assets = (response.data ?? []).flatMap((row): MarketAsset[] => {
    const [symbol, price, change24h, , name] = row.d ?? [];
    if (
      !symbol ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      !name
    ) {
      return [];
    }
    return [
      {
        symbol,
        name,
        price,
        change24h:
          typeof change24h === "number" && Number.isFinite(change24h)
            ? change24h
            : null,
        icon: null,
        sparkline: [],
      },
    ];
  });

  if (assets.length === 0) {
    throw new Error(`TradingView returned no ${category} market data`);
  }

  const fetchedAt = new Date().toISOString();
  return {
    category,
    source: "TradingView",
    asOf: fetchedAt,
    fetchedAt,
    assets,
  };
}

async function loadCrypto(): Promise<MarketFeed> {
  type Coin = {
    id: string;
    symbol: string;
    name: string;
    image?: string;
    current_price: number;
    price_change_percentage_24h?: number | null;
    last_updated?: string;
    sparkline_in_7d?: { price?: number[] };
  };
  const coins = await fetchJson<Coin[]>(
    "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=25&page=1&sparkline=true&price_change_percentage=24h",
  );
  if (!Array.isArray(coins) || coins.length === 0) {
    throw new Error("CoinGecko returned no crypto markets");
  }
  const updated = coins
    .map((coin) => coin.last_updated)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);

  return {
    category: "crypto",
    source: "CoinGecko",
    asOf: updated ?? null,
    fetchedAt: new Date().toISOString(),
    assets: coins.map((coin) => ({
      id: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h ?? null,
      icon: safeCoinIcon(coin.image),
      sparkline: coin.sparkline_in_7d?.price ?? [],
    })),
  };
}

async function loadForex(): Promise<MarketFeed> {
  type ExchangeRates = {
    result?: string;
    time_last_update_utc?: string;
    rates?: Record<string, number>;
  };
  const response = await fetchJson<ExchangeRates>(
    "https://open.er-api.com/v6/latest/USD",
  );
  if (response.result !== "success" || !response.rates) {
    throw new Error("ExchangeRate-API returned no foreign-exchange rates");
  }

  const pairs = [
    { symbol: "EUR/USD", name: "Euro / US dollar", base: "EUR", quote: "USD", flag: "eu" },
    { symbol: "GBP/USD", name: "British pound / US dollar", base: "GBP", quote: "USD", flag: "gb" },
    { symbol: "USD/JPY", name: "US dollar / Japanese yen", base: "USD", quote: "JPY", flag: "us" },
    { symbol: "AUD/USD", name: "Australian dollar / US dollar", base: "AUD", quote: "USD", flag: "au" },
    { symbol: "USD/CAD", name: "US dollar / Canadian dollar", base: "USD", quote: "CAD", flag: "us" },
    { symbol: "USD/CHF", name: "US dollar / Swiss franc", base: "USD", quote: "CHF", flag: "us" },
    { symbol: "USD/CNY", name: "US dollar / Chinese yuan", base: "USD", quote: "CNY", flag: "us" },
    { symbol: "USD/NGN", name: "US dollar / Nigerian naira", base: "USD", quote: "NGN", flag: "ng" },
  ];
  const assets = pairs.flatMap((pair): MarketAsset[] => {
    const baseRate = response.rates?.[pair.base];
    const quoteRate = response.rates?.[pair.quote];
    if (!baseRate || !quoteRate) return [];
    const price = pair.quote === "USD" ? 1 / baseRate : quoteRate / baseRate;
    if (!Number.isFinite(price)) return [];
    return [
      {
        symbol: pair.symbol,
        name: pair.name,
        price,
        change24h: null,
        icon: `https://flagcdn.com/w80/${pair.flag}.png`,
        sparkline: [],
      },
    ];
  });
  if (assets.length === 0) {
    throw new Error("ExchangeRate-API returned no supported currency pairs");
  }

  return {
    category: "forex",
    source: "ExchangeRate-API Open Access (daily reference rates)",
    asOf: response.time_last_update_utc
      ? new Date(response.time_last_update_utc).toISOString()
      : null,
    fetchedAt: new Date().toISOString(),
    assets,
  };
}

async function loadCommodities(): Promise<MarketFeed> {
  const metals = [
    { symbol: "XAU", name: "Gold, per troy ounce", color: "#c89728" },
    { symbol: "XAG", name: "Silver, per troy ounce", color: "#8794a7" },
    { symbol: "XPT", name: "Platinum, per troy ounce", color: "#78899f" },
    { symbol: "XPD", name: "Palladium, per troy ounce", color: "#767b8b" },
  ];
  const quotes = await Promise.all(
    metals.map(async (metal) => {
      type MetalQuote = {
        symbol?: string;
        name?: string;
        price?: number;
        updatedAt?: string;
      };
      const quote = await fetchJson<MetalQuote>(
        `https://api.gold-api.com/price/${metal.symbol}`,
      );
      if (typeof quote.price !== "number" || !Number.isFinite(quote.price)) {
        throw new Error(`Gold-API returned no ${metal.symbol} spot price`);
      }
      return {
        quote,
        asset: {
          symbol: metal.symbol,
          name: metal.name,
          price: quote.price,
          change24h: null,
          icon: commodityIcon(metal.color),
          sparkline: [],
        } satisfies MarketAsset,
      };
    }),
  );
  const updated = quotes
    .map(({ quote }) => quote.updatedAt)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);

  return {
    category: "commodities",
    source: "Gold-API live spot metals",
    asOf: updated ?? null,
    fetchedAt: new Date().toISOString(),
    assets: quotes.map(({ asset }) => asset),
  };
}

async function fetchFeed(category: MarketCategory): Promise<MarketFeed> {
  switch (category) {
    case "stocks":
    case "etfs":
      return loadEquities(category);
    case "crypto":
      return loadCrypto();
    case "forex":
      return loadForex();
    case "commodities":
      return loadCommodities();
  }
}

async function getFeed(
  category: MarketCategory,
): Promise<{ feed: MarketFeed; cached: boolean; stale: boolean }> {
  const now = Date.now();
  const existing = cache.get(category);
  if (existing && existing.freshUntil > now) {
    return { feed: existing.feed, cached: true, stale: false };
  }

  const pending = inFlight.get(category);
  if (pending) {
    return { feed: await pending, cached: true, stale: false };
  }

  const refresh = fetchFeed(category);
  inFlight.set(category, refresh);
  try {
    const feed = await refresh;
    cache.set(category, {
      feed,
      freshUntil: Date.now() + freshForMs[category],
      staleUntil: Date.now() + staleForMs[category],
    });
    return { feed, cached: false, stale: false };
  } catch (error) {
    if (existing && existing.staleUntil > Date.now()) {
      return { feed: existing.feed, cached: true, stale: true };
    }
    throw error;
  } finally {
    inFlight.delete(category);
  }
}

const yahooSymbols: Partial<Record<MarketCategory, Record<string, string>>> = {
  stocks: {
    AAPL: "AAPL",
    MSFT: "MSFT",
    NVDA: "NVDA",
    AMZN: "AMZN",
    TSLA: "TSLA",
  },
  etfs: {
    VOO: "VOO",
    QQQ: "QQQ",
    VTI: "VTI",
    SPY: "SPY",
    IVV: "IVV",
  },
  forex: {
    "EUR-USD": "EURUSD=X",
    "GBP-USD": "GBPUSD=X",
    "USD-JPY": "JPY=X",
    "AUD-USD": "AUDUSD=X",
    "USD-CAD": "CAD=X",
    "USD-CHF": "CHF=X",
    "USD-CNY": "CNY=X",
    "USD-NGN": "NGN=X",
  },
  commodities: {
    XAU: "GC=F",
    XAG: "SI=F",
    XPT: "PL=F",
    XPD: "PA=F",
  },
};

async function loadHistory(
  category: MarketCategory,
  symbol: string,
  days: string,
): Promise<{ source: string; asOf: string | null; candles: MarketCandle[] }> {
  if (category === "crypto") {
    if (!/^[a-z0-9-]{1,80}$/.test(symbol)) {
      throw new Error("Invalid crypto asset identifier");
    }
    type CoinHistory = { prices?: [number, number][] };
    const history = await fetchJson<CoinHistory>(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}`,
    );
    const prices = history.prices ?? [];
    const candles: MarketCandle[] = [];
    for (let index = 0; index + 1 < prices.length; index += 2) {
      const group = prices.slice(index, index + 2);
      const values = group.map((point) => point[1]);
      const time = Math.floor(group[group.length - 1][0] / 1000);
      if (values.some((value) => !Number.isFinite(value))) continue;
      candles.push({
        time,
        open: values[0],
        high: Math.max(...values),
        low: Math.min(...values),
        close: values[values.length - 1],
        vol: null,
      });
    }
    if (candles.length === 0) {
      throw new Error("CoinGecko returned no historical crypto prices");
    }
    return {
      source: "CoinGecko",
      asOf: new Date(candles[candles.length - 1].time * 1000).toISOString(),
      candles,
    };
  }

  const yahooSymbol = yahooSymbols[category]?.[symbol];
  if (!yahooSymbol) {
    throw new Error(`Unsupported ${category} symbol`);
  }
  const chartPeriod: Record<string, { range: string; interval: string }> = {
    "1": { range: "1d", interval: "5m" },
    "7": { range: "5d", interval: "15m" },
    "30": { range: "1mo", interval: "1d" },
    "90": { range: "3mo", interval: "1d" },
    "365": { range: "1y", interval: "1wk" },
  };
  const { range, interval } = chartPeriod[days];
  type YahooChartResponse = {
    chart?: {
      result?: {
        meta?: { regularMarketTime?: number };
        timestamp?: number[];
        indicators?: {
          quote?: {
            open?: (number | null)[];
            high?: (number | null)[];
            low?: (number | null)[];
            close?: (number | null)[];
            volume?: (number | null)[];
          }[];
        };
      }[];
      error?: unknown;
    };
  };
  const data = await fetchJson<YahooChartResponse>(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`,
  );
  const result = data.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];
  const opens = quote?.open ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];
  const candles = timestamps.flatMap((time, index): MarketCandle[] => {
    const open = opens[index];
    const high = highs[index];
    const low = lows[index];
    const close = closes[index];
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      ![open, high, low, close].every(Number.isFinite)
    ) {
      return [];
    }
    return [
      {
        time,
        open,
        high,
        low,
        close,
        vol: volumes[index] ?? null,
      },
    ];
  });
  if (candles.length === 0) {
    throw new Error(`Yahoo Finance returned no ${category} history`);
  }
  const updatedAt = result?.meta?.regularMarketTime;
  return {
    source: "Yahoo Finance",
    asOf: updatedAt ? new Date(updatedAt * 1000).toISOString() : null,
    candles,
  };
}

router.get("/markets/:category/history/:symbol/:days", async (req, res): Promise<void> => {
  const parsedParams = GetMarketHistoryParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Unsupported market history request." });
    return;
  }

  const { category, symbol, days } = parsedParams.data;
  const cacheKey = `${category}:${symbol}:${days}`;
  const cached = historyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    res.json(cached.data);
    return;
  }

  try {
    const result = await loadHistory(category, symbol, days);
    const data = GetMarketHistoryResponse.parse(result);
    historyCache.set(cacheKey, {
      expiresAt: Date.now() + 30_000,
      data,
    });
    res.json(data);
  } catch (error) {
    req.log.warn(
      { category, symbol, days, error },
      "Market history provider request failed",
    );
    res.status(502).json({
      error: "Historical market data is temporarily unavailable.",
    });
  }
});

router.get("/markets/:category", async (req, res): Promise<void> => {
  const parsedParams = GetMarketFeedParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Unsupported market category." });
    return;
  }

  try {
    const result = await getFeed(parsedParams.data.category);
    res.json(
      GetMarketFeedResponse.parse({
        ...result.feed,
        cached: result.cached,
        stale: result.stale,
      }),
    );
  } catch (error) {
    req.log.warn(
      { category: parsedParams.data.category, error },
      "Market provider request failed",
    );
    res.status(502).json({
      error: "Market data is temporarily unavailable from the public provider.",
    });
  }
});

export default router;
