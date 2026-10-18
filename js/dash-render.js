/* The dashboard's views. Every function takes the model `M` (built by page-dashboard.js) and returns html. */
import { html, raw, donutSVG } from './ui.js';
import * as F from './fmt.js';
import {
  Q, totalShares, issuedShares, capTable, metrics, instrumentFlags, computeRound, todayISO, colorFor, POOL_COLOR, r2,
} from './engine.js';
import { kindLabel, ISAFE_TYPES } from './ledger.js';
import { moneyField, pctField, intField, textField, dateField, selectField } from './forms.js';
import { settlementClause, kpi, meter } from './views.js';

const cur = (M) => M.base.currency;
const numStr = (n) => (Number.isFinite(n) ? String(+Number(n).toFixed(6)) : '');
const pctPlain = (x) => F.pct(x).replace('%', '');

/* ================================================================== */
/* KPI tiles                                                          */
/* ================================================================== */
export function kpisView(M) {
  const st = M.st;
  const sv = M.saved;
  const m = metrics(st);
  const c = st.currency;
  const r = M.draft.round;
  const capacity = Math.max(st.authShares, m.total) || 1;
  const w = (n) => ((Math.max(0, n) / capacity) * 100).toFixed(3) + '%';
  const cIssued = M.hasSplit ? 0 : Math.min(issuedShares(sv), m.issued);
  const cPool = M.hasSplit ? 0 : Math.min(sv.pool, m.pool);
  const fresh = m.issued - cIssued + (m.pool - cPool);
  const tank = html`<div class="tank" role="img" aria-label="Authorised shares: ${F.int(m.issued)} issued, ${F.int(m.pool)} in the option pool, ${F.int(m.unissued)} unissued">
      <i style="width:${w(cIssued)};background:var(--ink)"></i><i style="width:${w(cPool)};background:#9aa3b5"></i><i style="width:${w(fresh)};background:var(--accent)"></i>${m.over ? html`<i style="width:${w(m.over)};background:var(--neg)"></i>` : ''}
    </div>
    <div class="tank-legend"><span><i class="dot sq" style="background:var(--ink)"></i>Issued ${F.int(cIssued)}</span>${m.pool ? html`<span><i class="dot sq" style="background:#9aa3b5"></i>Pool ${F.int(cPool)}</span>` : ''}${fresh > 0 ? html`<span><i class="dot sq" style="background:var(--accent)"></i>New ${F.int(fresh)}</span>` : ''}<span>Unissued ${F.int(m.unissued)}</span></div>`;

  let pre;
  let post;
  let preS;
  let postS;
  if (r && r.ok) {
    pre = F.money(r.preActual, c);
    post = F.money(r.postActual, c);
    preS = 'This deal';
    postS = r.postAgreed && Math.abs(r.postAgreed - r.postActual) > 0.5 ? `After the money · agreed ${F.compact(r.postAgreed, c)}` : 'After the money comes in';
  } else if (st.lastRound) {
    pre = F.money(st.lastRound.pre, c);
    post = F.money(st.lastRound.post, c);
    preS = `${st.lastRound.name} · ${F.date(st.lastRound.date)}`;
    postS = `${F.price(st.lastPrice, c)} a share`;
  } else {
    pre = '—';
    preS = 'No priced round yet';
    post = F.money(m.implied, c);
    postS = 'Shares × face value (not priced)';
  }
  const bank = m.cash + m.heldInstruments;
  return html`
    <div class="kpi ${m.over ? 'alert' : ''}"><div class="k">Authorised capital</div><div class="v">${F.money(st.authCapital, c)}</div><div class="s">${F.int(st.authShares)} shares × ${F.price(st.faceValue, c)}</div><div style="margin-top:8px">${tank}</div></div>
    ${kpi('Total paid-in cash (bank)', F.money(bank, c), m.heldInstruments ? `${F.money(m.cash, c)} for shares + ${F.money(m.heldInstruments, c)} in iSAFEs and notes` : `${F.money(m.cash, c)} paid for shares`)}
    ${kpi('Paid-up capital vs ceiling', F.money(m.nominal, c), `${F.pct(m.paidUpPct)} of the ${F.money(m.authCapital, c)} ceiling`, { extra: meter(m.paidUpPct) })}
    ${kpi('Unissued reserve pool', `${F.int(m.unissued)} shares`, m.over ? `Over the limit by ${F.int(m.over)} shares` : `${F.money(m.unissued * st.faceValue, c)} of capital room left`, { cls: m.over ? 'alert' : '' })}
    ${kpi('Pre-money valuation', pre, preS)}
    ${kpi('Post-money valuation', post, postS)}`;
}

