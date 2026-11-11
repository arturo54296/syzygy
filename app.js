import { openStore, makeKey } from './store.js?v=9';
import { SEED, SEED_VERSION } from './activities.js?v=9';
import * as G from './gcal.js?v=9';

const MIN = 60e3, HOUR = 36e5, DAY = 864e5, SNAP = 15 * MIN;
const PEOPLE = { arturo: { name: 'Arturo', css: '--arturo' }, zosia: { name: 'Zosia', css: '--zosia' } };
const WHO = ['arturo', 'zosia'];
const OTHER = { arturo: 'zosia', zosia: 'arturo' };
const LEVEL = { free: 'free', flex: 'flexible' };
const COST = ['free', '€', '€€', '€€€'];
const SLOTS = [['Morning', 9, 13], ['Afternoon', 13, 18], ['Evening', 18, 23], ['All day', 9, 23]];
const ZOOM = [24, 32, 40, 48, 64, 96];

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) p.startsWith('--') ? n.style.setProperty(p, x) : (n.style[p] = x); }
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem('tp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tp.' + k, JSON.stringify(v)); } catch {} },
};
const colorOf = who => getComputedStyle(document.documentElement).getPropertyValue(PEOPLE[who].css).trim();
const pad = n => String(n).padStart(2, '0');
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function weekStart(d) { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hhmmEnd = t => hhmm(t) === '00:00' ? '24:00' : hhmm(t);
const ymd = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dmy = d => { d = new Date(d); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const dm = d => { d = new Date(d); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const wd = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short' });
const dayName = d => `${wd(d)} ${dm(d)}`;
const fmtH = ms => { const m = Math.round(ms / MIN), h = Math.floor(m / 60); return m % 60 ? `${h}h${pad(m % 60)}` : `${h}h`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sameDay = (a, b) => ymd(a) === ymd(b);
const parseDmy = s => {
  const m = String(s).trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  const d = m && new Date(+m[3], +m[2] - 1, +m[1]);
  return d && d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? d : null;
};
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3500); }

// ---------- state ----------
let store = null, data = { events: [], activities: [], meta: [] }, me = LS.get('me', null);
const view = { mode: LS.get('mode', innerWidth < 760 ? '3day' : 'week'), anchor: startOfDay(new Date()), zoom: Object.assign({ week: 2, '3day': 2, day: 3 }, LS.get('zoom', {})) };
const filt = Object.assign({ place: 'any', cost: 3, hours: 0, rain: false, noBook: false, q: '', archived: false }, LS.get('filt', {}), { q: '' });
const hourPx = () => ZOOM[view.zoom[view.mode]];
const saveView = () => { LS.set('mode', view.mode); LS.set('zoom', view.zoom); };

function range() {
  const s = view.mode === 'week' ? weekStart(view.anchor) : startOfDay(view.anchor);
  return [s, addDays(s, view.mode === 'week' ? 7 : view.mode === '3day' ? 3 : 1)];
}
function dayList() { const [s, e] = range(), out = []; for (let d = s; d < e; d = addDays(d, 1)) out.push(d); return out; }

// ---------- events & occurrences ----------
// event: { id, kind: 'avail'|'plan', s, e, repeat: null | { every: 1|2, until: 'YYYY-MM-DD'|null, skip: ['YYYY-MM-DD'] }, note,
//   avail: who, level: 'free'|'flex'   plan: by, title, votes: { arturo: [ids], zosia: [ids] }, status: 'proposed'|'confirmed', chosen }
function occurrences(ev, S, E) {
  if (!ev.repeat) return ev.s < E && ev.e > S ? [{ ev, s: ev.s, e: ev.e, key: ymd(ev.s), rep: false }] : [];
  const out = [], dur = ev.e - ev.s, step = 7 * (ev.repeat.every || 1);
  const until = ev.repeat.until ? +addDays(new Date(ev.repeat.until + 'T00:00'), 1) : Infinity;
  const skip = ev.repeat.skip || [];
  for (let k = Math.max(0, Math.floor((S - ev.e) / (step * DAY)) - 1); ; k++) {
    const st = new Date(ev.s); st.setDate(st.getDate() + k * step);
    const s = +st, e = s + dur;
    if (s >= E || s >= until) break;
    const key = ymd(st);
    if (e > S && !skip.includes(key)) out.push({ ev, s, e, key, rep: true });
  }
  return out;
}
const allOcc = (S, E) => data.events.flatMap(ev => occurrences(ev, S, E));

/** Time when both are available: level 2 = both free, 1 = at least one only flexible. */
function matchesIn(S, E) {
  const occ = allOcc(S, E).filter(o => o.ev.kind === 'avail');
  const ts = [...new Set([S, E, ...occ.flatMap(o => [Math.max(S, o.s), Math.min(E, o.e)])])].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i], b = ts[i + 1], mid = (a + b) / 2;
    const lvl = p => Math.max(0, ...occ.filter(o => o.ev.who === p && o.s <= mid && o.e > mid).map(o => o.ev.level === 'free' ? 2 : 1));
    const L = Math.min(lvl('arturo'), lvl('zosia'));
    if (!L) continue;
    const last = out[out.length - 1];
    if (last && last.e === a && last.level === L) last.e = b; else out.push({ s: a, e: b, level: L });
  }
  return out.filter(m => m.e - m.s >= 30 * MIN);
}
function upcomingMatches(days = 14) {
  const now = Date.now(), out = [];
  for (let d = startOfDay(new Date()), i = 0; i <= days; i++, d = addDays(d, 1)) out.push(...matchesIn(Math.max(+d, now), +addDays(d, 1)));
  return out;
}

const votesOf = ev => ({ arturo: ev.votes?.arturo || [], zosia: ev.votes?.zosia || [] });
const votedIds = ev => { const v = votesOf(ev); return [...new Set([...v.arturo, ...v.zosia])]; };
const matchedIds = ev => { const v = votesOf(ev); return v.arturo.filter(id => v.zosia.includes(id)); };

// ---------- activities ----------
const actById = id => data.activities.find(a => a.id === id);
const actsSorted = () => [...data.activities].sort((a, b) => a.name.localeCompare(b.name));
const actLabel = a => a ? `${a.emoji || '•'} ${a.name}` : '(deleted activity)';
const placeIcon = a => a.place === 'outdoor' ? '🌳' : a.place === 'indoor' ? '🏠' : '🏠🌳';
/** Ideas with a fixed time (e.g. sleeping together 21:00–09:00): their range on the day that starts at dayStart. Ends the next day if `to` ≤ `from`. */
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
function fixedRange(a, dayStart) {
  if (!a?.fixed?.from || !a?.fixed?.to) return null;
  const f = toMin(a.fixed.from), t = toMin(a.fixed.to);
  const s = new Date(startOfDay(dayStart)); s.setMinutes(f);
  const e = new Date(startOfDay(dayStart)); if (t <= f) e.setDate(e.getDate() + 1); e.setMinutes(t);
  return [+s, +e];
}
const tags = (a, long = false) => [
  a.fixed?.from ? `🕘 ${a.fixed.from}–${a.fixed.to}` : null,
  long ? { indoor: '🏠 indoor', outdoor: '🌳 outdoor', both: '🏠🌳 indoor or outdoor' }[a.place] || '' : placeIcon(a),
  COST[a.cost ?? 0], a.hours ? `~${a.hours} h` : null,
  a.weather ? (long ? '☀️ needs good weather' : '☀️') : null, a.booking ? (long ? '📅 book ahead' : '📅') : null,
].filter(Boolean).join(' · ');
function passes(a, f = filt) {
  if (a.archived && !f.archived) return false;
  if (f.place === 'indoor' && a.place === 'outdoor') return false;
  if (f.place === 'outdoor' && a.place === 'indoor') return false;
  if ((a.cost ?? 0) > f.cost) return false;
  if (f.hours && (a.hours ?? 0) > f.hours) return false;
  if (f.rain && a.weather) return false;
  if (f.noBook && a.booking) return false;
  if (f.q && !`${a.name} ${a.note || ''}`.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}
/** Past confirmed plan occurrences with a final choice = things we've done. */
function doneList() {
  const now = Date.now(), out = [];
  for (const ev of data.events) if (ev.kind === 'plan' && ev.status === 'confirmed' && ev.chosen)
    for (const o of occurrences(ev, ev.s - 1, now)) if (o.e <= now) out.push(o);
  return out;
}
function doneMap() {
  const m = {};
  for (const o of doneList()) { const x = m[o.ev.chosen] ||= { n: 0, last: 0, hours: 0 }; x.n++; x.last = Math.max(x.last, o.s); x.hours += (o.e - o.s) / HOUR; }
  return m;
}

// ---------- render ----------
let renderPending = false;
function render() {
  if (!store) return;
  if (mv?.active || ideaDrag?.active) { renderPending = true; return; }   // don't redraw under a drag
  renderPending = false;
  const [s, e] = range();
  $('#label').textContent = view.mode === 'day' ? `${wd(s)} ${dmy(s)}` : `${dm(s)} – ${dmy(+e - 1)}`;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === view.mode));
  const mb = $('#meBtn');
  mb.replaceChildren(...(me ? [el('span', { class: 'dot', style: { background: colorOf(me) } }), PEOPLE[me].name] : ['Who are you?']));
  renderCalendar(dayList());
  renderAside();
  renderGBtn();
  loadBusy();
}

