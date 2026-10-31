import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabaseImageBucket = 'Images';

export const supabaseConfigured = Boolean(
  supabaseUrl && supabasePublishableKey,
);

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null;

export type AppProfile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  address: string;
  country: string;
  phone: string;
  admin_note: string;
  role: 'member' | 'owner' | 'finance' | 'support';
  account_status: 'active' | 'hold' | 'suspended' | 'archived';
  kyc_status: 'none' | 'pending' | 'verified' | 'rejected';
  withdrawals_enabled: boolean;
  demo_balance: number | string;
  created_at: string;
  updated_at: string;
};

export function normalizeProfileRole(
  role: unknown,
): AppProfile['role'] | null {
  const normalized = String(role ?? '').trim().toLowerCase();
  if (normalized === 'admin') return 'owner';
  if (
    normalized === 'member' ||
    normalized === 'owner' ||
    normalized === 'finance' ||
    normalized === 'support'
  ) {
    return normalized;
  }
  return null;
}

export function isStaffRole(
  role: unknown,
): role is Exclude<AppProfile['role'], 'member'> {
  const normalized = normalizeProfileRole(role);
  return (
    normalized === 'owner' ||
    normalized === 'finance' ||
    normalized === 'support'
  );
}

export function serializeInlineScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function appRedirectUrl(path: string) {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const relativePath = path.replace(/^\/+/, '');
  return new URL(`${base}${relativePath}`, window.location.origin).toString();
}
