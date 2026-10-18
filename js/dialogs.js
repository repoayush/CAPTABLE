/* Every pop-up on the dashboard. Each dialog shows a live preview and, on confirm,
 * hands a finished event (or offer) back to the page through `ctx`. */
import { html, raw, mount, openModal } from './ui.js';
import * as F from './fmt.js';
import {
  Q, newId, ROLES, totalShares, issuedShares, activeHolders, resolveTransfer, resolvePool, splitProblems, replay,
  convertInstrument, accrual, addYears, todayISO, isISO, r2, colorFor, computeRound,
} from './engine.js';
import {
  buildDraft, ISAFE_TYPES, holderFrom, issueEvent, transferEvent, splitEvent, poolEvent, authEvent, lockinEvent, holderEditEvent, convertEvent, cancelEvent,
} from './ledger.js';
import { parseNum, textField, moneyField, pctField, intField, dateField, selectField, checkField, switchField, wireMoneyHints, val, num, checked, setVal } from './forms.js';
import { settlementClause } from './views.js';

/** "Investor 1", "Investor 2" ... the lowest number not used by a shareholder or another offer */
function nextInvestorName(st, offers, ignoreId) {
  const used = new Set(Object.values(st.holders).map((h) => h.name));
  offers.forEach((o) => o.id !== ignoreId && o.name && used.add(o.name));
  let i = 1;
  while (used.has('Investor ' + i)) i++;
  return 'Investor ' + i;
}
const fin = (x) => (Number.isFinite(x) ? x : null);

const held = (h) => h.eq + h.pref;
const holdersOf = (st) => activeHolders(st);
const pctOf = (n, total) => (total ? (n / total) * 100 : 0);

function beforeAfter(rows) {
  // rows: [{name, color, before, after, bTotal, aTotal}]
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Shareholder</th><th class="num">Shares before</th><th class="num">Shares after</th><th class="num">Ownership before</th><th class="num">Ownership after</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr>
      <td><div class="who"><span class="swatch" style="background:${r.color}"></span><b>${r.name}</b></div></td>
      <td class="num">${F.int(r.before)}</td><td class="num">${F.int(r.after)}</td>
      <td class="num">${F.pct(pctOf(r.before, r.bTotal))}</td><td class="num">${F.pct(pctOf(r.after, r.aTotal))}</td></tr>`)}</tbody></table></div>`;
}

const holderOptions = (st, { exclude = null, withPool = false } = {}) =>
  holdersOf(st).filter((h) => h.id !== exclude).map((h) => ({ v: h.id, l: `${h.name} (${F.int(held(h))} shares, ${F.pct(pctOf(held(h), totalShares(st)))})` }));

