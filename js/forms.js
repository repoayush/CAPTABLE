/* Form field builders and readers. */
import { html, raw } from './ui.js';
import * as F from './fmt.js';

/** "10,00,000", "₹ 1000", "12.5" -> number, NaN if empty or not a number */
export function parseNum(s) {
  if (s == null) return NaN;
  const t = String(s).replace(/[,\s₹$€£%]/g, '');
  if (t === '' || t === '-' || t === '.') return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export const field = (id, label, inner, hint = '', extra = '') =>
  html`<div class="field ${extra}"><label for="${id}">${label}</label>${inner}${hint ? html`<span class="hint" ${raw(`data-hint-for="${id}"`)}>${hint}</span>` : ''}</div>`;

export const textField = (id, label, value = '', { placeholder = '', hint = '', maxlength = 80 } = {}) =>
  field(id, label, html`<input id="${id}" type="text" value="${value}" placeholder="${placeholder}" maxlength="${maxlength}" autocomplete="off">`, hint);

export const moneyField = (id, label, value = '', { sym = '₹', hint = '', words = false, placeholder = '' } = {}) =>
  field(id, label, html`<div class="prefix"><span>${sym}</span><input id="${id}" type="text" inputmode="decimal" class="num-in" value="${value}" placeholder="${placeholder}" autocomplete="off" ${raw(words ? 'data-words="1"' : '')}></div>`, hint || (words ? ' ' : ''));

export const pctField = (id, label, value = '', { hint = '', placeholder = '' } = {}) =>
  field(id, label, html`<div class="suffix"><input id="${id}" type="text" inputmode="decimal" class="num-in" value="${value}" placeholder="${placeholder}" autocomplete="off"><span>%</span></div>`, hint);

export const intField = (id, label, value = '', { hint = '', placeholder = '' } = {}) =>
  field(id, label, html`<input id="${id}" type="text" inputmode="numeric" class="num-in" value="${value}" placeholder="${placeholder}" autocomplete="off">`, hint);

export const dateField = (id, label, value = '', hint = '') => field(id, label, html`<input id="${id}" type="date" value="${value}">`, hint);

export const selectField = (id, label, options, value = '', hint = '') =>
  field(id, label, html`<select id="${id}">${options.map((o) => html`<option value="${o.v}" ${String(o.v) === String(value) ? raw('selected') : ''} ${o.disabled ? raw('disabled') : ''}>${o.l}</option>`)}</select>`, hint);

export const checkField = (id, label, checked = false) =>
  html`<label class="check"><input id="${id}" type="checkbox" ${checked ? raw('checked') : ''}> <span>${label}</span></label>`;

export const switchField = (id, label, checked = false) =>
  html`<label class="switch"><input id="${id}" type="checkbox" ${checked ? raw('checked') : ''}> <span>${label}</span></label>`;

/** keep the "₹10,00,000 · ten lakh rupees" hint under money inputs in step with what is typed */
export function wireMoneyHints(root, cur = 'INR') {
  root.querySelectorAll('input[data-words]').forEach((inp) => {
    const hint = root.querySelector(`[data-hint-for="${inp.id}"]`);
    if (!hint) return;
    if (hint.dataset.orig == null) hint.dataset.orig = hint.textContent.trim();
    const n = parseNum(inp.value);
    hint.textContent = Number.isFinite(n) && n > 0 ? F.money(n, cur) + (cur === 'INR' ? ' · ' + F.words(n) : '') : hint.dataset.orig;
  });
}

export const val = (root, id) => {
  const el = root.querySelector('#' + id);
  return el ? el.value : '';
};
export const num = (root, id) => parseNum(val(root, id));
export const checked = (root, id) => !!(root.querySelector('#' + id) || {}).checked;
export const setVal = (root, id, v) => {
  const el = root.querySelector('#' + id);
  if (el) el.value = v;
};