function availStyle(who, level) {
  const c = colorOf(who);
  return level === 'free'
    ? { background: c + 'b3', color: '#fff', borderLeft: `3px solid ${c}` }
    : { background: `repeating-linear-gradient(135deg, ${c}40 0 6px, ${c}1c 6px 12px)`, color: c, borderLeft: `3px dashed ${c}` };
}

function layoutLanes(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], end = -Infinity;
  const flush = () => { const n = Math.max(1, ...cluster.map(x => x.lane + 1)); cluster.forEach(x => x.lanes = n); cluster = []; };
  for (const x of items) {
    if (x.s >= end) { flush(); end = -Infinity; }
    const used = new Set(cluster.filter(c => c.e > x.s).map(c => c.lane));
    let lane = 0; while (used.has(lane)) lane++;
    x.lane = lane; cluster.push(x); end = Math.max(end, x.e);
  }
  flush();
  return items;
}

function planHeadline(ev) {
  // own title if given; otherwise the final choice, or the only idea; several ideas and no decision = "Undecided plan"
  if (ev.title) return ev.title;
  const ids = (ev.chosen ? [ev.chosen] : votedIds(ev)).filter(id => actById(id));
  return ids.length === 1 ? actLabel(actById(ids[0])) : 'Undecided plan';
}
function planCard(o, h) {
  const ev = o.ev, v = votesOf(ev), m = matchedIds(ev), rest = votedIds(ev).filter(id => !m.includes(id));
  const em = id => actById(id)?.emoji || '•';
  const kids = [el('b', {}, (ev.status === 'confirmed' ? '✓ ' : '') + planHeadline(ev) + (o.rep ? ' ↻' : ''))];
  if (h >= 28) kids.push(el('div', {}, `${hhmm(o.s)}–${hhmmEnd(o.e)}`));
  if (h >= 42 && ev.status !== 'confirmed') kids.push(el('div', { class: 'em' }, m.length ? '❤ ' + m.map(em).join('') + (rest.length ? ' · ' : '') : '', rest.map(em).join('')));
  const waiting = WHO.filter(p => !v[p].length);
  if (h >= 56 && waiting.length && ev.status !== 'confirmed') kids.push(el('div', { class: 'wait' }, `⏳ waiting for ${waiting.map(p => PEOPLE[p].name).join(', ')}`));
  return kids;
}
function planTip(o) {
  const ev = o.ev, v = votesOf(ev), m = matchedIds(ev);
  return [`${planHeadline(ev)} · ${ev.status === 'confirmed' ? 'confirmed' : 'proposed'}${o.rep ? ' · repeats' : ''}`, `${dayName(o.s)} ${hhmm(o.s)}–${hhmmEnd(o.e)}`,
    m.length ? `❤ Both want: ${m.map(id => actLabel(actById(id))).join(', ')}` : 'No match yet',
    ...WHO.map(p => `${PEOPLE[p].name}: ${v[p].length ? v[p].map(id => actById(id)?.emoji || '•').join(' ') : '(no votes yet)'}`),
    ev.note || null].filter(Boolean).join('\n');
}

function renderCalendar(days) {
  const hp = hourPx(), pxPerMs = hp / HOUR;
  document.documentElement.style.setProperty('--hour', `${hp}px`);
  const head = el('div', { class: 'hrow' }, el('div', { class: 'gut' }));
  $('#calHead').replaceChildren(head);
  const gutter = el('div', { class: 'gutter', style: { height: `${hp * 24}px` } });
  for (let h = 1; h < 24; h++) gutter.append(el('div', { style: { top: `${h * hp}px` } }, `${pad(h)}:00`));
  const body = $('#calBody');
  body.replaceChildren(gutter);

  for (const d of days) {
    const ds = +d, de = +addDays(d, 1), today = sameDay(d, new Date());
    const occ = allOcc(ds, de), ms = matchesIn(ds, de), plans = occ.filter(o => o.ev.kind === 'plan');
    const both = ms.reduce((t, m) => t + m.e - m.s, 0);
    head.append(el('div', { class: 'dh' + (today ? ' today' : ''), title: 'Add something on this day', onclick: () => newDialog(ds + 10 * HOUR, ds + 22 * HOUR) },
      el('div', { class: 'd' }, dayName(d)),
      el('div', { class: 'chips' },
        ms.length ? el('span', { class: 'mchip' + (ms.some(m => m.level === 2) ? ' strong' : ''), title: 'Time when you are both free or flexible' }, `❤ ${fmtH(both)}`) : null,
        plans.length ? el('span', { class: 'pchip' }, `${plans.length} plan${plans.length > 1 ? 's' : ''}`) : null)));

    const col = el('div', { class: 'col' + (today ? ' today' : '') });
    col._ds = ds; col._ppm = pxPerMs;
    const top = t => `${(Math.max(t, ds) - ds) * pxPerMs}px`;
    const ht = (s, e) => `${Math.max((Math.min(e, de) - Math.max(s, ds)) * pxPerMs, 3)}px`;
    // my Google busy times (only on this device, only for me), under everything else
    if (me && busy.key === rangeKey()) for (const b of busy.list.filter(b => b.e > ds && b.s < de))
      col.append(el('div', { class: 'busy', style: { top: top(b.s), height: ht(b.s, b.e), left: `${WHO.indexOf(me) * 50}%` },
        title: `Busy in your Google Calendar ${hhmm(b.s)}–${hhmmEnd(b.e)} (only you see this)` }, (Math.min(b.e, de) - Math.max(b.s, ds)) * pxPerMs >= 14 ? el('span', {}, 'busy') : null));
    // availability: left half Arturo, right half Zosia
    WHO.forEach((who, i) => {
      const items = layoutLanes(occ.filter(o => o.ev.kind === 'avail' && o.ev.who === who).map(o => ({ o, s: Math.max(o.s, ds), e: Math.min(o.e, de) })));
      for (const x of items) {
        const o = x.o, w = 50 / x.lanes;
        const node = el('div', { class: 'av', style: { top: top(x.s), height: ht(x.s, x.e), left: `${i * 50 + x.lane * w}%`, width: `calc(${w}% - 1px)`, ...availStyle(who, o.ev.level) },
          title: `${PEOPLE[who].name} is ${LEVEL[o.ev.level]}${o.rep ? ' (repeats)' : ''}\n${hhmm(o.s)}–${hhmmEnd(o.e)}${o.ev.note ? '\n' + o.ev.note : ''}` });
        if ((x.e - x.s) * pxPerMs >= 26) node.append(el('span', {}, PEOPLE[who].name), el('span', {}, LEVEL[o.ev.level] + (o.rep ? ' ↻' : '')));
        else if ((x.e - x.s) * pxPerMs >= 13) node.append(el('span', {}, `${PEOPLE[who].name[0]} · ${LEVEL[o.ev.level]}`));
        node._click = () => availDialog(o);
        node._occ = o;
        col.append(node);
      }
    });
    for (const m of ms) col.append(el('div', { class: 'match' + (m.level === 2 ? ' strong' : ''), style: { top: top(m.s), height: ht(m.s, m.e) },
      title: `${m.level === 2 ? 'You are both free' : 'Both available (at least one only flexible)'}\n${hhmm(m.s)}–${hhmmEnd(m.e)}` },
      (m.e - m.s) * pxPerMs >= 20 ? el('button', { class: 'mbtn', title: 'Plan something in this time', onpointerdown: e => e.stopPropagation(), onclick: () => newDialog(m.s, m.e, { kind: 'plan' }) },
        m.level === 2 ? '❤ plan' : '❤ maybe') : null));
    for (const x of layoutLanes(plans.map(o => ({ o, s: Math.max(o.s, ds), e: Math.min(o.e, de) })))) {
      const h = (x.e - x.s) * pxPerMs, w = 84 / x.lanes;
      const node = el('div', { class: 'plan ' + (x.o.ev.status === 'confirmed' ? 'conf' : 'prop'), style: { top: top(x.s), height: ht(x.s, x.e), left: `${8 + x.lane * w}%`, width: `calc(${w}% - 2px)` }, title: planTip(x.o) },
        planCard(x.o, h));
      node._click = () => planDialog(x.o);
      node._occ = x.o;
      col.append(node);
    }
    if (today) col.append(el('div', { class: 'now', style: { top: `${(Date.now() - ds) * pxPerMs}px` } }));
    attachDrag(col, ds, pxPerMs);
    body.append(col);
  }
}

function attachDrag(col, ds, pxPerMs) {
  let start = null, sel = null, moved = false;
  const timeAt = y => ds + Math.round(Math.max(0, Math.min(y, 24 * HOUR * pxPerMs)) / pxPerMs / SNAP) * SNAP;
  const reset = () => { start = null; sel?.remove(); sel = null; };
  col.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    let b = e.target;   // pressing on a plan or a free/flexible block: move it (or open it on a plain click)
    while (b && b !== col && !b._occ) b = b.parentElement;
    if (b?._occ) return startMove(b, col, e);
    start = { y: e.clientY - col.getBoundingClientRect().top, target: e.target, touch: e.pointerType !== 'mouse' }; moved = false;
    if (!start.touch) try { col.setPointerCapture(e.pointerId); } catch {}   // touch: let the page scroll; tap still works
  });
  col.addEventListener('pointermove', e => {
    if (!start) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    if (!moved && Math.abs(y - start.y) < 6) return;
    moved = true;
    if (start.touch) return;
    const t0 = timeAt(Math.min(start.y, y)), t1 = timeAt(Math.max(start.y, y));
    if (!sel) { sel = el('div', { class: 'sel' }); col.append(sel); }
    Object.assign(sel.style, { top: `${(t0 - ds) * pxPerMs}px`, height: `${(t1 - t0) * pxPerMs}px` });
    sel.textContent = `${hhmm(t0)}–${hhmmEnd(t1)}`;
  });
  col.addEventListener('pointercancel', reset);
  col.addEventListener('pointerup', e => {
    if (!start) return;
    const y = e.clientY - col.getBoundingClientRect().top, s0 = start, wasMoved = moved;
    reset();
    if (wasMoved) {
      if (s0.touch) return;
      const t0 = timeAt(Math.min(s0.y, y)), t1 = timeAt(Math.max(s0.y, y));
      if (t1 > t0) newDialog(t0, t1);
      return;
    }
    let n = s0.target;
    while (n && n !== col && !n._click) n = n.parentElement;
    if (n?._click) return n._click();
    const t = ds + Math.floor(s0.y / pxPerMs / HOUR) * HOUR;
    newDialog(t, Math.min(t + 2 * HOUR, ds + DAY));
  });
}