/* ================================================================== */
/* Add or edit an investor                                            */
/* ================================================================== */
export function dlgInvestor(ctx, editing = null) {
  const { st } = ctx.base();
  const base = st.currency;
  const sym = F.symbolOf(base);
  const offers = ctx.offers();
  const idx = editing ? offers.findIndex((o) => o.id === editing.id) : offers.length;
  const pricedBefore = offers.slice(0, idx).filter((o) => o.type === 'priced');
  const first = pricedBefore[0];
  const defName = editing && editing.name && /^Investor \d+$/.test(editing.name) ? editing.name : nextInvestorName(st, offers, editing && editing.id);
  const today = todayISO();

  const tabs = pricedBefore.length
    ? [['same', 'Priced equity, same price'], ['isafe', 'iSAFE (post-money cap)'], ['note', 'Convertible note (pre-money cap)']]
    : [['pct', 'Direct equity (%)'], ['pre', 'Priced · pre-money'], ['post', 'Priced · post-money'], ['shares', 'Shares × price'], ['isafe', 'iSAFE (post-money cap)'], ['note', 'Convertible note (pre-money cap)']];

  const e = editing || {};
  let v = {
    tab: e.uiTab && tabs.some((t) => t[0] === e.uiTab) ? e.uiTab : tabs[0][0],
    name: e.name ?? '',
    existing: e.existingHolderId || '',
    cur: e.currency ? e.currency.code : base,
    rate: e.currency ? String(e.currency.rate) : '',
    amount: e.amountOriginal != null ? String(e.amountOriginal) : '1000000',
    pct: e.pct != null ? String(e.pct) : '10',
    pre: e.pre != null ? String(e.pre) : '9000000',
    post: e.post != null ? String(e.post) : '10000000',
    shares: e.shares != null ? String(e.shares) : '1000',
    price: e.price != null ? String(e.price) : String(st.lastPrice || st.faceValue),
    itype: e.isafeType || 'cap_discount',
    cap: e.cap != null ? String(e.cap) : '',
    disc: e.discountPct != null ? String(e.discountPct) : '20',
    angel: !!e.angel,
    date: e.date || e.issueDate || today,
    rateN: e.ratePct != null ? String(e.ratePct) : '0',
    maturity: e.maturityDate || addYears(e.issueDate || today, 10),
    ncap: e.cap != null && e.type === 'note' ? String(e.cap) : '',
    ndisc: e.type === 'note' && e.discountPct ? String(e.discountPct) : '',
  };
  if (e.type === 'isafe' && e.cap != null) v.cap = String(e.cap);
  if (e.type === 'isafe' && e.discountPct != null) v.disc = String(e.discountPct);
  if (e.type === 'note' && e.currency == null) v.amount = String(e.amountOriginal ?? e.amount);

  const body = () => html`
    <div class="seg" role="group" aria-label="Deal type">${tabs.map(([k, l]) => html`<button type="button" data-tab="${k}" aria-pressed="${String(k === v.tab)}">${l}</button>`)}</div>
    <div class="cols2">
      ${textField('i-name', 'Investor name', v.name, { placeholder: defName, hint: 'Left empty, the app calls them ' + defName + '.' })}
      ${selectField('i-existing', 'Is this an existing shareholder?', [{ v: '', l: 'No, a new investor' }, ...holderOptions(st)], v.existing)}
    </div>
    <div class="cols2">
      ${selectField('i-cur', 'Currency of the offer', F.CURRENCIES.map((c) => ({ v: c.code, l: `${c.symbol.trim()} ${c.code}` })), v.cur)}
      ${v.cur !== base ? moneyField('i-rate', `Exchange rate: 1 ${v.cur} = ${base}`, v.rate, { sym, hint: 'Typed by you and frozen on this deal. It is never refreshed.' }) : html`<div></div>`}
    </div>
    <div id="i-fields">${fields()}</div>
    <div id="i-preview" aria-live="polite"></div>`;

  const cs = () => (v.cur === base ? sym : F.symbolOf(v.cur));
  function fields() {
    const s = cs();
    const t = v.tab;
    if (t === 'pct') return html`<div class="cols2">${moneyField('i-amount', 'Investment amount', v.amount, { sym: s, words: v.cur === 'INR' })}${pctField('i-pct', 'Equity offered', v.pct, { hint: 'Up to 99%. A full 100% is a buy-out, not a funding round.' })}</div>`;
    if (t === 'pre') return html`<div class="cols2">${moneyField('i-amount', 'Investment amount', v.amount, { sym: s, words: v.cur === 'INR' })}${moneyField('i-pre', 'Pre-money valuation', v.pre, { sym: s, words: v.cur === 'INR' })}</div>`;
    if (t === 'post') return html`<div class="cols2">${moneyField('i-amount', 'Investment amount', v.amount, { sym: s, words: v.cur === 'INR' })}${moneyField('i-post', 'Post-money valuation', v.post, { sym: s, words: v.cur === 'INR' })}</div>`;
    if (t === 'shares') return html`<div class="cols2">${intField('i-shares', 'Number of shares', v.shares)}${moneyField('i-price', 'Price per share', v.price, { sym: s })}</div><p class="hint small muted" style="margin:0" id="i-sp"></p>`;
    if (t === 'same') return html`${moneyField('i-amount', 'Investment amount', v.amount, { sym: s, words: v.cur === 'INR' })}<div class="alert info"><div class="grow">This investor buys at the same price per share as <b>${first ? first.name || 'the first investor' : 'the first investor'}</b>. Only the amount is needed. The stake follows from that price.</div></div>`;
    if (t === 'isafe') {
      const capNeeded = ['cap_discount', 'cap'].includes(v.itype);
      const discNeeded = ['cap_discount', 'discount'].includes(v.itype);
      return html`
        ${selectField('i-itype', 'iSAFE type', Object.entries(ISAFE_TYPES).map(([k, l]) => ({ v: k, l })), v.itype, { cap_discount: 'Converts at the first priced round at the better of the cap price or the discount price.', cap: 'A day-one holding: preference shares for a fixed stake.', discount: 'Converts at the round price less the discount.', mfn: 'Converts at the lowest price in the round, no discount.' }[v.itype])}
        <div class="cols2">${moneyField('i-amount', 'Investment amount', v.amount, { sym: s, words: v.cur === 'INR' })}${dateField('i-date', 'Allotment date', v.date, 'The 3-year expiry and 1-year lock-in count from here.')}</div>
        <div class="cols2">
          ${capNeeded ? moneyField('i-cap', 'Post-money valuation cap', v.cap, { sym: s, words: v.cur === 'INR', hint: 'Must be more than the investment.' }) : ''}
          ${discNeeded ? pctField('i-disc', 'Discount', v.disc, { hint: 'A 20% discount is a Discount Rate of 80%.' }) : ''}
        </div>
        ${v.itype !== 'cap' ? switchField('i-angel', 'Investor is an Angel Fund (1-year lock-in)', v.angel) : ''}`;
    }
    return html`
      <div class="cols2">${moneyField('i-amount', 'Principal', v.amount, { sym: s, words: v.cur === 'INR', hint: 'Indian rule: at least ₹25 lakh per investor per tranche.' })}${pctField('i-rate-n', 'Interest per year (simple)', v.rateN)}</div>
      <div class="cols2">${pctField('i-ndisc', 'Discount (optional)', v.ndisc, { hint: 'Off the next round\'s price.' })}${moneyField('i-ncap', 'Valuation cap (optional)', v.ncap, { sym: s, words: v.cur === 'INR', hint: 'Treated as a pre-money cap.' })}</div>
      <div class="cols2">${dateField('i-date', 'Issue date', v.date, 'Interest counts from here.')}${dateField('i-mat', 'Maturity date', v.maturity, 'Converts or is repaid by then. Default 10 years.')}</div>`;
  }

  function read(m) {
    v.name = val(m.el, 'i-name');
    v.existing = val(m.el, 'i-existing');
    v.cur = val(m.el, 'i-cur') || v.cur;
    if (m.$('#i-rate')) v.rate = val(m.el, 'i-rate');
    const g = (id, key) => {
      if (m.$('#' + id)) v[key] = val(m.el, id);
    };
    g('i-amount', 'amount'); g('i-pct', 'pct'); g('i-pre', 'pre'); g('i-post', 'post'); g('i-shares', 'shares'); g('i-price', 'price');
    g('i-itype', 'itype'); g('i-cap', 'cap'); g('i-disc', 'disc'); g('i-date', 'date'); g('i-rate-n', 'rateN'); g('i-ndisc', 'ndisc'); g('i-ncap', 'ncap'); g('i-mat', 'maturity');
    if (m.$('#i-angel')) v.angel = checked(m.el, 'i-angel');
  }

  function toOffer() {
    const rate = v.cur !== base ? fin(parseNum(v.rate)) : null;
    const o = {
      id: editing ? editing.id : newId(),
      holderId: editing ? editing.holderId : newId(),
      name: v.name.trim() || (v.existing ? '' : defName),
      existingHolderId: v.existing || null,
      uiTab: v.tab,
      currency: v.cur !== base ? { code: v.cur, rate } : null,
    };
    const n = (s) => fin(parseNum(s));
    if (['pct', 'pre', 'post', 'shares', 'same'].includes(v.tab)) {
      o.type = 'priced';
      o.mode = v.tab === 'same' ? 'same' : v.tab;
      o.pct = v.tab === 'pct' ? n(v.pct) : null;
      o.pre = v.tab === 'pre' ? n(v.pre) : null;
      o.post = v.tab === 'post' ? n(v.post) : null;
      if (v.tab === 'shares') {
        const sh = n(v.shares);
        o.shares = sh == null ? null : Math.trunc(sh);
        o.price = n(v.price);
        o.amountOriginal = o.shares && o.price ? o.shares * o.price : null;
        o.amount = o.amountOriginal;
      } else {
        o.amount = n(v.amount);
        o.amountOriginal = o.amount;
      }
    } else if (v.tab === 'isafe') {
      o.type = 'isafe';
      o.isafeType = v.itype;
      o.amount = n(v.amount); o.amountOriginal = o.amount;
      o.cap = ['cap_discount', 'cap'].includes(v.itype) ? n(v.cap) : null;
      o.discountPct = ['cap_discount', 'discount'].includes(v.itype) ? n(v.disc) || 0 : 0;
      o.angel = v.itype !== 'cap' && v.angel;
      o.date = v.date;
    } else {
      o.type = 'note';
      o.amount = n(v.amount); o.amountOriginal = o.amount;
      o.ratePct = n(v.rateN) || 0;
      o.discountPct = n(v.ndisc) || 0;
      o.cap = n(v.ncap) || null;
      o.issueDate = v.date;
      o.maturityDate = v.maturity;
    }
    return o;
  }

  const m = openModal({
    title: editing ? 'Edit investor' : 'Add investor',
    wide: true,
    body: body(),
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: editing ? 'Save investor' : 'Add to deal',
        kind: 'primary',
        onClick: (h) => {
          read(h);
          const o = toOffer();
          ctx.setOffers(editing ? offers.map((x) => (x.id === editing.id ? o : x)) : [...offers, o]);
          h.close();
          ctx.refresh();
        },
      },
    ],
  });
  const add = m.btn(1);

  function preview() {
    read(m);
    wireMoneyHints(m.el, v.cur);
    const o = toOffer();
    if (v.cur !== base && !(parseNum(v.rate) > 0)) {
      mount(m.$('#i-preview'), html`<div class="alert warn"><div class="grow">Enter a valid exchange rate.</div></div>`);
      add.disabled = true;
      return;
    }
    const trial = editing ? offers.map((x) => (x.id === editing.id ? o : x)) : [...offers, o];
    let d;
    let own;
    try {
      d = buildDraft(ctx.base().events, trial, ctx.roundOpts());
      const others = editing ? offers.filter((x) => x.id !== editing.id) : offers;
      const known = new Set(buildDraft(ctx.base().events, others, ctx.roundOpts()).errors);
      own = (d.errors || []).filter((x) => !known.has(x));
    } catch (err) {
      d = { errors: [], warnings: [], events: [] };
      own = ['Check the numbers: ' + err.message];
    }
    const c = base;
    let out = [];
    if (own.length) out.push(html`<div class="alert bad"><div class="grow">${own.map((x) => html`<div>${x}</div>`)}</div></div>`);
    else if (o.type === 'priced' && d.round && d.round.ok) {
      const pj = trial.filter((x) => x.type === 'priced').findIndex((x) => x.id === o.id);
      const r = d.round;
      const inv = r.investors[pj];
      out.push(html`<div class="card" style="box-shadow:none"><div class="card-b">
        <div class="result">
          <div><span>Price per share</span><b>${F.price(r.price, c)}</b></div>
          <div><span>New shares</span><b>${F.int(inv.shares)}</b></div>
          <div><span>Investor pays</span><b>${F.money(inv.paid, c)}</b></div>
          <div><span>Stake after the round</span><b>${F.pct(inv.stakePct)}</b></div>
          <div><span>Pre-money</span><b>${F.money(r.preActual, c)}</b></div>
          <div><span>Post-money</span><b>${F.money(r.postActual, c)}</b></div>
        </div>
        ${inv.unspent > 0.004 ? html`<div style="margin-top:10px">${settlementClause(inv, r.price, c, (o.existingHolderId && st.holders[o.existingHolderId] ? st.holders[o.existingHolderId].name : o.name) || 'the investor')}</div>` : ''}
      </div></div>`);
    } else if (o.type === 'isafe' || o.type === 'note') {
      const ev = d.events.find((x) => x.id === o.id);
      if (ev) out.push(html`<div class="alert info"><div class="grow">${ev.summary}</div></div>`);
    }
    if (d.warnings.length) out.push(d.warnings.map((w) => html`<div class="alert warn"><div class="grow">${w}</div></div>`));
    mount(m.$('#i-preview'), out);
    const sp = m.$('#i-sp');
    if (sp) {
      const t = parseNum(v.shares) * parseNum(v.price);
      sp.textContent = Number.isFinite(t) ? `Amount = ${F.money(t, v.cur)}` : '';
    }
    add.disabled = own.length > 0;
  }

  m.el.addEventListener('input', preview);
  m.el.addEventListener('change', (ev) => {
    if (ev.target.id === 'i-cur' || ev.target.id === 'i-itype') {
      read(m);
      if (ev.target.id === 'i-cur') {
        mount(m.$('[data-body]'), body());
      } else mount(m.$('#i-fields'), fields());
      preview();
    }
  });
  m.el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (!b) return;
    read(m);
    v.tab = b.dataset.tab;
    mount(m.$('[data-body]'), body());
    preview();
  });
  preview();
}

