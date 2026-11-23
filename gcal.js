// Google Calendar from the browser, no server: Google Identity Services gives a 1-hour access token,
// then we call the Calendar REST API directly. Needs googleClientId in config.js (see README).
import { googleClientId } from './config.js?v=25';

// Least access that still does the job (checked with two accounts on 23/11/2026):
//  - calendar.app.created: make Syzygy's own calendar and edit events ONLY in calendars Syzygy created
//    (also when the creator shared that calendar with the other person); every other calendar is refused
//  - calendar.freebusy: busy times of your main calendar, never titles or details
//  - openid email: your address, so Google can skip "choose an account" when the pass is renewed
const AUTH = 'https://www.googleapis.com/auth/';
const SCOPES = [AUTH + 'calendar.app.created', AUTH + 'calendar.freebusy', 'openid', 'email'].join(' ');
// What older versions asked for. If an account still has these, Syzygy removes them (see the callback).
const OLD_SCOPES = [AUTH + 'calendar.events', AUTH + 'calendar.readonly', AUTH + 'calendar'];
const API = 'https://www.googleapis.com/calendar/v3';
const TOK = 'tp.gtoken', WANT = 'tp.gcal', HINT = 'tp.ghint';   // HINT = this device's Google account (email)
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

let client = null, tok = null;
const listeners = [];
try { tok = JSON.parse(ls.get(TOK)); } catch {}
const staleTok = tok?.v !== 2 ? tok : null;   // a pass saved by an older version still carries the old, broad access
if (staleTok) { tok = null; ls.set(TOK, null); }

export const hasClient = !!googleClientId;
/** This device chose to connect (so we may ask Google for a fresh token when needed). */
export const wanted = () => ls.get(WANT) === '1';
export const isValid = () => !!tok?.t && Date.now() < tok.exp - 60e3;
/** Valid now but runs out within `ms` (so a click can renew it before a sync hits an expired pass). */
export const expiresWithin = ms => isValid() && Date.now() > tok.exp - ms;
export const ready = () => !!client;
/** This device's Google account (email), once known. */
export const account = () => ls.get(HINT);
export function onToken(fn) { listeners.push(fn); }

export function loadGis() {
  if (!hasClient || client) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onerror = reject;
    s.onload = () => {
      client = google.accounts.oauth2.initTokenClient({
        client_id: googleClientId, scope: SCOPES,
        callback: r => {
          if (r.error) return listeners.forEach(f => f(null, r.error));
          // This account still has the old broad access for Syzygy: remove ALL of Syzygy's access, so the next
          // connect asks you to approve only the small set above. Happens once per Google account.
          if (OLD_SCOPES.some(x => (r.scope || '').split(' ').includes(x))) {
            tok = null; ls.set(TOK, null);
            google.accounts.oauth2.revoke(r.access_token, () => listeners.forEach(f => f(null, 'upgraded')));
            return;
          }
          tok = { v: 2, t: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
          ls.set(TOK, JSON.stringify(tok)); ls.set(WANT, '1');
          listeners.forEach(f => f(tok));
          if (!ls.get(HINT)) rememberAccount();
        },
        error_callback: e => listeners.forEach(f => f(null, e?.type || 'popup_closed')),
      });
      // an older version's pass that hasn't expired yet: use it to remove the old broad access right away
      if (staleTok?.t && Date.now() < staleTok.exp) google.accounts.oauth2.revoke(staleTok.t, () => listeners.forEach(f => f(null, 'upgraded')));
      resolve();
    };
    document.head.append(s);
  });
}
/** Must be called from a click/tap (Google opens a small popup; it closes by itself once you've agreed before). */
// With a remembered account Google skips "choose an account", so a renewal popup closes by itself.
export function requestToken(prompt = '') {
  if (!client) return false;
  const hint = ls.get(HINT);
  client.requestAccessToken(hint ? { prompt, login_hint: hint } : { prompt });
  return true;
}
async function rememberAccount() {
  try {
    const i = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(tok.t)).then(r => r.json());
    if (i?.email) ls.set(HINT, i.email);
  } catch {}
}
export function disconnect() {
  try { if (tok?.t) google.accounts.oauth2.revoke(tok.t, () => {}); } catch {}
  tok = null; ls.set(TOK, null); ls.set(WANT, null); ls.set(HINT, null);
}

export async function api(method, path, body, query) {
  if (!isValid()) throw Object.assign(new Error('Not signed in to Google'), { code: 'auth' });
  const url = API + path + (query ? '?' + new URLSearchParams(query) : '');
  const r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + tok.t, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { tok = null; ls.set(TOK, null); throw Object.assign(new Error('Google sign-in expired'), { code: 'auth' }); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `HTTP ${r.status}`), { status: r.status });
  return j;
}
