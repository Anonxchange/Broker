import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Router as WouterRouter, useLocation } from 'wouter';
import type { AuthFormValues } from './pages/AuthPage';
import { SessionLoading } from './components/session-loading';
import { AuthProvider, useAuth } from './lib/auth-context';
import { isStaffRole } from './lib/supabase';

const AdminPage = lazy(() => import('./pages/AdminPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

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

  @keyframes investment-logo-marquee {
    from {
      transform: translate3d(0, 0, 0);
    }
    to {
      transform: translate3d(-33.333333%, 0, 0);
    }
  }

  .splide__list.is-logos {
    width: max-content !important;
    animation: investment-logo-marquee 40s linear infinite;
    will-change: transform;
  }

  .navbar-menu-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: 0.35rem;
  }

  .navbar-menu-action {
    box-sizing: border-box;
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border: 1px solid rgba(183, 208, 238, 0.32);
    border-radius: 999px;
    padding: 0.55rem 1rem;
    background: rgba(10, 28, 49, 0.16);
    color: #eaf3ff;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 550;
    text-decoration: none !important;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  }

  .navbar-menu-action:hover {
    transform: translateY(-1px);
    border-color: rgba(132, 192, 255, 0.75);
    background: rgba(32, 92, 242, 0.22);
  }

  .navbar-menu-action:focus-visible {
    outline: 2px solid #80c5ff;
    outline-offset: 3px;
  }

  .navbar-menu-action--signup {
    border-color: #205cf2;
    background: #205cf2;
    color: #fff;
  }

  .navbar-menu-action--signup:hover {
    border-color: #4e82ff;
    background: #174bd0;
  }

  .navbar-menu-action-icon {
    width: 1rem;
    height: 1rem;
    flex: none;
  }

  .navbar-link,
  .navbar-dropdown-link,
  .navbar-menu a {
    text-decoration: none !important;
  }

  .navbar-link:hover,
  .navbar-dropdown-link:hover,
  .navbar-menu a:hover {
    text-decoration: none !important;
  }

  .navbar-menu-action span {
    white-space: nowrap;
  }

  .navbar-menu-actions a {
    text-decoration: none !important;
  }

  .navbar-menu-action svg {
    display: block;
  }

  .navbar-menu-action:active {
    transform: translateY(0);
  }

  .navbar-menu-action--login {
    color: #eaf3ff;
  }

  .navbar-menu-action--login:hover {
    color: #ffffff;
  }

  .navbar-menu-action--signup {
    font-weight: 650;
  }

  .navbar-menu-action--signup .navbar-menu-action-icon {
    display: none;
  }

  .navbar-menu-action--login .navbar-menu-action-icon {
    display: none;
  }

  .navbar-menu-action:visited {
    color: inherit;
  }

  .navbar-menu-action--signup:visited {
    color: #fff;
  }

  .navbar-menu-action--login:visited {
    color: #eaf3ff;
  }

  .navbar-menu-action:focus-visible,
  .navbar-menu-action:focus {
    text-decoration: none !important;
  }

  .navbar-menu-actions {
    flex: none;
  }

  .navbar-menu-action {
    align-items: center;
  }

  #pricing .flex-2rem-wrap.investment-plan-grid {
    display: grid !important;
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: stretch;
    gap: 1.5rem !important;
    margin-top: 2rem;
  }

  #pricing .investment-plan-card {
    box-sizing: border-box;
    display: flex;
    min-width: 0;
    min-height: 27rem;
    flex-direction: column;
    align-items: center;
    padding: 2rem 1.5rem 1.75rem;
    border: 1px solid rgba(160, 182, 207, 0.16);
    border-radius: 1.25rem;
    background: linear-gradient(155deg, #0e1b2a 0%, #091421 100%);
    box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.14);
    color: #eef3fa;
    text-align: center;
  }

  #pricing .investment-plan-card__icon {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    color: #21a1ff;
    font-size: 1.75rem;
    line-height: 1;
  }

  #pricing .investment-plan-card__title {
    margin: 1.25rem 0 0;
    color: #f4f6fa;
    font-size: 1.375rem;
    font-weight: 650;
    line-height: 1.3;
  }

  #pricing .investment-plan-card__return {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0.65rem 0 0;
  }

  #pricing .investment-plan-card__rate {
    color: transparent;
    background-image: linear-gradient(90deg, #21a1ff, #4d35ff);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-size: 2.125rem;
    font-weight: 700;
    line-height: 1.1;
  }

  #pricing .investment-plan-card__return-label {
    color: #9aa8b9;
    font-size: 0.875rem;
  }

  #pricing .investment-plan-card__amounts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem 0.9rem;
    margin: 1rem 0 0;
    color: #aeb9c9;
    font-size: 0.875rem;
  }

  #pricing .investment-plan-card__amounts strong {
    color: #f1f4f8;
    font-weight: 600;
  }

  #pricing .investment-plan-card__duration {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.75rem 0 0;
    padding: 0.4rem 0.75rem;
    border: 1px solid rgba(33, 161, 255, 0.24);
    border-radius: 999px;
    background: rgba(33, 161, 255, 0.08);
    color: #8ccfff;
    font-size: 0.8rem;
  }

  #pricing .investment-plan-card__benefits {
    display: grid;
    gap: 0.45rem;
    margin: 1.1rem 0 1.5rem;
    padding: 0;
    width: max-content;
    max-width: 100%;
    color: #aeb9c9;
    font-size: 0.9rem;
    line-height: 1.4;
    list-style: none;
  }

  #pricing .investment-plan-card__benefit {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    text-align: left;
  }

  #pricing .investment-plan-card__check {
    flex: none;
    color: #22c55e;
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.2;
  }

  #pricing .investment-plan-card__action {
    display: inline-flex;
    min-height: 2.8rem;
    min-width: 10.75rem;
    align-items: center;
    justify-content: center;
    gap: 0.65rem;
    margin-top: auto;
    padding: 0.65rem 1.25rem;
    border: 0;
    border-radius: 999px;
    background-image: linear-gradient(90deg, #21a1ff, #4d35ff);
    color: #f4f7ff;
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    opacity: 1;
    cursor: default;
  }

  #pricing .investment-plan-card__action:disabled {
    opacity: 1;
  }

  #pricing .investment-plan-card__action-arrow {
    font-size: 1.1rem;
    line-height: 1;
  }

  #pricing .investment-plan-disclaimer {
    margin: 1rem 0 0;
    color: #95a2b3;
    font-size: 0.8rem;
    line-height: 1.5;
    text-align: center;
  }

  .investor-testimonials {
    width: 100%;
    min-width: 0;
    margin: 0;
  }

  .investor-testimonials__header {
    margin-bottom: 1.25rem;
  }

  .investor-testimonials__eyebrow {
    color: #21a1ff !important;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .investor-testimonials__title {
    margin-top: 0.65rem !important;
    color: #d6e8ff !important;
    font-size: 1.9rem !important;
    line-height: 1.1 !important;
  }

  .investor-testimonials__intro {
    margin-top: 0.75rem !important;
    color: rgba(214, 232, 255, 0.68) !important;
    font-size: 0.9rem;
    line-height: 1.65;
  }

  .section-strategies .investor-testimonial-product-row {
    display: grid !important;
    width: 100%;
    grid-template-columns: minmax(0, 1.8fr) minmax(15rem, 0.75fr);
    align-items: start;
    gap: 2rem !important;
  }

  .section-strategies .investor-testimonial-product-row > .price-box {
    justify-self: end;
  }

  .investor-testimonials__track {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: calc((100% - 1rem) / 2);
    align-items: stretch;
    gap: 1rem;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    padding-bottom: 0.35rem;
    scroll-behavior: smooth;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }

  .investor-testimonials__track::-webkit-scrollbar {
    display: none;
  }

  .investor-testimonial {
    box-sizing: border-box;
    min-width: 0;
    min-height: 17rem;
    padding: 1.35rem;
    border: 1px solid rgba(210, 213, 226, 0.16);
    border-radius: 1.25rem;
    background: linear-gradient(
      155deg,
      rgba(14, 41, 109, 0.3) 0%,
      rgba(12, 12, 12, 0.94) 100%
    );
    scroll-snap-align: start;
  }

  .investor-testimonial__author {
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .investor-testimonial__portrait {
    display: block;
    width: 3.5rem;
    height: 3.5rem;
    flex: none;
    border: 1px solid rgba(214, 232, 255, 0.22);
    border-radius: 50%;
    object-fit: cover;
    background: #0e296d;
  }

  .investor-testimonial__name {
    color: #d6e8ff !important;
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .investor-testimonial__country {
    display: block;
    margin-top: 0.2rem;
    color: rgba(214, 232, 255, 0.6) !important;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .investor-testimonial__quote {
    position: relative;
    margin: 1.2rem 0 0 !important;
    padding: 1rem 0 0 !important;
    border: 0 !important;
    color: rgba(214, 232, 255, 0.78) !important;
    font-size: 0.92rem !important;
    line-height: 1.7 !important;
  }

  .investor-testimonial__quote::before {
    position: absolute;
    top: -0.1rem;
    left: 0;
    color: #21a1ff;
    content: "“";
    font-size: 2rem;
    line-height: 1;
  }

  .investor-testimonials__controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-top: 0.85rem;
  }

  .investor-testimonials__count {
    color: rgba(214, 232, 255, 0.52) !important;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }

  .investor-testimonials__buttons {
    display: flex;
    gap: 0.55rem;
  }

  .investor-testimonials__button {
    display: inline-grid;
    width: 2.55rem;
    height: 2.55rem;
    place-items: center;
    border: 1px solid rgba(214, 232, 255, 0.2);
    border-radius: 50%;
    background: rgba(14, 41, 109, 0.42);
    color: #d6e8ff;
    font: inherit;
    font-size: 1.1rem;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease;
  }

  .investor-testimonials__button:hover {
    border-color: rgba(33, 161, 255, 0.72);
    background: #205cf2;
  }

  .investor-testimonials__button:focus-visible {
    outline: 2px solid #80c5ff;
    outline-offset: 3px;
  }

  .investor-testimonials__note {
    margin-top: 0.9rem !important;
    color: rgba(214, 232, 255, 0.52) !important;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  @media screen and (max-width: 991px) {
    .navbar-menu.is-page-height-tablet {
      flex-direction: column !important;
      align-items: stretch !important;
      justify-content: flex-start !important;
      gap: 0 !important;
    }

    .navbar-menu-actions {
      display: grid !important;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.625rem;
      width: 100%;
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid rgba(255, 255, 255, 0.16);
    }

    #pricing .flex-2rem-wrap.investment-plan-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .section-strategies .investor-testimonial-product-row {
      grid-template-columns: minmax(0, 1fr);
      gap: 2.5rem !important;
    }

    .section-strategies .investor-testimonial-product-row > .price-box {
      justify-self: center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .splide__list.is-logos {
      animation: none !important;
    }

    .investor-testimonials__track {
      scroll-behavior: auto;
    }
  }

  @media screen and (max-width: 767px) {
    .logo-link svg text {
      font-size: 20px !important;
    }

    .padding-hero-section {
      padding-top: 6.5rem !important;
    }

    #pricing .flex-2rem-wrap.investment-plan-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 1.1rem !important;
    }

    #pricing .investment-plan-card {
      width: 100%;
      max-width: 26rem;
      min-height: 26rem;
      margin: 0 auto;
      padding: 2rem 1.25rem 1.5rem;
    }

    .investor-testimonials__title {
      font-size: 1.7rem !important;
    }

    .investor-testimonials__track {
      grid-auto-columns: 88%;
      gap: 0.75rem;
    }

    .investor-testimonial {
      min-height: 16rem;
      padding: 1.15rem;
    }
  }
`;

const pageTitle = 'Auvrenthia Markets | Multi-Asset Investment Broker';
const pageDescription =
  'Explore investment opportunities across crypto, forex, agriculture, real estate, stocks, commodities, and more with Auvrenthia Markets.';

const contactEmailUser = 'support';
const contactEmailDomain = 'aurevathinmarket.com';
const contactEmail = `${contactEmailUser}@${contactEmailDomain}`;

type InvestmentPlan = {
  name: string;
  icon: string;
  rate: string;
  minimum: string;
  maximum: string;
  duration: string;
  benefits: string[];
};

const investmentPlans: InvestmentPlan[] = [
  {
    name: 'Stable Growth',
    icon: '◇',
    rate: '10%',
    minimum: '$150',
    maximum: '$6,500',
    duration: '24 Hours',
    benefits: ['Low risk profile', 'Fast returns', 'Perfect for beginners'],
  },
  {
    name: 'Balanced Plus',
    icon: '◈',
    rate: '15%',
    minimum: '$1,200',
    maximum: '$15,000',
    duration: '2 Days',
    benefits: ['Moderate risk', 'Balanced returns', 'Diversified assets'],
  },
  {
    name: 'Alpha Growth',
    icon: '▣',
    rate: '35%',
    minimum: '$2,500',
    maximum: '$30,000',
    duration: '3 Days',
    benefits: ['Higher returns', 'Premium support', 'Advanced strategies'],
  },
  {
    name: 'Income Shield',
    icon: '▥',
    rate: '50%',
    minimum: '$4,000',
    maximum: '$45,000',
    duration: '4 Days',
    benefits: ['Maximum returns', 'VIP support', 'Premium strategies'],
  },
  {
    name: 'Venture Catalyst',
    icon: '↗',
    rate: '20%',
    minimum: '$1,500',
    maximum: '$5,000',
    duration: '24 Hours',
    benefits: ['Holiday special', 'Quick returns', 'Limited time offer'],
  },
  {
    name: 'ESG Future',
    icon: '◉',
    rate: '40%',
    minimum: '$2,300',
    maximum: '$15,000',
    duration: '18 Hours',
    benefits: ['Holiday special', 'Fastest returns', 'Limited time offer'],
  },
];

type InvestorTestimonial = {
  author: string;
  country: string;
  quote: string;
  portrait: string;
};

const investorTestimonials: InvestorTestimonial[] = [
  {
    author: 'Alexander Whitmore',
    country: 'United Kingdom',
    quote:
      "I've been looking for a platform where everything is easy to follow without having to spend too much time figuring things out. The layout is straightforward, and I can find the information I need without much trouble.",
    portrait: 'assets/testimonials/testimonial-01.jpg',
  },
  {
    author: 'Priya Nair',
    country: 'India',
    quote:
      "What I like most is how simple the dashboard is. It doesn't feel unnecessarily complicated, and the information is arranged neatly.",
    portrait: 'assets/testimonials/testimonial-02.jpg',
  },
  {
    author: 'Matheus Oliveira da Costa',
    country: 'Brazil',
    quote:
      "I usually take my time before trying any financial platform. I'm still learning my way around Auvrenthia, but so far the interface has been easy enough to understand. I prefer to make decisions after reviewing the details carefully.",
    portrait: 'assets/testimonials/testimonial-03.jpg',
  },
  {
    author: 'Élodie Moreau',
    country: 'France',
    quote:
      "I appreciate when a website respects my time. I don't want to click through ten different pages just to understand my account. Auvrenthia's presentation is clear, which makes the experience less frustrating.",
    portrait: 'assets/testimonials/testimonial-04.jpg',
  },
  {
    author: 'Charlotte McKenzie',
    country: 'Canada',
    quote:
      "The first thing I noticed was the presentation. Everything feels organized, and I didn't have to guess where to look for the main account details. I'm interested in seeing how the platform develops over time.",
    portrait: 'assets/testimonials/testimonial-05.jpg',
  },
  {
    author: 'Kenji Nakamura',
    country: 'Japan',
    quote:
      "Clean design and easy navigation. That's a good start for me. I like platforms that keep things simple instead of making basic tasks unnecessarily complicated.",
    portrait: 'assets/testimonials/testimonial-06.jpg',
  },
  {
    author: 'Thandeka Mokoena',
    country: 'South Africa',
    quote:
      "I don't rush into investments, especially online. I prefer to understand the platform, check the terms and conditions, and know exactly what I'm dealing with. The website is easy to navigate, which is helpful when going through those details.",
    portrait: 'assets/testimonials/testimonial-07.jpg',
  },
  {
    author: "Lachlan James O'Connor",
    country: 'Australia',
    quote:
      "I tend to be cautious with anything involving money online. A clean website is a good first impression, but I still want to see clear documentation, realistic explanations of risk, and accessible support before deciding whether a platform is right for me.",
    portrait: 'assets/testimonials/testimonial-08.jpg',
  },
];

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

function renderInvestorTestimonials(pageDocument: Document) {
  const strategiesSection =
    pageDocument.querySelector<HTMLElement>('.section-strategies');
  const issue36CoverImage =
    strategiesSection?.querySelector<HTMLImageElement>(
      '.image-wrap.is-smaller img[src*="34_201.avif"]',
    );
  const issue36CoverWrapper =
    issue36CoverImage?.closest<HTMLElement>('.image-wrap.is-smaller');
  const productRow = issue36CoverWrapper?.parentElement;
  const productDetails = productRow?.querySelector('.price-box');

  if (
    !strategiesSection ||
    !issue36CoverWrapper ||
    !productRow ||
    !productDetails
  ) {
    throw new Error(
      'The Issue 36 cover or its product-details row was not found.',
    );
  }

  const section = pageDocument.createElement('section');
  section.id = 'investor-testimonials';
  section.className = 'investor-testimonials';
  section.setAttribute('aria-labelledby', 'investor-testimonials-title');
  section.setAttribute('data-testid', 'section-investor-testimonials');

  const heading = pageDocument.createElement('header');
  heading.className = 'investor-testimonials__header';

  const eyebrow = pageDocument.createElement('p');
  eyebrow.className = 'investor-testimonials__eyebrow';
  eyebrow.textContent = 'Investor voices';

  const title = pageDocument.createElement('h2');
  title.id = 'investor-testimonials-title';
  title.className = 'investor-testimonials__title';
  title.textContent = 'Testimonials';
  title.setAttribute('data-testid', 'text-investor-testimonials-title');

  const intro = pageDocument.createElement('p');
  intro.className = 'investor-testimonials__intro';
  intro.textContent = 'Swipe or use the arrows to browse investor experiences.';

  heading.append(eyebrow, title, intro);

  const track = pageDocument.createElement('div');
  track.id = 'investor-testimonials-track';
  track.className = 'investor-testimonials__track';
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', 'Investor testimonials carousel');
  track.setAttribute('data-testid', 'track-investor-testimonials');

  investorTestimonials.forEach((testimonial, index) => {
    const card = pageDocument.createElement('article');
    card.className = 'investor-testimonial';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-roledescription', 'slide');
    card.setAttribute(
      'aria-label',
      `Testimonial ${index + 1} of ${investorTestimonials.length}`,
    );
    card.setAttribute('data-testid', `card-investor-testimonial-${index + 1}`);

    const author = pageDocument.createElement('div');
    author.className = 'investor-testimonial__author';

    const portrait = pageDocument.createElement('img');
    portrait.className = 'investor-testimonial__portrait';
    portrait.src = `/site/${testimonial.portrait}`;
    portrait.alt = `Portrait of ${testimonial.author}`;
    portrait.loading = 'lazy';
    portrait.decoding = 'async';
    portrait.setAttribute(
      'data-testid',
      `img-investor-testimonial-${index + 1}`,
    );

    const identity = pageDocument.createElement('div');
    const name = pageDocument.createElement('p');
    name.className = 'investor-testimonial__name';
    name.textContent = testimonial.author;
    const country = pageDocument.createElement('span');
    country.className = 'investor-testimonial__country';
    country.textContent = testimonial.country;
    identity.append(name, country);
    author.append(portrait, identity);

    const quote = pageDocument.createElement('blockquote');
    quote.className = 'investor-testimonial__quote';
    quote.textContent = testimonial.quote;
    quote.setAttribute(
      'data-testid',
      `text-investor-testimonial-quote-${index + 1}`,
    );

    card.append(author, quote);
    track.appendChild(card);
  });

  const controls = pageDocument.createElement('div');
  controls.className = 'investor-testimonials__controls';

  const count = pageDocument.createElement('span');
  count.className = 'investor-testimonials__count';
  count.textContent = `01 / ${String(investorTestimonials.length).padStart(2, '0')}`;
  count.setAttribute('aria-live', 'off');
  count.setAttribute('data-testid', 'status-investor-testimonial-count');

  const buttons = pageDocument.createElement('div');
  buttons.className = 'investor-testimonials__buttons';

  const previousButton = pageDocument.createElement('button');
  previousButton.type = 'button';
  previousButton.className = 'investor-testimonials__button';
  previousButton.setAttribute('aria-label', 'Previous testimonial');
  previousButton.setAttribute('data-carousel-direction', 'previous');
  previousButton.setAttribute('data-testid', 'button-previous-testimonial');
  previousButton.textContent = '←';

  const nextButton = pageDocument.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'investor-testimonials__button';
  nextButton.setAttribute('aria-label', 'Next testimonial');
  nextButton.setAttribute('data-carousel-direction', 'next');
  nextButton.setAttribute('data-testid', 'button-next-testimonial');
  nextButton.textContent = '→';

  buttons.append(previousButton, nextButton);
  controls.append(count, buttons);

  const note = pageDocument.createElement('p');
  note.className = 'investor-testimonials__note';
  note.textContent =
    'Testimonials reflect individual platform experiences and are not investment advice or a guarantee of outcomes.';
  note.setAttribute('data-testid', 'text-investor-testimonials-disclaimer');

  section.append(heading, track, controls, note);

  const carouselScript = pageDocument.createElement('script');
  carouselScript.textContent = `(() => {
    const section = document.getElementById('investor-testimonials');
    const track = document.getElementById('investor-testimonials-track');
    if (!section || !track) return;

    const cards = Array.from(track.querySelectorAll('.investor-testimonial'));
    const count = section.querySelector('.investor-testimonials__count');
    const previousButton = section.querySelector('[data-carousel-direction="previous"]');
    const nextButton = section.querySelector('[data-carousel-direction="next"]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!cards.length || !count || !previousButton || !nextButton) return;

    let currentIndex = 0;
    let isVisible = false;
    let isHovered = false;
    let hasFocus = false;
    let isInteracting = false;
    let timer;
    let resumeTimer;
    let scrollFrame;

    const updateCount = () => {
      count.textContent =
        String(currentIndex + 1).padStart(2, '0') +
        ' / ' +
        String(cards.length).padStart(2, '0');
    };

    const stopAutoplay = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };

    const canAutoplay = () =>
      isVisible &&
      !isHovered &&
      !hasFocus &&
      !isInteracting &&
      !document.hidden &&
      !reducedMotion.matches;

    const goTo = (requestedIndex) => {
      currentIndex = (requestedIndex + cards.length) % cards.length;
      const trackLeft = track.getBoundingClientRect().left;
      const cardLeft = cards[currentIndex].getBoundingClientRect().left;
      track.scrollTo({
        left: track.scrollLeft + cardLeft - trackLeft,
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      });
      updateCount();
    };

    const scheduleAutoplay = () => {
      stopAutoplay();
      if (!canAutoplay()) return;
      timer = window.setTimeout(() => {
        goTo(currentIndex + 1);
        scheduleAutoplay();
      }, 6500);
    };

    const updateIndexFromScroll = () => {
      const trackLeft = track.getBoundingClientRect().left;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      cards.forEach((card, index) => {
        const distance = Math.abs(card.getBoundingClientRect().left - trackLeft);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      currentIndex = nearestIndex;
      updateCount();
    };

    previousButton.addEventListener('click', () => {
      goTo(currentIndex - 1);
      scheduleAutoplay();
    });
    nextButton.addEventListener('click', () => {
      goTo(currentIndex + 1);
      scheduleAutoplay();
    });

    track.addEventListener(
      'scroll',
      () => {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(updateIndexFromScroll);
      },
      { passive: true },
    );

    section.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') {
        isHovered = true;
        scheduleAutoplay();
      }
    });
    section.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') {
        isHovered = false;
        scheduleAutoplay();
      }
    });
    section.addEventListener('focusin', () => {
      hasFocus = true;
      scheduleAutoplay();
    });
    section.addEventListener('focusout', () => {
      window.setTimeout(() => {
        hasFocus = section.contains(document.activeElement);
        scheduleAutoplay();
      }, 0);
    });

    track.addEventListener(
      'pointerdown',
      () => {
        isInteracting = true;
        scheduleAutoplay();
        window.clearTimeout(resumeTimer);
      },
      { passive: true },
    );
    const resumeAfterInteraction = () => {
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => {
        isInteracting = false;
        scheduleAutoplay();
      }, 5000);
    };
    track.addEventListener('pointerup', resumeAfterInteraction, { passive: true });
    track.addEventListener('pointercancel', resumeAfterInteraction, {
      passive: true,
    });

    document.addEventListener('visibilitychange', scheduleAutoplay);
    reducedMotion.addEventListener?.('change', scheduleAutoplay);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        isVisible = entries.some((entry) => entry.isIntersecting);
        scheduleAutoplay();
      });
      observer.observe(section);
    } else {
      isVisible = true;
      scheduleAutoplay();
    }
  })();`;
  pageDocument.body.appendChild(carouselScript);

  productRow.classList.add('investor-testimonial-product-row');
  issue36CoverWrapper.replaceWith(section);
}

function renderInvestmentPlans(pageDocument: Document) {
  const pricingSection = pageDocument.querySelector('#pricing');
  const cardsContainer = pricingSection?.querySelector<HTMLElement>(
    '.central-flex-wrap > .flex-2rem-wrap',
  );
  const exploreMarketsButton = pricingSection?.querySelector(
    '.header-wrap .main-button',
  );

  if (
    !pricingSection ||
    !cardsContainer ||
    !exploreMarketsButton?.textContent?.includes('Explore Markets')
  ) {
    throw new Error(
      'The pricing section or its Explore Markets button was not found.',
    );
  }

  cardsContainer.classList.add('investment-plan-grid');
  cardsContainer.replaceChildren(
    ...investmentPlans.map((plan, index) => {
      const card = pageDocument.createElement('article');
      card.className = 'investment-plan-card';

      const heading = pageDocument.createElement('h3');
      heading.className = 'investment-plan-card__title';
      heading.id = `investment-plan-${index + 1}`;
      heading.textContent = plan.name;
      card.setAttribute('aria-labelledby', heading.id);

      const icon = pageDocument.createElement('span');
      icon.className = 'investment-plan-card__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = plan.icon;

      const returnDetails = pageDocument.createElement('p');
      returnDetails.className = 'investment-plan-card__return';
      const rate = pageDocument.createElement('span');
      rate.className = 'investment-plan-card__rate';
      rate.textContent = plan.rate;
      const returnLabel = pageDocument.createElement('span');
      returnLabel.className = 'investment-plan-card__return-label';
      returnLabel.textContent = 'Profit Return';
      returnDetails.append(rate, returnLabel);

      const amounts = pageDocument.createElement('p');
      amounts.className = 'investment-plan-card__amounts';
      const minimum = pageDocument.createElement('span');
      minimum.append('Min ');
      const minimumAmount = pageDocument.createElement('strong');
      minimumAmount.textContent = plan.minimum;
      minimum.appendChild(minimumAmount);
      const separator = pageDocument.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '|';
      const maximum = pageDocument.createElement('span');
      maximum.append('Max ');
      const maximumAmount = pageDocument.createElement('strong');
      maximumAmount.textContent = plan.maximum;
      maximum.appendChild(maximumAmount);
      amounts.append(minimum, separator, maximum);

      const duration = pageDocument.createElement('p');
      duration.className = 'investment-plan-card__duration';
      const timer = pageDocument.createElement('span');
      timer.setAttribute('aria-hidden', 'true');
      timer.textContent = 'Duration: ';
      duration.append(timer, pageDocument.createTextNode(plan.duration));

      const benefits = pageDocument.createElement('ul');
      benefits.className = 'investment-plan-card__benefits';
      plan.benefits.forEach((benefit) => {
        const item = pageDocument.createElement('li');
        item.className = 'investment-plan-card__benefit';
        const check = pageDocument.createElement('span');
        check.className = 'investment-plan-card__check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = '✓';
        const text = pageDocument.createElement('span');
        text.textContent = benefit;
        item.append(check, text);
        benefits.appendChild(item);
      });

      const action = pageDocument.createElement('button');
      action.type = 'button';
      action.className = 'investment-plan-card__action';
      action.disabled = true;
      action.title = 'Investment action is not available yet';
      action.setAttribute(
        'aria-label',
        `Invest Now in ${plan.name}; investment action is not available yet`,
      );
      const actionText = pageDocument.createElement('span');
      actionText.textContent = 'Invest Now';
      const actionArrow = pageDocument.createElement('span');
      actionArrow.className = 'investment-plan-card__action-arrow';
      actionArrow.setAttribute('aria-hidden', 'true');
      actionArrow.textContent = '→';
      action.append(actionText, actionArrow);

      card.append(
        icon,
        heading,
        returnDetails,
        amounts,
        duration,
        benefits,
        action,
      );
      return card;
    }),
  );

  const disclaimer = pageDocument.createElement('p');
  disclaimer.className = 'investment-plan-disclaimer';
  disclaimer.textContent =
    'Product availability and terms vary. Review product information before investing.';
  cardsContainer.after(disclaimer);

  if (!pricingSection.contains(exploreMarketsButton)) {
    throw new Error(
      'The Explore Markets button must remain in the pricing section.',
    );
  }
}

function preparePage(source: string) {
  const pageDocument = new DOMParser().parseFromString(source, 'text/html');
  pageDocument
    .querySelectorAll('link[rel~="preconnect"]')
    .forEach((link) => link.remove());
  pageDocument
    .querySelectorAll('link[rel~="canonical"], meta[property="og:url"]')
    .forEach((element) => element.remove());
  pageDocument.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    try {
      const destination = new URL(link.getAttribute('href') || '', pageDocument.baseURI);
      if (/wealth.?hub/i.test(`${destination.hostname}${destination.pathname}`)) {
        link.setAttribute('href', '#');
      }
    } catch {
      // Leave malformed or local destinations unchanged.
    }
  });
  pageDocument
    .querySelectorAll('script[src*="splide"], link[href*="splide"]')
    .forEach((asset) => asset.remove());
  const logoSliderScript = Array.from(pageDocument.scripts).find((script) =>
    /new\s+Splide\(\s*["']#logos["']/.test(script.textContent ?? ''),
  );
  logoSliderScript?.remove();
  pageDocument
    .querySelector<HTMLElement>('#logos-list')
    ?.style.removeProperty('transform');

  const base = pageDocument.createElement('base');
  base.href = '/site/';
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
  pageDocument.querySelector<HTMLAnchorElement>('.logo-link')?.setAttribute('href', '/');
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

    const menuActions = pageDocument.createElement('div');
    menuActions.className = 'navbar-menu-actions';
    const actionDefinitions = [
      {
        label: 'Login',
        variant: 'login',
        href: '/login',
        paths: [
          'M10 17l5-5-5-5',
          'M15 12H3',
          'M13 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6',
        ],
      },
      {
        label: 'Sign up',
        variant: 'signup',
        href: '/signup',
        paths: ['M12 5v14', 'M5 12h14'],
      },
    ];
    const svgNamespace = 'http://www.w3.org/2000/svg';
    actionDefinitions.forEach(({ label, variant, href, paths }) => {
      const link = pageDocument.createElement('a');
      link.href = href;
      link.target = '_top';
      link.setAttribute('data-testid', `link-${variant}`);
      link.className = `navbar-menu-action navbar-menu-action--${variant}`;

      const icon = pageDocument.createElementNS(svgNamespace, 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.8');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('class', 'navbar-menu-action-icon');
      icon.setAttribute('aria-hidden', 'true');
      paths.forEach((pathData) => {
        const path = pageDocument.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', pathData);
        icon.appendChild(path);
      });

      const text = pageDocument.createElement('span');
      text.textContent = label;
      link.append(icon, text);
      menuActions.appendChild(link);
    });
    navigation.appendChild(menuActions);
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
      delete schema.url;
      delete schema.sameAs;
      const organization = schema.about as Record<string, unknown> | undefined;
      if (organization) {
        organization.name = 'Auvrenthia Markets';
        organization.description =
          'A multi-asset investment platform covering crypto, forex, agriculture, real estate, stocks, commodities, and more.';
        delete organization.offers;
        delete organization.url;
        delete organization.sameAs;
      }
      structuredData.textContent = JSON.stringify(schema);
    } catch {
      // Keep the original structured data if the export is not valid JSON.
    }
  }

  renderInvestorTestimonials(pageDocument);
  renderInvestmentPlans(pageDocument);

  const backgroundStyle = pageDocument.createElement('style');
  backgroundStyle.textContent = heroBackgrounds;
  pageDocument.head.appendChild(backgroundStyle);

  return `<!doctype html>${pageDocument.documentElement.outerHTML}`;
}

function AppContent() {
  const [pageHtml, setPageHtml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [location, setLocation] = useLocation();
  const {
    configured,
    loading: authLoading,
    session,
    profile,
    profileError,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
  } = useAuth();

  const authMode = location === '/signup' ? 'signup' : 'login';
  const handleLogout = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Supabase sign out failed.', error);
    } finally {
      setLocation('/');
    }
  }, [setLocation, signOut]);

  const submitAuth = async (values: AuthFormValues) => {
    if (authMode === 'login') {
      await signIn(values.email, values.password);
      return;
    }
    const confirmationRequired = await signUp(values);
    if (confirmationRequired) {
      return 'Account created. Check your email to confirm, then sign in.';
    }
    return;
  };

  useEffect(() => {
    if (session && (location === '/login' || location === '/signup')) {
      setLocation('/dashboard');
    }
  }, [location, session, setLocation]);

  useEffect(() => {
    if (location !== '/') return;
    let mounted = true;

    void import('./assets/landing-page.html?raw')
      .then(({ default: source }) => {
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
  }, [location]);

  if (location === '/login' || location === '/signup') {
    return (
      <Suspense fallback={<SessionLoading />}>
        <AuthPage
          mode={authMode}
          configured={configured}
          onSubmit={submitAuth}
          onGoogleSignIn={signInWithGoogle}
        />
      </Suspense>
    );
  }
  if (
    location === '/admin' ||
    location === '/admin/deposit-settings' ||
    location === '/admin/account-settings'
  ) {
    if (authLoading) {
      return <SessionLoading />;
    }
    if (!session) {
      return (
        <Suspense fallback={<SessionLoading />}>
          <AuthPage
            mode="login"
            audience="admin"
            configured={configured}
            onSubmit={submitAuth}
            onGoogleSignIn={signInWithGoogle}
          />
        </Suspense>
      );
    }
    if (profileError || !profile) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Account information unavailable</h1>
            <p role="alert">We could not load your account information. Please try again or contact support.</p>
          </section>
        </main>
      );
    }
    if (profile.account_status !== 'active') {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Account unavailable</h1>
            <p>Contact support before using this account.</p>
          </section>
        </main>
      );
    }
    if (!isStaffRole(profile.role)) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Admin access required</h1>
            <p>Your account does not have an admin role.</p>
            <button className="auth-submit" onClick={() => setLocation('/dashboard')}>
              Go to dashboard
            </button>
          </section>
        </main>
      );
    }
    return (
      <Suspense fallback={<SessionLoading />}>
        <AdminPage onLogout={handleLogout} />
      </Suspense>
    );
  }
  if (location === '/dashboard' || location === '/dashboard/profile') {
    if (authLoading) {
      return <SessionLoading />;
    }
    if (!session) {
      return (
        <Suspense fallback={<SessionLoading />}>
          <AuthPage
            mode="login"
            configured={configured}
            onSubmit={submitAuth}
            onGoogleSignIn={signInWithGoogle}
          />
        </Suspense>
      );
    }
    if (profileError || !profile) {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Account information unavailable</h1>
            <p role="alert">We could not load your account information. Please try again or contact support.</p>
          </section>
        </main>
      );
    }
    if (profile.account_status !== 'active') {
      return (
        <main className="auth-shell">
          <section className="auth-card">
            <h1>Account unavailable</h1>
            <p>Contact support before using this account.</p>
            <button
              className="auth-submit"
              onClick={() => void handleLogout()}
            >
              Sign out
            </button>
          </section>
        </main>
      );
    }
    return (
      <Suspense fallback={<SessionLoading />}>
        <DashboardPage
          onLogout={handleLogout}
          profile={profile}
          userId={session.user.id}
        />
      </Suspense>
    );
  }

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

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </WouterRouter>
  );
}

export default App;
