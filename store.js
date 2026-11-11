// Data layer. Firestore when config.js has a config, otherwise a demo store in localStorage
// (synced live between tabs of the same browser, handy for testing both people side by side).
import { firebaseConfig } from './config.js?v=22';

const FIREBASE_VERSION = '10.12.2';
const COLLS = ['events', 'activities', 'meta'];   // meta: shared settings (e.g. the Google calendar) and sync state

/** Random space key for the shared link (18 chars from a 32-letter alphabet ≈ 90 bits). */
export function makeKey() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789', a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return [...a].map(b => abc[b % 32]).join('');
}

const clean = o => JSON.parse(JSON.stringify(o));  // drops undefined (Firestore rejects it)

export async function openStore(key, onData, onError) {
  const data = {}, ready = {};
  for (const c of COLLS) { data[c] = []; ready[c] = false; }
  const emit = () => { if (COLLS.every(c => ready[c])) onData(Object.fromEntries(COLLS.map(c => [c, [...data[c]]]))); };

  if (!firebaseConfig) {
    const LK = 'tp.demo.' + key;
    const load = () => { try { return JSON.parse(localStorage.getItem(LK)) || {}; } catch { return {}; } };
    const read = () => { const db = load(); for (const c of COLLS) { data[c] = Object.values(db[c] || {}).filter(x => x && typeof x === 'object' && x.id); ready[c] = true; } emit(); };
    const bc = 'BroadcastChannel' in window ? new BroadcastChannel(LK) : null;
    if (bc) bc.onmessage = read;
    const write = fn => { const db = load(); fn(db); localStorage.setItem(LK, JSON.stringify(db)); bc?.postMessage(1); read(); };
    return {
      mode: 'demo',
      exists: async () => { const d = load(); return !!(d._seed || d.meta?.seeded); },
      start: read,
      put: async (c, o) => write(db => { (db[c] ||= {})[o.id] = clean(o); }),
      del: async (c, id) => write(db => { if (db[c]) delete db[c][id]; }),
      seed: async (list, version) => {
        const db0 = load(), have = db0._seed?.version || (db0.meta?.seeded ? (db0.meta.version || 1) : 0);
        if (have >= version) return;
        write(db => {
          db.activities ||= {};
          for (const a of list) if (a.since > have) db.activities[a.id] ||= clean(a);
          db._seed = { version };
        });
      },
    };
  }

  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
  const { initializeApp } = await import(base + 'firebase-app.js');
  const F = await import(base + 'firebase-firestore.js');
  const app = initializeApp(firebaseConfig);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch { db = F.getFirestore(app); }
  const ref = (c, id) => F.doc(db, 'spaces', key, c, id);
  return {
    mode: 'live',
    /** Is there a calendar under this key? (every real one has meta/seed, written when it was created) */
    exists: async () => { try { return (await F.getDoc(ref('meta', 'seed'))).exists(); } catch { return null; } },   // null = couldn't check (offline)
    start: () => {
      for (const c of COLLS) F.onSnapshot(F.collection(db, 'spaces', key, c), snap => {
        data[c] = snap.docs.map(d => ({ ...d.data(), id: d.id })); ready[c] = true; emit();
      }, onError);
    },
    put: (c, o) => F.setDoc(ref(c, o.id), clean(o)).catch(onError),
    del: (c, id) => F.deleteDoc(ref(c, id)).catch(onError),
    // Writes the starting ideas once, and later-added ideas (a.since > stored version) once per space.
    seed: async (list, version) => {
      try {
        const m = await F.getDoc(ref('meta', 'seed'));
        const have = m.exists() ? (m.data().version || 1) : 0;
        if (have >= version) return;
        const b = F.writeBatch(db);
        for (const a of list) if (a.since > have) b.set(ref('activities', a.id), clean(a));
        b.set(ref('meta', 'seed'), { at: Date.now(), version });
        await b.commit();
      } catch (e) { onError(e); }
    },
  };
}
