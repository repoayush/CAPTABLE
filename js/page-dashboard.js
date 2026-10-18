/* The live dashboard: setup, deal, actions and the cap table on one screen. */
import { requireUser, getStartup, loadEvents, saveChanges } from './backend.js';
import { mountTopbar, html, mount, $, $$, toast, confirmDialog } from './ui.js';
import * as F from './fmt.js';
import { Q, replay, totalShares, solveAuthorised, newId, todayISO, r2 } from './engine.js';
import { setupErrors, incorporationEvent, setupFromEvent, buildDraft, startupStats } from './ledger.js';
import { parseNum } from './forms.js';
import * as V from './dash-render.js';
import * as D from './dialogs.js';

const user = await requireUser();
const sid = new URLSearchParams(location.search).get('s');
if (!sid) {
  location.replace('home.html');
  throw new Error('no startup chosen');
}
mountTopbar(user, { active: 'dashboard', sid });

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */
let startup = null;
let saved = []; // every stored event, voided ones included
let incEvent = null; // the live incorporation event
let setup = null; // form values for the incorporation
let touched = ['capital', 'faceValue']; // the two of capital / shares / face value that stay fixed
let pending = []; // events added on this page, not saved yet
let offers = []; // investors in the deal, not saved yet
let roundOpts = freshRoundOpts();
let assumedPre = null;
let view = 'fd';
let showSaved = false;
let saving = false;
let M = null; // the derived model
let renderedLocked = null;

function freshRoundOpts() {
  return { date: todayISO(), roundName: 'Priced round', roundId: newId(), dilution: 'pre', poolTarget: null };
}
const numStr = (n) => (Number.isFinite(n) ? String(+Number(n).toFixed(6)) : '');

/* ------------------------------------------------------------------ */
/* The model                                                           */
/* ------------------------------------------------------------------ */
const setupKey = (s) => JSON.stringify([s.name, s.faceValue, s.authorisedCapital, s.authorisedShares, !!s.dpiit, s.incorporationDate, s.founders.map((f) => [f.id, f.name, f.designation, f.shares, f.paid])]);

function compute() {
  const setupErr = setupErrors(setup);
  const dirtySetup = setupKey(setup) !== setupKey(setupFromEvent(incEvent));
  const useSetup = dirtySetup && !setupErr.length;
  const incUse = useSetup ? incorporationEvent(setup, incEvent, incEvent.updatedAt) : incEvent;
  const savedEvents = saved.map((e) => (e.id === incEvent.id ? incUse : e));
  const calcEvents = [...savedEvents, ...pending];
  const base = replay(calcEvents);
  const opts = { ...roundOpts, now: Date.now(), currency: base.currency };
  let draft;
  try {
    draft = buildDraft(calcEvents, offers, opts);
  } catch (err) {
    draft = { events: [], errors: ['Check the numbers: ' + err.message], warnings: [], round: null, roundEvent: null };
  }
  const st = replay([...calcEvents, ...draft.events]);
  const savedState = replay(saved);
  const locked = saved.some((e) => !e.voidedAt && e.kind !== 'incorporation') || pending.length > 0;
  const over = totalShares(st) > st.authShares && st.authShares > 0;
  const blockers = [];
  if (setupErr.length) blockers.push(...setupErr);
  blockers.push(...draft.errors);
  st.problems.forEach((p) => blockers.push(p.msg));
  if (over) blockers.push(`Shares (${F.int(totalShares(st))}) are more than the authorised shares (${F.int(st.authShares)}). Increase the authorised capital (Form SH-7).`);
  const dirty = dirtySetup || pending.length > 0 || offers.length > 0;
  M = {
    setupErr, dirtySetup, useSetup, locked, calcEvents, base, draft, st, saved: savedState, problems: st.problems, over, blockers, dirty,
    canSave: dirty && !blockers.length && !saving, changed: dirty, hasPriced: offers.some((o) => o.type === 'priced'), hasSplit: pending.some((e) => e.kind === 'split'),
  };
  return M;
}