/* ================================================================== */
/* Setup                                                              */
/* ================================================================== */
export function setupFormView(M, setup, touched) {
  const c = setup.currency || 'INR';
  const sym = F.symbolOf(c);
  const lock = M.locked;
  const dis = lock ? raw('disabled') : '';
  const calc = (k) => !touched.includes(k);
  const fld = (id, label, inner, hintTxt, isCalc) => html`<div class="field"><label for="${id}">${label} <span class="badge info cb ${isCalc ? '' : 'hide'}" title="Worked out from the other two">auto</span></label>${inner}<span class="hint" ${raw(`data-hint-for="${id}"`)}>${hintTxt || ' '}</span></div>`;
  return html`
    ${lock ? html`<div class="alert info" style="margin-bottom:14px"><div class="grow"><b>The setup is locked</b> because this cap table already has history, and changing the starting numbers would rewrite it. Use <b>Increase authorised capital</b>, <b>Split</b>, <b>Issue</b> or <b>Transfer</b> below. The name and DPIIT status can still change. Undo the history in the Archive to unlock.</div></div>` : ''}
    <div class="cols3">
      ${fld('s-cap', 'Authorised capital', html`<div class="prefix"><span>${sym}</span><input id="s-cap" type="text" inputmode="decimal" class="num-in ${calc('capital') ? 'linked' : ''}" value="${numStr(setup.authorisedCapital)}" autocomplete="off" ${dis}></div>`, '', calc('capital'))}
      ${fld('s-sh', 'Authorised shares (max)', html`<input id="s-sh" type="text" inputmode="numeric" class="num-in ${calc('shares') ? 'linked' : ''}" value="${numStr(setup.authorisedShares)}" autocomplete="off" ${dis}>`, '', calc('shares'))}
      ${fld('s-fv', 'Face value per share', html`<div class="prefix"><span>${sym}</span><input id="s-fv" type="text" inputmode="decimal" class="num-in ${calc('faceValue') ? 'linked' : ''}" value="${numStr(setup.faceValue)}" autocomplete="off" ${dis}></div>`, '', calc('faceValue'))}
    </div>
    <p class="hint small muted" style="margin:6px 0 14px">Change any two of these. The third is worked out for you (capital ÷ face value = shares).</p>
    <div class="cols2" style="margin-bottom:14px">
      ${dateField('s-inc', 'Incorporation date', setup.incorporationDate)}
      <div></div>
    </div>
    <div class="lbl" style="margin-bottom:6px">Founders</div>
    <div class="f-head"><span>Name</span><span>Designation</span><span class="num">Shares</span><span class="num">Paid-up (${sym.trim()})</span><span class="num">% of authorised</span><span></span></div>
    <div id="f-rows">${setup.founders.map((f, i) => founderRow(f, i, setup, lock, setup.founders.length))}</div>
    ${lock ? '' : html`<div style="margin-top:8px"><button type="button" class="btn sm" data-act="add-founder">+ Add founder</button></div>`}
    <div id="setup-sum" style="margin-top:14px"></div>`;
}