/* ================================================================== */
/* Transfer shares                                                    */
/* ================================================================== */
export function dlgTransfer(ctx) {
  const { st } = ctx.base();
  const hs = holdersOf(st);
  if (!hs.length) return;
  const total = totalShares(st);
  const c = st.currency;
  const m = openModal({
    title: 'Transfer shares',
    wide: true,
    body: html`
      <p class="muted small" style="margin:0">No new shares are created, so nobody else is diluted and the valuation does not change.</p>
      ${selectField('t-from', 'Seller', holderOptions(st), hs[0].id)}
      ${checkField('t-full', 'Full transfer: the seller sells all their shares and leaves the cap table', false)}
      <div class="cols2" id="t-amt">${intField('t-shares', 'Number of shares', '')}${pctField('t-pct', 'Percentage of the seller\'s shares', '')}</div>
      <div><div class="lbl" style="margin-bottom:6px">Receiver</div>
        <div class="seg" role="group"><button type="button" data-to="existing" aria-pressed="false">Existing shareholder</button><button type="button" data-to="new" aria-pressed="true">New person</button></div></div>
      <div id="t-to"></div>
      <div class="cols2">${moneyField('t-amount', 'Sale amount (optional)', '', { sym: F.symbolOf(c), hint: 'Leave empty for a gift. It is recorded in the history only. It does not set a valuation.' })}${dateField('t-date', 'Effective date', todayISO())}</div>
      <div id="t-preview" aria-live="polite"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add transfer',
        kind: 'primary',
        onClick: (h) => {
          const x = calc();
          if (!x.ok) return;
          ctx.addPending(transferEvent(st, { fromId: x.fromId, to: x.to, shares: x.res.shares, amount: x.amount, date: x.date, full: x.full }));
          h.close();
        },
      },
    ],
  });
  let toMode = 'new';
  const add = m.btn(1);
  const drawTo = () => {
    const from = val(m.el, 't-from');
    mount(m.$('#t-to'), toMode === 'existing'
      ? selectField('t-existing', 'Receiver', holderOptions(st, { exclude: from }), (holderOptions(st, { exclude: from })[0] || {}).v)
      : html`<div class="cols2">${textField('t-newname', 'Name of the new shareholder', '')}${textField('t-newdes', 'Designation', 'Shareholder')}</div>`);
  };
  drawTo();
  function calc() {
    const fromId = val(m.el, 't-from');
    const full = checked(m.el, 't-full');
    const from = st.holders[fromId];
    const sh = val(m.el, 't-shares');
    const pc = val(m.el, 't-pct');
    const date = val(m.el, 't-date');
    const amount = num(m.el, 't-amount');
    const res = resolveTransfer(st, { fromId, full, shares: sh === '' ? null : parseNum(sh), pct: pc === '' ? null : parseNum(pc) });
    let to;
    let err = null;
    if (!res.ok) err = res.error;
    if (toMode === 'existing') {
      const id = val(m.el, 't-existing');
      if (!id) err = err || 'Choose the receiver.';
      else to = holderFrom(st, { existingId: id });
    } else {
      const name = val(m.el, 't-newname').trim();
      if (!name) err = err || 'Enter the new shareholder\'s name.';
      else to = holderFrom(st, { name, designation: val(m.el, 't-newdes').trim() || 'Shareholder', role: 'shareholder' });
    }
    if (!isISO(date)) err = err || 'Choose a valid date.';
    return { ok: !err, err, res, to, from, fromId, full, date, amount: Number.isFinite(amount) && amount > 0 ? amount : null };
  }
  function preview(src) {
    const fromId = val(m.el, 't-from');
    const from = st.holders[fromId];
    const full = checked(m.el, 't-full');
    m.$('#t-amt').classList.toggle('hide', full);
    const held0 = held(from);
    if (!full && src === 't-shares') {
      const n = parseNum(val(m.el, 't-shares'));
      setVal(m.el, 't-pct', Number.isFinite(n) ? String(+((n / held0) * 100).toFixed(4)) : '');
    } else if (!full && src === 't-pct') {
      const p = parseNum(val(m.el, 't-pct'));
      setVal(m.el, 't-shares', Number.isFinite(p) ? String(Number(new Q(BigInt(held0)).mul(Q.of(p)).div(100).round())) : '');
    }
    wireMoneyHints(m.el, c);
    const x = calc();
    const out = [];
    if (x.err && (full || val(m.el, 't-shares') || val(m.el, 't-pct'))) out.push(html`<div class="alert warn"><div class="grow">${x.err}</div></div>`);
    if (x.res.ok) {
      const toBefore = x.to && st.holders[x.to.id] ? held(st.holders[x.to.id]) : 0;
      const rows = [
        { name: from.name, color: colorFor(from.colorIdx), before: held0, after: held0 - x.res.shares, bTotal: total, aTotal: total },
        { name: x.to ? x.to.name : 'Receiver', color: x.to ? colorFor(x.to.colorIdx) : '#ccc', before: toBefore, after: toBefore + x.res.shares, bTotal: total, aTotal: total },
      ];
      out.push(html`<div class="alert info"><div class="grow"><b>${F.int(x.res.shares)} shares</b> = ${F.pct2(x.res.ofHoldingPct)} of ${from.name}'s holding and ${F.pct(x.res.ofCompanyPct)} of the company. Dilution of everyone else: <b>0%</b>.${x.res.fullExit ? ` ${from.name} leaves the active cap table (the history is kept).` : ''}</div></div>`, beforeAfter(rows));
      const lock = st.lockins.find((l) => l.holderId === fromId && x.date && l.until >= x.date && l.from <= x.date);
      if (lock) out.push(html`<div class="alert warn"><div class="grow"><b>Lock-in.</b> ${from.name} agreed not to sell until ${F.date(lock.until)} (${lock.scope}). The app only warns. Check the shareholders' agreement before you go ahead.</div></div>`);
    }
    mount(m.$('#t-preview'), out);
    add.disabled = !x.ok;
  }
  m.el.addEventListener('input', (e) => preview(e.target.id));
  m.el.addEventListener('change', (e) => {
    if (e.target.id === 't-from') {
      drawTo();
      setVal(m.el, 't-shares', '');
      setVal(m.el, 't-pct', '');
    }
    preview(e.target.id);
  });
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-to]');
    if (!b) return;
    toMode = b.dataset.to;
    m.$$('[data-to]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawTo();
    preview('');
  });
  preview('');
}