const ctx = {
  base: () => ({ st: M.base, events: M.calcEvents }),
  offers: () => offers,
  setOffers: (o) => {
    offers = o;
    fixFirstPriced();
  },
  roundOpts: () => ({ ...roundOpts, now: Date.now(), currency: M.base.currency }),
  addPending(ev) {
    if (ev.kind === 'auth_increase' && pending.length) ev.createdAt = Math.min(...pending.map((p) => p.createdAt)) - 1;
    pending.push(ev);
    toast('Added to your changes. Press Save changes to keep it.');
    refresh();
  },
  refresh: () => refresh(),
  neededShares: () => (M.draft.round && M.draft.round.ok ? M.draft.round.T : totalShares(M.base)),
};

/** if the investor who set the price is removed, the next one must set it */
function fixFirstPriced() {
  const first = offers.find((o) => o.type === 'priced');
  if (first && first.mode === 'same') {
    Object.assign(first, { mode: 'pct', uiTab: 'pct', pct: 10, pre: null, post: null });
    toast(`${first.name || 'The next investor'} now sets the price: 10% equity. Edit to change it.`);
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
function renderSetupFull() {
  mount($('#c-setup-body'), V.setupFormView(M, setup, touched));
  renderedLocked = M.locked;
  syncSetup();
}

function syncSetup() {
  const act = document.activeElement;
  const setIf = (el, v) => {
    if (el && el !== act) el.value = v;
  };
  setIf($('#s-cap'), numStr(setup.authorisedCapital));
  setIf($('#s-sh'), numStr(setup.authorisedShares));
  setIf($('#s-fv'), numStr(setup.faceValue));
  [['s-cap', 'capital'], ['s-sh', 'shares'], ['s-fv', 'faceValue']].forEach(([id, k]) => {
    const el = $('#' + id);
    if (!el) return;
    el.classList.toggle('linked', !touched.includes(k));
    const badge = el.closest('.field').querySelector('.cb');
    if (badge) badge.classList.toggle('hide', touched.includes(k));
  });
  const c = setup.currency || 'INR';
  const hint = (id, t) => {
    const h = document.querySelector(`[data-hint-for="${id}"]`);
    if (h) h.textContent = t || ' ';
  };
  hint('s-cap', setup.authorisedCapital > 0 ? `${F.money(setup.authorisedCapital, c)}${c === 'INR' ? ' · ' + F.words(setup.authorisedCapital) : ''}` : '');
  hint('s-sh', setup.authorisedShares >= 1 ? `${F.int(setup.authorisedShares)} shares at most` : '');
  hint('s-fv', setup.faceValue > 0 ? `${F.price(setup.faceValue, c)} a share` : '');
  $$('#f-rows .f-row').forEach((row) => {
    const f = setup.founders[+row.dataset.fi];
    if (!f) return;
    setIf(row.querySelector('.f-sh'), numStr(f.shares));
    setIf(row.querySelector('.f-paid'), numStr(f.paid));
    const pct = setup.authorisedShares > 0 && Number.isFinite(f.shares) ? (f.shares / setup.authorisedShares) * 100 : NaN;
    setIf(row.querySelector('.f-pct'), Number.isFinite(pct) ? F.pct(pct).replace('%', '') : '');
  });
  const sum = $('#setup-sum');
  if (sum) mount(sum, V.setupSumView(M, setup));
}

function refresh(o = {}) {
  compute();
  const st = M.st;
  document.title = `${setup.name || 'Startup'} · CAPTABLE`;

  // header
  const n = saved.filter((e) => !e.voidedAt).length;
  mount($('#sub'), html`Last saved ${F.dateTime(startup.updatedAt)} · ${F.plural(n, 'event')} ${M.dirty ? html`<span class="badge warn live" style="margin-left:6px">Unsaved changes</span>` : html`<span class="badge good" style="margin-left:6px">All changes saved</span>`}`);
  $('#to-archive').href = `archive.html?s=${sid}`;
  $('#to-report').href = `report.html?s=${sid}`;

  // setup
  $('#setup-lock').classList.toggle('hide', !M.locked);
  if (o.setup === 'full' || renderedLocked !== M.locked) renderSetupFull();
  else syncSetup();

  mount($('#kpis'), V.kpisView(M));

  // deal
  mount($('#offers'), offers.length ? V.offersView(M, offers) : '');
  $('#offers').classList.toggle('hide', !offers.length);
  $('#deal-options').classList.toggle('hide', !M.hasPriced);
  if (M.hasPriced && !o.keepDealOpts) mount($('#deal-options'), V.dealOptionsView(M, roundOpts));
  mount($('#deal-result'), V.resultView(M, offers));
  $('#add-investor').textContent = offers.length ? '+ Add another investor' : '+ Add investor';

  mount($('#c-pending-body'), V.pendingView(M, pending));
  $('#c-pending').classList.toggle('hide', !pending.length && !M.problems.length);
  mount($('#actions'), V.actionsView(M));

  // right column
  $$('[data-act="view"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === view)));
  $$('[data-act="cmp"]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === 'saved') === (showSaved && M.changed))));
  $('#cmp-seg').classList.toggle('hide', !M.changed);
  mount($('#donut'), V.donutView(M, view, showSaved));
  mount($('#table'), V.tableView(M, view));

  const hasW = st.waiting.length > 0;
  $('#w-head').classList.toggle('hide', !hasW);
  if (hasW && assumedPre == null) {
    assumedPre = st.lastRound ? st.lastRound.post : Math.max(0, ...st.waiting.map((w) => w.cap || 0)) || 50000000;
    $('#w-pre').value = numStr(assumedPre);
  }
  mount($('#w-list'), V.waitingListView(M, offers, assumedPre));
  mount($('#money'), V.moneyView(M));

  renderSavebar();
}

function renderSavebar() {
  const bar = $('#savebar');
  const btn = $('#sb-save');
  const hasOffer = offers.length > 0;
  const pulse = $('#sb-pulse');
  const text = $('#sb-text');
  const nChanges = pending.length + offers.length + (M.dirtySetup ? 1 : 0);
  btn.className = 'btn lg ' + (hasOffer ? 'accent' : 'primary');
  btn.textContent = saving ? 'Saving…' : hasOffer ? (offers.length > 1 ? 'Accept offers' : 'Accept offer') : 'Save changes';
  btn.disabled = !M.canSave;
  $('#sb-discard').classList.toggle('hide', !M.dirty);
  $('#sb-discard').disabled = saving;
  pulse.className = 'pulse' + (!M.dirty ? ' ok' : M.blockers.length ? ' bad' : '');
  if (!M.dirty) mount(text, html`<span>All changes saved${startup.updatedAt ? ' · ' + F.dateTime(startup.updatedAt) : ''}</span>`);
  else if (M.blockers.length) mount(text, html`<span><b>Cannot save yet.</b> ${M.blockers[0]}${M.blockers.length > 1 ? ` (+${M.blockers.length - 1} more)` : ''}</span>`);
  else mount(text, html`<span><b>${F.plural(nChanges, 'change')}</b> waiting. <span class="hide-sm">${hasOffer ? 'Nothing is final until you accept the offer.' : 'Save them to keep them.'}</span></span>`);
  bar.classList.remove('hide');
}

/* ------------------------------------------------------------------ */
/* Setup editing                                                       */
/* ------------------------------------------------------------------ */
function founderPaid(f) {
  if (f.paidAuto && Number.isFinite(f.shares) && setup.faceValue > 0) f.paid = r2(Q.of(f.shares).mul(Q.of(setup.faceValue)));
}

$('#c-setup').addEventListener('input', (e) => {
  const t = e.target;
  if (M.locked) return;
  const row = t.closest('.f-row');
  if (t.id === 's-cap' || t.id === 's-sh' || t.id === 's-fv') {
    const key = { 's-cap': 'capital', 's-sh': 'shares', 's-fv': 'faceValue' }[t.id];
    const v = parseNum(t.value);
    touched = touched.filter((k) => k !== key).concat(key).slice(-2);
    if (key === 'capital') setup.authorisedCapital = v;
    else if (key === 'shares') setup.authorisedShares = Number.isFinite(v) ? Math.trunc(v) : NaN;
    else setup.faceValue = v;
    const r = solveAuthorised({ capital: setup.authorisedCapital, shares: setup.authorisedShares, faceValue: setup.faceValue }, touched);
    setup.authorisedCapital = r.capital;
    setup.authorisedShares = r.shares;
    setup.faceValue = r.faceValue;
    setup.founders.forEach(founderPaid);
  } else if (t.id === 's-inc') {
    setup.incorporationDate = t.value;
  } else if (row) {
    const f = setup.founders[+row.dataset.fi];
    if (t.classList.contains('f-name')) f.name = t.value;
    else if (t.classList.contains('f-des')) f.designation = t.value;
    else if (t.classList.contains('f-sh')) {
      const v = parseNum(t.value);
      f.shares = Number.isFinite(v) ? Math.trunc(v) : NaN;
      founderPaid(f);
    } else if (t.classList.contains('f-paid')) {
      f.paid = parseNum(t.value);
      f.paidAuto = false;
    } else if (t.classList.contains('f-pct')) {
      const p = parseNum(t.value);
      f.shares = Number.isFinite(p) && setup.authorisedShares > 0 ? Math.round((p / 100) * setup.authorisedShares) : NaN;
      founderPaid(f);
    }
  } else return;
  refresh({ keepDealOpts: true });
});

function addFounder() {
  const n = setup.founders.length + 1;
  const f = { id: newId(), name: 'Founder ' + n, designation: 'Co-founder', shares: 1000, paid: 0, paidAuto: true };
  founderPaid(f);
  setup.founders.push(f);
  refresh({ setup: 'full', keepDealOpts: true });
}
function removeFounder(i) {
  if (setup.founders.length < 2) return;
  setup.founders.splice(i, 1);
  refresh({ setup: 'full', keepDealOpts: true });
}

$('#name').addEventListener('input', (e) => {
  setup.name = e.target.value;
  refresh({ keepDealOpts: true });
});
$('#dpiit').addEventListener('change', (e) => {
  setup.dpiit = e.target.checked;
  refresh({ keepDealOpts: true });
});

/* deal options */
$('#deal-options').addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'd-name') roundOpts.roundName = t.value.trim() || 'Priced round';
  else if (t.id === 'd-date') roundOpts.date = t.value;
  else if (t.id === 'd-pool') {
    const v = parseNum(t.value);
    roundOpts.poolTarget = Number.isFinite(v) && v > 0 ? v : null;
  } else return;
  refresh({ keepDealOpts: true });
});
$('#deal-options').addEventListener('change', (e) => {
  if (e.target.id === 'd-dil') {
    roundOpts.dilution = e.target.value;
    refresh({ keepDealOpts: true });
  }
});

$('#w-pre').addEventListener('input', (e) => {
  const v = parseNum(e.target.value);
  assumedPre = Number.isFinite(v) ? v : 0;
  mount($('#w-list'), V.waitingListView(M, offers, assumedPre));
});

/* ------------------------------------------------------------------ */
/* Clicks                                                              */
/* ------------------------------------------------------------------ */
$('#app').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  const id = b.dataset.id;
  switch (a) {
    case 'add-investor': D.dlgInvestor(ctx); break;
    case 'edit-offer': D.dlgInvestor(ctx, offers.find((o) => o.id === id)); break;
    case 'del-offer':
      offers = offers.filter((o) => o.id !== id);
      fixFirstPriced();
      refresh();
      break;
    case 'add-founder': addFounder(); break;
    case 'del-founder': removeFounder(+b.dataset.i); break;
    case 'transfer': D.dlgTransfer(ctx); break;
    case 'split': D.dlgSplit(ctx); break;
    case 'issue': D.dlgIssue(ctx); break;
    case 'pool': D.dlgPool(ctx); break;
    case 'auth': D.dlgAuth(ctx); break;
    case 'lockin': D.dlgLockin(ctx); break;
    case 'edit-holder': D.dlgEditHolder(ctx, id); break;
    case 'convert': D.dlgConvert(ctx, id); break;
    case 'cancel': D.dlgCancel(ctx, id); break;
    case 'del-pending':
      pending = pending.filter((p) => p.id !== id);
      refresh({ setup: 'full' });
      break;
    case 'fit-auth': {
      const r = M.draft.round;
      if (r && r.ok) D.dlgAuth(ctx, Math.ceil((r.T - r.auth.limit) * M.base.faceValue * 100) / 100);
      break;
    }
    case 'view': view = b.dataset.v; refresh({ keepDealOpts: true }); break;
    case 'cmp': showSaved = b.dataset.v === 'saved'; refresh({ keepDealOpts: true }); break;
    default:
  }
});