// ---------- move / resize blocks ----------
// Mouse: drag a plan or a free/flexible block to another time or day; drag its bottom edge to change the end.
// Touch: hold ~0.4 s, then drag. A plain click/tap still opens it. Repeating events move the whole series.
let mv = null;
function startMove(node, col, e) {
  const r = node.getBoundingClientRect(), touch = e.pointerType !== 'mouse';
  mv = { o: node._occ, node, col, x: e.clientX, y: e.clientY, id: e.pointerId, touch, resize: !touch && e.clientY > r.bottom - 7,
    active: false, timer: null, prev: null, s: node._occ.s, e: node._occ.e };
  if (!touch) e.preventDefault();
  else { const m = mv; mv.timer = setTimeout(() => { if (mv === m) { beginMove(m); navigator.vibrate?.(20); } }, 400); }
}
function beginMove(m) {
  m.active = true;
  window.getSelection()?.removeAllRanges();
  document.body.classList.add('dragging');
  m.node.classList.add('moving');
}
function moveTo(m, x, y) {
  const n = document.elementFromPoint(x, y)?.closest('.col');
  const tcol = n && n._ds !== undefined ? n : m.col;
  const ppm = m.col._ppm, dt = Math.round((y - m.y) / ppm / SNAP) * SNAP;
  const o = m.o, dur = o.e - o.s;
  if (m.resize) { m.s = o.s; m.e = Math.max(o.s + SNAP, Math.round((o.e + dt) / SNAP) * SNAP); }
  else {
    const days = Math.round((tcol._ds - m.col._ds) / DAY);
    const st = new Date(o.s); st.setDate(st.getDate() + days);
    m.s = Math.round((+st + dt) / SNAP) * SNAP; m.e = m.s + dur;
  }
  // preview in the column where the new start is
  const pcol = m.resize ? m.col : tcol, ds = pcol._ds, a = Math.max(m.s, ds), b = Math.min(m.e, ds + DAY);
  m.prev?.remove();
  m.prev = el('div', { class: 'sel', style: { top: `${(a - ds) * ppm}px`, height: `${Math.max(b - a, SNAP) * ppm}px` } },
    `${m.resize ? '' : dayName(m.s) + ' '}${hhmm(m.s)}–${hhmmEnd(m.e)}`);
  pcol.append(m.prev);
  const sc = $('#calScroll').getBoundingClientRect();
  if (y < sc.top + 40) $('#calScroll').scrollTop -= 12; else if (y > sc.bottom - 40) $('#calScroll').scrollTop += 12;
}
function endMove(commit) {
  const m = mv;
  mv = null;
  if (!m) return;
  clearTimeout(m.timer);
  if (!m.active) { if (commit && m.node._click) m.node._click(); return; }
  m.prev?.remove(); m.node.classList.remove('moving');
  document.body.classList.remove('dragging');
  const changed = commit && (m.s !== m.o.s || m.e !== m.o.e);
  if (changed) {
    const cur = data.events.find(x => x.id === m.o.ev.id);
    if (cur) {
      store.put('events', { ...cur, ...shifted(cur, m.o, [m.s, m.e]) });
      toast(`${m.resize ? 'Now ends' : 'Moved to'} ${m.resize ? hhmmEnd(m.e) : `${dayName(m.s)} ${hhmm(m.s)}–${hhmmEnd(m.e)}`}${m.o.rep ? ' (whole series)' : ''}`);
    }
  }
  if (renderPending || !changed) render();
}
document.addEventListener('pointermove', e => {
  const m = mv;
  if (!m || e.pointerId !== m.id) return;
  if (!m.active) {
    const dist = Math.hypot(e.clientX - m.x, e.clientY - m.y);
    if (m.touch) { if (dist > 10) { clearTimeout(m.timer); mv = null; } return; }   // a swipe = scrolling
    if (dist < 5) return;
    beginMove(m);
  }
  e.preventDefault();
  moveTo(m, e.clientX, e.clientY);
}, { passive: false });
document.addEventListener('touchmove', e => { if (mv?.active) e.preventDefault(); }, { passive: false });
document.addEventListener('pointerup', e => { if (mv && e.pointerId === mv.id) endMove(true); });
document.addEventListener('pointercancel', e => { if (mv && e.pointerId === mv.id) endMove(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && mv) endMove(false); });

// ---------- sidebar ----------
function renderAside() {
  const a = $('#aside'), now = Date.now(), E = +addDays(startOfDay(new Date()), 15);
  const keepScroll = a.scrollTop, focused = document.activeElement?.id;
  const ups = upcomingMatches(14).slice(0, 8);
  const plans = allOcc(now, E).filter(o => o.ev.kind === 'plan').sort((x, y) => x.s - y.s).slice(0, 8);
  const done = doneMap();
  const acts = actsSorted().filter(x => passes(x));

  a.replaceChildren(
    el('h2', {}, el('span', {}, '❤ Next times you’re both free')),
    ups.length ? el('ul', { class: 'list' }, ups.map(m => el('li', { title: 'Plan something here', onclick: () => newDialog(m.s, m.e, { kind: 'plan' }) },
      el('span', { class: 'emo' }, m.level === 2 ? '❤' : '♡'),
      el('div', { class: 'n' }, el('div', {}, `${dayName(m.s)} · ${hhmm(m.s)}–${hhmmEnd(m.e)}`),
        el('div', { class: 'tags' }, m.level === 2 ? 'both free' : 'one of you is only flexible')),
      el('span', { class: 'cnt' }, fmtH(m.e - m.s)))))
      : el('p', { class: 'hint' }, 'No shared free time in the next two weeks yet. Add when you’re free or flexible: drag on the calendar or press ＋ New.'),

    el('h2', {}, el('span', {}, '💞 Upcoming plans')),
    plans.length ? el('ul', { class: 'list' }, plans.map(o => {
      const m = matchedIds(o.ev);
      return el('li', { onclick: () => planDialog(o) },
        el('span', { class: 'emo' }, o.ev.status === 'confirmed' ? (actById(o.ev.chosen)?.emoji || '✓') : (m.length ? '❤' : '?')),
        el('div', { class: 'n' }, el('div', {}, planHeadline(o.ev)),
          el('div', { class: 'tags' }, `${dayName(o.s)} ${hhmm(o.s)} · ${o.ev.status === 'confirmed' ? 'confirmed' : m.length ? `${m.length} match${m.length > 1 ? 'es' : ''}` : 'no match yet'}`)));
    })) : el('p', { class: 'hint' }, 'No plans in the next two weeks.'),

    el('h2', {}, el('span', {}, '💡 Ideas'), el('button', { class: 'link', onclick: () => activityDialog(null) }, '＋ Add')),
    el('div', { class: 'btnrow' },
      el('button', { onclick: surpriseDialog, title: 'A random idea from the filtered list' }, '🎲 Surprise us'),
      el('button', { onclick: statsDialog }, '📊 Stats')),
    filtersNode(filt, () => { LS.set('filt', { ...filt, q: '' }); renderAside(); }, true),
    el('div', { class: 'hint' }, `${acts.length} of ${data.activities.filter(x => !x.archived).length} ideas`),
    el('ul', { class: 'list' }, acts.map(x => el('li', { class: x.archived ? 'arch' : '', onclick: () => { if (!dragJustEnded) activityDialog(x); }, onpointerdown: e => ideaPointerDown(x, e),
      title: (x.note ? x.note + '\n' : '') + tags(x, true) + '\nDrag onto the calendar to plan it (on a phone: hold, then drag)' },
      el('span', { class: 'emo' }, x.emoji || '•'),
      el('div', { class: 'n' }, el('div', {}, x.name), el('div', { class: 'tags' }, tags(x))),
      el('span', { class: 'cnt', title: 'Times done' }, done[x.id] ? `×${done[x.id].n}` : '')))),

    el('h2', {}, el('span', {}, 'Legend')),
    el('div', { class: 'legend' },
      WHO.flatMap(p => ['free', 'flex'].map(l => el('div', {}, el('span', { class: 'sw', style: availStyle(p, l) }), `${PEOPLE[p].name} ${LEVEL[l]}`))),
      el('div', {}, el('span', { class: 'sw', style: { border: '2px solid var(--love)', background: 'var(--love-soft)' } }), 'both free'),
      el('div', {}, el('span', { class: 'sw', style: { border: '2px dashed var(--love)', background: 'var(--love-soft)' } }), 'both available'),
      el('div', {}, el('span', { class: 'sw', style: { border: '2px dashed var(--love)', background: 'var(--panel)' } }), 'plan (proposed)'),
      el('div', {}, el('span', { class: 'sw', style: { background: 'var(--love)' } }), 'plan (confirmed)')),
    el('p', { class: 'hint' }, 'Drag on the calendar (or tap an empty spot) to add a plan or free/flexible time. Drag an idea onto the calendar to plan it, or onto a plan to vote for it (phone: hold the idea, then drag). Click anything to edit it. Keys: ← → t w 3 d + −.'),
  );
  a.scrollTop = keepScroll;
  if (focused) document.getElementById(focused)?.focus();
}

