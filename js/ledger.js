/* Builds events (with a plain-English title and summary) and the live "draft deal".
 * Events hold resolved facts. The cap table is always rebuilt from them by engine.replay(). */
import {
  newId, replay, issuedShares, computeRound, resolveCapOnly, addYears, isISO, r2, Q, ROLES, todayISO, metrics, capTable, activeHolders,
} from './engine.js';
import * as F from './fmt.js';

export function makeEvent(kind, effectiveDate, data, title, summary, o = {}) {
  const now = o.now ?? Date.now();
  return { id: o.id || newId(), kind, effectiveDate, createdAt: now, updatedAt: now, voidedAt: null, title, summary, data };
}

const cur = (st) => st?.currency || 'INR';
const nameOf = (st, id) => st.holders[id]?.name || 'Shareholder';

/* ------------------------------------------------------------------ */
/* Setup (incorporation)                                               */
/* ------------------------------------------------------------------ */
export function setupErrors(s) {
  const e = [];
  if (!s.name || !s.name.trim()) e.push('Enter the company name.');
  if (!(s.faceValue > 0)) e.push('Face value must be more than 0.');
  if (!(s.authorisedCapital > 0)) e.push('Authorised capital must be more than 0.');
  if (!(s.authorisedShares >= 1)) e.push('Authorised shares must be at least 1.');
  if (!s.founders.length) e.push('Add at least one founder.');
  let total = 0;
  s.founders.forEach((f, i) => {
    if (!f.name || !f.name.trim()) e.push(`Founder ${i + 1}: enter a name.`);
    if (!Number.isInteger(f.shares) || f.shares < 1) e.push(`${f.name || 'Founder ' + (i + 1)}: shares must be a whole number above 0.`);
    if (!(f.paid >= 0)) e.push(`${f.name || 'Founder ' + (i + 1)}: enter the paid-up amount (0 or more).`);
    total += Number.isInteger(f.shares) ? f.shares : 0;
  });
  if (total > s.authorisedShares) e.push(`Founders hold ${F.int(total)} shares, more than the ${F.int(s.authorisedShares)} authorised. Increase the authorised capital or lower the shares.`);
  return e;
}

export function incorporationEvent(s, existing, now) {
  const founders = s.founders.map((f, i) => ({
    id: f.id,
    name: f.name.trim(),
    designation: (f.designation || '').trim() || 'Founder',
    role: 'founder',
    colorIdx: i,
    shares: f.shares,
    paid: f.paid,
  }));
  const tot = founders.reduce((a, f) => a + f.shares, 0);
  const paid = founders.reduce((a, f) => a + f.paid, 0);
  const c = s.currency || 'INR';
  const title = `Incorporation: ${s.name.trim()}`;
  const summary = `${founders.map((f) => f.name).join(', ')} hold ${F.int(tot)} shares (${F.money(paid, c)} paid up) at a face value of ${F.money(s.faceValue, c)}. Authorised capital ${F.money(s.authorisedCapital, c)} (${F.int(s.authorisedShares)} shares).`;
  const data = {
    name: s.name.trim(),
    faceValue: s.faceValue,
    authorisedCapital: s.authorisedCapital,
    authorisedShares: s.authorisedShares,
    dpiit: !!s.dpiit,
    currency: c,
    incorporationDate: s.incorporationDate,
    founders,
  };
  if (existing) return { ...existing, data, title, summary, effectiveDate: s.incorporationDate, updatedAt: now ?? Date.now() };
  return makeEvent('incorporation', s.incorporationDate, data, title, summary, { now });
}

/** the setup form values for an existing incorporation event */
export function setupFromEvent(ev) {
  const d = ev.data;
  return {
    name: d.name,
    faceValue: d.faceValue,
    authorisedCapital: d.authorisedCapital,
    authorisedShares: d.authorisedShares,
    dpiit: !!d.dpiit,
    currency: d.currency || 'INR',
    incorporationDate: d.incorporationDate || ev.effectiveDate,
    founders: d.founders.map((f) => ({ id: f.id, name: f.name, designation: f.designation, shares: f.shares, paid: f.paid })),
  };
}

export function defaultSetup(name = 'New startup') {
  return {
    name,
    faceValue: 10,
    authorisedCapital: 1000000,
    authorisedShares: 100000,
    dpiit: false,
    currency: 'INR',
    incorporationDate: todayISO(),
    founders: [{ id: newId(), name: 'Founder 1', designation: 'Founder & CEO', shares: 1000, paid: 10000 }],
  };
}

