/* Small UI helpers shared by every page. No framework. */
import { isDemo, signOutUser } from './backend.js';
import * as F from './fmt.js';

/* ---------- safe HTML templates ---------- */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw {
  constructor(s) {
    this.s = s;
  }
}
export const raw = (s) => new Raw(s);
const toStr = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(toStr).join('') : esc(v));
/** html`<p>${userText}</p>` escapes every value unless it is wrapped in raw() */
export const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? toStr(vals[i]) : ''), ''));
export const str = (v) => toStr(v);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function mount(el, content) {
  el.innerHTML = toStr(content);
}
export const debounce = (fn, ms = 150) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/* ---------- toasts ---------- */
export function toast(msg, kind = '') {
  let box = $('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 6500 : 3800);
}

/* ---------- modal ---------- */
export function openModal({ title, body, actions = [], wide = false, onOpen }) {
  const back = document.createElement('div');
  back.className = 'backdrop';
  back.innerHTML = toStr(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-h"><h2>${title}</h2><button class="icon-btn" data-x aria-label="Close" style="font-size:22px">×</button></div>
    <div class="modal-b" data-body>${body}</div>
    <div class="modal-f" data-foot>${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-act="${i}">${a.label}</button>`)}</div>
  </div>`);
  document.body.appendChild(back);
  const modal = back.firstElementChild;
  const handle = {
    el: modal,
    $: (s) => modal.querySelector(s),
    $$: (s) => [...modal.querySelectorAll(s)],
    close() {
      document.removeEventListener('keydown', onKey);
      back.remove();
    },
    setBody(content) {
      modal.querySelector('[data-body]').innerHTML = toStr(content);
    },
    btn: (i) => modal.querySelector(`[data-act="${i}"]`),
  };
  const onKey = (e) => {
    if (e.key === 'Escape') handle.close();
  };
  document.addEventListener('keydown', onKey);
  let downOnBack = false;
  back.addEventListener('mousedown', (e) => (downOnBack = e.target === back));
  back.addEventListener('click', (e) => {
    if (e.target === back && downOnBack) handle.close();
  });
  modal.querySelector('[data-x]').addEventListener('click', handle.close);
  actions.forEach((a, i) => modal.querySelector(`[data-act="${i}"]`).addEventListener('click', () => a.onClick && a.onClick(handle)));
  setTimeout(() => {
    const f = modal.querySelector('input:not([type=checkbox]):not([disabled]), select, textarea');
    if (f) f.focus();
  }, 30);
  if (onOpen) onOpen(handle);
  return handle;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      body: html`<p class="muted" style="margin:0">${message}</p>`,
      actions: [
        { label: 'Cancel', onClick: (h) => { done = true; h.close(); resolve(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: (h) => { done = true; h.close(); resolve(true); } },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.el) && !done) {
        done = true;
        resolve(false);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- top bar ---------- */
const initials = (name) => (name || 'F').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function mountTopbar(user, { active = '', sid = null } = {}) {
  const el = document.getElementById('topbar');
  if (!el) return;
  const links = [['home', 'home.html', 'Startups']];
  if (sid) links.push(['dashboard', `dashboard.html?s=${sid}`, 'Dashboard'], ['archive', `archive.html?s=${sid}`, 'Archive'], ['report', `report.html?s=${sid}`, 'Report']);
  links.push(['quick', 'quickcalc.html', 'Quick calc']);
  const avatar = user && user.photo
    ? html`<img class="avatar" src="${user.photo}" alt="" referrerpolicy="no-referrer" />`
    : html`<span class="avatar">${initials(user && user.name)}</span>`;
  el.innerHTML = toStr(html`<div class="topbar-in">
    <a class="brand" href="${user ? 'home.html' : 'index.html'}"><span class="brand-mark"><i></i><i></i><i></i></span>CAPTABLE</a>
    ${isDemo ? html`<span class="badge warn" title="Firebase is not connected yet. Data stays in this browser.">Demo mode</span>` : ''}
    <nav class="nav" aria-label="Main">${links.map(([k, href, label]) => html`<a href="${href}" ${k === active ? raw('aria-current="page"') : ''}>${label}</a>`)}</nav>
    ${user ? html`<div class="user">
      <button class="btn sm logout-btn" id="logout-top" type="button">Log out</button>
      <button class="user-btn" id="user-btn" aria-haspopup="true" aria-expanded="false">
        ${avatar}
        <span class="user-meta"><b>${user.name}</b><span>${user.email}</span></span>
      </button>
      <div class="menu hide" id="user-menu" role="menu">
        <div class="who"><b>${user.name}</b><span class="muted small">${user.email}</span></div>
        <a href="home.html" role="menuitem">Your startups</a>
        <button id="logout" role="menuitem">Log out</button>
      </div>
    </div>` : ''}
  </div>`);
  const img = el.querySelector('img.avatar');
  if (img) img.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'avatar', textContent: initials(user.name) })));
  const btn = el.querySelector('#user-btn');
  const menu = el.querySelector('#user-menu');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('hide') === false;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => menu.classList.add('hide'));
    const out = async () => {
      await signOutUser();
      location.replace('index.html');
    };
    el.querySelector('#logout').addEventListener('click', out);
    el.querySelector('#logout-top').addEventListener('click', out);
  }
}

/* ---------- donut chart ---------- */
export function donutSVG(slices, { size = 200, thickness = 34, top = '', bottom = '' } = {}) {
  const R = size / 2 - 2;
  const r = R - thickness;
  const c = size / 2;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const pt = (rad, a) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  let paths = '';
  if (total <= 0) {
    paths = `<circle cx="${c}" cy="${c}" r="${(R + r) / 2}" fill="none" stroke="#e1e4ea" stroke-width="${thickness}"/>`;
  } else {
    let a0 = -Math.PI / 2;
    const live = slices.filter((s) => s.value > 0);
    for (const s of live) {
      const f = s.value / total;
      const a1 = a0 + f * Math.PI * 2;
      const label = `${esc(s.label)}: ${F.pct(f * 100)}`;
      if (live.length === 1) {
        paths += `<circle cx="${c}" cy="${c}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${thickness}"><title>${label}</title></circle>`;
      } else {
        const [x0, y0] = pt(R, a0);
        const [x1, y1] = pt(R, a1);
        const [x2, y2] = pt(r, a1);
        const [x3, y3] = pt(r, a0);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        paths += `<path d="M${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${large} 0 ${x3} ${y3} Z" fill="${s.color}" stroke="#fff" stroke-width="2"><title>${label}</title></path>`;
      }
      a0 = a1;
    }
  }
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Ownership chart">${paths}
    <text x="${c}" y="${c + (bottom ? 2 : 8)}" text-anchor="middle" font-size="22" font-weight="600" fill="#121b34">${esc(top)}</text>
    ${bottom ? `<text x="${c}" y="${c + 20}" text-anchor="middle" font-size="12" fill="#5d6781" style="font-family:'Noto Sans',system-ui,sans-serif">${esc(bottom)}</text>` : ''}</svg>`;
}

export const GOOGLE_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.3-4 6.8-9.9 6.8-16.9z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>`;