/* ================================================================== */
/* Split                                                              */
/* ================================================================== */
export function dlgSplit(ctx) {
  const { st } = ctx.base();
  const c = st.currency;
  const m = openModal({
    title: 'Split shares',
    wide: true,
    body: html`
      <p class="muted small" style="margin:0">A split cuts every share into smaller ones. Issued and unissued (authorised) shares both change. Nobody's ownership changes and no money moves.</p>
      <div class="btn-row">${[[1, 2], [1, 5], [1, 10], [1, 100], [10, 1]].map(([a, b]) => html`<button type="button" class="btn sm" data-p="${a},${b}">${a} → ${b}${b < a ? ' (reverse)' : ''}</button>`)}</div>
      <div class="cols2">${intField('s-a', 'Old shares …', '1')}${intField('s-b', '… become this many new shares', '10')}</div>
      ${dateField('s-date', 'Effective date', todayISO())}
      <div id="s-preview" aria-live="polite"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add split',
        kind: 'primary',
        onClick: (h) => {
          const a = Math.trunc(num(h.el, 's-a'));
          const b = Math.trunc(num(h.el, 's-b'));
          ctx.addPending(splitEvent(st, { a, b, date: val(h.el, 's-date') }));
          h.close();
        },
      },
    ],
  });
  const add = m.btn(1);
  function preview() {
    const a = Math.trunc(num(m.el, 's-a'));
    const b = Math.trunc(num(m.el, 's-b'));
    const date = val(m.el, 's-date');
    const out = [];
    let ok = a >= 1 && b >= 1 && a !== b && isISO(date);
    if (!(a >= 1 && b >= 1)) out.push(html`<div class="alert warn"><div class="grow">Both numbers must be whole numbers above 0.</div></div>`);
    else if (a === b) out.push(html`<div class="alert warn"><div class="grow">The two numbers are the same, so nothing would change.</div></div>`);
    if (a >= 1 && b >= 1 && a !== b) {
      const bad = splitProblems(st, a, b);
      if (bad.length) {
        ok = false;
        out.push(html`<div class="alert bad"><div class="grow"><b>This split leaves a fraction of a share</b> for ${bad.join(', ')}. A share cannot be split. Choose a ratio that divides everyone's shares exactly.</div></div>`);
      } else {
        const mul = (n) => Number(new Q(BigInt(n)).mul(b).div(a).floor());
        const hs = holdersOf(st);
        const issuedB = issuedShares(st);
        const issuedA = mul(issuedB);
        const poolA = mul(st.pool);
        const authA = mul(st.authShares);
        const fvA = new Q(1n).mul(st.faceValue).mul(a).div(b).toNumber();
        out.push(html`<div class="result">
          <div><span>Issued shares</span><b>${F.int(issuedB)} → ${F.int(issuedA)}</b></div>
          <div><span>Option pool</span><b>${F.int(st.pool)} → ${F.int(poolA)}</b></div>
          <div><span>Authorised shares (issued + unissued)</span><b>${F.int(st.authShares)} → ${F.int(authA)}</b></div>
          <div><span>Unissued shares</span><b>${F.int(Math.max(0, st.authShares - issuedB - st.pool))} → ${F.int(Math.max(0, authA - issuedA - poolA))}</b></div>
          <div><span>Face value</span><b>${F.price(st.faceValue, c)} → ${F.price(fvA, c)}</b></div>
          <div><span>Authorised capital</span><b>${F.money(st.authCapital, c)} (same)</b></div>
          ${st.lastPrice ? html`<div><span>Last round price per share</span><b>${F.price(st.lastPrice, c)} → ${F.price(new Q(1n).mul(st.lastPrice).mul(a).div(b).toNumber(), c)}</b></div>` : ''}
        </div>`);
        out.push(beforeAfter(hs.map((h) => ({ name: h.name, color: colorFor(h.colorIdx), before: held(h), after: mul(held(h)), bTotal: totalShares(st), aTotal: mul(totalShares(st)) }))));
      }
    }
    mount(m.$('#s-preview'), out);
    add.disabled = !ok;
  }
  m.el.addEventListener('input', preview);
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const [a, bb] = b.dataset.p.split(',');
    setVal(m.el, 's-a', a);
    setVal(m.el, 's-b', bb);
    preview();
  });
  preview();
}

