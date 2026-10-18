/* Sign-in and saving.
 * Real mode: Firebase Authentication (Google) + Cloud Firestore.
 *   users/{uid}/startups/{startupId}
 *   users/{uid}/startups/{startupId}/events/{eventId}      (one small document per event)
 * Demo mode (config.js not filled in): fake user, data kept in localStorage.
 * Both modes expose the same functions, so the pages never know the difference.
 */
import { firebaseConfig } from './config.js';

export const isDemo = !firebaseConfig || !firebaseConfig.apiKey || /^(PASTE|YOUR)/i.test(firebaseConfig.apiKey);

const SDK = '10.14.1';
let fbp = null;
function loadFirebase() {
  if (fbp) return fbp;
  const base = `https://www.gstatic.com/firebasejs/${SDK}/`;
  fbp = Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]).then(([app, A, F]) => {
    const a = app.initializeApp(firebaseConfig);
    return { app: a, auth: A.getAuth(a), db: F.getFirestore(a), A, F };
  });
  return fbp;
}

const clean = (o) => JSON.parse(JSON.stringify(o));
export function withTimeout(p, ms = 15000) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}
const toUser = (u) => (u ? { uid: u.uid, name: u.displayName || 'Founder', email: u.email || '', photo: u.photoURL || '' } : null);

/* ----------------------------- demo ---------------------------------- */
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
  },
  del(k) {
    localStorage.removeItem(k);
  },
};
const DEMO_USER = { uid: 'demo-user', name: 'Demo Founder', email: 'demo@captable.local', photo: '' };
const demo = {
  watch(cb) {
    setTimeout(() => cb(LS.get('captable.demo.user', null)), 0);
    return () => {};
  },
  async signIn() {
    LS.set('captable.demo.user', DEMO_USER);
    return DEMO_USER;
  },
  async signOut() {
    LS.del('captable.demo.user');
  },
  async list() {
    return LS.get('captable.demo.startups', []).filter((s) => !s.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(uid, sid) {
    return LS.get('captable.demo.startups', []).find((s) => s.id === sid) || null;
  },
  async events(uid, sid) {
    return LS.get('captable.demo.events.' + sid, []);
  },
  async create(uid, startup, events) {
    const all = LS.get('captable.demo.startups', []);
    all.push(clean(startup));
    LS.set('captable.demo.startups', all);
    LS.set('captable.demo.events.' + startup.id, clean(events));
  },
  async save(uid, sid, { startup, events }) {
    const all = LS.get('captable.demo.startups', []);
    const i = all.findIndex((s) => s.id === sid);
    if (i >= 0 && startup) all[i] = { ...all[i], ...clean(startup) };
    LS.set('captable.demo.startups', all);
    const evs = LS.get('captable.demo.events.' + sid, []);
    for (const ev of events || []) {
      const j = evs.findIndex((e) => e.id === ev.id);
      if (j >= 0) evs[j] = clean(ev);
      else evs.push(clean(ev));
    }
    LS.set('captable.demo.events.' + sid, evs);
  },
  async remove(uid, sid) {
    LS.set('captable.demo.startups', LS.get('captable.demo.startups', []).filter((s) => s.id !== sid));
    LS.del('captable.demo.events.' + sid);
  },
};

/* ----------------------------- firebase -------------------------------- */
const real = {
  async watch(cb) {
    const { auth, A } = await loadFirebase();
    try {
      await A.getRedirectResult(auth);
    } catch (e) {
      console.warn('Redirect sign-in failed', e);
    }
    return A.onAuthStateChanged(auth, (u) => cb(toUser(u)));
  },
  async signIn() {
    const { auth, A } = await loadFirebase();
    const provider = new A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const r = await A.signInWithPopup(auth, provider);
      return toUser(r.user);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await A.signInWithRedirect(auth, provider);
        return null;
      }
      throw e;
    }
  },
  async signOut() {
    const { auth, A } = await loadFirebase();
    await A.signOut(auth);
  },
  async list(uid) {
    const { db, F } = await loadFirebase();
    const snap = await F.getDocs(F.collection(db, 'users', uid, 'startups'));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id })).filter((s) => !s.deleted).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async get(uid, sid) {
    const { db, F } = await loadFirebase();
    const d = await F.getDoc(F.doc(db, 'users', uid, 'startups', sid));
    return d.exists() ? { ...d.data(), id: d.id } : null;
  },
  async events(uid, sid) {
    const { db, F } = await loadFirebase();
    const snap = await F.getDocs(F.collection(db, 'users', uid, 'startups', sid, 'events'));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  },
  async create(uid, startup, events) {
    const { db, F } = await loadFirebase();
    const batch = F.writeBatch(db);
    batch.set(F.doc(db, 'users', uid, 'startups', startup.id), clean(startup));
    for (const ev of events) batch.set(F.doc(db, 'users', uid, 'startups', startup.id, 'events', ev.id), clean(ev));
    await batch.commit();
  },
  async save(uid, sid, { startup, events }) {
    const { db, F } = await loadFirebase();
    const batch = F.writeBatch(db);
    if (startup) batch.set(F.doc(db, 'users', uid, 'startups', sid), clean(startup), { merge: true });
    for (const ev of events || []) batch.set(F.doc(db, 'users', uid, 'startups', sid, 'events', ev.id), clean(ev));
    await batch.commit();
  },
  async remove(uid, sid) {
    const { db, F } = await loadFirebase();
    const snap = await F.getDocs(F.collection(db, 'users', uid, 'startups', sid, 'events'));
    const refs = snap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) {
      const batch = F.writeBatch(db);
      refs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await F.deleteDoc(F.doc(db, 'users', uid, 'startups', sid));
  },
};

const be = isDemo ? demo : real;

/* ----------------------------- public ---------------------------------- */
export const watchAuth = (cb) => be.watch(cb);
export const signInWithGoogle = () => be.signIn();
export const signOutUser = () => be.signOut();

function showFatal(e) {
  console.error(e);
  const box = document.createElement('div');
  box.className = 'alert bad';
  box.setAttribute('role', 'alert');
  box.style.cssText = 'max-width:640px;margin:80px auto;padding:18px 20px';
  box.innerHTML = '<div class="grow"><b>Could not connect to Firebase.</b><br>Check your internet connection and the values in <code>js/config.js</code>, then <a href="">reload</a>. (' + String((e && (e.code || e.message)) || e).replace(/[<>&]/g, '') + ')</div>';
  document.body.appendChild(box);
}

/** Resolves with the signed-in user, or sends the visitor to the sign-in page. */
export function requireUser() {
  return new Promise((resolve) => {
    let done = false;
    Promise.resolve(be.watch((u) => {
      if (done) {
        if (!u) location.replace('index.html');
        return;
      }
      done = true;
      if (!u) location.replace('index.html');
      else resolve(u);
    })).catch(showFatal);
  });
}

export const listStartups = (uid) => be.list(uid);
export const getStartup = (uid, sid) => be.get(uid, sid);
export const loadEvents = (uid, sid) => be.events(uid, sid);
export const createStartup = (uid, startup, events) => be.create(uid, startup, events);
export const saveChanges = (uid, sid, payload) => be.save(uid, sid, payload);
export const deleteStartup = (uid, sid) => be.remove(uid, sid);
