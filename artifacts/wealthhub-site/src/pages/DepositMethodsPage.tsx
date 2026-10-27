import { useEffect, useRef, useState } from 'react';
import './deposit-pages.css';

type DepositMethod = {
  id: string;
  asset: string;
  network: string;
  address: string;
};

// Edit this list with your real assets, networks and addresses.
const DEPOSIT_METHODS: DepositMethod[] = [
  { id: 'btc', asset: 'Bitcoin (BTC)', network: 'Bitcoin', address: 'YOUR_BTC_ADDRESS' },
  { id: 'eth', asset: 'Ethereum (ETH)', network: 'ERC20', address: 'YOUR_ETH_ADDRESS' },
  { id: 'usdt', asset: 'Tether (USDT)', network: 'TRC20', address: 'YOUR_USDT_ADDRESS' },
];

const MAX_QR_SIZE = 5 * 1024 * 1024; // 5 MB

export default function DepositMethodsPage() {
  const [copyError, setCopyError] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const qrImagesRef = useRef(qrImages);
  qrImagesRef.current = qrImages;

  // Release object URLs when the page unmounts
  useEffect(() => {
    return () => {
      Object.values(qrImagesRef.current).forEach((url) => URL.revokeObjectURL(url));
    };
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

  function setUploadError(id: string, message: string) {
    setUploadErrors((prev) => ({ ...prev, [id]: message }));
  }

  function handleQrUpload(id: string, file: File | undefined) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError(id, 'Please choose an image file.');
      return;
    }
    if (file.size > MAX_QR_SIZE) {
      setUploadError(id, 'Image is too large. Maximum size is 5 MB.');
      return;
    }

    const url = URL.createObjectURL(file);
    setQrImages((prev) => {
      if (prev[id]) URL.revokeObjectURL(prev[id]);
      return { ...prev, [id]: url };
    });
    setUploadError(id, '');
  }

  function removeQr(id: string) {
    setQrImages((prev) => {
      if (prev[id]) URL.revokeObjectURL(prev[id]);
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setUploadError(id, '');
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

        {DEPOSIT_METHODS.length === 0 ? (
          <div className="deposit-page__state">
            No crypto deposit methods are available right now.
          </div>
        ) : (
          <section className="deposit-method-grid" aria-label="Available deposit methods">
            {DEPOSIT_METHODS.map((method) => {
              const qrUrl = qrImages[method.id];
              const inputId = `qr-upload-${method.id}`;

              return (
                <article className="deposit-method-card" key={method.id}>
                  <div className="deposit-method-card__heading">
                    <div>
                      <p className="deposit-method-card__label">Asset</p>
                      <h2>{method.asset}</h2>
                    </div>
                    <span className="deposit-method-card__network">{method.network}</span>
                  </div>

                  <div className="deposit-method-card__qr">
                    <input
                      id={inputId}
                      className="deposit-method-card__file"
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        handleQrUpload(method.id, e.target.files?.[0]);
                        e.target.value = ''; // allow re-selecting the same file
                      }}
                    />

                    {qrUrl ? (
                      <>
                        <img
                          className="deposit-method-card__qr-image"
                          src={qrUrl}
                          alt={`QR code for ${method.asset} on ${method.network}`}
                        />
                        <div className="deposit-method-card__qr-actions">
                          <label htmlFor={inputId} className="deposit-method-card__qr-btn">
                            Replace
                          </label>
                          <button
                            type="button"
                            className="deposit-method-card__qr-btn"
                            onClick={() => removeQr(method.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <label htmlFor={inputId} className="deposit-method-card__upload">
                        <span className="deposit-method-card__upload-icon" aria-hidden="true">
                          +
                        </span>
                        <span>Click to upload QR code</span>
                        <small>PNG, JPG or SVG, up to 5 MB</small>
                      </label>
                    )}

                    {uploadErrors[method.id] && (
                      <p className="deposit-method-card__copy-error" role="alert">
                        {uploadErrors[method.id]}
                      </p>
                    )}
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
              );
            })}
          </section>
        )}

        <footer className="deposit-page__footer">
          Confirm the asset, address, and network in your wallet before sending.
        </footer>
      </div>
    </main>
  );
}
