/* Small render helpers shared by the dashboard, dialogs and report. */
import { html, raw } from './ui.js';
import * as F from './fmt.js';

/**
 * The live "fractional share settlement" clause.
 * inv: { shares, exact, frac, offered, paid, unspent }, price per share, name of the investor.
 * Returns '' when the offer divides into whole shares exactly.
 */
export function settlementClause(inv, price, cur, name = 'the investor') {
  if (!inv || !(inv.unspent > 0.004)) return '';
  return html`<div class="clause" role="note">
    <b>Fractional share settlement.</b>
    At ${F.price(price, cur)} a share, ${F.money(inv.offered, cur)} would buy <b>${inv.exact.toFixed(2)}</b> shares.
    A share cannot be split, so ${name} is allotted <b>${F.int(inv.shares)} whole shares</b> for ${F.money(inv.paid, cur)},
    and the remaining <b>${inv.frac.toFixed(2)} of a share</b> is settled in cash: <b>${F.money(inv.unspent, cur)}</b>.
  </div>`;
}

export const kpi = (label, value, sub = '', { cls = '', extra = '' } = {}) =>
  html`<div class="kpi ${cls}"><div class="k">${label}</div><div class="v">${value}</div>${sub ? html`<div class="s">${sub}</div>` : ''}${extra}</div>`;

export const meter = (pctValue) => html`<div class="meter" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, pctValue)).toFixed(2)}%"></i></div>`;
