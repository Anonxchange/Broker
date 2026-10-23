import { useEffect, useState } from 'react';

const heroBackgrounds = `
  .section-header {
    background-image: url('/assets/header-bg-3.avif'), url('/assets/header-bg-1.avif');
    background-repeat: no-repeat, no-repeat;
    background-position: right center, center center;
    background-size: min(40vw, 500px) auto, cover;
  }

  .section-header .home-hero-wrap > .v-flex.is-2-5rem {
    align-items: flex-start;
    gap: 1rem !important;
  }

  .w-webflow-badge {
    display: none !important;
  }

  @media screen and (max-width: 767px) {
    .logo-link svg text {
      font-size: 20px !important;
    }

    .padding-hero-section {
      padding-top: 6.5rem !important;
    }
  }
`;

const pageTitle = 'Auvrenthia Markets | Multi-Asset Investment Broker';
const pageDescription =
  'Explore investment opportunities across crypto, forex, agriculture, real estate, stocks, commodities, and more with Auvrenthia Markets.';

const contactEmailUser = 'support';
const contactEmailDomain = 'aurevathinmarket.com';
const contactEmail = `${contactEmailUser}@${contactEmailDomain}`;

const textReplacements: Record<string, string> = {
  'Trading Community': 'Markets',
  'Strategy Vault': 'Investment Products',
  'Research Hub': 'Asset Classes',
  'Historical Data': 'Crypto',
  'Vendor list': 'Digital assets',
  'Hedge Fund Letters': 'Forex',
  'Curated archive': 'Currency markets',
  'Investment Mandates': 'Agriculture',
  'Tools for trading & backtesting': 'Agricultural markets',
  'Recommended Reading': 'Real Estate',
  'Books on trading & investing': 'Property markets',
  'Machine Learning': 'Stocks & ETFs',
  'Courses for traders': 'Public markets',
  'Research Papers': 'Commodities',
  'Insights on strategy': 'Energy, metals & resources',
  'Financial Glossary': 'Investment terms',
  'Key terms explained': 'Market terms',
  'Libraries for Quants': 'Portfolio tools',
  'Libraries, Packages and Resources': 'Multi-asset information',
  'About Us': 'About Auvrenthia',
  'Our Strategy Lab': 'Our Company',
  'Custom models for funds': 'Auvrenthia Markets',
  Contribute: 'Investment Access',
  'Submit your article': 'Learn about our markets',
  Career: 'Contact',
  'Join the team': 'Get in touch',
  Articles: 'Market Insights',
  '🚀 Thriving Trading Community': 'Multi-Asset Investment Platform',
  'Wealth Hub - Where Traders Unite for':
    'Auvrenthia, Building the Future of Digital Finance',
  'Join a vibrant community where traders collaborate and share insights. Together, we empower each other to achieve financial success.':
    'Explore opportunities across crypto, forex, agriculture, real estate, stocks, commodities, and more from one investment platform.',
  Confidence: 'Crypto',
  'Join Discord': 'Explore Markets',
  'powered by': 'Investment Markets',
  join: 'Discover',
  'Our Trading': 'One Platform,',
  Community: 'Multiple Markets',
  'What Awaits Inside the Wealth Hub':
    'Explore investment opportunities across global asset classes.',
  'Trade Ideas': 'Crypto & Digital Assets',
  'Join a network of active traders sharing high-conviction setups and live technical breakdowns.':
    'Explore cryptocurrency markets and digital assets through available investment products.',
  'Connect with serious traders and gain access to a supportive, resource-rich environment.':
    'Explore forex markets and currency pairs from around the world.',
  'Discover Educational Resources': 'Agriculture & Commodities',
  'Explore trading tools, podcasts, and tutorials built to sharpen your skills.':
    'Explore agricultural markets, energy, metals, and other commodities.',
  'Never Miss Market': 'Real Estate',
  Moves: 'and Stocks',
  'Instant notifications on time sensitive trading opportunities.':
    'Explore property-focused and stock-market investment opportunities.',
  Smarter: 'Investing',
  'Trading Starts Here': 'Across Markets',
  'Unlock the tools, insights, and community support you need to trade with confidence.':
    'Explore crypto, forex, agriculture, real estate, stocks, commodities, and other investment markets.',
  'Exclusive Trading Insights': 'Multi-Asset Access',
  'Join a community where cutting-edge data and real-time analysis drive smarter trading decisions.':
    'Explore a range of asset classes from one investment-focused platform.',
  'AI-Powered Market Tools': 'Global Market Coverage',
  'Use intelligent tools to track sentiment, flow, and price action without the noise.':
    'Explore digital and traditional investment markets across multiple asset classes.',
  'Instant Market Alerts': 'Product Information',
  'Stay one step ahead with real-time updates on key market shifts.':
    'Review market details and product information before making investment decisions.',
  'Strategy Ideas': 'Investment Choice',
  'Explore high-quality research and ongoing trade ideas shared inside the community.':
    'Explore available markets and compare asset classes that fit your interests.',
  benefits: 'Auvrenthia Markets',
  'Why Choose': 'Why Choose',
  'Wealth Hub': 'Auvrenthia Markets',
  'Experience unparalleled trading support and insights.':
    'Explore multiple investment categories through Auvrenthia Markets.',
  'Discover the Wealth Hub Advantage': 'Explore Multiple Markets',
  'Engage, learn, and succeed together.':
    'Discover investment options across a broader range of asset classes.',
  'Smart Research Automation': 'Crypto, Forex & Stocks',
  'Harness the power of our discord bots.':
    'Explore digital assets, currency pairs, and equity markets.',
  'Connect with Our Community': 'Agriculture & Commodities',
  'Collaborate and share insights with fellow traders.':
    'Review opportunities across agricultural products, energy, metals, and other commodities.',
  'Real Time Market Updates': 'Real Estate',
  'Dive into global market trends.':
    'Explore property-focused investment opportunities and market information.',
  welcome: 'Asset Classes',
  Collaborative: 'Investing',
  'Trading Excellence': 'Across Markets',
  'Explore our organized Discord knowledge categories.':
    'Explore a broad mix of investment markets through Auvrenthia Markets.',
  Channels: 'Digital Assets',
  'Content Library': 'Crypto',
  'Access curated videos, podcasts, and advanced tools covering trader education.':
    'Explore digital-asset markets, including cryptocurrency products.',
  'Trading Hub': 'Forex',
  'Research-bot and trading-ideas channels for collaboration.':
    'Explore currency pairs and global foreign-exchange markets.',
  'Market Updates': 'Agriculture & Commodities',
  'Automatic real-time trend alerts for informed decisions.':
    'Review agricultural, energy, metals, and other commodity markets.',
  'Member Benefits': 'Real Estate',
  'Unlock content and tools designed to sharpen your skills.':
    'Explore real-estate-related investment opportunities and product information.',
  'Pro Lounge': 'Stocks',
  'Exlusive channel for like minded professional traders.':
    'Explore companies and stock-market investment opportunities.',
  'Smart Signals': 'Portfolio Options',
  'AI Bot': 'More Asset Classes',
  'Charts, dark pool data, crypto tracking, and scanning tools.':
    'Explore more investment categories and compare market information in one place.',
  'service launching soon': 'Auvrenthia Markets',
  'Unlock 50% Off –': 'Explore',
  Exclusive: 'Global',
  'Early Access!': 'Investment Markets',
  'Be the first to join Wealth Hub and get 50% off! Offer available for a limited time only.':
    'Explore opportunities across crypto, forex, agriculture, real estate, stocks, commodities, and more.',
  'Claim Your Spot & Save 50%': 'Explore Markets',
  'Monthly Plan': 'Crypto & Forex',
  '$39': 'Contact',
  'per month': 'for details',
  'Paid monthly, cancel anytime': 'Product availability and terms vary.',
  'Coming soon': 'Explore Markets',
  'Real-time options flow, dark pool & short data alerts':
    'Crypto and foreign-exchange market information',
  'Crypto dashboard with instant price and flow updates':
    'Access to crypto, forex, agriculture, and commodities',
  'Interactive charts, screeners & heat maps for quick analysis':
    'Market information and product details',
  'Auto-updated economic calendar and macro indicators':
    'Explore stocks and other listed assets',
  'Discovery channel for new trade ideas & opportunities':
    'Explore property-focused opportunities',
  'Weekly research digest + educational videos/tools':
    'Review product information before investing',
  'Community chat with Q&A sessions with the Wealth Hub team':
    'Contact Auvrenthia Markets for product information',
  Annual: 'Multi-Asset Access',
  '$390': 'Contact',
  'per year': 'for details',
  'Save 2 months': 'Terms vary by product',
  'Everything in the Monthly plan': 'Explore multiple asset classes',
  'Quarterly deep-dive reports & asymmetric trade ideas':
    'Crypto, forex, and digital assets',
  'Access to Pro Lounge (pro-level market talk)':
    'Agriculture and commodities',
  'Unusual volume alerts (reports & unusual volume alerts)':
    'Real estate and property-focused products',
  'Government contracts & corporate lobbying updates':
    'Stocks and other listed investments',
  'Early access to new tools & feature betas':
    'Market availability varies by jurisdiction',
  'Founding member badge': 'Review product terms before investing',
  empower: 'Investment Approach',
  Real: 'Explore',
  Strategies: 'Global Markets',
  '. No Hype.': ' with clear product information.',
  "Discover a collection of trading strategies. Whether you're refining your edge or building your first system, the Archive gives you direct access to what actually works.":
    'Explore multiple asset classes and review product information before making investment decisions.',
  'Trading Strategies': 'Crypto & Forex',
  'Across markets and timeframes': 'Explore available asset classes',
  'Code You Can Use': 'Agriculture & Commodities',
  'EasyLanguage & Python': 'Explore market access',
  'No-Fluff Research': 'Real Estate & Stocks',
  'Only tested concepts': 'Review product information',
  'Learn What Works': 'Explore Opportunities',
  'Lessons from history': 'Across multiple markets',
  'A Trader’s Toolbox': 'Investor Resources',
  'Strategies and backtest results': 'Understand available products',
  'Wealth Hub Archive': 'Auvrenthia Markets',
  'Instant digital access. One time archive.':
    'Explore opportunities across investment markets.',
  '$490': 'Contact',
  'One-time payment': 'Product details vary',
  '36 full issues (PDF download)': 'Crypto, forex, agriculture, and commodities',
  '500+ pages of content': 'Real estate and stock-market opportunities',
  'Over 5,000 hours of research': 'Digital and traditional asset classes',
  'Backtested Trading Strategies': 'Market-specific product information',
  'Address:': 'Address:',
  '590 Madison Avenue New York, NY 10022':
    'Miami, Florida 33186, United States of America',
  '© Wealth Hub': '© Auvrenthia Markets',
  '© 2025 Wealth Hub Capital. All rights reserved.':
    '© Auvrenthia Markets. All rights reserved.',
  'Free Articles': 'Market Insights',
  'Machine Learning Course': 'Asset Classes',
  'Quant Libraries': 'Investment Resources',
  Careers: 'Contact',
  'Wealth Hub and its affiliated services provide educational content only. We do not offer investment advice, portfolio management, or any other service requiring registration or licensing under financial regulations. Nothing on this website, in our Discord community, or within the Wealth Hub Archive constitutes a recommendation, solicitation, or offer to buy or sell any financial instrument. All information is general in nature and for informational purposes only. Users are solely responsible for their own investment decisions and should consult a licensed financial advisor or registered investment professional before acting on any material provided. Use of this site implies acceptance of our full terms and conditions and legal disclaimers.':
    'Investing involves risk, including the possible loss of principal. Asset availability, eligibility, and risks vary by product and jurisdiction. Information on this site is general and is not a personal recommendation. Review relevant product disclosures and consider speaking with a licensed professional before investing.',
};

