import { useCallback, useRef } from 'react';

const heroBackgrounds = `
  .section-header {
    background-image: url('/assets/header-bg-3.avif'), url('/assets/header-bg-1.avif');
    background-repeat: no-repeat, no-repeat;
    background-position: right center, center center;
    background-size: min(40vw, 500px) auto, cover;
  }
`;

function App() {
  const pageFrame = useRef<HTMLIFrameElement>(null);

  const applyHeroBackgrounds = useCallback(() => {
    const pageDocument = pageFrame.current?.contentDocument;
    if (!pageDocument?.head) return;

    let style = pageDocument.getElementById(
      'wealthhub-hero-backgrounds',
    ) as HTMLStyleElement | null;

    if (!style) {
      style = pageDocument.createElement('style');
      style.id = 'wealthhub-hero-backgrounds';
      pageDocument.head.appendChild(style);
    }

    style.textContent = heroBackgrounds;
  }, []);

  return (
    <iframe
      ref={pageFrame}
      title="Wealth Hub homepage"
      src="/wealthhub/index.html"
      onLoad={applyHeroBackgrounds}
      style={{ display: 'block', width: '100%', height: '100vh', border: 0 }}
    />
  );
}

export default App;