// ---------- drag an idea onto the calendar ----------
// Mouse: press and drag. Touch: hold ~0.35 s, then drag (a quick swipe still scrolls the list).
// Drop on an empty spot = new plan with that idea at that time; drop on a plan = add it to your votes there.
let ideaDrag = null, dragJustEnded = false;
function ideaPointerDown(a, e) {
  if (e.button !== 0) return;
  const st = { a, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== 'mouse', active: false, timer: null, ghost: null, prev: null, drop: null };
  ideaDrag = st;
  if (!st.touch) e.preventDefault();   // mouse: don't start a text selection (the click still fires)
  if (st.touch) st.timer = setTimeout(() => { if (ideaDrag === st) { beginIdeaDrag(st); navigator.vibrate?.(20); } }, 350);
}
function beginIdeaDrag(st) {
  st.active = true;
  window.getSelection()?.removeAllRanges();
  document.body.classList.add('dragging');
  st.ghost = el('div', { class: 'ghost' }, `${st.a.emoji || '•'} ${st.a.name}`);
  document.body.append(st.ghost);
  moveGhost(st, st.x, st.y);
  setTimeout(() => $('#aside').classList.remove('open'), 150);   // phone: get the drawer out of the way
}
function dropTarget(x, y) {
  const n = document.elementFromPoint(x, y);
  const plan = n?.closest('.plan');
  if (plan?._occ) return { plan };
  const col = n?.closest('.col');
  if (!col) return null;
  const t = col._ds + Math.round(Math.max(0, y - col.getBoundingClientRect().top) / col._ppm / SNAP) * SNAP;
  const fx = fixedRange(ideaDrag.a, col._ds);
  if (fx) return { col, s: fx[0], e: fx[1] };
  const dur = Math.max(SNAP, Math.round((ideaDrag.a.hours || 2) * HOUR / SNAP) * SNAP);
  return { col, s: t, e: Math.min(t + dur, col._ds + DAY) };
}
function moveGhost(st, x, y) {
  Object.assign(st.ghost.style, { left: `${x + 12}px`, top: `${y + 12}px` });
  const sc = $('#calScroll').getBoundingClientRect();
  if (x > sc.left && x < sc.right) { if (y < sc.top + 40) $('#calScroll').scrollTop -= 12; else if (y > sc.bottom - 40) $('#calScroll').scrollTop += 12; }
  const d = dropTarget(x, y);
  st.drop = d;
  st.prev?.remove(); st.prev = null;
  document.querySelectorAll('.plan.droptarget').forEach(n => n.classList.remove('droptarget'));
  if (d?.plan) d.plan.classList.add('droptarget');
  else if (d?.col) {
    st.prev = el('div', { class: 'sel', style: { top: `${(d.s - d.col._ds) * d.col._ppm}px`, height: `${(d.e - d.s) * d.col._ppm}px` } }, `${st.a.emoji || ''} ${hhmm(d.s)}–${hhmmEnd(d.e)}`);
    d.col.append(st.prev);
  }
}
function endIdeaDrag(drop) {
  const st = ideaDrag;
  ideaDrag = null;
  if (!st) return;
  clearTimeout(st.timer);
  if (!st.active) return;
  st.ghost.remove(); st.prev?.remove();
  document.querySelectorAll('.plan.droptarget').forEach(n => n.classList.remove('droptarget'));
  document.body.classList.remove('dragging');
  if (renderPending) render();
  dragJustEnded = true; setTimeout(() => { dragJustEnded = false; }, 50);
  const d = drop ? st.drop : null;
  if (!d) return;
  if (d.plan) addVote(d.plan._occ, st.a);
  else newDialog(d.s, d.e, { kind: 'plan', acts: [st.a.id] });
}
function addVote(o, a) {
  if (!me) return whoDialog(() => addVote(o, a));
  const cur = data.events.find(x => x.id === o.ev.id);
  if (!cur) return;
  const v = votesOf(cur);
  if (v[me].includes(a.id)) return toast(`${actLabel(a)} is already in your votes for this plan`);
  store.put('events', { ...cur, votes: { ...v, [me]: [...v[me], a.id] } });
  toast(v[OTHER[me]].includes(a.id) ? `❤ It’s a match: ${actLabel(a)}` : `Added ${actLabel(a)} to your votes`);
}
document.addEventListener('pointermove', e => {
  const st = ideaDrag;
  if (!st || e.pointerId !== st.id) return;
  if (!st.active) {
    const dist = Math.hypot(e.clientX - st.x, e.clientY - st.y);
    if (st.touch) { if (dist > 10) { clearTimeout(st.timer); ideaDrag = null; } return; }   // a swipe = scrolling
    if (dist < 6) return;
    beginIdeaDrag(st);
  }
  e.preventDefault();
  moveGhost(st, e.clientX, e.clientY);
}, { passive: false });
document.addEventListener('touchmove', e => { if (ideaDrag?.active) e.preventDefault(); }, { passive: false });  // no scrolling while dragging
document.addEventListener('pointerup', e => { if (ideaDrag && e.pointerId === ideaDrag.id) endIdeaDrag(true); });
document.addEventListener('pointercancel', e => { if (ideaDrag && e.pointerId === ideaDrag.id) endIdeaDrag(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ideaDrag) endIdeaDrag(false); });
document.addEventListener('contextmenu', e => { if (ideaDrag) e.preventDefault(); });

/** Filter controls; f is changed in place, then onChange() runs. */
function filtersNode(f, onChange, withArchived = false) {
  const seg = el('div', { class: 'seg' }, [['any', 'Any'], ['indoor', '🏠 Indoor'], ['outdoor', '🌳 Outdoor']].map(([v, t]) =>
    el('button', { class: f.place === v ? 'on' : '', onclick: () => { f.place = v; onChange(); } }, t)));
  const cost = el('select', { onchange: e => { f.cost = +e.target.value; onChange(); } },
    [[3, 'Any cost'], [0, 'Free only'], [1, 'Up to €'], [2, 'Up to €€']].map(([v, t]) => el('option', { value: v, selected: f.cost === v }, t)));
  const hours = el('select', { onchange: e => { f.hours = +e.target.value; onChange(); } },
    [[0, 'Any length'], [1, '≤ 1 h'], [2, '≤ 2 h'], [3, '≤ 3 h'], [5, '≤ 5 h']].map(([v, t]) => el('option', { value: v, selected: f.hours === v }, t)));
  const q = el('input', { type: 'search', placeholder: 'Search ideas…', value: f.q, id: withArchived ? 'fq' : null });
  q.addEventListener('input', () => { f.q = q.value; onChange(); });
  const cb = (k, t, title) => el('label', { title }, el('input', { type: 'checkbox', checked: f[k], onchange: e => { f[k] = e.target.checked; onChange(); } }), t);
  return el('div', { class: 'filters' },
    el('div', { class: 'r' }, seg),
    el('div', { class: 'r' }, cost, hours),
    el('div', { class: 'r' }, cb('rain', '☔ It’s raining', 'Hide ideas that need good weather'), cb('noBook', 'No booking', 'Hide ideas that need booking ahead'),
      withArchived ? cb('archived', 'Archived', 'Also show archived ideas') : null),
    el('div', { class: 'r' }, q));
}

// ---------- dialogs ----------
function dialog(title, body, onClose = null) {
  const d = $('#dlg');
  d.onclose = onClose ? () => { d.onclose = null; onClose(); } : null;
  d.replaceChildren(el('div', { class: 'dlg-h' }, title, el('button', { class: 'x', onclick: () => d.close() }, '✕')), el('div', { class: 'dlg-b' }, body));
  if (!d.open) d.showModal();
  return d;
}
const close = () => $('#dlg').close();
const segCtl = (opts, cur, onPick) => {
  const n = el('div', { class: 'seg' });
  const draw = () => n.replaceChildren(...opts.map(([v, t]) => el('button', { type: 'button', class: v === cur ? 'on' : '', onclick: () => { cur = v; draw(); onPick(v); } }, t)));
  draw();
  return n;
};