function preparePage(source: string) {
  const pageDocument = new DOMParser().parseFromString(source, 'text/html');
  const base = pageDocument.createElement('base');
  base.href = '/wealthhub/';
  pageDocument.head.prepend(base);

  const logo = pageDocument.querySelector('.logo-link svg');
  if (logo) {
    Array.from(logo.querySelectorAll('path'))
      .slice(4)
      .forEach((path) => path.remove());

    const wordmark = pageDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'text',
    );
    wordmark.setAttribute('x', '33.8');
    wordmark.setAttribute('y', '20.5');
    wordmark.setAttribute('font-family', 'Ppmori, sans-serif');
    wordmark.setAttribute('font-size', '16');
    wordmark.setAttribute('font-weight', '600');
    wordmark.setAttribute('textLength', '134');
    wordmark.setAttribute('lengthAdjust', 'spacingAndGlyphs');

    const firstWord = pageDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'tspan',
    );
    firstWord.setAttribute('fill', '#D6E8FF');
    firstWord.textContent = 'Auvrenthia ';

    const secondWord = pageDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'tspan',
    );
    secondWord.setAttribute('fill', '#205CF2');
    secondWord.textContent = 'Markets';

    wordmark.append(firstWord, secondWord);
    logo.appendChild(wordmark);
  }

  pageDocument.title = pageTitle;
  pageDocument
    .querySelectorAll(
      'meta[name="description"], meta[property="og:description"], meta[name="twitter:description"]',
    )
    .forEach((meta) => meta.setAttribute('content', pageDescription));
  pageDocument
    .querySelectorAll(
      'meta[property="og:title"], meta[name="twitter:title"]',
    )
    .forEach((meta) => meta.setAttribute('content', pageTitle));

  pageDocument.querySelector('.page-wrapper')?.setAttribute('id', 'home');
  const navigation = pageDocument.querySelector('.navbar-menu');
  if (navigation) {
    const navigationItems = [
      'Home',
      'About',
      'Services',
      'Investments',
      'Lending',
      'Market',
      'Resources',
      'Contact',
    ];
    navigation.replaceChildren(
      ...navigationItems.map((label) => {
        const link = pageDocument.createElement('a');
        link.className = 'navbar-link w-inline-block';
        link.href = label === 'Home' ? '#home' : '#';
        link.textContent = label;
        return link;
      }),
    );
  }
  pageDocument.querySelector('.navbar-button-wrapper')?.remove();

  const textWalker = pageDocument.createTreeWalker(
    pageDocument.body,
    NodeFilter.SHOW_TEXT,
  );
  let textNode = textWalker.nextNode();
  while (textNode) {
    const parent = textNode.parentElement;
    const isProtected = parent?.closest(
      'script, style, svg, .logo-link, .navbar-brand, .w-nav-brand, header .navbar-container > a:first-child',
    );
    const original = textNode.nodeValue ?? '';
    const normalized = original.trim().replace(/\s+/g, ' ');
    const isEmailAddress = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
    const rebrandedText = isEmailAddress
      ? undefined
      : normalized.replace(/\bwealth\s*hub\b/gi, 'Auvrenthia Markets');
    const replacement =
      textReplacements[normalized] ??
      (rebrandedText !== normalized ? rebrandedText : undefined);

    if (!isProtected && replacement !== undefined) {
      const leading = original.match(/^\s*/)?.[0] ?? '';
      const trailing = original.match(/\s*$/)?.[0] ?? '';
      textNode.nodeValue = `${leading}${replacement}${trailing}`;
    }
    textNode = textWalker.nextNode();
  }

  pageDocument
    .querySelectorAll('[alt], [title], [aria-label]')
    .forEach((element) => {
      ['alt', 'title', 'aria-label'].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (!value || /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) return;
        element.setAttribute(
          attribute,
          value.replace(/\bwealth\s*hub\b/gi, 'Auvrenthia Markets'),
        );
      });
    });

  const emailContainer = pageDocument.querySelector('#email-container');
  if (emailContainer) {
    emailContainer.setAttribute('aria-label', `Email address: ${contactEmail}`);
    const emailText = emailContainer.querySelector('svg text');
    if (emailText) emailText.textContent = contactEmail;
  }

  const emailBuilder = Array.from(pageDocument.scripts).find((script) =>
    /const\s+domain\s*=\s*["']wealthhubtrading\.com["']/.test(
      script.textContent ?? '',
    ),
  );
  if (emailBuilder?.textContent) {
    emailBuilder.textContent = emailBuilder.textContent
      .replace(
        /const\s+user\s*=\s*["'][^"']+["'];/,
        `const user = ${JSON.stringify(contactEmailUser)};`,
      )
      .replace(
        /const\s+domain\s*=\s*["'][^"']+["'];/,
        `const domain = ${JSON.stringify(contactEmailDomain)};`,
      );
  }

  const typedWordsScript = Array.from(pageDocument.scripts).find((script) =>
    script.textContent?.includes(
      'const el = document.querySelector(".typed-words")',
    ),
  );
  if (typedWordsScript?.textContent) {
    typedWordsScript.textContent = typedWordsScript.textContent.replace(
      /const strings = \[[\s\S]*?\];/,
      'const strings = ["Crypto", "Forex", "Agriculture", "Real Estate", "Stocks", "Commodities"];',
    );
  }

  const structuredData = pageDocument.querySelector(
    'script[type="application/ld+json"]',
  );
  if (structuredData?.textContent) {
    try {
      const schema = JSON.parse(structuredData.textContent) as Record<
        string,
        unknown
      >;
      schema.name = pageTitle;
      schema.description = pageDescription;
      const organization = schema.about as Record<string, unknown> | undefined;
      if (organization) {
        organization.name = 'Auvrenthia Markets';
        organization.description =
          'A multi-asset investment platform covering crypto, forex, agriculture, real estate, stocks, commodities, and more.';
        delete organization.offers;
      }
      structuredData.textContent = JSON.stringify(schema);
    } catch {
      // Keep the original structured data if the export is not valid JSON.
    }
  }

  const backgroundStyle = pageDocument.createElement('style');
  backgroundStyle.textContent = heroBackgrounds;
  pageDocument.head.appendChild(backgroundStyle);

  return `<!doctype html>${pageDocument.documentElement.outerHTML}`;
}

function App() {
  const [pageHtml, setPageHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let mounted = true;

    fetch('/wealthhub/index.html')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load the homepage (${response.status}).`);
        }
        return response.text();
      })
      .then((source) => {
        if (mounted) setPageHtml(preparePage(source));
      })
      .catch((error: unknown) => {
        console.error(
          'Failed to load the Auvrenthia Markets homepage source.',
          error,
        );
        if (mounted) setLoadError(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (loadError) {
    return <div role="alert">Unable to load the homepage content.</div>;
  }

  return (
    <iframe
      title="Auvrenthia Markets homepage"
      srcDoc={pageHtml ?? ''}
      style={{ display: 'block', width: '100%', height: '100vh', border: 0 }}
    />
  );
}

export default App;