/* ------------------------------------------------------------------ */
/* Single actions                                                      */
/* ------------------------------------------------------------------ */
/** pick or create a holder profile. sel: {existingId} | {name, designation, role} */
export function holderFrom(st, sel, extraNew = 0, defaultRole = 'other') {
  if (sel.existingId && st.holders[sel.existingId]) {
    const h = st.holders[sel.existingId];
    return { id: h.id, name: h.name, designation: h.designation, role: h.role, colorIdx: h.colorIdx };
  }
  return {
    id: sel.id || newId(),
    name: (sel.name || '').trim() || 'Shareholder',
    designation: (sel.designation || '').trim() || ROLES[sel.role || defaultRole] || 'Shareholder',
    role: sel.role || defaultRole,
    colorIdx: st.order.length + extraNew,
  };
}

export function issueEvent(st, { holder, shares, price, date }) {
  if (!Number.isInteger(shares) || shares < 1) return { error: 'Shares must be a whole number above 0.' };
  if (!(price >= 0)) return { error: 'Price per share cannot be negative.' };
  const paid = r2(new Q(BigInt(shares)).mul(Q.of(price)));
  const c = cur(st);
  const ev = makeEvent('issue', date, { holder, shares, price, paid },
    `Shares issued: ${holder.name}`,
    `${holder.name} was issued ${F.int(shares)} new shares at ${F.price(price, c)} each, paying ${F.money(paid, c)}. Everyone else is diluted.`);
  return { event: ev, paid };
}

export function transferEvent(st, { fromId, to, shares, amount, date, full }) {
  const c = cur(st);
  const from = nameOf(st, fromId);
  const ev = makeEvent('transfer', date, { fromId, to, shares, amount: amount || null, full: !!full },
    `Share transfer: ${from} to ${to.name}`,
    `${from} ${full ? 'sold all ' : 'transferred '}${F.int(shares)} shares to ${to.name}${amount ? ' for ' + F.money(amount, c) : ' with no payment recorded'}. No new shares, so nobody else is diluted.`);
  return ev;
}

export function splitEvent(st, { a, b, date }) {
  const kind = b > a ? 'Forward split' : 'Reverse split';
  return makeEvent('split', date, { a, b },
    `Stock split: ${a} for ${b}`,
    `${kind}: every ${a} old ${a === 1 ? 'share becomes' : 'shares become'} ${b} new. Issued and unissued (authorised) shares both change. Face value goes from ${F.price(st.faceValue, cur(st))} to ${F.price(new Q(BigInt(1)).mul(st.faceValue).mul(a).div(b).toNumber(), cur(st))}. Ownership percentages stay the same.`);
}

export function poolEvent(st, { resolved, targetPct, date }) {
  const verb = resolved.action === 'shrink' ? 'shrunk' : resolved.action === 'create' ? 'created' : 'grown';
  return makeEvent('pool', date, { delta: resolved.delta, targetPct, action: resolved.action },
    `Option pool ${verb}: ${F.pct2(targetPct)}`,
    `The employee option pool was ${verb} to ${F.pct2(targetPct)} of the company: ${F.int(Math.abs(resolved.delta))} shares ${resolved.delta < 0 ? 'cancelled' : 'added'}. The pool is now ${F.int(resolved.poolAfter)} shares.`);
}

export function authEvent(st, { addCapital, date, note }) {
  const c = cur(st);
  const addShares = Number(new Q(BigInt(0)).add(Q.of(addCapital)).div(st.faceValue).floor());
  return makeEvent('auth_increase', date, { addCapital, note: note || '' },
    `Authorised capital increased by ${F.compact(addCapital, c)}`,
    `Authorised capital rises from ${F.money(st.authCapital, c)} to ${F.money(r2(Q.of(st.authCapital).add(addCapital)), c)} (${F.int(addShares)} more shares). Form SH-7 is due within 30 days of the shareholders' resolution.`);
}

export function lockinEvent(st, { holderId, startDate, years, scope, permitted, source }) {
  const endDate = addYears(startDate, years);
  return makeEvent('lockin', startDate, { holderId, startDate, endDate, years, scope, permitted, source },
    `Lock-in recorded: ${nameOf(st, holderId)}`,
    `${nameOf(st, holderId)} agreed not to sell ${scope.toLowerCase()} for ${years} ${years === 1 ? 'year' : 'years'}, until ${F.date(endDate)}.${permitted ? ' Permitted transfers: ' + permitted + '.' : ''}${source ? ' Source: ' + source + '.' : ''} The app records and warns. It cannot stop a sale.`);
}

