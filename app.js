import { openStore, makeKey } from './store.js';
import { SEED } from './activities.js';

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
let store = null, data = { events: [], activities: [] }, me = LS.get('me', null);
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
const tags = (a, long = false) => [
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
function render() {
  if (!store) return;
  const [s, e] = range();
  $('#label').textContent = view.mode === 'day' ? `${wd(s)} ${dmy(s)}` : `${dm(s)} – ${dmy(+e - 1)}`;
  document.querySelectorAll('#mode button').forEach(b => b.classList.toggle('on', b.dataset.v === view.mode));
  const mb = $('#meBtn');
  mb.replaceChildren(...(me ? [el('span', { class: 'dot', style: { background: colorOf(me) } }), PEOPLE[me].name] : ['Who are you?']));
  renderCalendar(dayList());
  renderAside();
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
  if (ev.status === 'confirmed' && ev.chosen) return actLabel(actById(ev.chosen));
  return ev.title || 'Plan';
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
    const top = t => `${(Math.max(t, ds) - ds) * pxPerMs}px`;
    const ht = (s, e) => `${Math.max((Math.min(e, de) - Math.max(s, ds)) * pxPerMs, 3)}px`;
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
    el('ul', { class: 'list' }, acts.map(x => el('li', { class: x.archived ? 'arch' : '', onclick: () => activityDialog(x), title: (x.note ? x.note + '\n' : '') + tags(x, true) },
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
    el('p', { class: 'hint' }, 'Drag on the calendar (or tap an empty spot) to add a plan or free/flexible time. Click anything to edit it. Keys: ← → t w 3 d + −.'),
  );
  a.scrollTop = keepScroll;
  if (focused) document.getElementById(focused)?.focus();
}

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
  return { nodes: [el('div', { class: 'row' }, el('label', {}, 'From'), sd, st), el('div', { class: 'row' }, el('label', {}, 'To'), ed, et), slots], read };
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
        onclick: () => { mine.has(a.id) ? mine.delete(a.id) : mine.add(a.id); draw(); onChange?.(); } },
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

function newDialog(s, e, opts = {}) {
  if (!me) return whoDialog(() => newDialog(s, e, opts));
  let kind = opts.kind || 'plan', who = me;
  const ti = timeInputs(s, e), rp = repeatInputs(null);
  const mine = new Set(opts.acts || []);
  const f = { ...filt, q: '', archived: false };
  const pk = picker({ mine, f });
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
  const pk = picker({ mine, other: otherSet, otherWho: other, f, onChange: () => drawInfo() });
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
      el('div', { class: 'row' }, el('label', {}, 'Status'), segCtl([['proposed', 'Proposed'], ['confirmed', '✓ Confirmed']], status, val => { status = val; })));
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
  const used = data.events.filter(e => e.kind === 'plan' && (votedIds(e).includes(a.id) || e.chosen === a.id)).length;
  dialog(isNew ? 'New idea' : actLabel(a), [
    el('div', { class: 'row' }, emoji, name),
    el('div', { class: 'row' }, el('label', {}, 'Where'), segCtl([['indoor', '🏠 Indoor'], ['outdoor', '🌳 Outdoor'], ['both', 'Either']], place, v => { place = v; })),
    el('div', { class: 'row' }, el('label', {}, 'Cost'), cost, el('label', { style: { minWidth: 0, marginLeft: '12px' } }, 'Length'), hours, el('span', { class: 'hint' }, 'hours')),
    el('div', { class: 'row' }, weatherL, bookingL),
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
        store.put('activities', { ...a, emoji: emoji.value.trim(), name: name.value.trim(), place, cost: +cost.value, hours: Math.max(0, +hours.value || 0),
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
    store = await openStore(key, d => { data = d; render(); }, err => { console.error(err); setStatus('down', 'Connection problem'); toast('Could not reach the database: ' + (err.code || err.message)); });
  } catch (err) { console.error(err); setStatus('down', 'Offline'); toast('Could not load Firebase'); return; }
  setStatus(store.mode === 'demo' ? 'demo' : '', store.mode === 'demo' ? 'Demo (this browser only)' : 'Live');
  store.start();
  await store.seed(SEED);
  render();
  scrollTo8();
  if (fresh) shareDialog(true);
  else if (!me) whoDialog();
}
boot();