function founderRow(f, i, setup, lock, n) {
  const dis = lock ? raw('disabled') : '';
  const pct = setup.authorisedShares > 0 && Number.isFinite(f.shares) ? (f.shares / setup.authorisedShares) * 100 : NaN;
  return html`<div class="f-row" data-fi="${i}">
    <input class="f-name" type="text" value="${f.name}" maxlength="60" aria-label="Founder name" autocomplete="off" ${dis}>
    <input class="f-des" type="text" value="${f.designation}" maxlength="60" aria-label="Designation" autocomplete="off" ${dis}>
    <input class="f-sh num-in" type="text" inputmode="numeric" value="${numStr(f.shares)}" aria-label="Shares" autocomplete="off" ${dis}>
    <input class="f-paid num-in" type="text" inputmode="decimal" value="${numStr(f.paid)}" aria-label="Paid-up amount" autocomplete="off" ${dis}>
    <input class="f-pct num-in" type="text" inputmode="decimal" value="${Number.isFinite(pct) ? pctPlain(pct) : ''}" aria-label="Percent of authorised shares" autocomplete="off" ${dis}>
    ${lock || n < 2 ? html`<span></span>` : html`<button type="button" class="icon-btn" data-act="del-founder" data-i="${i}" aria-label="Remove founder ${f.name}" title="Remove">✕</button>`}
  </div>`;
}

export function setupSumView(M, setup) {
  const c = setup.currency || 'INR';
  const tot = setup.founders.reduce((s, f) => s + (Number.isInteger(f.shares) ? f.shares : 0), 0);
  const paid = setup.founders.reduce((s, f) => s + (Number.isFinite(f.paid) ? f.paid : 0), 0);
  const auth = setup.authorisedShares;
  const nominal = Number.isFinite(setup.faceValue) ? r2(Q.of(tot).mul(setup.faceValue)) : NaN;
  return html`
    <div class="result">
      <div><span>Founders hold</span><b>${F.int(tot)} shares (${Number.isFinite(auth) && auth > 0 ? F.pct((tot / auth) * 100) : '—'})</b></div>
      <div><span>Paid up by founders</span><b>${F.money(paid, c)}</b></div>
      <div><span>Face value of those shares</span><b>${F.money(nominal, c)}</b></div>
      <div><span>Unissued after founders</span><b>${Number.isFinite(auth) ? F.int(Math.max(0, auth - tot)) : '—'} shares</b></div>
    </div>
    ${M.setupErr.length ? html`<div class="alert bad" style="margin-top:10px"><div class="grow">${M.setupErr.map((e) => html`<div>${e}</div>`)}</div></div>` : ''}`;
}

/* ================================================================== */
/* Deal: offers, options, result                                      */
/* ================================================================== */
function offerLine(o, base) {
  const c = o.currency ? o.currency.code : base;
  const amt = F.money(o.amountOriginal, c);
  const fx = o.currency ? ` (rate 1 ${o.currency.code} = ${F.money(o.currency.rate, base)})` : '';
  if (o.type === 'priced') {
    const how = { pct: `for ${F.pct2(o.pct)} equity`, pre: `at ${F.compact(o.pre, c)} pre-money`, post: `at ${F.compact(o.post, c)} post-money`, shares: `${F.int(o.shares)} shares × ${F.price(o.price, c)}`, same: 'at the same price as the first investor' }[o.mode] || '';
    return `${amt} ${how}${fx}`;
  }
  if (o.type === 'isafe') return `${amt} iSAFE · ${ISAFE_TYPES[o.isafeType]}${o.cap ? ' · cap ' + F.compact(o.cap, c) : ''}${o.discountPct ? ' · ' + F.pct2(o.discountPct) + ' discount' : ''}${fx}`;
  return `${amt} convertible note · ${F.pct2(o.ratePct || 0)} interest${o.discountPct ? ' · ' + F.pct2(o.discountPct) + ' discount' : ''}${o.cap ? ' · cap ' + F.compact(o.cap, c) : ''} · matures ${F.date(o.maturityDate)}${fx}`;
}

