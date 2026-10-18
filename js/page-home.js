import { requireUser, listStartups, createStartup, deleteStartup } from './backend.js';
import { mountTopbar, html, mount, $, openModal, toast } from './ui.js';
import { defaultSetup, incorporationEvent, startupStats } from './ledger.js';
import { replay, newId } from './engine.js';
import * as F from './fmt.js';

const user = await requireUser();
mountTopbar(user, { active: 'home' });

const list = $('#list');
const sub = $('#sub');
const createBtn = $('#create');
let startups = [];

async function load() {
  try {
    startups = await listStartups(user.uid);
  } catch (e) {
    console.error(e);
    sub.textContent = 'Could not load your startups.';
    mount(list, html`<div class="alert bad" style="grid-column:1/-1"><div class="grow"><b>Could not reach the database.</b> Check your internet connection and the Firestore rules, then refresh. (${e.code || e.message})</div></div>`);
    return;
  }
  render();
}

function card(s) {
  const st = s.stats || {};
  const cur = st.currency || s.currency || 'INR';
  return html`<article class="s-card" data-id="${s.id}">
    <a class="open" href="dashboard.html?s=${s.id}">
      <h3>${s.name}</h3>
      ${st.slices && st.slices.length ? html`<div class="s-bar" aria-hidden="true">${st.slices.map((x) => html`<i style="width:${x.pct}%;background:${x.color}"></i>`)}</div>` : ''}
      <div class="meta">
        <div>Last updated <b>${F.dateTime(s.updatedAt)}</b></div>
        <div>${F.plural(st.holders || 0, 'shareholder')} · ${F.int(st.total || 0)} shares${st.waiting ? ' · ' + F.plural(st.waiting, 'waiting deal') : ''}</div>
        <div>${st.post ? 'Post-money ' + F.compact(st.post, cur) + (st.price ? ' · ' + F.price(st.price, cur) + ' a share' : '') : 'Not priced yet'}</div>
        <div class="faint xs">Created ${F.dateTime(s.createdAt)} · ${F.plural(st.events || 1, 'event')}</div>
      </div>
    </a>
    <div class="foot">
      <a class="btn sm" href="dashboard.html?s=${s.id}">Open</a>
      <a class="btn sm ghost" href="archive.html?s=${s.id}">Archive</a>
      <button class="btn sm ghost right" data-del="${s.id}" style="color:var(--neg)">Delete</button>
    </div>
  </article>`;
}

function render() {
  const n = startups.length;
  sub.textContent = n ? `${n} ${n === 1 ? 'startup' : 'startups'}, most recently changed first` : 'Nothing here yet';
  if (!n) {
    mount(list, html`<div class="card empty" style="grid-column:1/-1">
      <h2>Create your first startup</h2>
      <p>It starts with sensible placeholders: ₹10,00,000 authorised capital, ₹10 face value and one founder with 1,000 shares. Change anything on the next screen.</p>
      <button class="btn primary lg" id="create2">Create startup</button>
    </div>`);
    $('#create2').addEventListener('click', create);
    return;
  }
  mount(list, [startups.map(card), html`<button class="s-card s-new" id="create3">+ Create startup</button>`]);
  $('#create3').addEventListener('click', create);
}

function uniqueName() {
  const names = new Set(startups.map((s) => s.name));
  if (!names.has('New startup')) return 'New startup';
  let i = 2;
  while (names.has('New startup ' + i)) i++;
  return 'New startup ' + i;
}

async function create() {
  createBtn.disabled = true;
  const prev = createBtn.textContent;
  createBtn.textContent = 'Creating…';
  try {
    const setup = defaultSetup(uniqueName());
    const now = Date.now();
    const ev = incorporationEvent(setup, null, now);
    const st = replay([ev]);
    const doc = { id: newId(), name: setup.name, createdAt: now, updatedAt: now, currency: 'INR', stats: startupStats(st, 1) };
    await createStartup(user.uid, doc, [ev]);
    location.href = 'dashboard.html?s=' + doc.id;
  } catch (e) {
    console.error(e);
    toast('Could not create the startup: ' + (e.code || e.message), 'bad');
    createBtn.disabled = false;
    createBtn.textContent = prev;
  }
}
createBtn.addEventListener('click', create);

list.addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const s = startups.find((x) => x.id === b.dataset.del);
  if (s) askDelete(s);
});

function askDelete(s) {
  const m = openModal({
    title: 'Delete this startup?',
    body: html`
      <div class="alert bad"><div class="grow">This permanently deletes <b>${s.name}</b>, its cap table and its whole history. It cannot be undone.</div></div>
      <div class="field"><label for="confirm-name">Type the startup name to confirm</label>
        <input id="confirm-name" type="text" autocomplete="off" placeholder="${s.name}" />
        <span class="hint">Type exactly: <b>${s.name}</b></span></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Delete startup',
        kind: 'danger',
        onClick: async (h) => {
          const btn = h.btn(1);
          btn.disabled = true;
          btn.textContent = 'Deleting…';
          try {
            await deleteStartup(user.uid, s.id);
            startups = startups.filter((x) => x.id !== s.id);
            h.close();
            render();
            toast('Deleted ' + s.name, 'good');
          } catch (e) {
            console.error(e);
            toast('Could not delete: ' + (e.code || e.message), 'bad');
            btn.disabled = false;
            btn.textContent = 'Delete startup';
          }
        },
      },
    ],
  });
  const input = m.$('#confirm-name');
  const del = m.btn(1);
  del.disabled = true;
  input.addEventListener('input', () => (del.disabled = input.value.trim() !== s.name));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !del.disabled) del.click();
  });
}

load();
