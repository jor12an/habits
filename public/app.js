/* Habits — private, local-first habit tracker. Data stays in localStorage. */
(() => {
  'use strict';

  const STORE_KEY = 'habits.v1';
  const COLORS = ['#ff9f0a', '#0a84ff', '#ff453a', '#30d158', '#bf5af2', '#64d2ff', '#ffd60a', '#ff375f'];
  const DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const DOW_FULL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DOW_TINY = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const HISTORY_DAYS = 90;
  const DAY_W = 44; // keep in sync with --day-w
  const HALF_LIFE = 14;
  const LALLY_DAYS = 66;

  let state = load();
  let editingId = null;
  let draft = null;
  let detailId = null;
  let scrollSyncing = false;
  let scrolledOnce = false;

  // ---------- Persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (!s.sort) s.sort = 'manual';
        if (!s.theme) s.theme = 'dark';
        return s;
      }
    } catch (_) { /* ignore */ }
    try {
      const old = localStorage.getItem('habitflow.v1');
      if (old) {
        const o = JSON.parse(old);
        return {
          habits: (o.habits || []).map(migrateHabit),
          sort: 'manual',
          theme: o.theme === 'light' ? 'light' : 'dark',
        };
      }
    } catch (_) { /* ignore */ }
    return { habits: [], sort: 'manual', theme: 'dark' };
  }

  function migrateHabit(h) {
    return {
      id: h.id,
      name: h.name,
      color: h.color || COLORS[0],
      type: h.goal > 1 || h.type === 'progressive' ? 'progressive' : 'basic',
      goal: h.goal || 1,
      days: Array.isArray(h.days) ? h.days : [0, 1, 2, 3, 4, 5, 6],
      log: h.log || {},
      created: h.created || todayKey(),
      order: h.order ?? 0,
    };
  }

  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  // ---------- Dates ----------
  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function keyFromOffset(offset) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return todayKey(d);
  }
  function dateFromKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function dowOf(k) {
    return dateFromKey(k).getDay();
  }
  function daysBetween(a, b) {
    return Math.round((dateFromKey(b) - dateFromKey(a)) / 86400000);
  }

  // ---------- Model ----------
  function progressFor(h, key) {
    return (h.log && h.log[key]) || 0;
  }
  function isScheduled(h, key) {
    return h.days.includes(dowOf(key));
  }
  function completion(h, key) {
    if (!isScheduled(h, key)) return null;
    const p = progressFor(h, key);
    if (h.type === 'progressive' && h.goal > 1) return Math.min(1, p / h.goal);
    return p > 0 ? 1 : 0;
  }
  function isComplete(h, key) {
    const c = completion(h, key);
    return c !== null && c >= 1;
  }

  /**
   * Strength 0–100: recency-weighted performance × maturity (Lally ~66d) × consistency.
   */
  function strengthOf(h) {
    const today = todayKey();
    const start = h.created || today;
    const lookback = Math.min(HISTORY_DAYS, Math.max(0, daysBetween(start, today)));
    let wSum = 0, wPerf = 0, nSched = 0, nDone = 0, longestMiss = 0, curMiss = 0;
    const lambda = Math.LN2 / HALF_LIFE;

    for (let i = lookback; i >= 0; i--) {
      const k = keyFromOffset(-i);
      if (daysBetween(start, k) < 0) continue;
      if (!isScheduled(h, k)) continue;
      nSched++;
      const c = completion(h, k) || 0;
      if (c >= 1) { nDone++; curMiss = 0; }
      else if (c > 0) curMiss = 0;
      else { curMiss++; longestMiss = Math.max(longestMiss, curMiss); }
      const w = Math.exp(-lambda * i);
      wSum += w;
      wPerf += w * c;
    }

    if (nSched === 0) {
      return { score: 0, stage: 'New', rate: 0, nSched: 0, nDone: 0 };
    }

    const recencyRate = wSum > 0 ? wPerf / wSum : 0;
    const maturity = 1 - Math.exp((-nSched * Math.log(20)) / LALLY_DAYS);
    const missRatio = longestMiss / Math.max(1, nSched);
    const consistency = Math.max(0.35, 1 - Math.min(1, missRatio * 1.4));
    const score = Math.round(Math.max(0, Math.min(100, recencyRate * maturity * consistency * 100)));

    let stage = 'Forming';
    if (score >= 80 && maturity > 0.85) stage = 'Automatic';
    else if (score >= 60) stage = 'Strong';
    else if (score >= 35) stage = 'Building';
    else if (nSched < 7) stage = 'New';

    return { score, stage, rate: recencyRate, nSched, nDone };
  }

  function streakOf(h) {
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const k = keyFromOffset(-i);
      if (!isScheduled(h, k)) continue;
      if (isComplete(h, k)) streak++;
      else if (i === 0) continue;
      else break;
    }
    return streak;
  }

  function bestStreakOf(h) {
    let best = 0, cur = 0;
    const today = todayKey();
    const start = h.created || today;
    const n = Math.min(HISTORY_DAYS, Math.max(0, daysBetween(start, today)));
    for (let i = n; i >= 0; i--) {
      const k = keyFromOffset(-i);
      if (!isScheduled(h, k)) continue;
      if (isComplete(h, k)) { cur++; best = Math.max(best, cur); }
      else cur = 0;
    }
    return best;
  }

  function weekdayRates(h) {
    const counts = Array.from({ length: 7 }, () => ({ due: 0, done: 0 }));
    const today = todayKey();
    const start = h.created || today;
    const n = Math.min(HISTORY_DAYS, Math.max(0, daysBetween(start, today)));
    for (let i = n; i >= 0; i--) {
      const k = keyFromOffset(-i);
      if (!isScheduled(h, k)) continue;
      const d = dowOf(k);
      counts[d].due++;
      if (isComplete(h, k)) counts[d].done++;
    }
    return counts.map(c => (c.due ? Math.round((c.done / c.due) * 100) : null));
  }

  function sortedHabits() {
    const list = state.habits.slice();
    switch (state.sort) {
      case 'name': return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'color': return list.sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.name.localeCompare(b.name));
      case 'score': return list.sort((a, b) => strengthOf(b).score - strengthOf(a).score);
      case 'created': return list.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
      default: return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
  }

  // ---------- DOM ----------
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function markHTML(h, key) {
    if (!isScheduled(h, key)) return { html: '', off: true, full: false };
    const prog = progressFor(h, key);
    const done = isComplete(h, key);
    // Inline SVG so marks always paint (no font/glyph issues)
    const check = `<svg class="mark-svg" viewBox="0 0 24 24" aria-label="Done" width="16" height="16"><path fill="none" stroke="#30d158" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>`;
    const cross = `<svg class="mark-svg" viewBox="0 0 24 24" aria-label="Missed" width="15" height="15"><path fill="none" stroke="#8e8e93" stroke-width="2.5" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>`;
    if (h.type === 'progressive' && h.goal > 1) {
      if (prog <= 0) return { html: cross, off: false, full: false };
      if (done) return { html: check, off: false, full: true };
      const pct = Math.round((prog / h.goal) * 100);
      return { html: `<span class="mark-pct">${pct}%</span>`, off: false, full: false };
    }
    return done ? { html: check, off: false, full: true } : { html: cross, off: false, full: false };
  }

  /** Full history oldest → newest; ~4 columns visible, swipe for more (no scrollbar). */
  function dateKeys() {
    const keys = [];
    for (let i = HISTORY_DAYS; i >= 0; i--) keys.push(keyFromOffset(-i));
    return keys;
  }

  /** % of scheduled habits completed on a given day. */
  function dayCompletion(key) {
    let due = 0, done = 0;
    state.habits.forEach((h) => {
      if (!isScheduled(h, key)) return;
      due++;
      if (isComplete(h, key)) done++;
    });
    if (due === 0) return { due: 0, done: 0, pct: 0, none: true };
    return { due, done, pct: Math.round((done / due) * 100), none: false };
  }

  /** SVG ring around the day number (r=13, circ≈81.68). */
  function dayRingHTML(pct, none) {
    const r = 13;
    const c = 2 * Math.PI * r;
    const offset = none ? c : c * (1 - Math.min(1, Math.max(0, pct / 100)));
    let cls = 'ring-prog';
    if (none || pct <= 0) cls += ' empty';
    else if (pct >= 100) cls += ' full';
    else cls += ' partial';
    return `<span class="day-ring" aria-hidden="true">
      <svg viewBox="0 0 30 30">
        <circle class="ring-track" cx="15" cy="15" r="${r}"></circle>
        <circle class="ring-prog ${cls}" cx="15" cy="15" r="${r}"
          stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
      <span class="dnum"></span>
    </span>`;
  }

  function render() {
    applyTheme();
    const habits = sortedHabits();
    const empty = $('#emptyState');
    const board = $('#board');

    if (habits.length === 0) {
      empty.hidden = false;
      board.hidden = true;
      // clear board so no grey/black split flashes
      const names = $('#colNames');
      const track = $('#daysTrack');
      if (names) names.innerHTML = '';
      if (track) track.innerHTML = '';
      return;
    }
    empty.hidden = true;
    board.hidden = false;

    const keys = dateKeys();
    const today = todayKey();
    const names = $('#colNames');
    const track = $('#daysTrack');
    const days = $('#colDays');
    const prevTop = days.scrollTop;
    const prevLeft = days.scrollLeft;

    names.innerHTML = '';
    track.innerHTML = '';
    track.style.width = (keys.length * DAY_W) + 'px';

    // "Score" header aligned with score column (rightmost in name area)
    const corner = el('div', 'corner');
    corner.innerHTML = `<span class="score-hdr">Score</span>`;
    names.appendChild(corner);

    const canReorder = state.sort === 'manual';
    habits.forEach((h, idx) => {
      const s = strengthOf(h);
      const row = el('div', 'name-row');
      row.style.setProperty('--hc', h.color);
      row.dataset.id = h.id;
      row.innerHTML = `
        <span class="reorder" ${canReorder ? '' : 'hidden'}>
          <button type="button" class="move-up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="move-down" aria-label="Move down" ${idx === habits.length - 1 ? 'disabled' : ''}>▼</button>
        </span>
        <span class="label">
          <span class="nm">${escapeHtml(h.name)}</span>
          <span class="meta">
            <span class="score">${s.score}</span>
            <span class="stage">${escapeHtml(s.stage)}</span>
          </span>
        </span>`;
      row.querySelector('.label').onclick = () => openDetail(h.id);
      if (canReorder) {
        row.querySelector('.move-up').onclick = (e) => { e.stopPropagation(); moveHabit(h.id, -1); };
        row.querySelector('.move-down').onclick = (e) => { e.stopPropagation(); moveHabit(h.id, 1); };
      }
      names.appendChild(row);
    });

    const heads = el('div', 'day-heads');
    keys.forEach((k) => {
      const d = dateFromKey(k);
      const dc = dayCompletion(k);
      const cell = el('div', 'day-head' + (k === today ? ' today' : '') + (dc.none ? ' none' : ''));
      cell.title = dc.none
        ? `${k}: nothing scheduled`
        : `${k}: ${dc.done}/${dc.due} done (${dc.pct}%)`;
      cell.innerHTML = `<span class="dow">${DOW_TINY[d.getDay()]}</span>${dayRingHTML(dc.pct, dc.none)}`;
      cell.querySelector('.dnum').textContent = String(d.getDate());
      heads.appendChild(cell);
    });
    track.appendChild(heads);

    habits.forEach((h) => {
      const row = el('div', 'cell-row');
      row.dataset.id = h.id;
      keys.forEach((k) => {
        const m = markHTML(h, k);
        const btn = el('button', 'mark-cell' + (m.full ? ' full' : ''));
        btn.type = 'button';
        btn.style.setProperty('--hc', h.color);
        btn.innerHTML = m.html;
        if (m.off) {
          btn.disabled = true;
        } else {
          btn.onclick = () => toggleCell(h, k);
        }
        row.appendChild(btn);
      });
      track.appendChild(row);
    });

    requestAnimationFrame(() => {
      if (!scrolledOnce) {
        days.scrollLeft = days.scrollWidth;
        scrolledOnce = true;
      } else {
        days.scrollLeft = prevLeft;
      }
      days.scrollTop = prevTop;
      names.scrollTop = prevTop;
    });
  }

  function wireScrollSync() {
    const names = $('#colNames');
    const days = $('#colDays');
    days.addEventListener('scroll', () => {
      if (scrollSyncing) return;
      scrollSyncing = true;
      names.scrollTop = days.scrollTop;
      scrollSyncing = false;
    }, { passive: true });
    names.addEventListener('scroll', () => {
      if (scrollSyncing) return;
      scrollSyncing = true;
      days.scrollTop = names.scrollTop;
      scrollSyncing = false;
    }, { passive: true });

    // Mouse drag-to-scroll days (touch uses native pan-x)
    let drag = null;
    days.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return;
      const onMark = e.target.closest && e.target.closest('.mark-cell:not(:disabled)');
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        left: days.scrollLeft,
        top: days.scrollTop,
        moved: false,
        onMark: !!onMark,
      };
    });
    days.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (drag.onMark && !drag.moved && Math.abs(dx) < 8) return;
      drag.moved = true;
      try { days.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      days.scrollLeft = drag.left - dx;
      days.scrollTop = drag.top - dy;
      e.preventDefault();
    });
    const endDrag = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved) {
        const suppress = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          days.removeEventListener('click', suppress, true);
        };
        days.addEventListener('click', suppress, true);
      }
      drag = null;
    };
    days.addEventListener('pointerup', endDrag);
    days.addEventListener('pointercancel', endDrag);
  }

  function deleteAllHabits() {
    if (!state.habits.length) {
      toast('No habits to delete');
      return;
    }
    const n = state.habits.length;
    if (!confirm(`Delete all ${n} habit${n === 1 ? '' : 's'} and their history? This cannot be undone.`)) return;
    if (!confirm('Are you sure? Export first if you want a backup.')) return;
    state.habits = [];
    save();
    closeDetail();
    scrolledOnce = false;
    render();
    toast('All habits deleted');
  }

  /** Move habit up (-1) or down (+1). Forces custom sort so order sticks. */
  function moveHabit(id, dir) {
    state.sort = 'manual';
    const list = state.habits.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const i = list.findIndex((h) => h.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    list.forEach((h, idx) => { h.order = idx; });
    state.habits = list;
    save();
    render();
  }

  function toggleCell(h, key) {
    h.log = h.log || {};
    const cur = progressFor(h, key);
    if (h.type === 'progressive' && h.goal > 1) {
      h.log[key] = cur >= h.goal ? 0 : cur + 1;
    } else {
      h.log[key] = cur >= 1 ? 0 : 1;
    }
    if (h.log[key] === 0) delete h.log[key];
    save();
    if (navigator.vibrate) navigator.vibrate(10);
    render();
    if (detailId === h.id) renderDetail();
  }

  // ---------- Detail ----------
  function openDetail(id) {
    detailId = id;
    const home = $('#view-home');
    const detail = $('#view-detail');
    home.classList.remove('active');
    home.setAttribute('hidden', '');
    detail.removeAttribute('hidden');
    detail.classList.add('active');
    renderDetail();
    // ensure back control is bound even if init order was odd
    const back = $('#btnBack');
    if (back) back.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeDetail(); };
  }
  function closeDetail() {
    detailId = null;
    const home = $('#view-home');
    const detail = $('#view-detail');
    detail.classList.remove('active');
    detail.setAttribute('hidden', '');
    home.removeAttribute('hidden');
    home.classList.add('active');
    try { render(); } catch (err) { console.error(err); }
  }
  function renderDetail() {
    const h = state.habits.find(x => x.id === detailId);
    if (!h) return closeDetail();
    const s = strengthOf(h);
    $('#detailTitle').textContent = h.name;
    const rates = weekdayRates(h);
    const heat = [];
    for (let i = 89; i >= 0; i--) {
      const k = keyFromOffset(-i);
      if (!isScheduled(h, k)) {
        heat.push(`<div class="hm-cell off" title="${k}"></div>`);
      } else {
        const c = completion(h, k) || 0;
        if (c <= 0) heat.push(`<div class="hm-cell" title="${k}"></div>`);
        else {
          const op = (0.35 + c * 0.65).toFixed(2);
          heat.push(`<div class="hm-cell" title="${k}" style="background:${h.color};opacity:${op}"></div>`);
        }
      }
    }
    const freq = rates.map((p, i) => `
      <div class="freq-pill">
        <div class="d">${DOW_SHORT[i]}</div>
        <div class="p" style="color:${p === null ? 'var(--text-faint)' : h.color}">${p === null ? '—' : p + '%'}</div>
      </div>`).join('');

    $('#detailBody').innerHTML = `
      <div class="score-hero">
        <div class="big" style="color:${h.color}">${s.score}</div>
        <div class="label">${s.stage}</div>
        <div class="sub">Habit strength · recency-weighted · matures over ~${LALLY_DAYS} scheduled days</div>
        <div class="score-bar"><i style="width:${s.score}%;background:${h.color}"></i></div>
      </div>
      <div class="stat-grid">
        <div class="stat-tile"><span class="n">${streakOf(h)}</span><span class="l">Current streak</span></div>
        <div class="stat-tile"><span class="n">${bestStreakOf(h)}</span><span class="l">Best streak</span></div>
        <div class="stat-tile"><span class="n">${s.nDone}</span><span class="l">Days completed</span></div>
        <div class="stat-tile"><span class="n">${Math.round(s.rate * 100)}%</span><span class="l">Recent rate</span></div>
      </div>
      <div class="section-h">Last 90 days</div>
      <div class="heatmap">${heat.join('')}</div>
      <div class="section-h">By weekday</div>
      <div class="freq-row">${freq}</div>
      <div class="section-h">How this score works</div>
      <p style="font-size:13px;color:var(--text-soft);line-height:1.5;margin:0">
        Recent check-ins count more (half-life ${HALF_LIFE} days). Maturity grows toward automaticity around
        ${LALLY_DAYS} scheduled days (Lally et al., 2010). Long miss streaks lower consistency. Past days are editable.
      </p>`;
  }

  // ---------- Sheet ----------
  function newDraft() {
    return {
      name: '',
      color: COLORS[state.habits.length % COLORS.length],
      type: 'basic',
      goal: 1,
      days: [0, 1, 2, 3, 4, 5, 6],
    };
  }
  function buildPickers() {
    const cp = $('#colorPicker');
    cp.innerHTML = '';
    COLORS.forEach((c) => {
      const b = el('button');
      b.type = 'button';
      b.style.background = c;
      b.style.color = c;
      b.onclick = () => { draft.color = c; syncPickers(); };
      cp.appendChild(b);
    });
    const dp = $('#daysPicker');
    dp.innerHTML = '';
    DOW_SHORT.forEach((d, i) => {
      const b = el('button');
      b.type = 'button';
      b.textContent = d;
      b.onclick = () => {
        const idx = draft.days.indexOf(i);
        if (idx >= 0) { if (draft.days.length > 1) draft.days.splice(idx, 1); }
        else draft.days.push(i);
        syncPickers();
      };
      dp.appendChild(b);
    });
  }
  function rgbToHex(rgb) {
    const m = String(rgb).match(/\d+/g);
    if (!m) return String(rgb).toLowerCase();
    return '#' + m.slice(0, 3).map(x => (+x).toString(16).padStart(2, '0')).join('');
  }
  function syncPickers() {
    [...$('#colorPicker').children].forEach((b) => {
      const bg = b.style.background.toLowerCase();
      b.classList.toggle('active', bg === draft.color.toLowerCase() || rgbToHex(bg) === draft.color.toLowerCase());
    });
    [...$('#daysPicker').children].forEach((b, i) => b.classList.toggle('active', draft.days.includes(i)));
    [...$('#typeSeg').children].forEach((b) => b.classList.toggle('active', b.dataset.type === draft.type));
    $('#goalVal').textContent = draft.goal;
    const prog = draft.type === 'progressive';
    $('#goalBlock').hidden = !prog;
    $('#typeNote').textContent = prog
      ? 'Count up toward a daily target (e.g. glasses of water).'
      : 'One check per scheduled day.';
  }
  function openSheet(id) {
    editingId = id || null;
    if (id) {
      const h = state.habits.find(x => x.id === id);
      draft = {
        name: h.name,
        color: h.color,
        type: h.type === 'progressive' ? 'progressive' : 'basic',
        goal: h.goal || 1,
        days: h.days.slice(),
      };
    } else draft = newDraft();
    $('#sheetTitle').textContent = id ? 'Edit habit' : 'New habit';
    $('#fName').value = draft.name;
    $('#deleteBtn').hidden = !id;
    syncPickers();
    $('#sheetBackdrop').hidden = false;
    $('#habitSheet').hidden = false;
    setTimeout(() => $('#fName').focus(), 150);
  }
  function closeSheet() {
    $('#sheetBackdrop').hidden = true;
    $('#habitSheet').hidden = true;
  }
  function saveHabit() {
    draft.name = $('#fName').value.trim() || 'Untitled';
    if (draft.type === 'basic') draft.goal = 1;
    if (editingId) {
      const h = state.habits.find(x => x.id === editingId);
      Object.assign(h, draft);
      toast('Habit updated');
    } else {
      state.habits.push({
        ...draft,
        id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        log: {},
        created: todayKey(),
        order: state.habits.length,
      });
      toast('Habit added');
    }
    save();
    closeSheet();
    if (detailId) renderDetail();
    render();
  }
  function deleteHabit() {
    if (!editingId) return;
    if (!confirm('Delete this habit and its history?')) return;
    state.habits = state.habits.filter(h => h.id !== editingId);
    save();
    closeSheet();
    if (detailId === editingId) closeDetail();
    else render();
    toast('Deleted');
  }

  // ---------- Import / export ----------
  function exportData() {
    const payload = {
      app: 'Habits',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `habits-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exported');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const data = parsed.data || parsed;
        if (!data || !Array.isArray(data.habits)) throw new Error('Invalid file');
        if (!confirm('Import will replace all current habits on this device. Continue?')) return;
        state = {
          habits: data.habits.map(migrateHabit),
          sort: data.sort || 'manual',
          theme: data.theme || state.theme || 'dark',
        };
        state.habits.forEach((h, i) => { if (h.order == null) h.order = i; });
        save();
        closeDetail();
        scrolledOnce = false;
        render();
        toast('Imported');
      } catch (e) {
        toast('Import failed');
        console.error(e);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Theme / help ----------
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme === 'light' ? 'light' : 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = state.theme === 'light' ? '#f2f2f7' : '#0d0d0f';
  }
  function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    save();
    applyTheme();
  }
  function openHelp() {
    $('#helpBody').innerHTML = `
      <h3>What the score means</h3>
      <p>Each habit gets a <strong>0–100 strength score</strong> estimating how close the behaviour is to feeling automatic.</p>
      <h3>Research basis</h3>
      <ul>
        <li><strong>Lally et al. (2010)</strong> — automaticity rises asymptotically; median ~<strong>66 days</strong> to 95% of each person’s plateau (range 18–254). Missing a day does not reset formation.</li>
        <li><strong>Gardner and others</strong> — habits form through repeated performance in stable contexts.</li>
      </ul>
      <h3>Our algorithm</h3>
      <ul>
        <li><strong>Recency-weighted performance</strong> — recent scheduled days count more (half-life ${HALF_LIFE} days).</li>
        <li><strong>Maturity</strong> — full score room opens over ~${LALLY_DAYS} scheduled opportunities.</li>
        <li><strong>Consistency</strong> — long miss streaks hurt more than isolated misses.</li>
      </ul>
      <p><strong>Stages:</strong> New → Forming → Building → Strong → Automatic.</p>
      <h3>Your data</h3>
      <p>Everything stays in this browser. Use Export / Import to back up. Import replaces current data.</p>`;
    $('#helpBackdrop').hidden = false;
    $('#helpSheet').hidden = false;
  }

  function seedIfNeeded() {
    if (state.habits.length > 0) return;
    if (localStorage.getItem('habits.seeded')) return;
    const samples = [
      { name: 'Drink 1.5L of water', color: COLORS[0], type: 'progressive', goal: 5, days: [0,1,2,3,4,5,6] },
      { name: 'Go jogging', color: COLORS[1], type: 'basic', goal: 1, days: [1,2,3,4,5] },
      { name: 'Read 3 newspaper articles', color: COLORS[1], type: 'progressive', goal: 3, days: [0,1,2,3,4,5,6] },
      { name: 'Revise a lesson', color: COLORS[2], type: 'basic', goal: 1, days: [1,2,3,4,5] },
      { name: 'Workout', color: COLORS[3], type: 'basic', goal: 1, days: [1,3,5] },
    ];
    samples.forEach((s, idx) => {
      const log = {};
      for (let i = 21; i >= 0; i--) {
        const k = keyFromOffset(-i);
        if (!s.days.includes(dowOf(k))) continue;
        const roll = (idx * 7 + i * 3) % 10;
        if (roll < 7) log[k] = s.goal > 1 ? 1 + ((idx + i) % s.goal) : 1;
      }
      state.habits.push({
        ...s,
        id: 'h_demo_' + idx,
        log,
        created: keyFromOffset(-21),
        order: idx,
      });
    });
    localStorage.setItem('habits.seeded', '1');
    save();
  }

  function openSort() {
    [...$('#sortOptions').children].forEach(b => b.classList.toggle('active', b.dataset.sort === state.sort));
    $('#sortBackdrop').hidden = false;
    $('#sortSheet').hidden = false;
  }
  function closeSort() {
    $('#sortBackdrop').hidden = true;
    $('#sortSheet').hidden = true;
  }
  function openMenu() {
    $('#menuBackdrop').hidden = false;
    $('#menuSheet').hidden = false;
  }
  function closeMenu() {
    $('#menuBackdrop').hidden = true;
    $('#menuSheet').hidden = true;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  function init() {
    seedIfNeeded();
    buildPickers();
    applyTheme();
    wireScrollSync();
    render();

    $('#btnAdd').onclick = () => openSheet();
    $('#emptyAddBtn').onclick = () => openSheet();
    $('#btnSort').onclick = openSort;
    $('#btnMenu').onclick = openMenu;
    $('#btnBack').onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeDetail(); };
    $('#btnEdit').onclick = () => openSheet(detailId);

    $('#sheetClose').onclick = closeSheet;
    $('#sheetBackdrop').onclick = closeSheet;
    $('#saveBtn').onclick = saveHabit;
    $('#deleteBtn').onclick = deleteHabit;
    $('#goalPlus').onclick = () => { draft.goal = Math.min(30, draft.goal + 1); syncPickers(); };
    $('#goalMinus').onclick = () => { draft.goal = Math.max(1, draft.goal - 1); syncPickers(); };
    [...$('#typeSeg').children].forEach((b) => {
      b.onclick = () => {
        draft.type = b.dataset.type;
        if (draft.type === 'progressive' && draft.goal < 2) draft.goal = 2;
        if (draft.type === 'basic') draft.goal = 1;
        syncPickers();
      };
    });

    $('#sortBackdrop').onclick = closeSort;
    [...$('#sortOptions').children].forEach((b) => {
      b.onclick = () => {
        state.sort = b.dataset.sort;
        save();
        closeSort();
        render();
        toast('Sorted by ' + b.textContent);
      };
    });

    $('#menuBackdrop').onclick = closeMenu;
    $('#btnExport').onclick = () => { closeMenu(); exportData(); };
    $('#btnImport').onclick = () => { $('#importFile').click(); };
    $('#importFile').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      closeMenu();
      if (f) importData(f);
      e.target.value = '';
    };
    $('#btnTheme').onclick = () => { closeMenu(); toggleTheme(); };
    $('#btnHelp').onclick = () => { closeMenu(); openHelp(); };
    $('#btnDeleteAll').onclick = () => { closeMenu(); deleteAllHabits(); };
    $('#helpClose').onclick = () => { $('#helpBackdrop').hidden = true; $('#helpSheet').hidden = true; };
    $('#helpBackdrop').onclick = () => { $('#helpBackdrop').hidden = true; $('#helpSheet').hidden = true; };
  }

  document.addEventListener('DOMContentLoaded', init);

  // Disable double-tap zoom (skip when interacting with controls)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, button, a, .mark-cell, .reorder')) return;
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          try { reg.update(); } catch (_) { /* ignore */ }
        })
        .catch(() => {});
    });
  }
})();