export function offersView(M, offers) {
  const c = cur(M);
  const r = M.draft.round && M.draft.round.ok ? M.draft.round : null;
  const priced = offers.filter((o) => o.type === 'priced');
  return offers.map((o, i) => {
    const holder = o.existingHolderId ? M.base.holders[o.existingHolderId] : null;
    const name = holder ? holder.name : o.name || 'Investor ' + (i + 1);
    const color = holder ? colorFor(holder.colorIdx) : colorFor(M.base.order.length + i);
    let result = '';
    if (o.type === 'priced' && r) {
      const inv = r.investors[priced.findIndex((x) => x.id === o.id)];
      if (inv) result = html`<div class="d" style="color:var(--ink)">Gets <b>${F.int(inv.shares)} shares</b> (${F.pct(inv.stakePct)}) and pays ${F.money(inv.paid, c)}${inv.unspent > 0.004 ? html` · <span style="color:var(--warn)">${F.money(inv.unspent, c)} settled in cash</span>` : ''}</div>`;
    } else if (o.type !== 'priced') {
      const ev = M.draft.events.find((e) => e.id === o.id);
      if (ev && ev.data.shares) result = html`<div class="d" style="color:var(--ink)">Day-one holding: <b>${F.int(ev.data.shares)} preference shares</b> (${F.pct(ev.data.stakePct)})</div>`;
      else if (ev) result = html`<div class="d">Waits and converts at the next priced round.</div>`;
    }
    return html`<div class="offer">
      <span class="swatch" style="background:${color};margin-top:6px"></span>
      <div class="body"><div class="t">${name} ${o.existingHolderId ? html`<span class="badge">existing shareholder</span>` : ''}</div><div class="d">${offerLine(o, c)}</div>${result}</div>
      <button type="button" class="btn sm" data-act="edit-offer" data-id="${o.id}">Edit</button>
      <button type="button" class="icon-btn" data-act="del-offer" data-id="${o.id}" aria-label="Remove ${name}" title="Remove">✕</button>
    </div>`;
  });
}

export function dealOptionsView(M, roundOpts) {
  const st = M.base;
  const total = totalShares(st);
  const poolNow = total ? (st.pool / total) * 100 : 0;
  return html`
    <div class="cols3">
      ${textField('d-name', 'Round name', roundOpts.roundName, { placeholder: 'Priced round' })}
      ${dateField('d-date', 'Effective date', roundOpts.date)}
      ${pctField('d-pool', 'Option pool after the round', roundOpts.poolTarget == null ? '' : String(roundOpts.poolTarget), { hint: st.pool ? `Now ${F.pct2(poolNow)}. Leave empty for no top-up.` : 'Leave empty for no pool.' })}
    </div>
    ${selectField('d-dil', 'Who shares the dilution of a pool top-up and converting deals', [{ v: 'pre', l: 'Existing holders only (they are inside the pre-money)' }, { v: 'post', l: 'Everyone, new investors too (they are outside the pre-money)' }], roundOpts.dilution)}`;
}