function timeInputs(s, e) {
  const tf = v => el('input', { type: 'text', value: v, size: 5, maxlength: 5, inputmode: 'numeric', placeholder: 'HH:MM', title: '24-hour time, e.g. 09:30' });
  const df = v => el('input', { type: 'text', value: v, size: 10, maxlength: 10, inputmode: 'numeric', placeholder: 'dd/mm/yyyy', title: 'Date as dd/mm/yyyy' });
  const sd = df(dmy(s)), st = tf(hhmm(s)), ed = df(dmy(e)), et = tf(hhmm(e));
  if (hhmm(e) === '00:00' && e > s) { ed.value = dmy(e - 1); et.value = '24:00'; }
  const parse = (dateIn, timeIn) => {
    const m = timeIn.value.trim().match(/^(\d{1,2})[:.h]?(\d{2})$/);
    if (!m || +m[1] > 24 || +m[2] > 59 || (+m[1] === 24 && +m[2] > 0)) { timeIn.focus(); toast(`“${timeIn.value}” is not a 24-hour time (HH:MM)`); throw new Error('bad'); }
    const d = parseDmy(dateIn.value);
    if (!d) { dateIn.focus(); toast(`“${dateIn.value}” is not a date (dd/mm/yyyy)`); throw new Error('bad'); }
    d.setHours(+m[1], +m[2]);
    return +d;
  };
  const read = () => {
    const a = parse(sd, st), b = parse(ed, et);
    if (b <= a) { toast('End must be after start'); throw new Error('bad'); }
    return [a, b];
  };
  for (const t of [st, et]) t.addEventListener('blur', () => { const m = t.value.trim().match(/^(\d{1,2})[:.h]?(\d{2})$/); if (m) t.value = `${pad(+m[1])}:${m[2]}`; });
  const slots = el('div', { class: 'row' }, el('label', {}, 'Slot'), SLOTS.map(([name, h0, h1]) => el('button', { type: 'button', onclick: () => {
    ed.value = sd.value; st.value = `${pad(h0)}:00`; et.value = `${pad(h1)}:00`;
  } }, name)));
  const set = (a, b) => { sd.value = dmy(a); st.value = hhmm(a); ed.value = dmy(b); et.value = hhmm(b); };
  const day = () => parseDmy(sd.value);
  return { nodes: [el('div', { class: 'row' }, el('label', {}, 'From'), sd, st), el('div', { class: 'row' }, el('label', {}, 'To'), ed, et), slots], read, set, day };
}

function repeatInputs(rep) {
  const sel = el('select', {}, [[0, 'Once'], [1, 'Every week'], [2, 'Every 2 weeks']].map(([v, t]) => el('option', { value: v, selected: (rep?.every || 0) === v }, t)));
  const until = el('input', { type: 'text', size: 10, placeholder: 'dd/mm/yyyy', value: rep?.until ? dmy(rep.until + 'T00:00') : '', title: 'Last date (empty = forever)' });
  const untilWrap = el('span', { class: 'row', style: { margin: 0 } }, el('span', { class: 'hint' }, 'until'), until, el('span', { class: 'hint' }, '(optional)'));
  const sync = () => untilWrap.style.display = +sel.value ? '' : 'none';
  sel.onchange = sync; sync();
  return {
    node: el('div', { class: 'row' }, el('label', {}, 'Repeat'), sel, untilWrap),
    read() {
      if (!+sel.value) return null;
      let u = null;
      if (until.value.trim()) { const d = parseDmy(until.value); if (!d) { until.focus(); toast('“Until” must be dd/mm/yyyy'); throw new Error('bad'); } u = ymd(d); }
      return { every: +sel.value, until: u, skip: rep?.skip || [] };
    },
  };
}

/** Activity chips. mine = Set (toggled on click), other = Set (shown as dots), chosen = id (outlined). */
function picker({ mine, other = new Set(), otherWho = null, f, onChange }) {
  const box = el('div', {});
  const draw = () => {
    const ids = new Set([...mine, ...other]);
    const list = actsSorted().filter(a => ids.has(a.id) || passes(a, f));
    const rank = a => (mine.has(a.id) && other.has(a.id) ? 0 : mine.has(a.id) ? 1 : other.has(a.id) ? 2 : 3);
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    box.replaceChildren(el('div', { class: 'picker', style: { '--mecolor': colorOf(me) } }, list.map(a => {
      const both = mine.has(a.id) && other.has(a.id);
      return el('button', { type: 'button', class: 'pk' + (both ? ' both' : mine.has(a.id) ? ' mine' : '') + (a.archived ? ' arch' : ''), title: (a.note ? a.note + '\n' : '') + tags(a, true),
        onclick: () => { const add = !mine.has(a.id); add ? mine.add(a.id) : mine.delete(a.id); draw(); onChange?.(a, add); } },
        both ? '❤ ' : '', `${a.emoji || '•'} ${a.name}`,
        el('span', { class: 'dots' },
          mine.has(a.id) ? el('i', { style: { background: colorOf(me) }, title: PEOPLE[me].name }) : null,
          other.has(a.id) && otherWho ? el('i', { style: { background: colorOf(otherWho) }, title: PEOPLE[otherWho].name }) : null));
    })));
  };
  draw();
  return { node: box, redraw: draw };
}

function whoDialog(then) {
  dialog('Who are you?', [
    el('p', { class: 'center' }, 'This device will remember it. You can switch anytime with the button at the top right.'),
    el('div', { class: 'who' }, WHO.map(p => el('button', { style: { background: colorOf(p) }, onclick: () => { me = p; LS.set('me', p); close(); render(); then?.(); } }, PEOPLE[p].name))),
  ]);
}

/** Picking an idea with a fixed time moves the plan to that time on the chosen start day. */
function applyFixed(ti, a, add) {
  if (!add) return;
  const day = ti.day();
  const fx = day && fixedRange(a, day);
  if (fx) { ti.set(fx[0], fx[1]); toast(`${actLabel(a)}: time set to ${a.fixed.from}–${a.fixed.to}`); }
}

function newDialog(s, e, opts = {}) {
  if (!me) return whoDialog(() => newDialog(s, e, opts));
  let kind = opts.kind || 'plan', who = me;
  const fx0 = (opts.acts || []).map(id => fixedRange(actById(id), s)).find(Boolean);
  if (fx0) [s, e] = fx0;
  const ti = timeInputs(s, e), rp = repeatInputs(null);
  const mine = new Set(opts.acts || []);
  const f = { ...filt, q: '', archived: false };
  const pk = picker({ mine, f, onChange: (a, add) => applyFixed(ti, a, add) });
  const fnode = filtersNode(f, () => { pk.redraw(); }, false);
  const title = el('input', { type: 'text', placeholder: 'Title (optional), e.g. “Lazy Sunday”', style: { flex: 1 } });
  const note = el('textarea', { rows: 2, placeholder: 'Note (optional)' });
  const planPart = el('section', {}, el('h3', {}, 'What would you like to do? (pick at least one)'), fnode, pk.node, el('div', { class: 'row', style: { marginTop: '10px' } }, title));
  const whoPart = el('div', { class: 'row' }, el('label', {}, 'Who'), segCtl(WHO.map(p => [p, PEOPLE[p].name]), who, v => { who = v; }));
  const sync = () => { planPart.style.display = kind === 'plan' ? '' : 'none'; whoPart.style.display = kind === 'plan' ? 'none' : ''; };
  dialog('New', [
    el('section', {}, el('div', { class: 'row' }, segCtl([['plan', '💞 Plan together'], ['free', 'Free'], ['flex', 'Flexible']], kind, v => { kind = v; sync(); })),
      whoPart, el('p', { class: 'hint', style: { margin: '0 0 8px' } }, '“Free” = this time is yours to plan. “Flexible” = could be free if needed.')),
    el('section', {}, ti.nodes, rp.node),
    planPart,
    note,
    el('div', { class: 'actions' }, el('span', { class: 'spacer' }), el('button', { onclick: close }, 'Cancel'), el('button', { class: 'primary', onclick: save }, 'Save')),
  ]);
  sync();
  function save() {
    let t, repeat;
    try { t = ti.read(); repeat = rp.read(); } catch { return; }
    const base = { id: uid(), s: t[0], e: t[1], repeat, note: note.value.trim(), created: Date.now(), by: me };
    if (kind === 'plan') {
      if (!mine.size) return toast('Pick at least one activity');
      store.put('events', { ...base, kind: 'plan', title: title.value.trim(), votes: { [me]: [...mine], [OTHER[me]]: [] }, status: 'proposed', chosen: null });
    } else store.put('events', { ...base, kind: 'avail', who, level: kind });
    close();
  }
}

function occActions(o) {
  if (!o.rep) return [];
  return [el('button', { title: `Remove only ${dmy(o.s)} from the series`, onclick: () => {
    const ev = data.events.find(x => x.id === o.ev.id) || o.ev;
    store.put('events', { ...ev, repeat: { ...ev.repeat, skip: [...new Set([...(ev.repeat.skip || []), o.key])] } });
    close(); toast(`Skipped ${dmy(o.s)}`);
  } }, `Skip ${dm(o.s)}`)];
}
function delBtn(o) {
  return el('button', { class: 'danger', onclick: () => {
    if (!confirm(o.rep ? 'Delete the whole series (every repetition)?' : 'Delete this?')) return;
    store.del('events', o.ev.id); close();
  } }, o.rep ? 'Delete series' : 'Delete');
}
/** New start/end for the stored event when an occurrence was edited (shifts the whole series). */
function shifted(ev, o, t) { const delta = t[0] - o.s; return { s: ev.s + delta, e: ev.s + delta + (t[1] - t[0]) }; }

