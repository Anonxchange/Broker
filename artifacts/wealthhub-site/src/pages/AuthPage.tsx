import { useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import './auth-page.theme.css';

type AuthPageProps = {
  mode: 'login' | 'signup';
};

function BrandMark() {
  return (
    <Link href="/" className="auth-brand" aria-label="Auvrenthia Markets home" data-testid="link-auth-home">
      <span className="auth-brand-plate">
        <img src="/wealthhub/auvrenthia-logo.svg" alt="Auvrenthia Markets" />
      </span>
    </Link>
  );
}

type FormFieldProps = {
  label: string;
  name: string;
  placeholder: string;
  autoComplete: string;
  type?: string;
  minLength?: number;
};

function FormField({
  label,
  name,
  placeholder,
  autoComplete,
  type = 'text',
  minLength,
}: FormFieldProps) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input
        type={type}
        name={name}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        minLength={minLength}
        data-testid={`input-${name}`}
      />
    </label>
  );
}

function GoogleMark() {
  return (
    <svg className="auth-google-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11.1c-.5 2.5-1.9 4.7-4 6.1v5h6.4c3.7-3.4 6.1-8.4 6.1-14.8Z" />
      <path fill="#34A853" d="M24 44c5.4 0 9.9-1.8 13.3-4.7l-6.4-5c-1.8 1.2-4.1 1.9-6.9 1.9-5.3 0-9.7-3.6-11.3-8.4H6.1v5.2C9.5 39.6 16.1 44 24 44Z" />
      <path fill="#FBBC05" d="M12.7 27.8c-.4-1.2-.7-2.5-.7-3.8s.2-2.6.7-3.8V15H6.1C4.7 17.9 4 20.9 4 24s.7 6.1 2.1 9l6.6-5.2Z" />
      <path fill="#EA4335" d="M24 9.6c3 0 5.7 1 7.8 3.1l5.8-5.8C34.9 3.7 29.4 1.5 24 1.5c-7.9 0-14.5 4.4-17.9 10.9l6.6 5.2c1.6-4.8 6-8 11.3-8Z" />
    </svg>
  );
}

export default function AuthPage({ mode }: AuthPageProps) {
  const [notice, setNotice] = useState('');
  const isSignup = mode === 'signup';

  function handleGoogleSignIn() {
    setNotice('Google sign-in will be available when Supabase is connected. No information was sent.');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    setNotice(
      'Account access is not active yet. Your details have not been saved or sent. Access will be enabled when Supabase is connected.',
    );
  }

  return (
    <main className="auth-shell">
      <section className={`auth-card${isSignup ? ' auth-card--signup' : ''}`} aria-labelledby="auth-heading">
        <BrandMark />
        <div className="auth-form-wrap">
          <div className="auth-form-heading">
            <span className="auth-form-kicker">{isSignup ? 'CREATE ACCOUNT' : 'WELCOME BACK'}</span>
            <h1 id="auth-heading">{isSignup ? 'Create your account' : 'Sign in'}</h1>
            <p>
              {isSignup
                ? 'Set up your Auvrenthia Markets access.'
                : 'Sign in to continue to Auvrenthia Markets.'}
            </p>
          </div>

          <button className="auth-google" type="button" onClick={handleGoogleSignIn} data-testid="button-google-auth">
            <GoogleMark />
            <span>Continue with Google</span>
          </button>

          <div className="auth-divider" aria-hidden="true">
            <span>or continue with email</span>
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {isSignup && (
              <>
                <div className="auth-field-grid">
                  <FormField label="First name" name="firstName" autoComplete="given-name" placeholder="First name" minLength={2} />
                  <FormField label="Last name" name="lastName" autoComplete="family-name" placeholder="Last name" minLength={2} />
                </div>
                <FormField label="Address" name="address" autoComplete="street-address" placeholder="Street address" />
                <div className="auth-field-grid">
                  <FormField label="Country" name="country" autoComplete="country-name" placeholder="Country" />
                  <FormField label="Phone number" name="phone" type="tel" autoComplete="tel" placeholder="Phone number" />
                </div>
              </>
            )}
            <FormField label="Email address" name="email" type="email" autoComplete="email" placeholder="name@example.com" />
            <FormField
              label="Password"
              name="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="Enter your password"
              minLength={8}
            />
            <p className="auth-privacy-note">No information is saved or sent until account access is connected.</p>
            <button className="auth-submit" type="submit" data-testid="button-auth-submit">
              {isSignup ? 'Create account' : 'Sign in'}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {notice && (
            <p className="auth-status" role="status" aria-live="polite" data-testid="status-auth-notice">
              <span className="auth-status-dot" aria-hidden="true" />
              {notice}
            </p>
          )}

          <p className="auth-switch">
            {isSignup ? 'Already have an account?' : 'New to Auvrenthia Markets?'}{' '}
            <Link href={isSignup ? '/login' : '/signup'} data-testid="link-auth-switch">
              {isSignup ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <Link href="/" className="auth-back-link" data-testid="link-back-home">Back to home</Link>
        </div>
      </section>
    </main>
  );
}