/* ================================================================== */
/* Issue shares (co-founder, advisor, earlier shareholder)             */
/* ================================================================== */
export function dlgIssue(ctx) {
  const { st } = ctx.base();
  const c = st.currency;
  const total = totalShares(st);
  const m = openModal({
    title: 'Issue shares',
    wide: true,
    body: html`
      <p class="muted small" style="margin:0">New shares dilute everyone. To give a new co-founder a stake without diluting each other, transfer shares instead.</p>
      <div class="seg" role="group"><button type="button" data-who="new" aria-pressed="true">New person</button><button type="button" data-who="existing" aria-pressed="false">Existing shareholder</button></div>
      <div id="x-who"></div>
      <div class="cols2">${intField('x-shares', 'Number of shares', '100')}${moneyField('x-price', 'Price per share', String(st.faceValue), { sym: F.symbolOf(c), hint: 'Default is the face value.' })}</div>
      ${dateField('x-date', 'Effective date', todayISO())}
      <div id="x-preview" aria-live="polite"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add share issue',
        kind: 'primary',
        onClick: (h) => {
          const r = calc();
          if (r.err) return;
          ctx.addPending(r.ev);
          h.close();
        },
      },
    ],
  });
  let mode = 'new';
  const add = m.btn(1);
  const drawWho = () =>
    mount(m.$('#x-who'), mode === 'existing'
      ? selectField('x-existing', 'Shareholder', holderOptions(st), (holderOptions(st)[0] || {}).v)
      : html`<div class="cols3">${textField('x-name', 'Name', '')}${textField('x-des', 'Designation', 'Co-founder')}${selectField('x-role', 'Role', [{ v: 'cofounder', l: 'Co-founder' }, { v: 'advisor', l: 'Advisor' }, { v: 'investor', l: 'Investor' }, { v: 'other', l: 'Other' }], 'cofounder')}</div>`);
  drawWho();
  function calc() {
    const shares = Math.trunc(num(m.el, 'x-shares'));
    const price = num(m.el, 'x-price');
    const date = val(m.el, 'x-date');
    let holder;
    let err = null;
    if (mode === 'existing') {
      const id = val(m.el, 'x-existing');
      if (!id) err = 'Choose the shareholder.';
      else holder = holderFrom(st, { existingId: id });
    } else {
      const name = val(m.el, 'x-name').trim();
      if (!name) err = 'Enter the name.';
      else holder = holderFrom(st, { name, designation: val(m.el, 'x-des').trim(), role: val(m.el, 'x-role') });
    }
    if (!isISO(date)) err = err || 'Choose a valid date.';
    if (!(shares >= 1)) err = err || 'Shares must be a whole number above 0.';
    if (!(price >= 0)) err = err || 'Enter the price per share.';
    if (err) return { err, holder, shares, price };
    const r = issueEvent(st, { holder, shares, price, date });
    return r.error ? { err: r.error } : { ev: r.event, paid: r.paid, holder, shares, price };
  }
  function preview() {
    wireMoneyHints(m.el, c);
    const r = calc();
    const out = [];
    const shares = Math.trunc(num(m.el, 'x-shares'));
    if (r.err) {
      if (val(m.el, 'x-name') || mode === 'existing') out.push(html`<div class="alert warn"><div class="grow">${r.err}</div></div>`);
    } else {
      const after = total + r.shares;
      const rows = holdersOf(st).map((h) => ({ name: h.name, color: colorFor(h.colorIdx), before: held(h), after: held(h), bTotal: total, aTotal: after }));
      const had = st.holders[r.holder.id] ? held(st.holders[r.holder.id]) : 0;
      if (had) rows.find((x) => x.name === st.holders[r.holder.id].name).after += r.shares;
      else rows.push({ name: r.holder.name, color: colorFor(r.holder.colorIdx), before: 0, after: r.shares, bTotal: total, aTotal: after });
      out.push(html`<div class="alert info"><div class="grow">${r.holder.name} pays <b>${F.money(r.paid, c)}</b> for ${F.int(r.shares)} shares and holds ${F.pct(pctOf(had + r.shares, after))} afterwards. Total shares go from ${F.int(total)} to ${F.int(after)}.</div></div>`, beforeAfter(rows));
      if (after > st.authShares) out.push(html`<div class="alert bad"><div class="grow"><b>More than the authorised shares.</b> You can issue only ${F.int(Math.max(0, st.authShares - total))} more until the authorised capital is increased (Form SH-7).</div></div>`);
    }
    mount(m.$('#x-preview'), out);
    add.disabled = !!r.err;
  }
  m.el.addEventListener('input', preview);
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    mode = b.dataset.who;
    m.$$('[data-who]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawWho();
    preview();
  });
  preview();
}

/* ================================================================== */
/* Option pool                                                        */
/* ================================================================== */
export function dlgPool(ctx) {
  const { st } = ctx.base();
  const total = totalShares(st);
  const cur = total ? (st.pool / total) * 100 : 0;
  const m = openModal({
    title: 'Employee option pool (ESOP)',
    body: html`
      <p class="muted small" style="margin:0">The pool is a block of shares kept for future hires. Nobody owns it yet. It counts when ownership is worked out on a fully diluted basis.</p>
      <div class="btn-row">${[5, 10, 12.5, 15, 20].map((p) => html`<button type="button" class="btn sm" data-p="${p}">${p}%</button>`)}</div>
      <div class="cols2">${pctField('p-target', 'Target pool after the change', cur > 0 ? String(+cur.toFixed(2)) : '10', { hint: 'The pool\'s share of the total, counting the pool itself.' })}${dateField('p-date', 'Effective date', todayISO())}</div>
      <div id="p-preview" aria-live="polite"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add pool change',
        kind: 'primary',
        onClick: (h) => {
          const t = num(h.el, 'p-target');
          const r = resolvePool(st, t);
          if (!r.ok || r.action === 'none') return;
          ctx.addPending(poolEvent(st, { resolved: r, targetPct: t, date: val(h.el, 'p-date') }));
          h.close();
        },
      },
    ],
  });
  const add = m.btn(1);
  function preview() {
    const t = num(m.el, 'p-target');
    const out = [];
    let ok = false;
    if (!(t >= 0 && t < 100)) out.push(html`<div class="alert warn"><div class="grow">Enter a percentage between 0 and 100.</div></div>`);
    else {
      const r = resolvePool(st, t);
      if (r.ok && r.action === 'none') out.push(html`<div class="alert info"><div class="grow">The pool is already at this level.</div></div>`);
      else if (r.ok) {
        ok = isISO(val(m.el, 'p-date'));
        out.push(html`<div class="result">
          <div><span>Action</span><b>${{ create: 'Create the pool', grow: 'Grow the pool', shrink: 'Shrink the pool' }[r.action]}</b></div>
          <div><span>${r.delta < 0 ? 'Shares cancelled' : 'New pool shares'}</span><b>${F.int(Math.abs(r.delta))}</b></div>
          <div><span>Pool shares</span><b>${F.int(st.pool)} → ${F.int(r.poolAfter)}</b></div>
          <div><span>Total shares</span><b>${F.int(total)} → ${F.int(r.totalAfter)}</b></div>
          <div><span>Pool share of company</span><b>${F.pct(pctOf(r.poolAfter, r.totalAfter))}</b></div>
          <div><span>Existing holders after</span><b>${F.pct(pctOf(total - st.pool, r.totalAfter))} (was ${F.pct(pctOf(total - st.pool, total))})</b></div>
        </div>`);
        if (t > 30) out.push(html`<div class="alert warn"><div class="grow">A pool above 30% is unusual. Guides give 10 to 15% at seed and 12 to 18% at Series A. That is market practice, not law.</div></div>`);
        if (r.totalAfter > st.authShares) out.push(html`<div class="alert bad"><div class="grow"><b>More than the authorised shares.</b> Increase the authorised capital (Form SH-7) first or use a smaller pool.</div></div>`);
      } else out.push(html`<div class="alert warn"><div class="grow">${r.error}</div></div>`);
    }
    mount(m.$('#p-preview'), out);
    add.disabled = !ok;
  }
  m.el.addEventListener('input', preview);
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    setVal(m.el, 'p-target', b.dataset.p);
    preview();
  });
  preview();
}