/* ------------------------------------------------------------------ */
/* Save                                                                */
/* ------------------------------------------------------------------ */
const draftFor = (date) => buildDraft(M.calcEvents, offers, { ...roundOpts, date, now: Date.now(), currency: M.base.currency });

$('#sb-save').addEventListener('click', async () => {
  if (!M.canSave || saving) return;
  let date = roundOpts.date;
  if (offers.length) {
    date = await D.dlgAccept(ctx, draftFor);
    if (!date) return;
    roundOpts.date = date;
  }
  await commit(date);
});

$('#sb-discard').addEventListener('click', async () => {
  const ok = await confirmDialog({ title: 'Discard your changes?', message: 'Everything you added since the last save is removed: the investors, the extra changes and any edits to the setup. Saved data stays as it is.', confirmLabel: 'Discard', danger: true });
  if (!ok) return;
  resetDraft();
});

function resetDraft() {
  pending = [];
  offers = [];
  roundOpts = freshRoundOpts();
  setup = loadSetup();
  touched = ['capital', 'faceValue'];
  $('#name').value = setup.name;
  $('#dpiit').checked = !!setup.dpiit;
  refresh({ setup: 'full' });
}

async function commit(date) {
  saving = true;
  refresh({ keepDealOpts: true });
  try {
    const now = Date.now();
    const write = [];
    if (M.dirtySetup && M.useSetup) write.push(incorporationEvent(setup, incEvent, now));
    write.push(...pending);
    let fresh = [];
    if (offers.length) {
      const d = buildDraft(M.calcEvents, offers, { ...roundOpts, date, now, currency: M.base.currency });
      if (d.errors.length) throw new Error(d.errors[0]);
      fresh = d.events;
    }
    write.push(...fresh);
    const newInc = write.find((e) => e.kind === 'incorporation') || incEvent;
    const merged = [...saved.filter((e) => !write.some((w) => w.id === e.id)), ...write];
    const st = replay(merged);
    if (st.problems.length) throw new Error(st.problems[0].msg);
    if (st.authShares && totalShares(st) > st.authShares) throw new Error('Shares would be more than the authorised shares. Increase the authorised capital first.');
    const live = merged.filter((e) => !e.voidedAt).length;
    const doc = { name: setup.name.trim(), updatedAt: now, currency: st.currency, stats: startupStats(st, live) };
    await saveChanges(user.uid, sid, { startup: doc, events: write });
    saved = merged;
    incEvent = newInc;
    startup = { ...startup, ...doc };
    pending = [];
    offers = [];
    roundOpts = freshRoundOpts();
    setup = loadSetup();
    touched = ['capital', 'faceValue'];
    saving = false;
    $('#name').value = setup.name;
    $('#dpiit').checked = !!setup.dpiit;
    refresh({ setup: 'full' });
    toast(fresh.some((e) => e.kind === 'round') ? 'Offer accepted and saved.' : 'Saved.', 'good');
  } catch (err) {
    console.error(err);
    saving = false;
    refresh({ keepDealOpts: true });
    toast('Could not save: ' + (err.code || err.message), 'bad');
  }
}

