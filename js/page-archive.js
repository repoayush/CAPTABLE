/* Archive: the full history, a calendar with a count on each day, time travel, undo and restore. */
import { requireUser, getStartup, loadEvents, saveChanges } from './backend.js';
import { mountTopbar, html, mount, $, $$, toast, openModal } from './ui.js';
import * as F from './fmt.js';
import { replay, sortEvents, capTable, metrics, todayISO } from './engine.js';
import { kindLabel, startupStats } from './ledger.js';

const user = await requireUser();
const sid = new URLSearchParams(location.search).get('s');
if (!sid) {
  location.replace('home.html');
  throw new Error('no startup chosen');
}
mountTopbar(user, { active: 'archive', sid });

let startup = null;
let events = [];
let mode = 'effective'; // calendar counts by effective date or by the day the change was saved
let selDate = null;
let kindFilter = '';
let cal = { y: new Date().getFullYear(), m: new Date().getMonth() };
let busy = false;

const localDate = (ms) => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const keyOf = (e) => (mode === 'effective' ? e.effectiveDate : localDate(e.createdAt));
const titleOf = (id) => (events.find((e) => e.id === id) || {}).title || 'a change';

/* ------------------------------------------------------------------ */
function counts() {
  const map = new Map();
  events.forEach((e) => map.set(keyOf(e), (map.get(keyOf(e)) || 0) + 1));
  return map;
}

function renderCal() {
  const map = counts();
  const { y, m } = cal;
  const first = new Date(y, m, 1);
  const dim = new Date(y, m + 1, 0).getDate();
  const today = todayISO();
  const cells = [];
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d, i) => cells.push(html`<div class="cal-dow" title="${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}">${d}</div>`));
  for (let i = 0; i < first.getDay(); i++) cells.push(html`<div></div>`);
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const n = map.get(iso) || 0;
    const cls = ['cal-day', n ? 'has' : '', iso === selDate ? 'sel' : '', iso === today ? 'today' : ''].join(' ');
    if (n) cells.push(html`<button type="button" class="${cls}" data-date="${iso}" aria-label="${F.date(iso)}: ${n} ${n === 1 ? 'change' : 'changes'}" aria-pressed="${String(iso === selDate)}"><span>${d}</span><span class="cnt">${n}</span></button>`);
    else cells.push(html`<div class="${cls}" aria-label="${F.date(iso)}">${d}</div>`);
  }
  mount($('#cal'), cells);
  $('#month').textContent = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]} ${y}`;
}

function snapshotFor(date) {
  if (!date) return replay(events);
  if (mode === 'effective') return replay(events, { asOf: date });
  return replay(events.filter((e) => localDate(e.createdAt) <= date));
}

function renderSnap() {
  const st = snapshotFor(selDate);
  const ct = capTable(st, 'fd');
  const c = st.currency;
  const m = metrics(st);
  $('#snap-hint').textContent = selDate ? `As it stood on ${F.date(selDate)}` : 'As it stands now';
  if (!ct.rows.length) {
    mount($('#snap'), html`<p class="muted small" style="padding:8px 18px 16px;margin:0">Nothing existed yet on this date.</p>`);
    return;
  }
  mount($('#snap'), html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Shareholder</th><th class="num">Shares</th><th class="num">Ownership</th></tr></thead>
    <tbody>${ct.rows.map((r) => html`<tr><td><div class="who"><span class="swatch" style="background:${r.color}"></span><div><b>${r.name}</b><small>${r.isPool ? 'Option pool' : r.designation}</small></div></div></td><td class="num">${F.int(r.shares)}</td><td class="num"><b>${F.pct(r.pct)}</b></td></tr>`)}
    <tr class="total"><td>Total</td><td class="num">${F.int(ct.total)}</td><td class="num">${F.pct(100)}</td></tr></tbody></table></div>
    <div style="padding:10px 18px 16px" class="small muted">Authorised capital ${F.money(m.authCapital, c)} · paid-up ${F.money(m.nominal, c)} · cash received ${F.money(m.cash, c)}${m.post ? ' · last post-money ' + F.compact(m.post, c) : ''}</div>`);
}