function mathLines(M, r, priced) {
  const c = cur(M);
  const b = M.draft.base;
  const first = r.investors[0];
  const denom = r.preActual && r.price ? Math.round(r.preActual / r.price) : r.S0;
  const L = [];
  L.push(['Shares before', `${F.int(b.issued)} issued + ${F.int(b.pool)} in the pool = ${F.int(r.S0)}`]);
  if (priced[0].mode === 'shares') L.push(['Price per share', `${F.price(r.price, c)} (stated by the offer)`]);
  else L.push(['Price per share', `pre-money ${F.money(r.preActual, c)} ÷ ${F.int(denom)} shares counted before the money = ${F.price(r.price, c)}`]);
  r.investors.forEach((inv, j) => {
    const nm = M.draft.roundEvent ? M.draft.roundEvent.data.investors[j].holder.name : 'Investor ' + (j + 1);
    L.push([`${nm}'s shares`, `${F.money(inv.offered, c)} ÷ ${F.price(r.price, c)} = ${inv.exact.toFixed(4)} → ${F.int(inv.shares)} whole shares`]);
    L.push([`${nm} pays`, `${F.int(inv.shares)} × ${F.price(r.price, c)} = ${F.money(inv.paid, c)}${inv.unspent > 0.004 ? `. Settled in cash: ${F.money(inv.offered, c)} − ${F.money(inv.paid, c)} = ${F.money(inv.unspent, c)}` : ''}`]);
  });
  if (r.X) L.push(['Option pool top-up', `${F.int(r.X)} new pool shares so the pool is ${F.pct2(r.poolPct)} of ${F.int(r.T)}`]);
  r.conversions.forEach((cv) => L.push([`${cv.name}'s deal`, `${F.money(cv.accrued, c)} ÷ ${F.price(cv.price, c)} (${cv.route}) = ${F.int(cv.shares)} shares`]));
  L.push(['Total shares after', `${F.int(r.S0)} + ${F.int(r.sumN)} new${r.sumC ? ' + ' + F.int(r.sumC) + ' converted' : ''}${r.X ? ' + ' + F.int(r.X) + ' pool' : ''} = ${F.int(r.T)}`]);
  L.push(['Post-money', `${F.int(r.T)} × ${F.price(r.price, c)} = ${F.money(r.postActual, c)}`]);
  L.push(['Premium', `Share capital ${F.money(r.totals.nominal + r.conversions.reduce((s, x) => s + x.nominal, 0), c)} (shares × ${F.price(M.base.faceValue, c)}). Securities premium ${F.money(r.totals.premium + r.conversions.reduce((s, x) => s + x.premium, 0), c)}`]);
  return L;
}