window.addEventListener('beforeunload', (e) => {
  if (M && M.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */
function loadSetup() {
  const s = setupFromEvent(incEvent);
  s.founders.forEach((f) => {
    f.paidAuto = Math.abs((f.paid ?? 0) - r2(Q.of(f.shares).mul(Q.of(s.faceValue)))) < 0.005;
  });
  return s;
}

function showState(title, text) {
  const el = $('#state');
  mount(el, html`<h2>${title}</h2><p>${text}</p><a class="btn primary" href="home.html">Back to your startups</a>`);
  el.classList.remove('hide');
}

try {
  startup = await getStartup(user.uid, sid);
  if (!startup) {
    showState('Startup not found', 'It may have been deleted, or it belongs to another account.');
  } else {
    saved = await loadEvents(user.uid, sid);
    incEvent = saved.find((e) => e.kind === 'incorporation' && !e.voidedAt);
    if (!incEvent) {
      showState('This startup has no setup record', 'Its first event is missing, so the cap table cannot be built. Delete it from your startups list and create a new one.');
    } else {
      setup = loadSetup();
      $('#name').value = setup.name;
      $('#dpiit').checked = !!setup.dpiit;
      $('#app').classList.remove('hide');
      refresh({ setup: 'full' });
    }
  }
} catch (err) {
  console.error(err);
  showState('Could not load this startup', `Check your internet connection and the Firestore rules, then refresh. (${err.code || err.message})`);
}