/* ================================================================== */
/* Increase authorised capital (SH-7)                                  */
/* ================================================================== */
export function dlgAuth(ctx, prefill = null) {
  const { st } = ctx.base();
  const c = st.currency;
  const total = totalShares(st);
  const m = openModal({
    title: 'Increase authorised capital (Form SH-7)',
    wide: true,
    body: html`
      <div class="result">
        <div><span>Authorised capital now</span><b>${F.money(st.authCapital, c)}</b></div>
        <div><span>Authorised shares now</span><b>${F.int(st.authShares)}</b></div>
        <div><span>Shares issued + pool</span><b>${F.int(total)}</b></div>
        <div><span>Unissued shares</span><b>${F.int(Math.max(0, st.authShares - total))}</b></div>
      </div>
      ${moneyField('a-add', 'Increase authorised capital by', prefill != null ? String(prefill) : '', { sym: F.symbolOf(c), words: c === 'INR' })}
      <div class="btn-row">
        <button type="button" class="btn sm" data-q="500000">+ ₹5 lakh</button>
        <button type="button" class="btn sm" data-q="1000000">+ ₹10 lakh</button>
        <button type="button" class="btn sm" data-q="auto">Auto-fit (+25% buffer)</button>
      </div>
      ${dateField('a-date', 'Date of the shareholders\' resolution', todayISO())}
      ${textField('a-note', 'Note (optional)', '', { placeholder: 'e.g. Board meeting 12 Oct' })}
      <div id="a-preview" aria-live="polite"></div>
      <details class="math"><summary>What this involves in India</summary><div class="lines small">
        <div>1. Board resolution to propose the increase.</div>
        <div>2. Ordinary resolution of the shareholders (section 61(1)(a) of the Companies Act, 2013). The Articles must allow it.</div>
        <div>3. Amend the capital clause of the Memorandum of Association.</div>
        <div>4. File Form SH-7 with the Registrar within 30 days of the resolution (section 64). A Registrar fee and state stamp duty apply. Late filing costs ₹100 a day.</div>
        <div>5. Shares cannot be allotted beyond the authorised capital until this is approved. Form PAS-3 (return of allotment) cannot be filed before the SH-7 is approved.</div>
        <div class="muted">Your company secretary should confirm the forms, fees and deadlines. The app records the economics and files nothing.</div></div></details>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add increase',
        kind: 'primary',
        onClick: (h) => {
          const add = num(h.el, 'a-add');
          if (!(add > 0)) return;
          ctx.addPending(authEvent(st, { addCapital: add, date: val(h.el, 'a-date'), note: val(h.el, 'a-note') }));
          h.close();
        },
      },
    ],
  });
  const addBtn = m.btn(1);
  function preview() {
    wireMoneyHints(m.el, c);
    const add = num(m.el, 'a-add');
    const out = [];
    let ok = false;
    if (add > 0) {
      const newCap = r2(Q.of(st.authCapital).add(add));
      const newShares = st.authShares + Number(Q.of(add).div(st.faceValue).floor());
      ok = isISO(val(m.el, 'a-date'));
      out.push(html`<div class="alert info"><div class="grow">Authorised capital becomes <b>${F.money(newCap, c)}</b> (${F.int(newShares)} shares at ${F.price(st.faceValue, c)}). Unissued shares: ${F.int(Math.max(0, newShares - total))}.</div></div>`);
    }
    mount(m.$('#a-preview'), out);
    addBtn.disabled = !ok;
  }
  m.el.addEventListener('input', preview);
  m.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]');
    if (!b) return;
    let v = b.dataset.q;
    if (v === 'auto') {
      const needNow = Math.max(total, ctx.neededShares ? ctx.neededShares() : 0);
      const needShares = Math.ceil(needNow * 1.25);
      const needCap = Math.ceil(needShares * st.faceValue);
      v = String(Math.max(0, needCap - st.authCapital));
      if (v === '0') v = '';
    }
    setVal(m.el, 'a-add', v);
    preview();
  });
  preview();
}

/* ================================================================== */
/* Founder lock-in (record and warn)                                   */
/* ================================================================== */
export function dlgLockin(ctx) {
  const { st } = ctx.base();
  const hs = holdersOf(st);
  if (!hs.length) return;
  const m = openModal({
    title: 'Record a lock-in',
    body: html`
      <p class="muted small" style="margin:0">A lock-in is a contract term: the holder agrees not to sell or pledge shares for a set period. CAPTABLE records it and warns on transfers. It cannot stop a sale. Put the clause in both the shareholders' agreement and the Articles.</p>
      ${selectField('l-who', 'Shareholder', holderOptions(st), hs[0].id)}
      <div class="cols2">${dateField('l-start', 'Start date', todayISO(), 'The date of the term sheet or agreement.')}${intField('l-years', 'Duration in years', '5', { hint: 'There is no standard length. Five years is a negotiated figure.' })}</div>
      ${selectField('l-scope', 'Scope', [{ v: 'All shares', l: 'All shares' }, { v: 'Unvested shares', l: 'Unvested shares only' }, { v: 'Part of the holding', l: 'Part of the holding' }], 'All shares')}
      ${textField('l-perm', 'Permitted transfers (optional)', '', { placeholder: 'To a co-founder, to a family trust, or with the investor\'s consent' })}
      ${textField('l-src', 'Source (optional)', '', { placeholder: 'Term sheet, SHA clause number or Articles' })}
      <div id="l-preview"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add lock-in',
        kind: 'primary',
        onClick: (h) => {
          ctx.addPending(lockinEvent(st, { holderId: val(h.el, 'l-who'), startDate: val(h.el, 'l-start'), years: Math.trunc(num(h.el, 'l-years')), scope: val(h.el, 'l-scope'), permitted: val(h.el, 'l-perm').trim(), source: val(h.el, 'l-src').trim() }));
          h.close();
        },
      },
    ],
  });
  const add = m.btn(1);
  function preview() {
    const y = Math.trunc(num(m.el, 'l-years'));
    const s = val(m.el, 'l-start');
    const ok = y >= 1 && y <= 30 && isISO(s);
    mount(m.$('#l-preview'), ok ? html`<div class="alert info"><div class="grow">Locked until <b>${F.date(addYears(s, y))}</b>.</div></div>` : html`<div class="alert warn"><div class="grow">Enter a start date and a duration of 1 to 30 years.</div></div>`);
    add.disabled = !ok;
  }
  m.el.addEventListener('input', preview);
  preview();
}