export function holderEditEvent(st, { id, name, designation, role, date }) {
  const old = st.holders[id];
  return makeEvent('holder_edit', date, { id, name, designation, role },
    `Shareholder edited: ${old?.name || ''}`,
    `${old?.name || 'Shareholder'} is now ${name}${designation ? ', ' + designation : ''} (${ROLES[role] || role}).`);
}

export function cancelEvent(st, w, reason, date) {
  return makeEvent('cancel', date, { instrumentId: w.id, reason },
    `${w.kind === 'note' ? 'Convertible note' : 'iSAFE'} ${reason}: ${w.holder.name}`,
    `${w.holder.name}'s ${w.kind === 'note' ? 'convertible note' : 'iSAFE'} of ${F.money(w.amount, cur(st))} was ${reason}. It no longer converts.`);
}

/** convert one waiting instrument outside a round (expiry, maturity or the holder's choice) */
export function convertEvent(st, w, { price, date, accrued, shares: exactShares, leftover: exactLeftover }) {
  const shares = exactShares != null ? Number(exactShares) : Number(Q.of(accrued).div(price).floor());
  if (!(shares >= 1)) return { error: 'The price is too high for even one share.' };
  const leftover = exactLeftover != null ? exactLeftover : r2(Q.of(accrued).sub(Q.of(price).mul(new Q(BigInt(shares)))));
  const ev = makeEvent('convert', date, { instrumentId: w.id, holderId: w.holderId, shares, price, accrued, principal: w.amount, leftover },
    `Converted to shares: ${w.holder.name}`,
    `${w.holder.name}'s ${w.kind === 'note' ? 'note' : 'iSAFE'} (${F.money(accrued, cur(st))} counted) converted to ${F.int(shares)} shares at ${F.price(price, cur(st))}.${leftover > 0 ? ' ' + F.money(leftover, cur(st)) + ' was left over.' : ''}`);
  return { event: ev, shares, leftover };
}

/* ------------------------------------------------------------------ */
/* The draft deal: offers in, events out                               */
/* ------------------------------------------------------------------ */
export function normalizeOffer(o) {
  const rate = o.currency && o.currency.code !== 'BASE' && o.currency.rate ? Number(o.currency.rate) : 1;
  const money = (v) => (v === '' || v == null ? v : r2(Q.of(v).mul(Q.of(rate))));
  const n = { ...o, rate };
  n.amount = money(o.mode === 'shares' && o.type === 'priced' ? Q.of(o.shares || 0).mul(Q.of(o.price || 0)).toNumber() : o.amount);
  n.pre = money(o.pre);
  n.post = money(o.post);
  n.cap = o.cap === '' || o.cap == null ? null : money(o.cap);
  n.price = o.price === '' || o.price == null ? o.price : Q.of(o.price).mul(Q.of(rate)).toNumber();
  return n;
}

function validateInstrument(o) {
  if (!(Number(o.amount) > 0)) return 'The investment must be more than 0.';
  if (o.type === 'isafe') {
    const t = o.isafeType;
    if (['cap_discount', 'cap'].includes(t)) {
      if (!(Number(o.cap) > 0)) return 'Enter the post-money valuation cap.';
      if (!(Number(o.cap) > Number(o.amount))) return 'The valuation cap must be more than the investment.';
    }
    if (['cap_discount', 'discount'].includes(t) && !(Number(o.discountPct) > 0 && Number(o.discountPct) < 100)) return 'Discount must be above 0% and below 100%.';
  } else {
    if (Number(o.ratePct) < 0) return 'Interest cannot be negative.';
    if (o.discountPct && !(Number(o.discountPct) > 0 && Number(o.discountPct) < 100)) return 'Discount must be above 0% and below 100%.';
    if (o.cap && !(Number(o.cap) > 0)) return 'The valuation cap must be more than 0.';
    if (!isISO(o.maturityDate) || o.maturityDate <= o.issueDate) return 'The maturity date must be after the issue date.';
  }
  return null;
}

export const ISAFE_TYPES = {
  cap_discount: 'Cap + Discount',
  cap: 'Valuation Cap only',
  discount: 'Discount only',
  mfn: 'MFN',
};

/**
 * events: saved + pending events. offers: the draft investors.
 * opts: {date, roundName, roundId, dilution, poolTarget, now, currency}
 */