function renderTimeline() {
  const kinds = [...new Set(events.map((e) => e.kind))];
  const sel = $('#f-kind');
  if (sel.options.length !== kinds.length + 1) {
    mount(sel, html`<option value="">All changes</option>${kinds.map((k) => html`<option value="${k}">${kindLabel(k)}</option>`)}`);
  }
  sel.value = kindFilter;
  const list = sortEvents(events)
    .reverse()
    .filter((e) => (!selDate || keyOf(e) === selDate) && (!kindFilter || e.kind === kindFilter));
  $('#all-dates').classList.toggle('hide', !selDate);
  $('#tl-hint').textContent = selDate ? `${F.plural(list.length, 'change')} on ${F.date(selDate)}` : `${F.plural(events.length, 'change')} in all, newest first`;
  if (!list.length) {
    mount($('#timeline'), html`<li class="empty" style="padding:30px 18px">Nothing matches.</li>`);
    return;
  }
  mount($('#timeline'), list.map((e) => {
    const voided = !!e.voidedAt;
    const canUndo = e.kind !== 'incorporation';
    return html`<li class="tl ${voided ? 'voided' : ''}">
      <div class="when"><b>${F.date(e.effectiveDate)}</b><span>Saved ${F.dateTime(e.createdAt)}</span></div>
      <div><h3>${e.title}</h3><p>${e.summary}</p>
        <div class="facts"><span class="badge">${kindLabel(e.kind)}</span>${voided ? html`<span class="badge bad">Undone ${F.dateTime(e.voidedAt)}</span>` : ''}${e.updatedAt && e.updatedAt - e.createdAt > 2000 && !voided ? html`<span class="badge info">Edited ${F.dateTime(e.updatedAt)}</span>` : ''}</div></div>
      <div>${!canUndo ? html`<span class="badge">Setup record</span>` : voided ? html`<button type="button" class="btn sm" data-restore="${e.id}" ${busy ? 'disabled' : ''}>Restore</button>` : html`<button type="button" class="btn sm" data-undo="${e.id}" ${busy ? 'disabled' : ''}>Undo</button>`}</div>
    </li>`;
  }));
}

function renderAll() {
  const live = events.filter((e) => !e.voidedAt);
  document.title = `Archive · ${startup.name} · CAPTABLE`;
  $('#title').textContent = `Archive: ${startup.name}`;
  $('#sub').textContent = `${F.plural(live.length, 'change')} in force, ${events.length - live.length} undone`;
  $('#back').href = `dashboard.html?s=${sid}`;
  $('#to-report').href = `report.html?s=${sid}`;
  renderCal();
  renderSnap();
  renderTimeline();
}

/* ------------------------------------------------------------------ */
/* Undo and restore, with a check that nothing later depends on the change */
/* ------------------------------------------------------------------ */
function troubleIds(evs) {
  const st = replay(evs);
  return new Set([...st.problems.map((p) => p.eventId), ...st.alerts.map((a) => a.eventId)]);
}

function planUndo(ev) {
  const baseline = troubleIds(events);
  const ids = new Set([ev.id]);
  for (let i = 0; i < 50; i++) {
    const test = events.map((e) => (ids.has(e.id) ? { ...e, voidedAt: 1 } : e));
    const bad = [...troubleIds(test)].filter((id) => !ids.has(id) && !baseline.has(id));
    if (!bad.length) break;
    bad.forEach((id) => ids.add(id));
  }
  return [...ids];
}

async function write(changed) {
  const now = Date.now();
  busy = true;
  renderTimeline();
  try {
    const next = events.map((e) => changed.find((c) => c.id === e.id) || e);
    const st = replay(next);
    const doc = { updatedAt: now, stats: startupStats(st, next.filter((e) => !e.voidedAt).length) };
    await saveChanges(user.uid, sid, { startup: doc, events: changed });
    events = next;
    startup = { ...startup, ...doc };
    toast('Saved.', 'good');
  } catch (e) {
    console.error(e);
    toast('Could not save: ' + (e.code || e.message), 'bad');
  }
  busy = false;
  renderAll();
}