/* ================================================================== */
/* Edit a shareholder                                                  */
/* ================================================================== */
export function dlgEditHolder(ctx, id = null) {
  const { st } = ctx.base();
  const hs = holdersOf(st);
  if (!hs.length) return;
  const first = st.holders[id] || hs[0];
  const m = openModal({
    title: 'Edit a shareholder',
    body: html`
      ${selectField('h-who', 'Shareholder', holderOptions(st), first.id)}
      <div class="cols2" id="h-fields"></div>
      <p class="muted small" style="margin:0">Their colour never changes, so a person keeps the same colour in every chart.</p>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add edit',
        kind: 'primary',
        onClick: (h) => {
          const name = val(h.el, 'h-name').trim();
          if (!name) return;
          ctx.addPending(holderEditEvent(st, { id: val(h.el, 'h-who'), name, designation: val(h.el, 'h-des').trim(), role: val(h.el, 'h-role'), date: todayISO() }));
          h.close();
        },
      },
    ],
  });
  const draw = () => {
    const h = st.holders[val(m.el, 'h-who')];
    mount(m.$('#h-fields'), html`${textField('h-name', 'Name', h.name)}${textField('h-des', 'Designation', h.designation)}${selectField('h-role', 'Role', Object.entries(ROLES).filter(([k]) => k !== 'pool').map(([k, l]) => ({ v: k, l })), h.role)}`);
  };
  draw();
  m.el.addEventListener('change', (e) => {
    if (e.target.id === 'h-who') draw();
  });
}

/* ================================================================== */
/* Convert a waiting iSAFE or note outside a round                     */
/* ================================================================== */
export function dlgConvert(ctx, instrumentId) {
  const { st } = ctx.base();
  const w = st.waiting.find((x) => x.id === instrumentId);
  if (!w) return;
  const c = st.currency;
  const S0 = issuedShares(st) + st.pool;
  const m = openModal({
    title: `Convert ${w.holder.name}'s ${w.kind === 'note' ? 'note' : 'iSAFE'} to shares`,
    wide: true,
    body: html`
      <p class="muted small" style="margin:0">Use this when a deal expires or matures with no priced round, or when the holder chooses to convert. At a priced round, waiting deals convert on their own.</p>
      ${dateField('c-date', 'Conversion date', todayISO())}
      ${moneyField('c-fmv', 'Fair value per share (valuer\'s price)', String(st.lastPrice || st.faceValue), { sym: F.symbolOf(c), hint: 'For an expired iSAFE the company\'s independent valuer sets this. Cap + Discount and notes use it as the round price.' })}
      <div id="c-preview" aria-live="polite"></div>`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      {
        label: 'Add conversion',
        kind: 'primary',
        onClick: (h) => {
          const r = calc();
          if (!r || r.error) return;
          ctx.addPending(r.event);
          h.close();
        },
      },
    ],
  });
  const add = m.btn(1);
  function calc() {
    const date = val(m.el, 'c-date');
    const fmv = num(m.el, 'c-fmv');
    if (!isISO(date) || !(fmv > 0)) return null;
    // the cap price depends on the shares the instrument itself creates: settle by repeating
    let own = 0n;
    let res;
    for (let i = 0; i < 60; i++) {
      res = convertInstrument(w, { P: Q.of(fmv), S0: BigInt(S0), CC: BigInt(S0) + own, date });
      if (res.shares === own) break;
      own = res.shares;
    }
    const price = res.price.toNumber();
    const accrued = r2(res.accrued);
    const r = convertEvent(st, w, { price, date, accrued, shares: res.shares, leftover: r2(res.leftover) });
    return { ...r, res, price, accrued };
  }
  function preview() {
    wireMoneyHints(m.el, c);
    const r = calc();
    let out;
    if (!r) out = html`<div class="alert warn"><div class="grow">Enter a date and the fair value per share.</div></div>`;
    else if (r.error) out = html`<div class="alert bad"><div class="grow">${r.error}</div></div>`;
    else out = html`<div class="result">
      <div><span>Amount counted</span><b>${F.money(r.accrued, c)}${w.kind === 'note' ? ` (incl. ${F.money(r2(r.res.interest), c)} interest, ${r.res.days} days)` : ''}</b></div>
      <div><span>Conversion price</span><b>${F.price(r.price, c)} · ${r.res.route}</b></div>
      <div><span>Shares issued</span><b>${F.int(r.shares)}</b></div>
      <div><span>Left over in cash</span><b>${F.money(r.leftover, c)}</b></div></div>`;
    mount(m.$('#c-preview'), out);
    add.disabled = !r || !!r.error;
  }
  m.el.addEventListener('input', preview);
  preview();
}

