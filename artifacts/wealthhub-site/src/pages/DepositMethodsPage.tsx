import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import './deposit-pages.css';

type DepositMethod = {
  id: string;
  asset: string;
  network: string;
  address: string;
};

export default function DepositMethodsPage() {
  const [methods, setMethods] = useState<DepositMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyError, setCopyError] = useState('');
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/deposit-methods', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Deposit methods could not be loaded. Please try again.');
        }
        const result: unknown = await response.json();
        if (!Array.isArray(result)) {
          throw new Error('The deposit list returned an unexpected response.');
        }
        setMethods(result as DepositMethod[]);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Deposit methods could not be loaded. Please try again.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  async function copyAddress(method: DepositMethod) {
    try {
      await navigator.clipboard.writeText(method.address);
      setCopiedId(method.id);
      setCopyError('');
      window.setTimeout(() => setCopiedId(''), 1800);
    } catch {
      setCopyError('Your browser could not copy the address. Select and copy it instead.');
    }
  }

  return (
    <main className="deposit-page">
      <div className="deposit-page__wrap">
        <header className="deposit-page__top">
          <a className="deposit-page__brand" href="/" target="_top">
            <img src="/wealthhub/auvrenthia-logo.svg" alt="" />
            <span>Auvrenthia Markets</span>
          </a>
          <a className="deposit-page__back" href="/" target="_top">
            Back to home
          </a>
        </header>

        <section className="deposit-page__intro">
          <p className="deposit-page__eyebrow">CRYPTO DEPOSITS</p>
          <h1>Deposit methods</h1>
          <p>
            Choose the asset and network that match your transfer. Scan the QR
            code or copy the address before sending.
          </p>
        </section>

        <div className="deposit-page__notice" role="note">
          <strong>Check the network before sending.</strong>
          <span>
            Only send the listed asset on its matching network. A transfer sent
            to the wrong address or network may not be recoverable.
          </span>
        </div>

        {loading ? (
          <div className="deposit-page__state" role="status">
            Loading deposit methods…
          </div>
        ) : error ? (
          <div className="deposit-page__state deposit-page__state--error" role="alert">
            {error}
          </div>
        ) : methods.length === 0 ? (
          <div className="deposit-page__state">
            No crypto deposit methods are available right now.
          </div>
        ) : (
          <section className="deposit-method-grid" aria-label="Available deposit methods">
            {methods.map((method) => (
              <article className="deposit-method-card" key={method.id}>
                <div className="deposit-method-card__heading">
                  <div>
                    <p className="deposit-method-card__label">Asset</p>
                    <h2>{method.asset}</h2>
                  </div>
                  <span className="deposit-method-card__network">{method.network}</span>
                </div>
                <div
                  className="deposit-method-card__qr"
                  aria-label={`QR code for ${method.asset} on ${method.network}`}
                >
                  <QRCodeSVG
                    value={method.address}
                    size={184}
                    level="M"
                    includeMargin
                    title={`${method.asset} deposit address`}
                  />
                </div>
                <div className="deposit-method-card__address">
                  <span>Deposit address</span>
                  <code>{method.address}</code>
                </div>
                <button
                  className="deposit-page__copy"
                  type="button"
                  onClick={() => void copyAddress(method)}
                >
                  {copiedId === method.id ? 'Address copied' : 'Copy address'}
                </button>
                {copyError && (
                  <p className="deposit-method-card__copy-error" role="status">
                    {copyError}
                  </p>
                )}
              </article>
            ))}
          </section>
        )}

        <footer className="deposit-page__footer">
          Confirm the asset, address, and network in your wallet before sending.
        </footer>
      </div>
    </main>
  );
}
