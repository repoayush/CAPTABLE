/* Quick calc: public, in percentages, nothing saved. */
import { watchAuth, withTimeout } from './backend.js';
import { mountTopbar, html, mount, $ } from './ui.js';
import * as F from './fmt.js';
import { quickCalc, addYears, todayISO } from './engine.js';
import { ISAFE_TYPES } from './ledger.js';
import { moneyField, pctField, dateField, selectField, parseNum, val, wireMoneyHints } from './forms.js';

let user = null;
try {
  user = await withTimeout(new Promise((res) => watchAuth((u) => res(u))), 2500);
} catch (e) {
  user = null;
}
mountTopbar(user, { active: 'quick' });

const TYPES = [['pct', 'Direct equity (%)'], ['pre', 'Pre-money'], ['post', 'Post-money'], ['isafe', 'iSAFE'], ['note', 'Convertible note']];
let type = 'pct';
const st = {
  amount: '1000000', own: '100', poolPct: '', pct: '10', pre: '9000000', post: '10000000',
  isafeType: 'cap_discount', cap: '5000000', discount: '20', rate: '12', date: todayISO(), maturity: addYears(todayISO(), 10), assumedPre: '', nextDate: '',
};

function drawTypes() {
  mount($('#types'), TYPES.map(([k, l]) => html`<button type="button" data-t="${k}" aria-pressed="${String(k === type)}">${l}</button>`));
}
function drawCommon() {
  mount($('#common'), html`
    ${moneyField('q-amount', 'Investment amount', st.amount, { words: true })}
    ${pctField('q-own', 'Your ownership today', st.own, { hint: 'All the founders together. 100% if you own it all.' })}`);
}
function drawFields() {
  let h;
  if (type === 'pct') h = html`${pctField('q-pct', 'Equity the investor wants', st.pct, { hint: 'Up to 99%.' })}${pctField('q-pool', 'Option pool they ask for (optional)', st.poolPct, { hint: 'Taken out of your share, before they put money in.' })}`;
  else if (type === 'pre') h = html`${moneyField('q-pre', 'Pre-money valuation', st.pre, { words: true })}${pctField('q-pool', 'Option pool they ask for (optional)', st.poolPct)}`;
  else if (type === 'post') h = html`${moneyField('q-post', 'Post-money valuation', st.post, { words: true })}${pctField('q-pool', 'Option pool they ask for (optional)', st.poolPct)}`;
  else if (type === 'isafe') {
    const capNeeded = ['cap_discount', 'cap'].includes(st.isafeType);
    const discNeeded = ['cap_discount', 'discount'].includes(st.isafeType);
    h = html`${selectField('q-itype', 'iSAFE type', Object.entries(ISAFE_TYPES).map(([k, l]) => ({ v: k, l })), st.isafeType)}
      <div class="cols2">${capNeeded ? moneyField('q-cap', 'Post-money valuation cap', st.cap, { words: true }) : ''}${discNeeded ? pctField('q-disc', 'Discount', st.discount) : ''}</div>
      ${st.isafeType === 'cap' ? '' : html`<div class="cols2">${moneyField('q-assumed', 'Assume the next round is priced at (pre-money)', st.assumedPre, { words: true, hint: 'Needed to see how many shares it becomes.' })}${dateField('q-next', 'Next round date (optional)', st.nextDate)}</div>`}`;
  } else {
    h = html`<div class="cols2">${pctField('q-rate', 'Interest per year (simple)', st.rate)}${pctField('q-disc', 'Discount (optional)', st.discount)}</div>
      <div class="cols2">${moneyField('q-cap', 'Valuation cap (optional)', st.cap, { words: true })}${moneyField('q-assumed', 'Assume the next round is priced at (pre-money)', st.assumedPre, { words: true })}</div>
      <div class="cols3">${dateField('q-date', 'Issue date', st.date)}${dateField('q-mat', 'Maturity date', st.maturity)}${dateField('q-next', 'Next round date', st.nextDate)}</div>`;
  }
  mount($('#fields'), h);
}

function read() {
  const g = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };
  const set = (id, k) => {
    const v = g(id);
    if (v != null) st[k] = v;
  };
  set('q-amount', 'amount'); set('q-own', 'own'); set('q-pct', 'pct'); set('q-pool', 'poolPct'); set('q-pre', 'pre'); set('q-post', 'post');
  set('q-itype', 'isafeType'); set('q-cap', 'cap'); set('q-disc', 'discount'); set('q-rate', 'rate'); set('q-assumed', 'assumedPre');
  set('q-date', 'date'); set('q-mat', 'maturity'); set('q-next', 'nextDate');
}

