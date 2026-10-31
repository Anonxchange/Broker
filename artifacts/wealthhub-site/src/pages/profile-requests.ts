import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Member profile saves and profile picture, run in the React host with the
 * signed-in Supabase client. The dashboard iframe sends
 * { type: 'auvrenthia-profile-request', requestId, action, ... } and gets back
 * { type: 'auvrenthia-profile-response', requestId, ok, message, profile, avatarUrl }.
 */

const COLS = 'first_name,last_name,phone,country,state,postal,address,avatar_path,email,kyc_status,account_status';
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const ID_MAX_BYTES = 5 * 1024 * 1024;
const ID_TYPES = ['passport', 'national_id', 'drivers_license'];
const LIMITS: Record<string, number> = {
  first_name: 60, last_name: 60, phone: 30, country: 60, state: 60, postal: 20, address: 300,
};
// Locked once identity is verified (the database enforces this too).
const LOCKED_WHEN_VERIFIED = ['first_name', 'last_name', 'country', 'address'];

type Row = Record<string, unknown>;
export type ProfileReply = {
  message: string; profile?: Row; avatarUrl?: string; kyc?: Row; tickets?: Row[]; announcements?: Row[];
};

async function readProfile(s: SupabaseClient, userId: string): Promise<Row> {
  const { data, error } = await s.from('profiles').select(COLS).eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Profile not found.');
  return data as Row;
}

async function signedAvatar(s: SupabaseClient, bucket: string, path: unknown): Promise<string> {
  if (typeof path !== 'string' || !path) return '';
  const { data, error } = await s.storage.from(bucket).createSignedUrl(path, 3600);
  return error ? '' : data.signedUrl;
}

function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

