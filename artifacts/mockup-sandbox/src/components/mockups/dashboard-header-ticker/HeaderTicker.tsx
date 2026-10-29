import "./_group.css";

const quotes = [
  { symbol: "BTC", price: "$67,420", change: "+2.40%", positive: true },
  { symbol: "ETH", price: "$3,520", change: "+1.32%", positive: true },
  { symbol: "EUR/USD", price: "1.0842", change: "+0.20%", positive: true },
  { symbol: "USD/NGN", price: "1,488.00", change: "−0.45%", positive: false },
  { symbol: "Gold", price: "$2,741", change: "+0.80%", positive: true },
  { symbol: "Silver", price: "$33.30", change: "−0.12%", positive: false },
];

function QuoteGroup({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="ticker-group" aria-hidden={hidden}>
      {quotes.map((quote) => (
        <span className="ticker-item" key={quote.symbol}>
          {quote.symbol}
          <strong>{quote.price}</strong>
          <span className={quote.positive ? "positive" : "negative"}>
            {quote.change}
          </span>
        </span>
      ))}
    </div>
  );
}

export function HeaderTicker() {
  return (
    <main className="header-ticker-preview">
      <header className="dashboard-top">
        <button className="dashboard-menu" aria-label="Open menu" type="button">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M4 7h16M4 12h16M4 17h16"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </button>
        <h1
          className="dashboard-title"
          aria-label="Auvrenthia Markets dashboard"
        >
          <img
            src="/__mockup/images/auvrenthia-mark.svg"
            alt="Auvrenthia Markets"
          />
        </h1>
        <input
          className="dashboard-search"
          type="search"
          placeholder="Search assets"
          aria-label="Search assets"
        />
        <button
          className="dashboard-action"
          aria-label="Switch light or dark mode"
          type="button"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>
        <div className="dashboard-avatar" aria-label="Account menu">
          A
        </div>
      </header>
      <div
        className="price-ticker"
        role="region"
        aria-label="Live market prices"
        aria-live="off"
        tabIndex={0}
      >
        <div className="ticker-track">
          <QuoteGroup />
          <QuoteGroup hidden />
        </div>
      </div>
    </main>
  );
}
