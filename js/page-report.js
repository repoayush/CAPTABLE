/* A printable copy of the cap table, as of any date. */
import { requireUser, getStartup, loadEvents } from './backend.js';
import { mountTopbar, html, mount, $ } from './ui.js';
import * as F from './fmt.js';
import { replay, capTable, metrics, issuedShares, instrumentFlags, todayISO, sortEvents, isISO } from './engine.js';
import { kindLabel, ISAFE_TYPES } from './ledger.js';

const user = await requireUser();
const sid = new URLSearchParams(location.search).get('s');
if (!sid) {
  location.replace('home.html');
  throw new Error('no startup chosen');
}
mountTopbar(user, { active: 'report', sid });

let startup = null;
let events = [];

function draw() {
  const asof = isISO($('#asof').value) ? $('#asof').value : todayISO();
  const st = replay(events, { asOf: asof });
  const c = st.currency;
  const m = metrics(st);
  const fd = capTable(st, 'fd');
  const iss = capTable(st, 'issued');
  const live = sortEvents(events).filter((e) => !e.voidedAt && e.effectiveDate <= asof);
  document.title = `Cap table · ${st.name || startup.name} · ${F.date(asof)}`;
  mount($('#report'), html`
    <h1>${st.name || startup.name}</h1>
    <div class="muted">Cap table as of <b>${F.date(asof)}</b> · generated ${F.dateTime(Date.now())}${st.dpiit ? ' · DPIIT-recognised' : ''}</div>
    <div class="figs">
      <div><span>Authorised capital</span><b>${F.money(m.authCapital, c)}</b></div>
      <div><span>Authorised shares</span><b>${F.int(m.authShares)}</b></div>
      <div><span>Face value</span><b>${F.price(st.faceValue, c)}</b></div>
      <div><span>Issued shares</span><b>${F.int(m.issued)}</b></div>
      <div><span>Option pool</span><b>${F.int(m.pool)}</b></div>
      <div><span>Unissued shares</span><b>${F.int(m.unissued)}</b></div>
      <div><span>Paid-up share capital</span><b>${F.money(m.nominal, c)}</b></div>
      <div><span>Securities premium</span><b>${F.money(m.premium, c)}</b></div>
      <div><span>Cash received for shares</span><b>${F.money(m.cash, c)}</b></div>
      <div><span>Last price per share</span><b>${st.lastPrice ? F.price(st.lastPrice, c) : '—'}</b></div>
      <div><span>Last pre-money</span><b>${m.pre ? F.money(m.pre, c) : '—'}</b></div>
      <div><span>Last post-money</span><b>${m.post ? F.money(m.post, c) : '—'}</b></div>
    </div>

    <h2>Ownership (fully diluted)</h2>
    ${table(fd, c, true)}
    <h2>Ownership (issued shares only)</h2>
    ${table(iss, c, false)}

    ${st.waiting.length ? html`<h2>Waiting iSAFEs and convertible notes</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Holder</th><th>Instrument</th><th class="num">Amount</th><th>Terms</th><th>Status</th></tr></thead><tbody>
      ${st.waiting.map((w) => html`<tr><td><b>${w.holder.name}</b></td><td>${w.kind === 'note' ? 'Convertible note' : 'iSAFE · ' + ISAFE_TYPES[w.type]}</td><td class="num">${F.money(w.amount, c)}</td>
        <td>${w.kind === 'note' ? `${F.pct2(w.ratePct || 0)} interest` : ''}${w.cap ? ` cap ${F.compact(w.cap, c)}` : ''}${w.discountPct ? ` ${F.pct2(w.discountPct)} discount` : ''} · since ${F.date(w.date)}</td>
        <td>${instrumentFlags(w, st, asof).map((f) => f.text.replace(/\d{4}-\d{2}-\d{2}/, F.date)).join('; ')}</td></tr>`)}
      </tbody></table></div>` : ''}

    ${st.lockins.length ? html`<h2>Lock-ins</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Shareholder</th><th>Scope</th><th>From</th><th>Until</th><th>Permitted transfers</th></tr></thead><tbody>
      ${st.lockins.map((l) => html`<tr><td><b>${(st.holders[l.holderId] || {}).name || ''}</b></td><td>${l.scope}</td><td>${F.date(l.from)}</td><td>${F.date(l.until)}</td><td>${l.permitted || '—'}</td></tr>`)}
      </tbody></table></div>` : ''}

    <h2>History</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Change</th></tr></thead><tbody>
      ${live.map((e) => html`<tr><td class="nowrap" style="vertical-align:top">${F.date(e.effectiveDate)}</td><td><b>${e.title}</b><br><span class="muted small">${e.summary}</span></td></tr>`)}
    </tbody></table></div>
    ${st.problems.length ? html`<div class="alert bad" style="margin-top:12px"><div class="grow">Some changes could not be applied: ${st.problems.map((p) => p.msg).join('; ')}</div></div>` : ''}

    <p class="disclaimer">This report is produced by CAPTABLE, a calculation aid. Percentages are shown to two decimals and are not rounded to make whole shares. It is not a statutory register of members and is not legal, tax or financial advice. Have a company secretary, chartered accountant or lawyer confirm it before you rely on it, file it or sign anything based on it.</p>`);
}

function table(ct, c, showPool) {
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Shareholder</th><th class="num">Shares</th><th class="num">Ownership</th><th class="num">Invested</th></tr></thead><tbody>
    ${ct.rows.map((r) => html`<tr><td><div class="who"><span class="swatch" style="background:${r.color}"></span><div><b>${r.name}</b><small>${r.isPool ? 'Reserved for future hires' : r.designation || ''}${r.pref ? ` · ${F.int(r.pref)} preference` : ''}${r.lock ? ` · locked in until ${F.date(r.lock.until)}` : ''}</small></div></div></td><td class="num">${F.int(r.shares)}</td><td class="num"><b>${F.pct(r.pct)}</b></td><td class="num">${F.money(r.invested || 0, c)}</td></tr>`)}
    <tr class="total"><td>Total</td><td class="num">${F.int(ct.total)}</td><td class="num">${ct.rows.length ? F.pct(100) : F.pct(0)}</td><td class="num">${F.money(ct.rows.reduce((s, r) => s + (r.invested || 0), 0), c)}</td></tr>
  </tbody></table></div>`;
}

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
    $('#asof').value = todayISO();
    $('#back').href = `dashboard.html?s=${sid}`;
    $('#app').classList.remove('hide');
    draw();
    $('#asof').addEventListener('input', draw);
    $('#print').addEventListener('click', () => window.print());
  }
} catch (e) {
  console.error(e);
  showState('Could not load the report', `Check your internet connection and the Firestore rules, then refresh. (${e.code || e.message})`);
}