export function dlgCancel(ctx, instrumentId) {
  const { st } = ctx.base();
  const w = st.waiting.find((x) => x.id === instrumentId);
  if (!w) return;
  const m = openModal({
    title: `Remove ${w.holder.name}'s ${w.kind === 'note' ? 'note' : 'iSAFE'}`,
    body: html`<p class="muted" style="margin:0">The deal stops converting and is marked in the history. The money is not added to the cap table.</p>
      ${selectField('k-why', 'What happened', [{ v: 'repaid', l: 'It was repaid' }, { v: 'cancelled', l: 'It was cancelled' }], 'repaid')}
      ${dateField('k-date', 'Date', todayISO())}`,
    actions: [
      { label: 'Cancel', onClick: (h) => h.close() },
      { label: 'Add to changes', kind: 'primary', onClick: (h) => { ctx.addPending(cancelEvent(st, w, val(h.el, 'k-why'), val(h.el, 'k-date'))); h.close(); } },
    ],
  });
}

/* ================================================================== */
/* Accept offer: choose the effective date                             */
/* ================================================================== */
export function dlgAccept(ctx, draftFor) {
  return new Promise((resolve) => {
    let done = false;
    const initial = ctx.roundOpts().date;
    const hasPriced = ctx.offers().some((o) => o.type === 'priced');
    const c = ctx.base().st.currency;
    const m = openModal({
      title: ctx.offers().length > 1 ? 'Accept these offers' : 'Accept this offer',
      wide: true,
      body: html`
        <p class="muted small" style="margin:0">Saving writes the deal to your cap table and to the cloud. You can undo it later from the Archive.</p>
        ${hasPriced ? dateField('ac-date', 'Effective date', initial, 'The day the deal counts from. A past date is allowed.') : ''}
        <div id="ac-sum" aria-live="polite" style="display:grid;gap:10px"></div>`,
      actions: [
        { label: 'Cancel', onClick: (h) => { done = true; h.close(); resolve(null); } },
        { label: 'Accept and save', kind: 'accent', onClick: (h) => { const d = hasPriced ? val(h.el, 'ac-date') : initial; if (!isISO(d)) return; done = true; h.close(); resolve(d); } },
      ],
    });
    const btn = m.btn(1);
    const draw = () => {
      const date = hasPriced ? val(m.el, 'ac-date') : initial;
      const d = isISO(date) ? draftFor(date) : null;
      if (!d) {
        mount(m.$('#ac-sum'), html`<div class="alert warn"><div class="grow">Choose a valid date.</div></div>`);
        btn.disabled = true;
        return;
      }
      btn.disabled = d.errors.length > 0 || (d.round && d.round.ok && !d.round.auth.ok);
      mount(m.$('#ac-sum'), [
        d.errors.map((e) => html`<div class="alert bad"><div class="grow">${e}</div></div>`),
        d.events.map((e) => html`<div class="alert info"><div class="grow"><b>${e.title}.</b> ${e.summary}</div></div>`),
        d.round && d.round.ok ? d.round.investors.map((inv, j) => settlementClause(inv, d.round.price, c, d.roundEvent.data.investors[j].holder.name)) : '',
        d.round && d.round.ok ? html`<div class="result" style="margin-top:6px">
          <div><span>Share capital (shares × face value)</span><b>${F.money(d.round.totals.nominal + d.round.conversions.reduce((s, x) => s + x.nominal, 0), c)}</b></div>
          <div><span>Securities premium (the rest)</span><b>${F.money(d.round.totals.premium + d.round.conversions.reduce((s, x) => s + x.premium, 0), c)}</b></div></div>` : '',
        d.round && d.round.ok && !d.round.auth.ok ? html`<div class="alert bad"><div class="grow"><b>More than the authorised shares.</b> Increase the authorised capital first.</div></div>` : '',
      ]);
    };
    m.el.addEventListener('input', draw);
    draw();
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.el) && !done) {
        done = true;
        resolve(null);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
  });
}
