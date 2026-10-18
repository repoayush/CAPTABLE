/* CAPTABLE engine
 * Pure functions. No DOM, no network. Everything that decides a share count
 * is done on exact fractions (BigInt), so "round down to a whole share" is exact.
 *
 * The app stores EVENTS (what happened). The cap table on any date is rebuilt
 * by replay(). Events hold resolved facts (shares, amounts), never a copy of the table.
 */

/* ------------------------------------------------------------------ */
/* Exact fractions                                                     */
/* ------------------------------------------------------------------ */
const babs = (x) => (x < 0n ? -x : x);
const gcd = (a, b) => {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};

export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('Division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static of(x) {
    if (x instanceof Q) return x;
    if (typeof x === 'bigint') return new Q(x);
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) throw new Error('Not a finite number');
      return Q.parse(String(x));
    }
    if (typeof x === 'string') return Q.parse(x);
    throw new Error('Cannot read number');
  }
  static parse(s) {
    s = String(s).replace(/[,\s₹$€£%]/g, '');
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (!m[2] && !m[3])) throw new Error('Not a number: ' + s);
    const ip = m[2] || '0';
    const fp = m[3] || '';
    const exp = parseInt(m[4] || '0', 10);
    let n = BigInt(ip + fp);
    let d = 10n ** BigInt(fp.length);
    if (exp > 0) n *= 10n ** BigInt(exp);
    else if (exp < 0) d *= 10n ** BigInt(-exp);
    if (m[1] === '-') n = -n;
    return new Q(n, d);
  }
  add(o) {
    o = Q.of(o);
    return new Q(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    o = Q.of(o);
    return new Q(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    o = Q.of(o);
    return new Q(this.n * o.n, this.d * o.d);
  }
  div(o) {
    o = Q.of(o);
    if (o.n === 0n) throw new Error('Division by zero');
    return new Q(this.n * o.d, this.d * o.n);
  }
  cmp(o) {
    o = Q.of(o);
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  lt(o) { return this.cmp(o) < 0; }
  lte(o) { return this.cmp(o) <= 0; }
  gt(o) { return this.cmp(o) > 0; }
  gte(o) { return this.cmp(o) >= 0; }
  eq(o) { return this.cmp(o) === 0; }
  isZero() { return this.n === 0n; }
  /** floor as BigInt */
  floor() {
    if (this.n >= 0n) return this.n / this.d;
    return -((-this.n + this.d - 1n) / this.d);
  }
  /** nearest whole number, halves go up, as BigInt */
  round() {
    return this.add(new Q(1n, 2n)).floor();
  }
  toNumber() {
    const neg = this.n < 0n;
    const n = neg ? -this.n : this.n;
    const whole = n / this.d;
    const rem = n % this.d;
    const v = Number(whole) + Number(rem) / Number(this.d);
    return neg ? -v : v;
  }
}
const q = (x) => Q.of(x);
const ZERO = new Q(0n);
const ONE = new Q(1n);
const big = (x) => BigInt(x);
/** a number rounded to paise */
export const r2 = (x) => Number(q(x).mul(100).round()) / 100;
export const num = (x) => Number(x);

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */
export function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const dayNum = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
export function addYears(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y + n, m - 1, d)).toISOString().slice(0, 10);
}
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function newId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  return 'id' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ------------------------------------------------------------------ */
/* Colours (stable per holder; stored in the holder's first event)     */
/* ------------------------------------------------------------------ */
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const EXTRA = ['#5b6b8c', '#7d879c', '#a3abbb', '#c5cbd6'];
export const colorFor = (i) => (i < PALETTE.length ? PALETTE[i] : EXTRA[(i - PALETTE.length) % EXTRA.length]);
export const POOL_COLOR = '#b9c1ce';

export const ROLES = {
  founder: 'Founder',
  cofounder: 'Co-founder',
  investor: 'Investor',
  pool: 'Option pool',
  advisor: 'Advisor',
  other: 'Other',
  shareholder: 'Shareholder',
};

/* ------------------------------------------------------------------ */
/* State and replay                                                    */
/* ------------------------------------------------------------------ */
export function newState() {
  return {
    name: '',
    faceValue: 10,
    authCapital: 0,
    authShares: 0,
    dpiit: false,
    currency: 'INR',
    incDate: null,
    holders: {},
    order: [],
    pool: 0,
    waiting: [],
    cash: 0, // cash received for shares
    lastPrice: null,
    lastRound: null,
    lockins: [],
    problems: [],
    alerts: [],
    unknown: [],
    applied: [],
  };
}

const held = (h) => h.eq + h.pref;
export const issuedShares = (st) => Object.values(st.holders).reduce((s, h) => s + held(h), 0);
export const totalShares = (st) => issuedShares(st) + st.pool;
export const activeHolders = (st) => st.order.map((id) => st.holders[id]).filter((h) => held(h) > 0);

function addHolder(st, hd, date) {
  if (!hd || !hd.id) throw new Error('A shareholder is missing');
  let h = st.holders[hd.id];
  if (!h) {
    h = {
      id: hd.id,
      name: hd.name || 'Shareholder',
      designation: hd.designation || '',
      role: hd.role || 'other',
      colorIdx: hd.colorIdx ?? st.order.length,
      eq: 0,
      pref: 0,
      invested: 0,
      joined: date,
    };
    st.holders[hd.id] = h;
    st.order.push(hd.id);
  }
  return h;
}