function availDialog(o) {
  const ev = o.ev;
  let who = ev.who, level = ev.level;
  const ti = timeInputs(o.s, o.e), rp = repeatInputs(ev.repeat);
  const note = el('textarea', { rows: 2, placeholder: 'Note (optional)', value: ev.note || '' });
  dialog(`${PEOPLE[ev.who].name} is ${LEVEL[ev.level]}`, [
    el('section', {},
      el('div', { class: 'row' }, el('label', {}, 'Who'), segCtl(WHO.map(p => [p, PEOPLE[p].name]), who, v => { who = v; })),
      el('div', { class: 'row' }, el('label', {}, 'Is'), segCtl([['free', 'Free'], ['flex', 'Flexible']], level, v => { level = v; }))),
    el('section', {}, ti.nodes, rp.node, o.rep ? el('p', { class: 'hint' }, 'Changes apply to the whole series.') : null),
    note,
    el('div', { class: 'actions' }, delBtn(o), occActions(o),
      el('button', { onclick: () => { close(); newDialog(o.s, o.e, { kind: 'plan' }); } }, '💞 Plan here'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'primary', onclick: () => {
        let t, repeat;
        try { t = ti.read(); repeat = rp.read(); } catch { return; }
        const cur = data.events.find(x => x.id === ev.id) || ev;
        store.put('events', { ...cur, who, level, repeat, note: note.value.trim(), ...shifted(cur, o, t) });
        close();
      } }, 'Save')),
  ]);
}

function planDialog(o) {
  if (!me) return whoDialog(() => planDialog(o));
  const ev = o.ev, other = OTHER[me], v = votesOf(ev);
  const mine = new Set(v[me]), otherSet = new Set(v[other]);
  let status = ev.status || 'proposed', chosen = ev.chosen || null;
  const ti = timeInputs(o.s, o.e), rp = repeatInputs(ev.repeat);
  const title = el('input', { type: 'text', value: ev.title || '', placeholder: 'Title (optional)', style: { flex: 1 } });
  const note = el('textarea', { rows: 2, placeholder: 'Note (optional)', value: ev.note || '' });
  const f = { ...filt, q: '', archived: false };
  const matchBox = el('div', {}), decide = el('div', {});
  const pk = picker({ mine, other: otherSet, otherWho: other, f, onChange: (a, add) => { applyFixed(ti, a, add); drawInfo(); } });
  const fnode = filtersNode(f, () => pk.redraw(), false);
  const drawInfo = () => {
    const m = [...mine].filter(id => otherSet.has(id)), union = [...new Set([...mine, ...otherSet])];
    if (chosen && !union.includes(chosen)) chosen = null;
    matchBox.replaceChildren(m.length
      ? el('div', { class: 'matchline' }, el('b', {}, '❤ You both want: '), m.map(id => actLabel(actById(id))).join(', '))
      : el('div', { class: 'matchline none' }, !otherSet.size ? `${PEOPLE[other].name} hasn’t voted yet.` : !mine.size ? 'You haven’t voted yet.' : 'No match yet: pick some of the other’s ideas too.'));
    const sel = el('select', { onchange: e => { chosen = e.target.value || null; } },
      el('option', { value: '' }, '— not decided —'),
      union.map(id => el('option', { value: id, selected: id === chosen }, (m.includes(id) ? '❤ ' : '') + actLabel(actById(id)))));
    decide.replaceChildren(
      el('div', { class: 'row' }, el('label', {}, 'Final'), sel,
        el('button', { type: 'button', title: 'Random pick among the matches (or among all votes if there is no match)', onclick: () => {
          const pool = m.length ? m : union;
          if (!pool.length) return toast('Vote for something first');
          chosen = pool[Math.floor(Math.random() * pool.length)];
          drawInfo(); toast(`🎲 ${actLabel(actById(chosen))}`);
        } }, '🎲 Pick for us')),
      el('div', { class: 'row' }, el('label', {}, 'Status'), segCtl([['proposed', 'Proposed'], ['confirmed', '✓ Confirmed']], status, val => {
        status = val;
        if (val === 'confirmed' && !chosen && union.length === 1) { chosen = union[0]; drawInfo(); }   // only one idea: that's the final one
      })));
  };
  drawInfo();
  dialog(`💞 ${planHeadline(ev)}`, [
    el('section', {}, matchBox),
    el('section', {}, el('h3', {}, `Your votes (${PEOPLE[me].name})`),
      el('p', { class: 'hint', style: { margin: 0 } }, `Click to vote. Dots: `, el('span', { style: { color: colorOf(me), fontWeight: 600 } }, PEOPLE[me].name), ' / ', el('span', { style: { color: colorOf(other), fontWeight: 600 } }, PEOPLE[other].name), '. ❤ = you both want it.'),
      fnode, pk.node),
    el('section', {}, el('h3', {}, 'Decision'), decide),
    el('section', {}, el('h3', {}, 'When'), ti.nodes, rp.node, o.rep ? el('p', { class: 'hint' }, 'Changes apply to the whole series.') : null),
    el('div', { class: 'row' }, title), note,
    el('div', { class: 'actions' }, delBtn(o), occActions(o), el('span', { class: 'spacer' }), el('button', { onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: () => {
        let t, repeat;
        try { t = ti.read(); repeat = rp.read(); } catch { return; }
        const cur = data.events.find(x => x.id === ev.id) || ev;   // latest copy: keep the other person's votes as they are now
        const votes = { ...votesOf(cur), [me]: [...mine] };
        const union = [...new Set([...votes.arturo, ...votes.zosia])];
        if (!union.length) return toast('At least one activity must stay selected');
        if (chosen && !union.includes(chosen)) chosen = null;
        if (status === 'confirmed' && !chosen && union.length === 1) chosen = union[0];
        if (status === 'confirmed' && !chosen) return toast('Choose the final activity to confirm (or 🎲 Pick for us)');
        store.put('events', { ...cur, votes, status, chosen, title: title.value.trim(), note: note.value.trim(), repeat, ...shifted(cur, o, t) });
        close();
      } }, 'Save')),
  ]);
}

function activityDialog(a) {
  const isNew = !a;
  a = a || { id: uid(), emoji: '', name: '', place: 'both', cost: 0, hours: 2, weather: false, booking: false, note: '', archived: false };
  let place = a.place;
  const emoji = el('input', { type: 'text', value: a.emoji, size: 3, maxlength: 8, placeholder: '🙂', style: { fontSize: '18px', textAlign: 'center' } });
  const name = el('input', { type: 'text', value: a.name, placeholder: 'Name', style: { flex: 1 } });
  const cost = el('select', {}, COST.map((c, i) => el('option', { value: i, selected: (a.cost ?? 0) === i }, c)));
  const hours = el('input', { type: 'number', min: 0.5, max: 24, step: 0.5, value: a.hours ?? 2, style: { width: '70px' } });
  const cb = (v, t) => { const i = el('input', { type: 'checkbox', checked: v }); return [i, el('label', {}, i, ' ', t)]; };
  const [weather, weatherL] = cb(a.weather, '☀️ Needs good weather'), [booking, bookingL] = cb(a.booking, '📅 Book ahead'), [arch, archL] = cb(a.archived, 'Archived (hidden from lists)');
  const note = el('textarea', { rows: 2, placeholder: 'Note (optional)', value: a.note || '' });
  const tf = v => el('input', { type: 'text', value: v || '', size: 5, maxlength: 5, inputmode: 'numeric', placeholder: 'HH:MM' });
  const fxFrom = tf(a.fixed?.from), fxTo = tf(a.fixed?.to);
  const readFixed = () => {
    const ok = v => /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());
    const f = fxFrom.value.trim(), t = fxTo.value.trim();
    if (!f && !t) return null;
    if (!ok(f) || !ok(t)) { toast('Fixed time: use HH:MM for both, or leave both empty'); throw new Error('bad'); }
    const p = v => v.split(':').map(Number), [fh, fm] = p(f), [th, tm] = p(t);
    return { from: `${pad(fh)}:${pad(fm)}`, to: `${pad(th)}:${pad(tm)}` };
  };
  const used = data.events.filter(e => e.kind === 'plan' && (votedIds(e).includes(a.id) || e.chosen === a.id)).length;
  dialog(isNew ? 'New idea' : actLabel(a), [
    el('div', { class: 'row' }, emoji, name),
    el('div', { class: 'row' }, el('label', {}, 'Where'), segCtl([['indoor', '🏠 Indoor'], ['outdoor', '🌳 Outdoor'], ['both', 'Either']], place, v => { place = v; })),
    el('div', { class: 'row' }, el('label', {}, 'Cost'), cost, el('label', { style: { minWidth: 0, marginLeft: '12px' } }, 'Length'), hours, el('span', { class: 'hint' }, 'hours')),
    el('div', { class: 'row' }, weatherL, bookingL),
    el('div', { class: 'row' }, el('label', {}, 'Fixed time'), fxFrom, '–', fxTo,
      el('span', { class: 'hint' }, 'optional; picking this idea sets the plan to this time (ends next day if earlier)')),
    el('div', { class: 'row' }, note),
    isNew ? null : el('div', { class: 'row' }, archL),
    el('div', { class: 'actions' },
      isNew ? null : el('button', { class: 'danger', onclick: () => {
        if (!confirm(used ? `“${a.name}” is used in ${used} plan(s). Delete anyway? (Archiving keeps it in old plans.)` : `Delete “${a.name}”?`)) return;
        store.del('activities', a.id); close();
      } }, 'Delete'),
      el('span', { class: 'spacer' }), el('button', { onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: () => {
        if (!name.value.trim()) { name.focus(); return toast('Give it a name'); }
        let fixed;
        try { fixed = readFixed(); } catch { return; }
        store.put('activities', { ...a, fixed, emoji: emoji.value.trim(), name: name.value.trim(), place, cost: +cost.value, hours: Math.max(0, +hours.value || 0),
          weather: weather.checked, booking: booking.checked, note: note.value.trim(), archived: arch.checked });
        close();
      } }, 'Save')),
  ]);
  if (isNew) name.focus();
}