export function buildDraft(events, offers, opts) {
  const res = { events: [], errors: [], warnings: [], round: null, roundEvent: null, baseState: null, instruments: [] };
  if (!offers.length) return res;
  const now = opts.now ?? Date.now();
  let seq = 0;
  let working = [...events];
  const c = opts.currency || 'INR';
  const norm = offers.map(normalizeOffer);
  const label = (o, i) => `${o.name || 'Investor ' + (i + 1)}`;

  norm.forEach((o, i) => {
    if (o.type === 'priced') return;
    const date = o.type === 'isafe' ? o.date : o.issueDate;
    const lab = label(o, i);
    if (!isISO(date)) {
      res.errors.push(`${lab}: choose a valid date.`);
      return;
    }
    const bad = validateInstrument(o);
    if (bad) {
      res.errors.push(`${lab}: ${bad}`);
      return;
    }
    const st = replay(working, { asOf: date });
    const holder = holderFrom(st, { existingId: o.existingHolderId, id: o.holderId, name: o.name || 'Investor ' + (i + 1), designation: 'Investor', role: 'investor' }, 0, 'investor');
    const currencyMeta = o.currency && o.currency.code !== 'BASE' ? { code: o.currency.code, rate: o.rate, original: Number(o.amountOriginal ?? o.amount) } : null;
    let ev;
    if (o.type === 'isafe') {
      const d = { instrumentId: o.id, holder, type: o.isafeType, amount: Number(o.amount), cap: o.cap ? Number(o.cap) : null, discountPct: Number(o.discountPct) || 0, angel: !!o.angel, date, currency: currencyMeta };
      let summary;
      if (o.isafeType === 'cap') {
        const r = resolveCapOnly(issuedShares(st) + st.pool, d.amount, d.cap);
        if (!r.ok) {
          res.errors.push(`${lab}: ${r.error}`);
          return;
        }
        d.shares = r.shares;
        d.stakePct = r.stakePct;
        summary = `${holder.name} put in ${F.money(d.amount, c)} through a Valuation Cap only iSAFE (cap ${F.compact(d.cap, c)}). It is a day-one holding: ${F.int(r.shares)} preference shares, ${F.pct(r.stakePct)} of the company, converting 1:1 into equity at the 20th anniversary or earlier at the investor's choice.`;
      } else {
        summary = `${holder.name} put in ${F.money(d.amount, c)} through a ${ISAFE_TYPES[o.isafeType]} iSAFE${d.cap ? ' (cap ' + F.compact(d.cap, c) + ')' : ''}${d.discountPct ? ', ' + F.pct2(d.discountPct) + ' discount' : ''}. It waits and converts at the next priced round. Expires ${F.date(addYears(date, 3))}.`;
      }
      ev = makeEvent('isafe', date, d, `iSAFE issued: ${holder.name}`, summary, { id: o.id, now: now + seq++ });
      if (st.faceValue !== 10) res.warnings.push(`The iSAFE forms assume a ₹10 face value. This company's is ${F.price(st.faceValue, c)}.`);
    } else {
      const d = { instrumentId: o.id, holder, principal: Number(o.amount), ratePct: Number(o.ratePct) || 0, discountPct: Number(o.discountPct) || 0, cap: o.cap ? Number(o.cap) : null, issueDate: o.issueDate, maturityDate: o.maturityDate, currency: currencyMeta };
      ev = makeEvent('note', date, d, `Convertible note issued: ${holder.name}`,
        `${holder.name} lent ${F.money(d.principal, c)} at ${F.pct2(d.ratePct)} simple interest${d.discountPct ? ', ' + F.pct2(d.discountPct) + ' discount' : ''}${d.cap ? ', pre-money cap ' + F.compact(d.cap, c) : ''}. It converts at the next priced round or is repaid by ${F.date(d.maturityDate)}.`,
        { id: o.id, now: now + seq++ });
      if (!st.dpiit) res.warnings.push('Convertible notes are allowed only for DPIIT-recognised startups. Turn on DPIIT in the setup if this company is recognised.');
      if (d.principal < 2500000) res.warnings.push(`${holder.name}'s note is below ₹25,00,000. The Indian rule is at least ₹25 lakh per investor per tranche.`);
      if (d.maturityDate > addYears(d.issueDate, 10)) res.warnings.push('The note matures after more than 10 years.');
    }
    working.push(ev);
    res.events.push(ev);
    res.instruments.push({ offer: o, event: ev });
  });

  const priced = norm.filter((o) => o.type === 'priced');
  if (priced.length) {
    const date = opts.date;
    if (!isISO(date)) {
      res.errors.push('Choose a valid effective date.');
      return res;
    }
    const st = replay(working, { asOf: date });
    res.baseState = st;
    const base = { issued: issuedShares(st), pool: st.pool, waiting: st.waiting, faceValue: st.faceValue, authShares: st.authShares };
    const first = priced[0];
    const pricing = { mode: first.mode, pct: first.pct, pre: first.pre, post: first.post, price: first.price };
    const r = computeRound(base, {
      offers: priced.map((o, j) => ({ id: o.id, amount: o.amount, shares: j === 0 && first.mode === 'shares' ? Number(first.shares) : undefined })),
      pricing,
      poolTarget: opts.poolTarget || null,
      dilution: opts.dilution || 'pre',
      date,
    });
    res.round = r;
    res.base = base;
    if (!r.ok) {
      res.errors.push(...r.errors);
      return res;
    }
    res.warnings.push(...r.warnings);
    const latest = Math.max(0, ...working.filter((e) => !e.voidedAt).map((e) => (e.effectiveDate > date ? 1 : 0)));
    if (latest) res.warnings.push('The effective date is earlier than a later event. The round slots in by date and everything after it is recalculated.');
    const investors = priced.map((o, j) => {
      const holder = holderFrom(st, { existingId: o.existingHolderId, id: o.holderId, name: o.name || 'Investor ' + (offers.indexOf(offers.find((x) => x.id === o.id)) + 1), designation: 'Investor', role: 'investor' }, j, 'investor');
      const ri = r.investors[j];
      return { holder, shares: ri.shares, paid: ri.paid, offered: ri.offered, unspent: ri.unspent, frac: ri.frac, nominal: ri.nominal, premium: ri.premium, mode: j === 0 ? first.mode : 'same price',
        currency: o.currency && o.currency.code !== 'BASE' ? { code: o.currency.code, rate: o.rate, original: Number(o.amountOriginal ?? o.amount) } : null };
    });
    const names = investors.map((i) => i.holder.name).join(', ');
    const stake = r.stakeNew;
    let summary = `${names} ${investors.length > 1 ? 'invested' : 'invested'} ${F.money(r.totals.paid, c)} for ${F.int(r.sumN)} new shares at ${F.price(r.price, c)} each (${F.pct(stake)} of the company). Pre-money ${F.money(r.preActual, c)}, post-money ${F.money(r.postActual, c)}.`;
    if (r.X) summary += ` The option pool grew by ${F.int(r.X)} shares to ${F.pct2(r.poolPct)}.`;
    if (r.conversions.length) summary += ` ${r.conversions.length} waiting ${r.conversions.length === 1 ? 'deal' : 'deals'} converted into ${F.int(r.sumC)} shares.`;
    if (r.totals.unspent > 0) summary += ` ${F.money(r.totals.unspent, c)} of the amount offered was settled in cash because a whole share cannot be split.`;
    const data = {
      roundName: opts.roundName || 'Priced round',
      price: r.price,
      preActual: r.preActual,
      postActual: r.postActual,
      preAgreed: r.preAgreed,
      postAgreed: r.postAgreed,
      dilution: r.dilution,
      poolAdd: r.X,
      investors,
      conversions: r.conversions.map((x) => ({ instrumentId: x.instrumentId, holderId: x.holderId, name: x.name, shares: x.shares, price: x.price, route: x.route, accrued: x.accrued, interest: x.interest, days: x.days, principal: x.principal, leftover: x.leftover })),
      premium: { nominal: r.totals.nominal, premium: r.totals.premium },
    };
    const ev = makeEvent('round', date, data, `${opts.roundName || 'Priced round'}: ${names}`, summary, { id: opts.roundId, now: now + 1000 });
    res.roundEvent = ev;
    res.events.push(ev);
  }
  return res;
}

export function kindLabel(kind) {
  return {
    incorporation: 'Incorporation',
    issue: 'Shares issued',
    round: 'Priced round',
    isafe: 'iSAFE issued',
    note: 'Convertible note issued',
    convert: 'Converted to shares',
    cancel: 'Cancelled',
    transfer: 'Share transfer',
    split: 'Stock split',
    pool: 'Option pool changed',
    holder_edit: 'Shareholder edited',
    auth_increase: 'Authorised capital',
    lockin: 'Lock-in recorded',
  }[kind] || 'Unknown change';
}

/** the small summary kept on the startup document, so the list can show it without loading every event */
export function startupStats(st, eventCount) {
  const m = metrics(st);
  const ct = capTable(st, 'fd');
  return {
    issued: m.issued,
    total: m.total,
    pool: st.pool,
    holders: activeHolders(st).length,
    post: st.lastRound ? st.lastRound.post : null,
    price: st.lastPrice || null,
    authShares: st.authShares,
    currency: st.currency,
    waiting: st.waiting.length,
    events: eventCount,
    slices: ct.rows.slice(0, 10).map((r) => ({ color: r.color, pct: +r.pct.toFixed(2) })),
  };
}