const posInt = (n, label) => {
  if (!Number.isInteger(n) || n <= 0) throw new Error(label + ' must be a whole number above 0');
};

const APPLY = {
  incorporation(st, ev) {
    const d = ev.data;
    st.name = d.name || st.name;
    st.faceValue = d.faceValue;
    st.authCapital = d.authorisedCapital;
    st.authShares = d.authorisedShares ?? Number(q(d.authorisedCapital).div(d.faceValue).floor());
    st.dpiit = !!d.dpiit;
    st.currency = d.currency || 'INR';
    st.incDate = d.incorporationDate || ev.effectiveDate;
    for (const f of d.founders || []) {
      const h = addHolder(st, f, ev.effectiveDate);
      h.eq += f.shares;
      h.invested += f.paid ?? r2(q(f.shares).mul(d.faceValue));
      st.cash += f.paid ?? r2(q(f.shares).mul(d.faceValue));
    }
  },

  auth_increase(st, ev) {
    const add = ev.data.addCapital;
    if (!(add > 0)) throw new Error('The increase must be above 0');
    st.authCapital = r2(q(st.authCapital).add(add));
    st.authShares += Number(q(add).div(st.faceValue).floor());
  },

  issue(st, ev) {
    const d = ev.data;
    posInt(d.shares, 'Shares');
    const h = addHolder(st, d.holder, ev.effectiveDate);
    h.eq += d.shares;
    h.invested += d.paid || 0;
    st.cash += d.paid || 0;
  },

  isafe(st, ev) {
    const d = ev.data;
    const h = addHolder(st, d.holder, ev.effectiveDate);
    if (d.type === 'cap') {
      posInt(d.shares, 'Preference shares');
      h.pref += d.shares;
      h.invested += d.amount;
      st.cash += d.amount;
    } else {
      st.waiting.push({
        id: d.instrumentId || ev.id,
        kind: 'isafe',
        type: d.type,
        holderId: h.id,
        holder: d.holder,
        amount: d.amount,
        cap: d.cap || null,
        discountPct: d.discountPct || 0,
        angel: !!d.angel,
        date: d.date,
        expiry: addYears(d.date, 3),
        lockEnd: d.angel ? addYears(d.date, 1) : null,
        currency: d.currency || null,
      });
    }
  },

  note(st, ev) {
    const d = ev.data;
    const h = addHolder(st, d.holder, ev.effectiveDate);
    st.waiting.push({
      id: d.instrumentId || ev.id,
      kind: 'note',
      holderId: h.id,
      holder: d.holder,
      amount: d.principal,
      ratePct: d.ratePct || 0,
      discountPct: d.discountPct || 0,
      cap: d.cap || null,
      issueDate: d.issueDate,
      maturityDate: d.maturityDate,
      date: d.issueDate,
      currency: d.currency || null,
    });
  },

  round(st, ev) {
    const d = ev.data;
    for (const cv of d.conversions || []) {
      if (!st.waiting.some((w) => w.id === cv.instrumentId)) {
        throw new Error('A waiting iSAFE or note that converts in this round is missing');
      }
    }
    for (const inv of d.investors || []) {
      if (inv.shares > 0) posInt(inv.shares, 'Shares');
      const h = addHolder(st, inv.holder, ev.effectiveDate);
      h.eq += inv.shares;
      h.invested += inv.paid;
      st.cash += inv.paid;
    }
    st.pool += d.poolAdd || 0;
    for (const cv of d.conversions || []) {
      const i = st.waiting.findIndex((w) => w.id === cv.instrumentId);
      const w = st.waiting[i];
      st.waiting.splice(i, 1);
      const h = addHolder(st, w.holder, ev.effectiveDate);
      h.eq += cv.shares;
      h.invested += cv.principal;
      st.cash += cv.principal;
    }
    if (d.price) {
      st.lastPrice = d.price;
      st.lastRound = { name: d.roundName || 'Round', date: ev.effectiveDate, price: d.price, pre: d.preActual, post: d.postActual };
    }
  },

  convert(st, ev) {
    const d = ev.data;
    const i = st.waiting.findIndex((w) => w.id === d.instrumentId);
    if (i < 0) throw new Error('The iSAFE or note to convert is not waiting any more');
    const w = st.waiting[i];
    st.waiting.splice(i, 1);
    const h = addHolder(st, w.holder, ev.effectiveDate);
    h.eq += d.shares;
    h.invested += d.principal;
    st.cash += d.principal;
  },

  cancel(st, ev) {
    const i = st.waiting.findIndex((w) => w.id === ev.data.instrumentId);
    if (i < 0) throw new Error('The iSAFE or note to cancel is not waiting any more');
    st.waiting.splice(i, 1);
  },

  transfer(st, ev) {
    const d = ev.data;
    const from = st.holders[d.fromId];
    if (!from) throw new Error('The seller is not on the cap table at this date');
    posInt(d.shares, 'Shares');
    if (d.shares > held(from)) throw new Error(`${from.name} holds ${held(from)} shares, fewer than the ${d.shares} being transferred`);
    const to = addHolder(st, d.to, ev.effectiveDate);
    if (to.id === from.id) throw new Error('Seller and receiver are the same person');
    let left = d.shares;
    const fromEq = Math.min(from.eq, left);
    from.eq -= fromEq;
    left -= fromEq;
    from.pref -= left;
    to.eq += d.shares;
  },

  split(st, ev) {
    const { a, b } = ev.data;
    const bad = splitProblems(st, a, b);
    if (bad.length) throw new Error('This split leaves a fraction of a share for ' + bad.join(', '));
    const mul = (n) => Number(q(n).mul(b).div(a).floor());
    for (const h of Object.values(st.holders)) {
      h.eq = mul(h.eq);
      h.pref = mul(h.pref);
    }
    st.pool = mul(st.pool);
    st.authShares = mul(st.authShares);
    st.faceValue = q(st.faceValue).mul(a).div(b).toNumber();
    if (st.lastPrice) st.lastPrice = q(st.lastPrice).mul(a).div(b).toNumber();
    if (st.lastRound) st.lastRound = { ...st.lastRound, price: st.lastPrice };
  },

  pool(st, ev) {
    const delta = ev.data.delta;
    if (st.pool + delta < 0) throw new Error('The pool cannot go below 0');
    st.pool += delta;
  },

  holder_edit(st, ev) {
    const h = st.holders[ev.data.id];
    if (!h) throw new Error('The shareholder is not on the cap table');
    for (const k of ['name', 'designation', 'role']) if (ev.data[k] != null && ev.data[k] !== '') h[k] = ev.data[k];
  },

  lockin(st, ev) {
    const d = ev.data;
    st.lockins.push({ id: ev.id, holderId: d.holderId, from: d.startDate, until: d.endDate, years: d.years, scope: d.scope || 'All shares', permitted: d.permitted || '', source: d.source || '' });
  },
};

