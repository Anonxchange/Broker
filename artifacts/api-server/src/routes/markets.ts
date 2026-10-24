import { Router, type IRouter } from "express";
import {
  GetMarketFeedParams,
  GetMarketFeedResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type MarketCategory = "crypto" | "forex" | "commodities";
type MarketAsset = {
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
type CacheEntry = {
  feed: MarketFeed;
  freshUntil: number;
  staleUntil: number;
};

const cache = new Map<MarketCategory, CacheEntry>();
const inFlight = new Map<MarketCategory, Promise<MarketFeed>>();
const freshForMs: Record<MarketCategory, number> = {
  crypto: 60_000,
  forex: 30 * 60_000,
  commodities: 60_000,
};
const staleForMs: Record<MarketCategory, number> = {
  crypto: 6 * 60 * 60_000,
  forex: 48 * 60 * 60_000,
  commodities: 6 * 60 * 60_000,
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AuvrenthiaMarkets/1.0",
    },
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
