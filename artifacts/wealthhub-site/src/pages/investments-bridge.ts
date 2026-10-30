import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminInvestments,
  getReceiptUrl,
  loadAdminInvestments,
  loadBalances,
  loadMemberInvestments,
  memberInvestments,
} from './investments-api';

/**
 * Lets the iframe pages (admin console, Harbor member dashboard) call the
 * Supabase functions through the React host, which owns the signed-in client.
 *
 * iframe -> host : { type: 'auvrenthia-inv-call', id, op, args }
 * host -> iframe : { type: 'auvrenthia-inv-result', id, ok, data?, error? }
 *
 * Only the ops listed below can be called. Security does not depend on this
 * list: every op ends in an RLS policy or a security-definer function that
 * checks the caller's role.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Op = (supabase: SupabaseClient, ...args: any[]) => Promise<unknown>;
export type InvestmentOps = Record<string, Op>;

export function buildAdminOps(adminId: string): InvestmentOps {
  return {
    load: async (s) => ({
      ...(await loadAdminInvestments(s)),
      balances: await loadBalances(s),
    }),
    balances: (s) => loadBalances(s),
    receiptUrl: (s, path: string) => getReceiptUrl(s, path),
    ...adminInvestments,
    postSignal: (s, signal) => adminInvestments.postSignal(s, signal, adminId),
  };
}

export function buildMemberOps(memberId: string): InvestmentOps {
  return {
    load: (s) => loadMemberInvestments(s, memberId),
    receiptUrl: (s, path: string) => getReceiptUrl(s, path),
    /** Upload a receipt image and return its storage path for request_deposit. */
    uploadReceipt: async (s, dataUrl: string) => {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl || '');
      if (!match) throw new Error('Upload a PNG, JPG or WebP image of your receipt.');
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      if (bytes.length > 5 * 1024 * 1024) throw new Error('The receipt image must be under 5 MB.');
      const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/webp' ? 'webp' : 'jpg';
      const path = `deposit-proofs/${memberId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error } = await s.storage.from('Images').upload(path, bytes, { contentType: match[1] });
      if (error) throw new Error(error.message);
      return path;
    },
    ...memberInvestments,
  };
}

/** Call from your window 'message' listener. Returns true when the message was ours. */
export function handleInvestmentsMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
  supabase: SupabaseClient | null,
  ops: InvestmentOps,
): boolean {
  const message = event.data as { type?: string; id?: string; op?: string; args?: unknown[] } | null;
  if (!message || message.type !== 'auvrenthia-inv-call') return false;
  if (event.source !== frame?.contentWindow || event.origin !== window.location.origin) return true;

  const reply = (payload: Record<string, unknown>) =>
    frame?.contentWindow?.postMessage(
      { type: 'auvrenthia-inv-result', id: message.id, ...payload },
      window.location.origin,
    );

  const op = typeof message.op === 'string' && Object.prototype.hasOwnProperty.call(ops, message.op)
    ? ops[message.op]
    : null;
  if (!supabase || !op) {
    reply({ ok: false, error: 'This action is not available.' });
    return true;
  }
  const args = Array.isArray(message.args) ? message.args : [];
  void Promise.resolve()
    .then(() => op(supabase, ...args))
    .then((data) => reply({ ok: true, data }))
    .catch((error: unknown) =>
      reply({ ok: false, error: error instanceof Error ? error.message : 'The request failed.' }),
    );
  return true;
}