export function resultView(M, offers) {
  const c = cur(M);
  const d = M.draft;
  if (!offers.length) {
    return html`<p class="muted small" style="margin:0">Add an investor to see the price per share, new shares, dilution and the new cap table live. Nothing is saved until you accept.</p>`;
  }
  const out = [];
  if (d.errors.length) out.push(html`<div class="alert bad"><div class="grow">${d.errors.map((e) => html`<div>${e}</div>`)}</div></div>`);
  const r = d.round;
  const priced = offers.filter((o) => o.type === 'priced');
  if (r && r.ok) {
    const names = d.roundEvent.data.investors.map((i) => i.holder.name);
    out.push(html`<div class="result">
      <div><span>Price per share</span><b>${F.price(r.price, c)}</b></div>
      <div><span>New shares to investors</span><b>${F.int(r.sumN)}</b></div>
      <div><span>Money coming in</span><b>${F.money(r.totals.paid, c)}</b></div>
      <div><span>New investors' stake</span><b>${F.pct(r.stakeNew)}</b></div>
      <div><span>Pre-money</span><b>${F.money(r.preActual, c)}</b></div>
      <div><span>Post-money</span><b>${F.money(r.postActual, c)}</b></div>
      ${r.X ? html`<div><span>Option pool top-up</span><b>${F.int(r.X)} shares → ${F.pct(r.poolPct)}</b></div>` : ''}
      ${r.sumC ? html`<div><span>Waiting deals converting</span><b>${F.int(r.sumC)} shares</b></div>` : ''}
      <div><span>Total shares after</span><b>${F.int(r.T)} of ${F.int(r.auth.limit)} authorised</b></div>
    </div>`);
    out.push(html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Investor</th><th class="num">Offered</th><th class="num">Shares</th><th class="num">Pays</th><th class="num">Stake</th></tr></thead><tbody>
      ${r.investors.map((inv, j) => html`<tr><td><b>${names[j]}</b></td><td class="num">${F.money(inv.offered, c)}</td><td class="num">${F.int(inv.shares)}</td><td class="num">${F.money(inv.paid, c)}</td><td class="num">${F.pct(inv.stakePct)}</td></tr>`)}
      </tbody></table></div>`);
    r.investors.forEach((inv, j) => out.push(settlementClause(inv, r.price, c, names[j])));
    if (r.conversions.length) {
      out.push(html`<div class="lbl">Waiting deals that convert in this round</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Holder</th><th class="num">Counted</th><th class="num">Price</th><th>How</th><th class="num">Shares</th><th class="num">Stake</th></tr></thead><tbody>
        ${r.conversions.map((x) => html`<tr><td><b>${x.name}</b><br><span class="xs muted">${x.kind === 'note' ? 'Convertible note' : 'iSAFE'}${x.days ? ` · ${x.days} days interest` : ''}</span></td><td class="num">${F.money(x.accrued, c)}</td><td class="num">${F.price(x.price, c)}</td><td>${x.route}</td><td class="num">${F.int(x.shares)}</td><td class="num">${F.pct(x.stakePct)}</td></tr>`)}
        </tbody></table></div>`);
    }
    if (!r.auth.ok) {
      const short = r.T - r.auth.limit;
      out.push(html`<div class="alert bad"><div class="grow"><b>More than the authorised shares.</b> This deal needs ${F.int(r.T)} shares but only ${F.int(r.auth.limit)} are authorised (${F.int(short)} short). Increase the authorised capital (Form SH-7) before you accept.</div>
        <button type="button" class="btn sm" data-act="fit-auth" data-need="${r.T}">Increase it now</button></div>`);
    }
    out.push(html`<details class="math"><summary>Show the math</summary><div class="lines">${mathLines(M, r, priced).map(([a, b]) => html`<div class="mline"><span>${a}</span><code>${b}</code></div>`)}</div></details>`);
  }
  d.events.filter((e) => e.kind === 'isafe' || e.kind === 'note').forEach((e) => out.push(html`<div class="alert info"><div class="grow"><b>${e.title}.</b> ${e.summary}</div></div>`));
  d.warnings.forEach((w) => out.push(html`<div class="alert warn"><div class="grow">${w}</div></div>`));
  return out;
}

/* ================================================================== */
/* Actions and pending changes                                        */
/* ================================================================== */
export function actionsView(M) {
  const none = M.base.order.length === 0;
  const btn = (act, label, sub) => html`<button type="button" class="btn block" style="flex-direction:column;align-items:flex-start;gap:1px;padding:10px 13px;text-align:left" data-act="${act}" ${none && act !== 'auth' ? raw('disabled') : ''}><b style="font-weight:600">${label}</b><span class="xs muted" style="font-weight:400;white-space:normal">${sub}</span></button>`;
  return html`<div class="cols3" style="gap:10px">
    ${btn('transfer', 'Transfer shares', 'Sell or gift to someone. Nobody is diluted.')}
    ${btn('split', 'Split shares', 'Cut every share into more. Ownership stays.')}
    ${btn('issue', 'Issue shares', 'New shares for a co-founder or advisor.')}
    ${btn('pool', 'Option pool (ESOP)', 'Reserve shares for future hires.')}
    ${btn('auth', 'Increase authorised capital', 'Form SH-7 for more room to issue.')}
    ${btn('lockin', 'Record a lock-in', 'E.g. founders locked in for five years.')}
  </div>`;
}

export function pendingView(M, pending) {
  const out = [];
  if (M.problems.length) {
    out.push(html`<div class="alert bad"><div class="grow"><b>Some events cannot be applied.</b> ${M.problems.map((p) => html`<div>${p.msg}</div>`)}<div class="small">Open the Archive to fix the history.</div></div></div>`);
  }
  if (pending.length) {
    out.push(pending.map((ev) => html`<div class="offer">
      <div class="body"><div class="t">${ev.title} <span class="badge warn">${kindLabel(ev.kind)} · ${F.date(ev.effectiveDate)}</span></div><div class="d">${ev.summary}</div></div>
      <button type="button" class="icon-btn" data-act="del-pending" data-id="${ev.id}" aria-label="Remove this change" title="Remove">✕</button></div>`));
  }
  return out;
}

/* ================================================================== */
/* Right column                                                       */
/* ================================================================== */
export function donutView(M, view, showSaved) {
  const compareOn = M.changed;
  const st = showSaved && compareOn ? M.saved : M.st;
  const ct = capTable(st, view);
  const slices = ct.rows.map((r) => ({ label: r.name, value: r.shares, color: r.color }));
  return html`<div class="donut-wrap">
    ${raw(donutSVG(slices, { size: 200, thickness: 34, top: F.int(ct.total), bottom: 'shares' }))}
    <ul class="legend">${ct.rows.map((r) => html`<li><i class="dot sq" style="background:${r.color}"></i><span class="n" title="${r.name}">${r.name}</span><b>${F.pct(r.pct)}</b></li>`)}</ul>
  </div>`;
}

export function tableView(M, view) {
  const c = cur(M);
  const live = capTable(M.st, view);
  const sv = capTable(M.saved, view);
  const byId = new Map(sv.rows.map((r) => [r.id, r]));
  const today = todayISO();
  const rows = live.rows.map((r) => {
    const o = byId.get(r.id);
    const diff = o ? r.pct - o.pct : null;
    const lock = r.lock;
    return html`<tr>
      <td><div class="who"><span class="swatch" style="background:${r.color}"></span><div>${r.isPool || r.waiting ? html`<b>${r.name}</b>` : html`<button type="button" class="name-btn" data-act="edit-holder" data-id="${r.id}" title="Edit name, designation or role">${r.name}</button>`}<small>${r.isPool ? 'Reserved, not owned yet' : r.designation || ''}${r.pref ? ` · ${F.int(r.pref)} preference` : ''}</small>${lock ? html`<small style="color:var(--warn)">Locked in until ${F.date(lock.until)}</small>` : ''}</div></div></td>
      <td class="num">${F.int(r.shares)}</td>
      <td class="num"><b>${F.pct(r.pct)}</b></td>
      <td class="num muted">${o ? F.pct(o.pct) : '—'}</td>
      <td class="num">${o ? html`<span class="${diff > 0.004 ? 'up' : diff < -0.004 ? 'down' : 'muted'}">${F.pts(diff)}</span>` : html`<span class="badge warn">New</span>`}</td>
      <td class="num">${F.money(r.invested, c)}</td>
    </tr>`;
  });
  const gone = sv.rows.filter((r) => !live.rows.some((x) => x.id === r.id) && !r.isPool);
  return html`<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Shareholder</th><th class="num">Shares</th><th class="num">Ownership</th><th class="num">Saved</th><th class="num">Change</th><th class="num">Invested</th></tr></thead>
    <tbody>${rows}
      ${gone.map((r) => html`<tr class="voided"><td><div class="who"><span class="swatch" style="background:${r.color}"></span><b>${r.name}</b></div></td><td class="num">${F.int(r.shares)}</td><td class="num">${F.pct(0)}</td><td class="num">${F.pct(r.pct)}</td><td class="num">${F.pts(-r.pct)}</td><td class="num"></td></tr>`)}
      <tr class="total"><td>Total</td><td class="num">${F.int(live.total)}</td><td class="num">${F.pct(live.rows.length ? 100 : 0)}</td><td class="num">${F.pct(sv.rows.length ? 100 : 0)}</td><td class="num"></td><td class="num">${F.money(live.rows.reduce((s, r) => s + (r.invested || 0), 0), c)}</td></tr>
    </tbody></table></div>`;
}

export function waitingListView(M, offers, assumedPre) {
  const c = cur(M);
  const st = M.st;
  const today = todayISO();
  if (!st.waiting.length) return html`<p class="muted small" style="margin:0">No iSAFEs or convertible notes are waiting. A new one waits here until a priced round (or its expiry or maturity) turns it into shares.</p>`;
  let assumed = null;
  if (assumedPre > 0) {
    const base = { issued: issuedShares(st), pool: st.pool, waiting: st.waiting, faceValue: st.faceValue, authShares: null };
    try {
      assumed = computeRound(base, { offers: [], pricing: { pre: assumedPre }, poolTarget: null, dilution: 'pre', date: today });
    } catch (e) {
      assumed = null;
    }
  }
  return st.waiting.map((w) => {
    const flags = instrumentFlags(w, st, today);
    const inDeal = offers.some((o) => o.id === w.id);
    const cv = assumed && assumed.ok ? assumed.conversions.find((x) => x.instrumentId === w.id) : null;
    const wc = w.currency ? w.currency.code : c;
    return html`<div class="offer">
      <span class="swatch" style="background:${colorFor(w.holder.colorIdx ?? 0)};margin-top:6px"></span>
      <div class="body">
        <div class="t">${w.holder.name} <span class="badge">${w.kind === 'note' ? 'Convertible note' : 'iSAFE · ' + ISAFE_TYPES[w.type]}</span>${inDeal ? html` <span class="badge warn">In this deal</span>` : ''}</div>
        <div class="d">${F.money(w.amount, c)}${w.kind === 'note' ? ` · ${F.pct2(w.ratePct || 0)} interest` : ''}${w.cap ? ` · cap ${F.compact(w.cap, c)}` : ''}${w.discountPct ? ` · ${F.pct2(w.discountPct)} discount` : ''} · since ${F.date(w.date)}</div>
        <div class="btn-row" style="margin-top:5px;gap:5px">${flags.map((f) => html`<span class="badge ${f.tone}">${f.text.replace(/\d{4}-\d{2}-\d{2}/, F.date)}</span>`)}</div>
        ${cv ? html`<div class="d" style="margin-top:6px;color:var(--ink)">At the assumed round: <b>${F.int(cv.shares)} shares</b> (${F.pct(cv.stakePct)}) at ${F.price(cv.price, c)} · ${cv.route}</div>` : ''}
      </div>
      ${inDeal ? '' : html`<div class="btn-row" style="flex-direction:column;gap:4px"><button type="button" class="btn sm" data-act="convert" data-id="${w.id}">Convert</button><button type="button" class="btn sm ghost" data-act="cancel" data-id="${w.id}">Remove</button></div>`}
    </div>`;
  });
}

export function moneyView(M) {
  const c = cur(M);
  const m = metrics(M.st);
  const base = Math.max(m.cash, m.nominal, 1);
  const nomW = Math.min(100, (Math.min(m.nominal, m.cash) / base) * 100);
  const preW = Math.min(100 - nomW, (m.premium / base) * 100);
  return html`
    <div class="stackbar" style="max-width:none;height:16px;border-radius:4px;background:var(--line-2);margin-bottom:10px">
      <i style="width:${nomW.toFixed(2)}%;background:var(--ink);border-color:#fff"></i><i style="width:${preW.toFixed(2)}%;background:var(--accent);border-color:#fff"></i>
    </div>
    <div class="result" style="grid-template-columns:minmax(0,1fr)">
      <div><span><i class="dot sq" style="background:var(--ink)"></i>Share capital (shares × face value)</span><b>${F.money(m.nominal, c)}</b></div>
      <div><span><i class="dot sq" style="background:var(--accent)"></i>Securities premium (paid above face value)</span><b>${F.money(m.premium, c)}</b></div>
      <div><span>Cash received for shares</span><b>${F.money(m.cash, c)}</b></div>
      <div><span>Held in iSAFEs and notes (not shares yet)</span><b>${F.money(m.heldInstruments, c)}</b></div>
      <div><span><b>Total in the bank</b></span><b>${F.money(m.cash + m.heldInstruments, c)}</b></div>
    </div>
    <p class="xs muted" style="margin:10px 0 0">Share capital counts against the authorised ceiling. The premium does not. Cash left over from a fractional share is settled back and never counted.</p>`;
}