function askUndo(ev) {
  const ids = planUndo(ev);
  const dependents = ids.filter((id) => id !== ev.id);
  const m = openModal({
    title: 'Undo this change?',
    body: html`
      <p style="margin:0"><b>${ev.title}</b><br><span class="muted">${ev.summary}</span></p>
      ${dependents.length ? html`<div class="alert warn"><div class="grow"><b>${F.plural(dependents.length, 'later change')} depend${dependents.length === 1 ? 's' : ''} on this one</b> and would stop making sense, so ${dependents.length === 1 ? 'it is' : 'they are'} undone too:<ul style="margin:6px 0 0 18px;padding:0">${dependents.map((id) => html`<li>${titleOf(id)}</li>`)}</ul></div></div>` : html`<div class="alert info"><div class="grow">Nothing later depends on it. The cap table is rebuilt without it. You can restore it from here at any time.</div></div>`}`,
    actions: [
      { label: 'Keep it', onClick: (h) => h.close() },
      { label: dependents.length ? `Undo ${ids.length} changes` : 'Undo', kind: 'danger', onClick: async (h) => { h.close(); const now = Date.now(); await write(ids.map((id) => ({ ...events.find((e) => e.id === id), voidedAt: now, updatedAt: now }))); } },
    ],
  });
  return m;
}

function askRestore(ev) {
  const baseline = troubleIds(events);
  const test = events.map((e) => (e.id === ev.id ? { ...e, voidedAt: null } : e));
  const bad = [...troubleIds(test)].filter((id) => !baseline.has(id));
  if (bad.length) {
    openModal({
      title: 'Cannot restore this yet',
      body: html`<p style="margin:0"><b>${ev.title}</b></p><div class="alert bad"><div class="grow">Bringing it back would break ${bad.length === 1 ? 'this later change' : 'these later changes'}:<ul style="margin:6px 0 0 18px;padding:0">${bad.map((id) => html`<li>${titleOf(id)}</li>`)}</ul>It cannot be applied on top of the other changes (for example it sells shares nobody holds yet, or issues more shares than are authorised). Restore the changes it depends on first, then try again.</div></div>`,
      actions: [{ label: 'Close', kind: 'primary', onClick: (h) => h.close() }],
    });
    return;
  }
  openModal({
    title: 'Restore this change?',
    body: html`<p style="margin:0"><b>${ev.title}</b><br><span class="muted">${ev.summary}</span></p><div class="alert info"><div class="grow">It counts again from ${F.date(ev.effectiveDate)}.</div></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      { label: 'Restore', kind: 'primary', onClick: async (h) => { h.close(); const now = Date.now(); await write([{ ...ev, voidedAt: null, updatedAt: now }]); } },
    ],
  });
}

/* ------------------------------------------------------------------ */
$('#timeline').addEventListener('click', (e) => {
  const u = e.target.closest('[data-undo]');
  const r = e.target.closest('[data-restore]');
  if (u) askUndo(events.find((x) => x.id === u.dataset.undo));
  if (r) askRestore(events.find((x) => x.id === r.dataset.restore));
});
$('#cal').addEventListener('click', (e) => {
  const b = e.target.closest('[data-date]');
  if (!b) return;
  selDate = selDate === b.dataset.date ? null : b.dataset.date;
  renderAll();
});
$('#all-dates').addEventListener('click', () => {
  selDate = null;
  renderAll();
});
$('#f-kind').addEventListener('change', (e) => {
  kindFilter = e.target.value;
  renderTimeline();
});
$$('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    selDate = null;
    $$('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    goLatest();
    renderAll();
  }),
);
function goLatest() {
  const keys = events.map(keyOf).sort();
  const last = keys[keys.length - 1] || todayISO();
  cal = { y: +last.slice(0, 4), m: +last.slice(5, 7) - 1 };
}
$('#prev').addEventListener('click', () => {
  cal = cal.m === 0 ? { y: cal.y - 1, m: 11 } : { y: cal.y, m: cal.m - 1 };
  renderCal();
});
$('#next').addEventListener('click', () => {
  cal = cal.m === 11 ? { y: cal.y + 1, m: 0 } : { y: cal.y, m: cal.m + 1 };
  renderCal();
});
$('#today').addEventListener('click', () => {
  goLatest();
  renderCal();
});

/* ------------------------------------------------------------------ */
function showState(title, text) {
  const el = $('#state');
  mount(el, html`<h2>${title}</h2><p>${text}</p><a class="btn primary" href="home.html">Back to your startups</a>`);
  el.classList.remove('hide');
}
try {
  startup = await getStartup(user.uid, sid);
  if (!startup) showState('Startup not found', 'It may have been deleted, or it belongs to another account.');
  else {
    events = await loadEvents(user.uid, sid);
    goLatest();
    $('#app').classList.remove('hide');
    renderAll();
  }
} catch (e) {
  console.error(e);
  showState('Could not load the archive', `Check your internet connection and the Firestore rules, then refresh. (${e.code || e.message})`);
}
