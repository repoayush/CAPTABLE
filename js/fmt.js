/* Number, money, percent and date formatting. */

export const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
];
export const symbolOf = (code) => (CURRENCIES.find((c) => c.code === code) || { symbol: code + ' ' }).symbol;

const nfIN = (min, max) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: min, maximumFractionDigits: max });
const nfUS = (min, max) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

/** whole-number counts, Indian grouping: 1,00,000 */
export const int = (n) => (n == null || !Number.isFinite(n) ? '—' : nfIN(0, 0).format(Math.round(n)));

/** money. Rupees use lakh/crore grouping, other currencies use Western grouping. */
export function money(n, cur = 'INR', dec) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const frac = Math.abs(a - Math.round(a)) > 0.004;
  const d = dec ?? (frac ? 2 : 0);
  const f = (cur === 'INR' ? nfIN(d, d) : nfUS(d, d)).format(a);
  return (n < 0 ? '−' : '') + symbolOf(cur) + f;
}

/** price per share: up to 4 decimals, trailing zeros dropped (never fewer than 0) */
export function price(n, cur = 'INR') {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (Math.abs(a - Math.round(a)) < 0.00005) return money(n, cur, 0);
  const s = (cur === 'INR' ? nfIN(2, 4) : nfUS(2, 4)).format(a);
  return (n < 0 ? '−' : '') + symbolOf(cur) + s;
}

/** ₹1.25 Cr, ₹50 L, else full */
export function compact(n, cur = 'INR') {
  if (n == null || !Number.isFinite(n)) return '—';
  if (cur !== 'INR') return money(n, cur);
  const a = Math.abs(n);
  const sgn = n < 0 ? '−' : '';
  const trim = (x) => String(+x.toFixed(2));
  if (a >= 1e7) return sgn + '₹' + trim(a / 1e7) + ' Cr';
  if (a >= 1e5) return sgn + '₹' + trim(a / 1e5) + ' L';
  return money(n, cur);
}

/** Ownership: exactly 2 digits before and 2 after the point: 09.99%, 90.01%, 100.00% */
export function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = Math.abs(x).toFixed(2);
  const [i, f] = s.split('.');
  return (x < 0 ? '−' : '') + i.padStart(2, '0') + '.' + f + '%';
}
/** other percentages (discount, interest, pool target): 2 decimals, no padding */
export function pct2(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return (x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%';
}
/** change in ownership, in percentage points, signed */
export function pts(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a < 0.005) return '0.00 pts';
  return (x < 0 ? '−' : '+') + a.toFixed(2) + ' pts';
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const below1000 = (n) => (n < 100 ? below100(n) : ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + below100(n % 100) : ''));
/** Indian words for a whole rupee amount: "fifty lakh rupees" */
export function words(n) {
  n = Math.floor(Math.abs(n));
  if (!Number.isFinite(n) || n > 9.99e14) return '';
  if (n === 0) return 'zero rupees';
  const parts = [];
  let rest = n;
  const crore = Math.floor(rest / 1e7);
  rest %= 1e7;
  const lakh = Math.floor(rest / 1e5);
  rest %= 1e5;
  const thousand = Math.floor(rest / 1e3);
  rest %= 1e3;
  if (crore) parts.push((crore >= 100 ? words(crore).replace(' rupees', '') : below100(crore)) + ' crore');
  if (lakh) parts.push(below100(lakh) + ' lakh');
  if (thousand) parts.push(below100(thousand) + ' thousand');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ') + ' rupees';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-14 -> 14 Oct 2026 */
export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** ms -> 14 Oct 2026, 4:12 pm */
export function dateTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  let h = d.getHours();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}
export const monthName = (m) => MONTHS[m];
export const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many || one + 's'}`;