const n = (s) => (s === '' || s == null ? '' : parseNum(s));
function result() {
  const inp = { type, amount: n(st.amount), own: n(st.own), poolPct: n(st.poolPct) || 0 };
  if (type === 'pct') inp.pct = n(st.pct);
  if (type === 'pre') inp.pre = n(st.pre);
  if (type === 'post') inp.post = n(st.post);
  if (type === 'isafe' || type === 'note') {
    inp.isafeType = st.isafeType;
    inp.cap = n(st.cap) || null;
    inp.discount = n(st.discount) || 0;
    inp.rate = n(st.rate) || 0;
    inp.date = st.date || todayISO();
    inp.maturity = st.maturity || addYears(inp.date, 10);
    inp.assumedPre = n(st.assumedPre) || 0;
    inp.nextDate = st.nextDate || '';
  }
  return quickCalc(inp);
}

const tile = (k, v, s = '') => html`<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div>${s ? html`<div class="s">${s}</div>` : ''}</div>`;
function bar(before, after) {
  const b = Math.max(0, Math.min(100, before));
  const a = Math.max(0, Math.min(100, after));
  return html`<div>
    <div class="lbl">Your slice of the company</div>
    <div class="stackbar" style="max-width:none;background:var(--line-2);margin-top:6px;height:22px"><i style="width:${a}%;background:var(--ink)"></i><i style="width:${Math.max(0, b - a)}%;background:var(--accent)"></i></div>
    <div class="stack-caps" style="color:var(--muted);max-width:none"><span>Now ${F.pct(before)}</span><span>After ${F.pct(after)}</span></div>
  </div>`;
}

function draw() {
  const r = result();
  const out = [];
  if (!r.ok) {
    out.push(html`<div class="alert warn"><div class="grow">${r.errors.length ? r.errors.map((e) => html`<div>${e}</div>`) : 'Fill in the offer on the left.'}</div></div>`);
  } else if (r.kind === 'priced') {
    out.push(html`<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      ${tile('Pre-money valuation', F.money(r.pre), 'Before the new money')}
      ${tile('Post-money valuation', F.money(r.post), 'After the new money')}
      ${tile('Investor gets', F.pct(r.investorPct), 'Of the company after the round')}
      ${tile('You keep', F.pct(r.yoursAfter), `Down from ${F.pct(r.yoursBefore)}`)}</div>`);
    out.push(bar(r.yoursBefore, r.yoursAfter));
    out.push(html`<div class="alert info"><div class="grow">You give up <b>${r.lost.toFixed(2)} percentage points</b>.${r.poolPct ? ` The ${F.pct2(r.poolPct)} option pool is counted before the investor, so it comes out of existing owners only.` : ''} Everyone who owned the company before shares the remaining <b>${F.pct(r.existingAfter)}</b>.</div></div>`);
  } else if (r.kind === 'capOnly') {
    out.push(html`<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      ${tile('Investor gets', F.pct(r.investorPct), `Exactly ${r.exactStakePct.toFixed(4)}% before whole-share rounding`)}
      ${tile('You keep', F.pct(r.yoursAfter), `Down from ${F.pct(r.yoursBefore)}`)}</div>`);
    out.push(bar(r.yoursBefore, r.yoursAfter));
    out.push(html`<div class="alert info"><div class="grow">A Valuation Cap only iSAFE is a <b>day-one holding</b>: the investor becomes a shareholder at once, for amount ÷ cap of the company. There is no waiting for a priced round.</div></div>`);
  } else if (r.kind === 'preview') {
    const c = r.conversion;
    out.push(html`<div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr));margin:0">
      ${tile('It converts at', c.route, `Assuming a ${F.compact(r.assumedPre)} pre-money round`)}
      ${tile('Holder gets', F.pct(r.investorPct), 'Of the company after that round')}
      ${tile('You keep', F.pct(r.yoursAfter), `Down from ${F.pct(r.yoursBefore)}`)}
      ${tile('Amount counted', F.money(c.accrued), c.days ? `Includes ${F.money(c.interest)} interest over ${c.days} days` : 'No interest')}</div>`);
    out.push(bar(r.yoursBefore, r.yoursAfter));
    out.push(html`<div class="alert info"><div class="grow">This is a preview of one future round, with no other deals and no new pool. The real result depends on the round that actually happens.</div></div>`);
  } else {
    out.push(html`<div class="alert info"><div class="grow">The terms are valid. Enter an assumed pre-money for the next priced round to see what this would turn into.</div></div>`);
  }
  mount($('#out'), out);
}

function onInput() {
  read();
  wireMoneyHints(document, 'INR');
  draw();
}

function full() {
  drawTypes();
  drawCommon();
  drawFields();
  wireMoneyHints(document, 'INR');
  draw();
}

$('#types').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  read();
  type = b.dataset.t;
  full();
});
document.querySelector('main').addEventListener('input', onInput);
document.querySelector('main').addEventListener('change', (e) => {
  if (e.target.id === 'q-itype') {
    read();
    drawFields();
    wireMoneyHints(document, 'INR');
    draw();
  }
});
full();