const cmpKey = (a, b) =>
  a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const sortEvents = (evts) => [...evts].sort(cmpKey);

/**
 * Rebuild the state from events.
 * asOf: only events with effectiveDate on or before this ISO date.
 */
export function replay(events, { asOf = null } = {}) {
  const st = newState();
  for (const ev of sortEvents(events)) {
    if (ev.voidedAt) continue;
    if (asOf && ev.effectiveDate > asOf) continue;
    const fn = APPLY[ev.kind];
    if (!fn) {
      st.unknown.push(ev.id);
      continue;
    }
    try {
      fn(st, ev);
      st.applied.push(ev.id);
      if (st.authShares && totalShares(st) > st.authShares) {
        st.alerts.push({ eventId: ev.id, msg: `Shares (${totalShares(st)}) are more than the authorised shares (${st.authShares})` });
      }
    } catch (e) {
      st.problems.push({ eventId: ev.id, msg: e.message });
    }
  }
  return st;
}

/* ------------------------------------------------------------------ */
/* Views of a state                                                    */
/* ------------------------------------------------------------------ */
/** fully diluted: issued + pool + waiting capped iSAFEs counted at their cap */
export function fullyDiluted(st) {
  const base = issuedShares(st) + st.pool;
  const capped = st.waiting.filter((w) => w.kind === 'isafe' && w.type === 'cap_discount' && w.cap);
  const qs = capped.map((w) => q(w.amount).div(w.cap));
  const sum = qs.reduce((a, b) => a.add(b), ZERO);
  if (!capped.length || sum.gte(ONE)) return { total: base, instruments: [] };
  const total = q(base).div(ONE.sub(sum));
  return {
    total: Number(total.round()),
    instruments: capped.map((w, i) => ({ id: w.id, holder: w.holder, shares: Number(total.mul(qs[i]).floor()), type: w.type, amount: w.amount })),
  };
}

/** rows for the cap table. view: 'issued' | 'fd' */
export function capTable(st, view = 'fd') {
  const rows = [];
  const priceNow = st.lastPrice || st.faceValue;
  const lockFor = (id, date) => st.lockins.find((l) => l.holderId === id && (!date || l.until >= date));
  for (const h of activeHolders(st)) {
    rows.push({
      id: h.id,
      name: h.name,
      designation: h.designation,
      role: h.role,
      color: colorFor(h.colorIdx),
      shares: held(h),
      pref: h.pref,
      invested: h.invested,
      value: held(h) * priceNow,
      lock: lockFor(h.id),
    });
  }
  if (view === 'fd' && st.pool > 0) rows.push({ id: 'pool', name: 'Employee option pool (ESOP)', designation: '', role: 'pool', color: POOL_COLOR, shares: st.pool, pref: 0, invested: 0, value: st.pool * priceNow, isPool: true });
  if (view === 'fd') {
    const fd = fullyDiluted(st);
    for (const it of fd.instruments) {
      rows.push({ id: 'w:' + it.id, name: it.holder.name + ' (iSAFE at cap)', designation: 'Waiting', role: 'investor', color: colorFor(it.holder.colorIdx), shares: it.shares, pref: 0, invested: it.amount, value: it.shares * priceNow, waiting: true });
    }
  }
  const total = rows.reduce((s, r) => s + r.shares, 0);
  rows.forEach((r) => (r.pct = total ? (r.shares / total) * 100 : 0));
  return { rows, total, view };
}