function surpriseDialog() {
  const pool = data.activities.filter(a => !a.archived && passes(a));
  if (!pool.length) return toast('No ideas match the filters');
  const done = doneMap();
  const roll = () => {
    const a = pool[Math.floor(Math.random() * pool.length)], d = done[a.id];
    const next = upcomingMatches(14)[0];
    dialog('🎲 Surprise!', [
      el('div', { class: 'big' }, a.emoji || '🎲'),
      el('div', { class: 'bigname' }, a.name),
      el('p', { class: 'center hint' }, tags(a, true), el('br'), d ? `Done ${d.n}× · last ${dmy(d.last)}` : 'Never done yet!', a.note ? el('br') : null, a.note || null),
      el('div', { class: 'actions' }, el('button', { onclick: roll }, '🎲 Again'), el('span', { class: 'spacer' }),
        el('button', { class: 'primary', title: next ? `Next shared free time: ${dayName(next.s)} ${hhmm(next.s)}` : 'Tomorrow evening', onclick: () => {
          close();
          const t = next ? [next.s, next.e] : [+startOfDay(addDays(new Date(), 1)) + 18 * HOUR, +startOfDay(addDays(new Date(), 1)) + 21 * HOUR];
          newDialog(t[0], t[1], { kind: 'plan', acts: [a.id] });
        } }, next ? `Plan it (${dayName(next.s)})` : 'Plan it')),
    ]);
  };
  roll();
}

function statsDialog() {
  const list = doneList(), dm_ = doneMap(), now = new Date();
  const monthStart = +new Date(now.getFullYear(), now.getMonth(), 1);
  const hours = list.reduce((t, o) => t + (o.e - o.s) / HOUR, 0);
  const rows = Object.entries(dm_).map(([id, x]) => ({ a: actById(id), id, ...x })).sort((p, q) => q.n - p.n || q.last - p.last);
  const max = Math.max(1, ...rows.map(r => r.n));
  const never = data.activities.filter(a => !a.archived && !dm_[a.id]).sort((p, q) => p.name.localeCompare(q.name));
  const future = data.events.filter(e => e.kind === 'plan').flatMap(e => occurrences(e, Date.now(), +addDays(now, 60)));
  dialog('📊 Stats', [
    el('div', { class: 'stats' },
      el('div', {}, el('b', {}, list.length), el('span', {}, 'things done together')),
      el('div', {}, el('b', {}, list.filter(o => o.s >= monthStart).length), el('span', {}, 'this month')),
      el('div', {}, el('b', {}, Math.round(hours)), el('span', {}, 'hours together')),
      el('div', {}, el('b', {}, future.length), el('span', {}, 'plans coming up'))),
    el('p', { class: 'hint' }, 'Counts confirmed plans with a final activity, once their time has passed.'),
    rows.length ? el('table', { class: 'st' }, rows.map(r => el('tr', {},
      el('td', {}, actLabel(r.a)),
      el('td', { style: { width: '35%' } }, el('div', { class: 'bar', style: { width: `${(r.n / max) * 100}%` } })),
      el('td', { class: 'num' }, `×${r.n}`),
      el('td', { class: 'num' }, `last ${dmy(r.last)}`)))) : el('p', {}, 'Nothing done yet. Confirm a plan and it shows up here after it happens.'),
    never.length ? el('section', { style: { marginTop: '14px' } }, el('h3', {}, `Not done yet (${never.length})`),
      el('div', { class: 'picker' }, never.map(a => el('span', { class: 'pk' }, `${a.emoji || '•'} ${a.name}`)))) : null,
  ]);
}

function shareDialog(fresh = false) {
  const url = location.href;
  const inp = el('input', { type: 'text', value: url, readonly: true });
  dialog('🔗 Your shared link', [
    fresh ? el('p', {}, 'Your shared calendar is ready! ') : null,
    el('p', {}, 'Open this link on both phones/laptops and bookmark it. Anyone with the link can see and edit, so share it only with each other.'),
    el('div', { class: 'copybox' }, inp, el('button', { class: 'primary', onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { inp.select(); document.execCommand('copy'); toast('Link copied'); }
    } }, 'Copy')),
    store?.mode === 'demo' ? el('p', { class: 'hint' }, '⚠ Demo mode: no Firebase config yet, so everything is saved only in this browser. See README.md.') : null,
  ], fresh && !me ? () => setTimeout(whoDialog) : null);
}

// ---------- Google Calendar ----------
// Every plan (proposed and confirmed) is copied to ONE shared Google calendar chosen in 📅 (stored in Firestore,
// so both use the same one). Any connected device that has the app open does the syncing; the sync state is shared
// too (meta/gsync: plan id → hash of what was sent), so unchanged plans aren't sent again.
const metaDoc = id => data.meta?.find(d => d.id === id) || null;
const gSettings = () => metaDoc('settings') || {};
let gStatus = '', gBusyNow = false, gAgain = false, gTimer = null;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localISO = t => { const d = new Date(t); return `${ymd(d)}T${hhmm(d)}:00`; };
const gid = id => 'tg' + [...id].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');  // Google ids: a–v, 0–9
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const appUrl = () => location.origin + location.pathname;

function gBody(ev) {
  const v = votesOf(ev), m = matchedIds(ev), conf = ev.status === 'confirmed';
  const names = ids => ids.map(id => actLabel(actById(id))).join(', ') || '(no votes yet)';
  const body = {
    summary: `💞 ${planHeadline(ev)}${conf ? '' : ' (proposed)'}`,
    description: [
      conf ? '✓ Confirmed' + (ev.chosen ? `: ${actLabel(actById(ev.chosen))}` : '') : 'Proposed, not decided yet',
      m.length ? `❤ Both want: ${names(m)}` : null,
      ...WHO.map(p => `${PEOPLE[p].name}: ${names(v[p])}`),
      ev.note ? '\n' + ev.note : null,
      `\nPlan it in Together: ${appUrl()}`,
    ].filter(x => x !== null).join('\n'),
    start: { dateTime: localISO(ev.s), timeZone: TZ },
    end: { dateTime: localISO(ev.e), timeZone: TZ },
    transparency: conf ? 'opaque' : 'transparent',   // proposed plans don't block your time
    status: 'confirmed',                              // also brings back an event that was deleted in Google
  };
  if (ev.repeat) {
    const st = new Date(ev.s);
    let rule = `RRULE:FREQ=WEEKLY;INTERVAL=${ev.repeat.every || 1}`;
    if (ev.repeat.until) rule += `;UNTIL=${ev.repeat.until.replaceAll('-', '')}T235959Z`;
    body.recurrence = [rule, ...(ev.repeat.skip || []).map(k => `EXDATE;TZID=${TZ}:${k.replaceAll('-', '')}T${pad(st.getHours())}${pad(st.getMinutes())}00`)];
  }
  return body;
}

function gSchedule() {
  clearTimeout(gTimer);
  if (G.hasClient && gSettings().gcalId && G.isValid()) gTimer = setTimeout(gSync, 1500);
}
function gPoke() {
  if (G.hasClient && G.ready() && G.wanted() && gSettings().gcalId && !G.isValid()) G.requestToken('');
}
async function gSync() {
  const cal = gSettings().gcalId;
  if (!G.hasClient || !cal || !G.isValid()) return;
  if (gBusyNow) { gAgain = true; return; }
  gBusyNow = true; renderGBtn();
  const C = `/calendars/${encodeURIComponent(cal)}/events`;
  try {
    const st = metaDoc('gsync'), prev = st?.cal === cal ? (st.ids || {}) : {}, next = {};
    let n = 0;
    for (const ev of data.events.filter(e => e.kind === 'plan')) {
      const body = gBody(ev), h = hash(JSON.stringify(body));
      next[ev.id] = h;
      if (prev[ev.id] === h) continue;
      try { await G.api('PUT', `${C}/${gid(ev.id)}`, body); }
      catch (e) { if (e.status === 404) await G.api('POST', C, { ...body, id: gid(ev.id) }); else throw e; }
      n++;
    }
    for (const id of Object.keys(prev)) if (!next[id]) {
      try { await G.api('DELETE', `${C}/${gid(id)}`); } catch (e) { if (![404, 410].includes(e.status)) throw e; }
      n++;
    }
    if (n || st?.cal !== cal) await store.put('meta', { id: 'gsync', cal, ids: next, at: Date.now() });
    gStatus = n ? `Synced ${n} change${n > 1 ? 's' : ''} to Google` : 'Google Calendar up to date';
  } catch (e) {
    console.error(e);
    gStatus = e.code === 'auth' ? 'Google sign-in expired: click 📅 to reconnect' : 'Google sync error: ' + e.message;
    if (e.code !== 'auth') toast(gStatus);
  } finally {
    gBusyNow = false; renderGBtn();
    if (gAgain) { gAgain = false; gSync(); }
  }
}