export async function runProfileRequest(
  s: SupabaseClient, userId: string, bucket: string, data: Row,
): Promise<ProfileReply> {
  const action = String(data.action || '');

  if (action === 'load') {
    const profile = await readProfile(s, userId);
    return { message: '', profile, avatarUrl: await signedAvatar(s, bucket, profile.avatar_path) };
  }

  if (action === 'save-profile') {
    const input = (data.fields && typeof data.fields === 'object' ? data.fields : {}) as Row;
    const current = await readProfile(s, userId);
    const patch: Row = {};
    for (const key of Object.keys(LIMITS)) {
      if (typeof input[key] !== 'string') continue;
      if (current.kyc_status === 'verified' && LOCKED_WHEN_VERIFIED.includes(key)) continue;
      const value = (input[key] as string).trim();
      if (value.length > LIMITS[key]) throw new Error('One of the fields is too long.');
      patch[key] = value;
    }
    if (patch.first_name === '' || patch.last_name === '') throw new Error('Enter your first and last name.');
    if (typeof patch.phone === 'string' && patch.phone && !/^[+\d][\d\s().-]{5,}$/.test(patch.phone)) {
      throw new Error('Enter a valid phone number.');
    }
    if (!Object.keys(patch).length) return { message: 'Nothing to save.', profile: current };
    // RLS filters rows silently, so confirm a row really changed.
    const { data: rows, error } = await s.from('profiles').update(patch).eq('id', userId).select(COLS);
    if (error) throw new Error(error.message);
    if (!rows || !rows.length) throw new Error('Your profile could not be updated.');
    return { message: 'Profile saved.', profile: rows[0] as Row };
  }

  if (action === 'save-avatar') {
    const raw = data.bytes;
    if (!(raw instanceof ArrayBuffer)) throw new Error('Choose an image to upload.');
    if (raw.byteLength === 0 || raw.byteLength > AVATAR_MAX_BYTES) throw new Error('Choose an image under 2 MB.');
    const kind = sniffImage(new Uint8Array(raw));
    if (!kind) throw new Error('Choose a PNG, JPG or WebP image.');
    const before = await readProfile(s, userId);
    const path = `avatars/${userId}/avatar-${Date.now()}.${kind.ext}`;
    const up = await s.storage.from(bucket).upload(path, raw, { contentType: kind.type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data: rows, error } = await s.from('profiles').update({ avatar_path: path }).eq('id', userId).select(COLS);
    if (error || !rows || !rows.length) {
      await s.storage.from(bucket).remove([path]);
      throw new Error(error?.message || 'Your profile picture could not be saved.');
    }
    if (typeof before.avatar_path === 'string' && before.avatar_path) {
      await s.storage.from(bucket).remove([before.avatar_path]); // best effort
    }
    return { message: 'Profile picture updated.', profile: rows[0] as Row, avatarUrl: await signedAvatar(s, bucket, path) };
  }

  if (action === 'remove-avatar') {
    const before = await readProfile(s, userId);
    const { data: rows, error } = await s.from('profiles').update({ avatar_path: '' }).eq('id', userId).select(COLS);
    if (error) throw new Error(error.message);
    if (!rows || !rows.length) throw new Error('Your profile picture could not be removed.');
    if (typeof before.avatar_path === 'string' && before.avatar_path) {
      await s.storage.from(bucket).remove([before.avatar_path]); // best effort
    }
    return { message: 'Profile picture removed.', profile: rows[0] as Row, avatarUrl: '' };
  }

  if (action === 'create-ticket') {
    const { data: ref, error } = await s.rpc('create_support_ticket', {
      p_email: String(data.email || ''), p_category: String(data.category || ''),
      p_priority: String(data.priority || ''), p_subject: String(data.subject || ''),
      p_reference: String(data.reference || ''), p_message: String(data.message || ''),
    });
    if (error) throw new Error(error.message);
    return { message: `Your ticket ${String(ref)} was submitted. We will reply by email.` };
  }

  if (action === 'list-tickets') {
    const { data: tickets, error } = await s
      .from('support_tickets').select('id,ticket_no,subject,category,status,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    const ids = (tickets ?? []).map((t) => t.id as string);
    const replies: Record<string, Row[]> = {};
    if (ids.length) {
      const { data: msgs, error: msgError } = await s
        .from('support_messages').select('ticket_id,body,created_at')
        .in('ticket_id', ids).eq('sender', 'staff').order('created_at', { ascending: true });
      if (msgError) throw new Error(msgError.message);
      (msgs ?? []).forEach((m) => { (replies[m.ticket_id as string] = replies[m.ticket_id as string] || []).push(m as Row); });
    }
    return {
      message: '',
      tickets: (tickets ?? []).map((t) => ({ ...t, replies: replies[t.id as string] || [] })) as Row[],
    };
  }

  if (action === 'list-announcements') {
    const { data: rows, error } = await s
      .from('announcements').select('id,title,body,created_at')
      .eq('is_live', true).order('created_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return { message: '', announcements: (rows ?? []) as Row[] };
  }

  if (action === 'kyc-status') {
    const { data: auth } = await s.auth.getUser();
    const { data: subs, error } = await s
      .from('kyc_submissions').select('status,rejection_reason,created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return {
      message: '',
      profile: await readProfile(s, userId),
      kyc: { emailVerified: Boolean(auth.user?.email_confirmed_at), submission: subs && subs[0] ? subs[0] : null },
    };
  }

  if (action === 'resend-confirmation') {
    const { data: auth } = await s.auth.getUser();
    const user = auth.user;
    if (!user?.email) throw new Error('There is no email address on this account.');
    if (user.email_confirmed_at) return { message: 'Your email is already verified.' };
    const { error } = await s.auth.resend({ type: 'signup', email: user.email });
    if (error) throw new Error(error.message);
    return { message: 'Confirmation email sent. Check your inbox and spam folder.' };
  }

  if (action === 'submit-kyc') {
    const docType = String(data.documentType || '');
    if (!ID_TYPES.includes(docType)) throw new Error('Choose a document type.');
    const number = String(data.documentNumber || '').trim();
    if (number.length < 4 || number.length > 40) throw new Error('Enter the document number.');
    const country = String(data.country || '').trim();
    if (country.length < 2 || country.length > 60) throw new Error('Enter the issuing country.');
    const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    const dob = String(data.dob || '');
    const expiry = String(data.expiry || '');
    if (!isDate(dob) || !isDate(expiry)) throw new Error('Enter the date of birth and expiry date.');
    const eighteen = new Date();
    eighteen.setFullYear(eighteen.getFullYear() - 18);
    if (new Date(dob) > eighteen) throw new Error('You must be at least 18 years old.');
    if (new Date(expiry) <= new Date()) throw new Error('This document has expired.');

    const front = data.front;
    const back = data.back;
    if (!(front instanceof ArrayBuffer)) throw new Error('Upload the front of your document.');
    if (docType !== 'passport' && !(back instanceof ArrayBuffer)) throw new Error('Upload the back of your document.');
    const checks: Array<[ArrayBuffer, string]> = [[front, 'front']];
    if (back instanceof ArrayBuffer) checks.push([back, 'back']);
    const kinds: Record<string, { type: string; ext: string }> = {};
    for (const [buffer, side] of checks) {
      if (buffer.byteLength === 0 || buffer.byteLength > ID_MAX_BYTES) throw new Error('Each image must be under 5 MB.');
      const kind = sniffImage(new Uint8Array(buffer));
      if (!kind) throw new Error('Use PNG, JPG or WebP images.');
      kinds[side] = kind;
    }

    const stamp = Date.now();
    const frontPath = `kyc/${userId}/front-${stamp}.${kinds.front.ext}`;
    const upFront = await s.storage.from(bucket).upload(frontPath, front, { contentType: kinds.front.type, upsert: false });
    if (upFront.error) throw new Error(upFront.error.message);
    let backPath = '';
    if (back instanceof ArrayBuffer) {
      backPath = `kyc/${userId}/back-${stamp}.${kinds.back.ext}`;
      const upBack = await s.storage.from(bucket).upload(backPath, back, { contentType: kinds.back.type, upsert: false });
      if (upBack.error) throw new Error(upBack.error.message);
    }
    const { error } = await s.rpc('submit_kyc', {
      p_document_type: docType, p_document_number: number, p_country: country,
      p_dob: dob, p_expiry: expiry, p_front_path: frontPath, p_back_path: backPath,
    });
    if (error) throw new Error(error.message);
    return {
      message: 'Your ID was submitted for review.',
      profile: await readProfile(s, userId),
      kyc: { emailVerified: true, submission: { status: 'pending', rejection_reason: '' } },
    };
  }

  throw new Error('That profile action is not supported.');
}