export function metrics(st) {
  const issued = issuedShares(st);
  const total = issued + st.pool;
  const nominal = r2(q(issued).mul(st.faceValue));
  const premium = Math.max(0, r2(q(st.cash).sub(nominal)));
  const heldInstruments = st.waiting.reduce((s, w) => s + w.amount, 0);
  return {
    issued,
    pool: st.pool,
    total,
    authShares: st.authShares,
    authCapital: st.authCapital,
    unissued: Math.max(0, st.authShares - total),
    over: Math.max(0, total - st.authShares),
    nominal,
    premium,
    cash: st.cash,
    heldInstruments,
    paidUpPct: st.authCapital ? (nominal / st.authCapital) * 100 : 0,
    issuedPct: st.authShares ? (issued / st.authShares) * 100 : 0,
    poolPct: st.authShares ? (st.pool / st.authShares) * 100 : 0,
    lastPrice: st.lastPrice,
    pre: st.lastRound ? st.lastRound.pre : null,
    post: st.lastRound ? st.lastRound.post : null,
    implied: total * (st.lastPrice || st.faceValue),
  };
}

/* ------------------------------------------------------------------ */
/* Setup helpers                                                       */
/* ------------------------------------------------------------------ */
/** two-of-three solver: capital, shares, face value. `known` names the two that stay fixed. */
export function solveAuthorised({ capital, shares, faceValue }, known) {
  const out = { capital, shares, faceValue };
  try {
    if (!known.includes('shares')) out.shares = Number(q(capital).div(faceValue).floor());
    else if (!known.includes('capital')) out.capital = r2(q(shares).mul(faceValue));
    else if (!known.includes('faceValue')) out.faceValue = q(capital).div(shares).toNumber();
  } catch (e) {
    /* leave as typed */
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Instruments: price a conversion                                     */
/* ------------------------------------------------------------------ */
export function accrual(w, date) {
  if (w.kind !== 'note') return { accrued: q(w.amount), days: 0, interest: ZERO };
  const days = Math.max(0, daysBetween(w.issueDate, date));
  const interest = q(w.amount).mul(q(w.ratePct || 0)).div(100).mul(days).div(365);
  return { accrued: q(w.amount).add(interest), days, interest };
}

/** The price an iSAFE or note converts at, and the shares it gets. */
export function convertInstrument(w, { P, S0, CC, date }) {
  const { accrued, days, interest } = accrual(w, date);
  const disc = q(w.discountPct || 0).div(100);
  const discPrice = P.mul(ONE.sub(disc));
  let price = P;
  let route = 'Round price';
  if (w.kind === 'isafe') {
    if (w.type === 'cap_discount') {
      const capPrice = q(w.cap).div(new Q(CC));
      if (capPrice.lte(discPrice)) {
        price = capPrice;
        route = 'Valuation cap';
      } else {
        price = discPrice;
        route = 'Discount';
      }
    } else if (w.type === 'discount') {
      price = discPrice;
      route = 'Discount';
    } else {
      price = P;
      route = 'MFN (round price)';
    }
  } else {
    if (disc.gt(ZERO) && discPrice.lt(price)) {
      price = discPrice;
      route = 'Discount';
    }
    if (w.cap) {
      const capPrice = q(w.cap).div(new Q(S0));
      if (capPrice.lt(price)) {
        price = capPrice;
        route = 'Valuation cap';
      }
    }
  }
  const shares = accrued.div(price).floor();
  const leftover = accrued.sub(price.mul(new Q(shares)));
  return { shares, price, route, accrued, days, interest, leftover };
}

/* Float estimate of the settled numbers. The exact (BigInt) loop below starts just
 * above this estimate and steps down to the highest stable whole-share answer, which is
 * the answer the rounding-free maths gives when the example works out in whole numbers. */
function convertFloat(w, P, s0, CC, date) {
  const { accrued } = accrual(w, date);
  const acc = accrued.toNumber();
  const disc = (w.discountPct || 0) / 100;
  const dp = P * (1 - disc);
  let price = P;
  if (w.kind === 'isafe') {
    if (w.type === 'cap_discount') price = Math.min(w.cap / CC, dp);
    else if (w.type === 'discount') price = dp;
  } else {
    if (disc > 0) price = Math.min(price, dp);
    if (w.cap) price = Math.min(price, w.cap / s0);
  }
  return acc / price;
}

function warmStart({ S0, E, insts, offers, V, Pfix, first, t, dilutePre, date }) {
  const s0 = Number(S0);
  const e = Number(E);
  const tt = t ? t.toNumber() : 0;
  let X = 0;
  let C = insts.map(() => 0);
  let N = offers.map(() => 0);
  for (let i = 0; i < 600; i++) {
    const sumC = C.reduce((a, b) => a + b, 0);
    const denom = dilutePre ? s0 + X + sumC : s0;
    const P = Pfix ? Pfix.toNumber() : V.toNumber() / denom;
    const Nn = offers.map((o, j) => (j === 0 && Pfix ? first.shares : Number(o.amount) / P));
    const sumN = Nn.reduce((a, b) => a + b, 0);
    const CC = s0 + sumC + sumN;
    const Cn = insts.map((w) => convertFloat(w, P, s0, CC, date));
    const T0 = s0 + Cn.reduce((a, b) => a + b, 0) + sumN;
    X = tt ? Math.max(0, (tt * T0 - e) / (1 - tt)) : 0;
    C = Cn;
    N = Nn;
    if (![X, ...C, ...N].every((v) => Number.isFinite(v) && v < 1e13)) return null;
  }
  return { X, C, N };
}

/* ------------------------------------------------------------------ */
/* The priced round                                                    */
/* ------------------------------------------------------------------ */
/**
 * base: { issued, pool, waiting[], faceValue, authShares|null }
 * cfg:  { offers:[{id, amount, shares?}], pricing:{mode:'pct'|'pre'|'post'|'shares', pct,pre,post,price} | {pre},
 *         poolTarget (% after round) , dilution:'pre'|'post', date }
 * The first offer sets the price. The others buy at that price.
 */
export function computeRound(base, cfg) {
  const out = { ok: false, errors: [], warnings: [] };
  const err = (m) => out.errors.push(m);
  const warn = (m) => out.warnings.push(m);
  const offers = cfg.offers || [];
  const pr = cfg.pricing || {};
  const date = cfg.date;
  const S0 = big(base.issued + base.pool);
  const E = big(base.pool);
  const FV = q(base.faceValue);
  const insts = (base.waiting || []).filter((w) => !(w.kind === 'isafe' && w.type === 'cap'));
  const dilutePre = cfg.dilution !== 'post';
  let t = null;
  try {
    if (cfg.poolTarget) {
      t = q(cfg.poolTarget).div(100);
      if (t.lt(ZERO) || t.gte(ONE)) {
        err('The option pool must be between 0% and 100%.');
        t = null;
      }
    }

    offers.forEach((o, i) => {
      if (!q(o.amount || 0).gt(ZERO)) err(`Investor ${i + 1}: the investment must be more than 0.`);
    });
    let V = null;
    let Pfix = null;
    let postAgreed = null;
    const first = offers[0];
    if (first && q(first.amount || 0).gt(ZERO)) {
      const I1 = q(first.amount);
      if (pr.mode === 'pct') {
        const p = q(pr.pct || 0).div(100);
        if (!p.gt(ZERO)) err('Equity % must be more than 0.');
        else if (p.gte(ONE)) err('An investor cannot buy 100% by funding the company. A full 100% is a buy-out: transfer all the shares instead.');
        else if (p.gt(q('0.99'))) err('An investor can get at most 99% in a funding round.');
        else {
          postAgreed = I1.div(p);
          V = postAgreed.sub(I1);
        }
      } else if (pr.mode === 'pre') {
        V = q(pr.pre || 0);
        if (!V.gt(ZERO)) err('Pre-money must be more than 0.');
        else postAgreed = V.add(I1);
      } else if (pr.mode === 'post') {
        const po = q(pr.post || 0);
        if (!po.gt(I1)) err('Post-money must be more than the investment.');
        else {
          postAgreed = po;
          V = po.sub(I1);
        }
      } else if (pr.mode === 'shares') {
        Pfix = q(pr.price || 0);
        if (!Pfix.gt(ZERO)) err('Price per share must be more than 0.');
        if (!Number.isInteger(first.shares) || first.shares <= 0) err('Shares must be a whole number above 0.');
      } else err('Choose how the offer is stated.');
    } else if (!first && pr.pre) {
      V = q(pr.pre);
      if (!V.gt(ZERO)) err('Pre-money must be more than 0.');
    } else if (!first) err('Add an investor first.');
    if (out.errors.length) return out;
    if (S0 <= 0n) {
      err('There are no shares before this round.');
      return out;
    }

    let X = 0n;
    let C = insts.map(() => 0n);
    let N = offers.map(() => 0n);
    if (insts.length || t) {
      const ws = warmStart({ S0, E, insts, offers, V, Pfix, first, t, dilutePre, date });
      if (!ws) {
        err('These terms cannot be settled. The converting iSAFEs and notes are too large for this valuation.');
        return out;
      }
      const up = (v) => big(Math.ceil(v) + 2);
      X = up(ws.X);
      C = ws.C.map(up);
      N = ws.N.map((v, j) => (j === 0 && Pfix ? big(first.shares) : up(v)));
    }
    let P = null;
    let CCfinal = S0;
    let denomFinal = S0;
    let iter = 0;
    let cycle = false;
    const seen = new Set();
    for (; iter < 3000; iter++) {
      const sumC = C.reduce((a, b) => a + b, 0n);
      const denom = dilutePre ? S0 + X + sumC : S0;
      P = Pfix || V.div(new Q(denom));
      const Nn = offers.map((o, j) => (j === 0 && Pfix ? big(first.shares) : q(o.amount).div(P).floor()));
      const sumN = Nn.reduce((a, b) => a + b, 0n);
      const CC = S0 + sumC + sumN;
      const Cn = insts.map((w) => convertInstrument(w, { P, S0, CC, date }).shares);
      const sumCn = Cn.reduce((a, b) => a + b, 0n);
      const T0 = S0 + sumCn + sumN;
      let Xn = 0n;
      if (t && t.gt(ZERO)) {
        const need = t.mul(new Q(T0)).sub(new Q(E)).div(ONE.sub(t));
        if (need.gt(ZERO)) Xn = need.round();
      }
      const same = Xn === X && Cn.every((c, k) => c === C[k]) && Nn.every((n, k) => n === N[k]);
      X = Xn;
      C = Cn;
      N = Nn;
      CCfinal = CC;
      denomFinal = denom;
      if (same) break;
      const key = [X, ...C, ...N].join(',');
      if (seen.has(key)) {
        cycle = true;
        break;
      }
      seen.add(key);
    }
    if (iter >= 3000) {
      err('These terms cannot be settled. The converting iSAFEs and notes are too large for this valuation.');
      return out;
    }

    // final figures at the settled counts
    const sumC = C.reduce((a, b) => a + b, 0n);
    const sumN = N.reduce((a, b) => a + b, 0n);
    const T = S0 + sumC + X + sumN;
    CCfinal = S0 + sumC + sumN;
    P = Pfix || V.div(new Q(dilutePre ? S0 + X + sumC : S0));

    const investors = offers.map((o, j) => {
      const exact = q(o.amount).div(P);
      const paid = new Q(N[j]).mul(P);
      return {
        offerId: o.id,
        shares: Number(N[j]),
        exact: exact.toNumber(),
        frac: exact.sub(new Q(N[j])).toNumber(),
        offered: r2(o.amount),
        paid: r2(paid),
        unspent: r2(q(o.amount).sub(paid)),
        stakePct: Number(T) ? (Number(N[j]) / Number(T)) * 100 : 0,
        nominal: r2(new Q(N[j]).mul(FV)),
        premium: r2(paid.sub(new Q(N[j]).mul(FV))),
      };
    });
    const conversions = insts.map((w) => {
      const r = convertInstrument(w, { P, S0, CC: CCfinal, date });
      if (w.kind === 'note' && daysBetween(w.issueDate, date) < 0) warn(`${w.holder.name}'s note is dated after the round. Interest is counted as 0 days.`);
      return {
        instrumentId: w.id,
        holderId: w.holderId,
        kind: w.kind,
        type: w.type || 'note',
        name: w.holder.name,
        shares: Number(r.shares),
        price: r.price.toNumber(),
        route: r.route,
        accrued: r2(r.accrued),
        interest: r2(r.interest),
        days: r.days,
        principal: w.amount,
        leftover: r2(r.leftover),
        stakePct: Number(T) ? (Number(r.shares) / Number(T)) * 100 : 0,
        nominal: r2(new Q(r.shares).mul(FV)),
        premium: r2(q(w.amount).sub(new Q(r.shares).mul(FV))),
      };
    });

    const stakeNew = Number(T) ? (Number(sumN) / Number(T)) * 100 : 0;
    if (stakeNew > 99) {
      err('New investors would hold more than 99%. A full takeover is a buy-out: transfer the shares instead.');
      return out;
    }
    if (t && t.gt(q('0.3'))) warn('The option pool is above 30% after the round. Market practice is 10 to 15% at seed.');
    if (cycle) warn('The numbers moved between two values by one share. The last settled value is shown.');
    const poolAfter = Number(E + X);
    const authOk = base.authShares == null ? true : Number(T) <= base.authShares;
    const pricePost = P.mul(new Q(T));
    const preActual = P.mul(new Q(dilutePre ? S0 + X + sumC : S0));
    Object.assign(out, {
      ok: true,
      P: P,
      price: P.toNumber(),
      S0: Number(S0),
      T: Number(T),
      sumN: Number(sumN),
      sumC: Number(sumC),
      X: Number(X),
      CC: Number(CCfinal),
      poolBefore: Number(E),
      poolAfter,
      poolPct: Number(T) ? (poolAfter / Number(T)) * 100 : 0,
      preActual: r2(preActual),
      postActual: r2(pricePost),
      preAgreed: V ? r2(V) : null,
      postAgreed: postAgreed ? r2(postAgreed) : null,
      investors,
      conversions,
      stakeNew,
      iterations: iter + 1,
      dilution: dilutePre ? 'pre' : 'post',
      auth: { needed: Number(T), limit: base.authShares, ok: authOk },
      totals: {
        offered: r2(offers.reduce((s, o) => s.add(q(o.amount)), ZERO)),
        paid: r2(investors.reduce((s, i) => s.add(q(i.paid)), ZERO)),
        unspent: r2(investors.reduce((s, i) => s.add(q(i.unspent)), ZERO)),
        nominal: investors.reduce((s, i) => s + i.nominal, 0),
        premium: investors.reduce((s, i) => s + i.premium, 0),
      },
    });
    return out;
  } catch (e) {
    err(e.message === 'Division by zero' ? 'Check the numbers. Something is zero that should not be.' : e.message);
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Other single-step resolvers (used by dialogs and tests)              */
/* ------------------------------------------------------------------ */
/** Cap-only iSAFE: a day-one holding. S = shares before this iSAFE. */
export function resolveCapOnly(S, amount, cap) {
  const qv = q(amount).div(cap);
  if (!qv.gt(ZERO) || qv.gte(ONE)) return { ok: false, error: 'The valuation cap must be more than the investment.' };
  const n = new Q(big(S)).mul(qv).div(ONE.sub(qv)).floor();
  return { ok: true, shares: Number(n), q: qv.toNumber(), stakePct: (Number(n) / (S + Number(n))) * 100 };
}

/** Option pool: grow, create or shrink to a target % of the total after the change. */
export function resolvePool(st, targetPct) {
  const S = totalShares(st);
  const E = st.pool;
  const t = q(targetPct).div(100);
  if (t.lt(ZERO) || t.gte(ONE)) return { ok: false, error: 'The pool must be between 0% and 100%.' };
  const ts = t.mul(new Q(big(S)));
  if (ts.gt(new Q(big(E)))) {
    const X = Number(ts.sub(new Q(big(E))).div(ONE.sub(t)).round());
    return { ok: true, action: E ? 'grow' : 'create', delta: X, poolAfter: E + X, totalAfter: S + X };
  }
  if (ts.lt(new Q(big(E)))) {
    const Y = Math.min(E, Number(new Q(big(E)).sub(ts).div(ONE.sub(t)).round()));
    return { ok: true, action: 'shrink', delta: -Y, poolAfter: E - Y, totalAfter: S - Y };
  }
  return { ok: true, action: 'none', delta: 0, poolAfter: E, totalAfter: S };
}

export function resolveTransfer(st, { fromId, full, shares, pct }) {
  const from = st.holders[fromId];
  if (!from) return { ok: false, error: 'Choose who is selling.' };
  const h = held(from);
  let n;
  if (full) n = h;
  else if (shares != null && shares !== '') n = Number(shares);
  else if (pct != null && pct !== '') n = Number(q(pct).div(100).mul(new Q(big(h))).round());
  else return { ok: false, error: 'Enter the number of shares or the percentage.' };
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'Shares must be a whole number above 0.' };
  if (n > h) return { ok: false, error: `${from.name} holds only ${h} shares.` };
  const total = totalShares(st);
  return { ok: true, shares: n, ofHoldingPct: (n / h) * 100, ofCompanyPct: total ? (n / total) * 100 : 0, fullExit: n === h };
}

/** Holders who would be left with a fraction of a share by a split A -> B */
export function splitProblems(st, a, b) {
  const bad = [];
  const whole = (n) => {
    const v = q(n).mul(b).div(a);
    return v.eq(new Q(v.floor()));
  };
  for (const h of Object.values(st.holders)) {
    if (held(h) > 0) {
      if (!(whole(h.eq) && whole(h.pref))) bad.push(h.name);
    }
  }
  if (st.pool && !whole(st.pool)) bad.push('the option pool');
  return bad;
}

/** Single-instrument preview or a conversion outside a round. */
export function previewInstrument(w, { shares, pool = 0, preMoney, date }) {
  const base = { issued: shares, pool, waiting: [w], faceValue: 10, authShares: null };
  return computeRound(base, { offers: [], pricing: { pre: preMoney }, date, dilution: 'pre' });
}

/* ------------------------------------------------------------------ */
/* Quick Calc: percentages and rupees only                              */
/* ------------------------------------------------------------------ */
export function quickCalc(inp) {
  const res = { ok: false, errors: [], warnings: [], math: [] };
  const err = (m) => res.errors.push(m);
  try {
    const I = q(inp.amount || 0);
    if (!I.gt(ZERO)) err('The investment must be more than 0.');
    const own = q(inp.own === '' || inp.own == null ? 100 : inp.own);
    if (own.lte(ZERO) || own.gt(q(100))) err('Your ownership today must be between 0% and 100%.');
    const t = inp.poolPct ? q(inp.poolPct).div(100) : ZERO;
    if (t.lt(ZERO) || t.gte(ONE)) err('The option pool must be between 0% and 100%.');
    if (res.errors.length) return res;
    const ownF = own.div(100);

    if (['pct', 'pre', 'post'].includes(inp.type)) {
      let post;
      let pre;
      if (inp.type === 'pct') {
        const p = q(inp.pct || 0).div(100);
        if (!p.gt(ZERO)) return (err('Equity % must be more than 0.'), res);
        if (p.gte(ONE)) return (err('An investor cannot buy 100% by funding the company. A full 100% is a buy-out.'), res);
        if (p.gt(q('0.99'))) return (err('An investor can get at most 99% in a funding round.'), res);
        post = I.div(p);
        pre = post.sub(I);
      } else if (inp.type === 'pre') {
        pre = q(inp.pre || 0);
        if (!pre.gt(ZERO)) return (err('Pre-money must be more than 0.'), res);
        post = pre.add(I);
      } else {
        post = q(inp.post || 0);
        if (!post.gt(I)) return (err('Post-money must be more than the investment.'), res);
        pre = post.sub(I);
      }
      const s = I.div(post);
      if (s.gt(q('0.99'))) return (err('The investor would hold more than 99%.'), res);
      const others = ONE.sub(s).sub(t);
      if (others.lte(ZERO)) return (err('The investor and the option pool together would take everything.'), res);
      const yours = ownF.mul(others);
      Object.assign(res, {
        ok: true,
        kind: 'priced',
        pre: pre.toNumber(),
        post: post.toNumber(),
        investorPct: s.mul(100).toNumber(),
        poolPct: t.mul(100).toNumber(),
        yoursBefore: own.toNumber(),
        yoursAfter: yours.mul(100).toNumber(),
        lost: own.sub(yours.mul(100)).toNumber(),
        existingAfter: others.mul(100).toNumber(),
      });
      return res;
    }

    // iSAFE and note
    const w = inp.type === 'isafe'
      ? { id: 'qc', kind: 'isafe', type: inp.isafeType, holder: { name: 'Investor' }, holderId: 'qc', amount: Number(inp.amount), cap: inp.cap ? Number(inp.cap) : null, discountPct: inp.discount ? Number(inp.discount) : 0, date: inp.date }
      : { id: 'qc', kind: 'note', holder: { name: 'Investor' }, holderId: 'qc', amount: Number(inp.amount), ratePct: Number(inp.rate || 0), discountPct: inp.discount ? Number(inp.discount) : 0, cap: inp.cap ? Number(inp.cap) : null, issueDate: inp.date, maturityDate: inp.maturity || addYears(inp.date, 10), date: inp.date };
    if (inp.type === 'isafe') {
      if (['cap_discount', 'cap'].includes(w.type) && !(w.cap > 0)) return (err('Enter the valuation cap.'), res);
      if (['cap_discount', 'discount'].includes(w.type) && !(w.discountPct > 0 && w.discountPct < 100)) return (err('Discount must be above 0% and below 100%.'), res);
      if (w.cap && w.cap <= w.amount) return (err('The cap must be more than the investment.'), res);
    } else {
      if (w.ratePct < 0) return (err('Interest cannot be negative.'), res);
      if (w.discountPct && !(w.discountPct > 0 && w.discountPct < 100)) return (err('Discount must be above 0% and below 100%.'), res);
    }
    if (inp.type === 'isafe' && w.type === 'cap') {
      const r = resolveCapOnly(1000000, w.amount, w.cap);
      if (!r.ok) return (err(r.error), res);
      const sPct = (w.amount / w.cap) * 100;
      Object.assign(res, { ok: true, kind: 'capOnly', investorPct: r.stakePct, exactStakePct: sPct, yoursBefore: own.toNumber(), yoursAfter: own.toNumber() * (1 - r.stakePct / 100), lost: own.toNumber() * (r.stakePct / 100) });
      return res;
    }
    if (inp.assumedPre) {
      const rr = previewInstrument(w, { shares: 1000000, preMoney: inp.assumedPre, date: inp.nextDate || inp.date });
      if (!rr.ok) return (res.errors.push(...rr.errors), res);
      const c = rr.conversions[0];
      const total = rr.T;
      const youAfter = own.toNumber() * (1000000 / total);
      Object.assign(res, { ok: true, kind: 'preview', conversion: c, investorPct: c.stakePct, yoursBefore: own.toNumber(), yoursAfter: youAfter, lost: own.toNumber() - youAfter, price: rr.price, assumedPre: Number(inp.assumedPre) });
      return res;
    }
    Object.assign(res, { ok: true, kind: 'terms' });
    return res;
  } catch (e) {
    err(e.message);
    return res;
  }
}

/* ------------------------------------------------------------------ */
/* Waiting instrument flags                                            */
/* ------------------------------------------------------------------ */
export function instrumentFlags(w, st, today) {
  const flags = [];
  if (w.kind === 'isafe') {
    if (w.expiry && today > w.expiry) flags.push({ tone: 'bad', text: 'Expired: convert' });
    else if (w.expiry) flags.push({ tone: 'info', text: 'Expires ' + w.expiry });
    if (w.angel && w.lockEnd) flags.push({ tone: today <= w.lockEnd ? 'warn' : 'info', text: (today <= w.lockEnd ? 'Locked until ' : 'Lock-in ended ') + w.lockEnd });
    if (st && st.faceValue !== 10) flags.push({ tone: 'warn', text: 'Forms assume a ₹10 face value' });
  } else {
    if (w.maturityDate && today > w.maturityDate) flags.push({ tone: 'bad', text: 'Matured: convert or repay' });
    else if (w.maturityDate) flags.push({ tone: 'info', text: 'Matures ' + w.maturityDate });
    if (st && !st.dpiit) flags.push({ tone: 'warn', text: 'Not marked DPIIT-recognised' });
    if (w.amount < 2500000) flags.push({ tone: 'warn', text: 'Below ₹25 lakh' });
    if (w.maturityDate && w.issueDate && w.maturityDate > addYears(w.issueDate, 10)) flags.push({ tone: 'warn', text: 'Longer than 10 years' });
  }
  return flags;
}