// my busy times from my own (primary) Google Calendar, shown only to me
let busy = { key: '', at: 0, list: [] }, busyLoading = false;
const rangeKey = () => { const [s, e] = range(); return `${+s}-${+e}`; };
const showBusy = () => LS.get('gbusy', true);
async function loadBusy() {
  if (!G.hasClient || !showBusy() || !G.isValid() || busyLoading) return;
  const key = rangeKey();
  if (busy.key === key && Date.now() - busy.at < 5 * 60e3) return;
  busyLoading = true;
  try {
    const [s, e] = range();
    const r = await G.api('POST', '/freeBusy', { timeMin: new Date(s).toISOString(), timeMax: new Date(e).toISOString(), items: [{ id: 'primary' }] });
    busy = { key, at: Date.now(), list: (r.calendars?.primary?.busy || []).map(b => ({ s: +new Date(b.start), e: +new Date(b.end) })) };
    renderCalendar(dayList());
  } catch (e) { console.error(e); busy = { key, at: Date.now(), list: [] }; }
  finally { busyLoading = false; }
}

function renderGBtn() {
  const b = $('#gcalBtn');
  if (!b) return;
  const cal = gSettings().gcalId, ok = G.isValid();
  const needs = G.hasClient && G.wanted() && !ok;
  b.textContent = gBusyNow ? '📅 …' : needs ? '📅 Reconnect' : '📅';
  b.classList.toggle('warn', needs);
  b.title = !G.hasClient ? 'Google Calendar (not set up)' : needs ? 'Google sign-in expired: click to reconnect' :
    ok ? `Google Calendar${cal ? ': ' + (gSettings().gcalName || cal) : ' (choose a calendar)'}${gStatus ? '\n' + gStatus : ''}` : 'Connect Google Calendar';
}

function gcalDialog() {
  if (!G.hasClient) return dialog('📅 Google Calendar', [
    el('p', {}, 'Google Calendar sync isn’t set up yet: it needs a Google sign-in client ID in config.js.'),
    el('p', { class: 'hint' }, 'See “Google Calendar sync” in README.md.'),
  ]);
  const s = gSettings(), ok = G.isValid();
  const pickBox = el('div', {});
  const busyCb = el('input', { type: 'checkbox', checked: showBusy(), onchange: e => { LS.set('gbusy', e.target.checked); busy.key = ''; render(); } });
  const choose = async () => {
    pickBox.replaceChildren(el('p', { class: 'hint' }, 'Loading your calendars…'));
    try {
      const r = await G.api('GET', '/users/me/calendarList', null, { minAccessRole: 'writer' });
      const items = (r.items || []).sort((a, b) => (a.primary ? 1 : 0) - (b.primary ? 1 : 0) || a.summary.localeCompare(b.summary));
      const sel = el('select', {}, items.map(c => el('option', { value: c.id, selected: c.id === s.gcalId }, c.summaryOverride || c.summary + (c.primary ? ' (your main calendar)' : ''))));
      pickBox.replaceChildren(el('div', { class: 'row' }, sel, el('button', { class: 'primary', onclick: async () => {
        const c = items.find(x => x.id === sel.value);
        await store.put('meta', { ...gSettings(), id: 'settings', gcalId: c.id, gcalName: c.summaryOverride || c.summary });
        toast(`Plans will go to “${c.summaryOverride || c.summary}”`); close(); gSchedule();
      } }, 'Use this calendar')),
        el('p', { class: 'hint' }, 'Pick the calendar you both share (e.g. “Us”). Don’t see it? Create it in Google Calendar and share it with the other person (“Make changes to events”), then reload.'));
    } catch (e) { pickBox.replaceChildren(el('p', {}, 'Could not load your calendars: ' + e.message)); }
  };
  dialog('📅 Google Calendar', [
    el('p', {}, ok ? '✓ Connected on this device.' : G.wanted() ? 'Sign-in expired on this device.' : 'Not connected on this device.'),
    el('div', { class: 'row' },
      ok ? null : el('button', { class: 'primary', onclick: () => { close(); G.requestToken(G.wanted() ? '' : 'consent'); } }, G.wanted() ? 'Reconnect' : 'Connect Google Calendar'),
      ok ? el('button', { onclick: () => { gSync(); close(); toast('Syncing…'); } }, 'Sync now') : null,
      G.wanted() ? el('button', { class: 'danger', onclick: () => { G.disconnect(); busy = { key: '', at: 0, list: [] }; close(); render(); } }, 'Disconnect this device') : null),
    el('section', {}, el('h3', {}, 'Shared calendar'),
      el('p', {}, s.gcalId ? `All plans (proposed and confirmed) go to “${s.gcalName || s.gcalId}”.` : 'No calendar chosen yet.'),
      ok ? el('button', { onclick: choose }, s.gcalId ? 'Change calendar' : 'Choose calendar') : el('p', { class: 'hint' }, 'Connect first to choose one.'),
      pickBox),
    el('section', {}, el('h3', {}, 'On this device'),
      el('label', {}, busyCb, ' Show my Google busy times (grey, only you see them)')),
    gStatus ? el('p', { class: 'hint' }, gStatus) : null,
    el('p', { class: 'hint' }, 'Syncing happens while the app is open on a connected device. Edit plans here, not in Google Calendar: changes made in Google are overwritten.'),
  ]);
}

// ---------- navigation ----------
function zoom(dir) {
  const sc = $('#calScroll'), centerT = (sc.scrollTop + sc.clientHeight / 2) / hourPx();
  const z = Math.max(0, Math.min(ZOOM.length - 1, view.zoom[view.mode] + dir));
  if (z === view.zoom[view.mode]) return;
  view.zoom[view.mode] = z; saveView(); render();
  sc.scrollTop = centerT * hourPx() - sc.clientHeight / 2;
}
function shift(n) { view.anchor = addDays(view.anchor, n * (view.mode === 'week' ? 7 : view.mode === '3day' ? 3 : 1)); render(); }
function setMode(m) { view.mode = m; saveView(); render(); }
const scrollTo8 = () => { $('#calScroll').scrollTop = 8 * hourPx(); };

$('#prev').onclick = () => shift(-1);
$('#next').onclick = () => shift(1);
$('#today').onclick = () => { view.anchor = startOfDay(new Date()); render(); };
document.querySelectorAll('#mode button').forEach(b => b.onclick = () => setMode(b.dataset.v));
$('#zoomIn').onclick = () => zoom(1);
$('#zoomOut').onclick = () => zoom(-1);
$('#addBtn').onclick = () => { const t = Math.ceil(Date.now() / HOUR) * HOUR; newDialog(t, t + 2 * HOUR); };
$('#meBtn').onclick = () => whoDialog();
$('#shareBtn').onclick = () => shareDialog();
$('#gcalBtn').onclick = () => (G.hasClient && G.wanted() && !G.isValid() && G.ready()) ? G.requestToken('') : gcalDialog();
$('#asideBtn').onclick = e => { e.stopPropagation(); $('#aside').classList.toggle('open'); };
document.addEventListener('click', e => { const a = $('#aside'); if (a.classList.contains('open') && !a.contains(e.target) && !$('#dlg').contains(e.target)) a.classList.remove('open'); });
document.addEventListener('keydown', e => {
  if ($('#dlg').open || e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') shift(-1); else if (e.key === 'ArrowRight') shift(1);
  else if (e.key === 't') $('#today').click();
  else if (e.key === '+' || e.key === '=') zoom(1); else if (e.key === '-') zoom(-1);
  else if (e.key === 'w') setMode('week'); else if (e.key === '3') setMode('3day'); else if (e.key === 'd') setMode('day');
});
setInterval(() => { if (!document.hidden && !$('#dlg').open) render(); }, 60e3);  // keeps the "now" line moving

// ---------- boot ----------
function setStatus(cls, text) { const s = $('#status'); s.className = cls; s.lastElementChild.textContent = text; }
async function boot(fresh = false) {
  const fromHash = (location.hash.match(/k=([a-z0-9]+)/i) || [])[1];
  const key = fromHash || LS.get('key', null);
  if (!key) {
    setStatus('down', 'Not set up');
    dialog('💞 Together', [
      el('p', {}, 'A shared calendar to find time together and decide what to do.'),
      el('p', {}, 'Create your shared space once, then send the link to the other person.'),
      el('div', { class: 'actions' }, el('span', { class: 'spacer' }), el('button', { class: 'primary', onclick: () => {
        location.hash = 'k=' + makeKey(); close(); boot(true);
      } }, 'Create our shared calendar')),
    ]);
    return;
  }
  if (!fromHash) history.replaceState(null, '', '#k=' + key);
  LS.set('key', key);
  try {
    store = await openStore(key, d => { data = d; render(); gSchedule(); }, err => { console.error(err); setStatus('down', 'Connection problem'); toast('Could not reach the database: ' + (err.code || err.message)); });
  } catch (err) { console.error(err); setStatus('down', 'Offline'); toast('Could not load Firebase'); return; }
  setStatus(store.mode === 'demo' ? 'demo' : '', store.mode === 'demo' ? 'Demo (this browser only)' : 'Live');
  // any change to a plan from a click: if Google sign-in expired, renew it now (a popup needs a click)
  const rawPut = store.put, rawDel = store.del;
  store.put = (c, o) => { if (c === 'events') gPoke(); return rawPut(c, o); };
  store.del = (c, id) => { if (c === 'events') gPoke(); return rawDel(c, id); };
  G.onToken((tok, err) => {
    if (err) { gStatus = err === 'popup_closed' ? 'Sign-in window closed' : 'Google sign-in failed: ' + err; renderGBtn(); return; }
    busy.key = ''; gStatus = 'Connected'; render(); gSync();
  });
  G.loadGis().catch(() => { gStatus = 'Could not load Google sign-in'; });
  store.start();
  await store.seed(SEED, SEED_VERSION);
  render();
  scrollTo8();
  if (fresh) shareDialog(true);
  else if (!me) whoDialog();
}
boot();
