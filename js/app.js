import {
  proposeFeeding, actualRatio, hydration, peakHours, planFeedTime, alternatives,
  calibrationFactor, feedingRatio, toICS, ratioLabel, sameRatio, RATIO_PRESETS,
  cToF, fToC, HOUR,
} from './logic.js';
import { getState, update, uid, exportJSON, importJSON, requestPersistence } from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (d) => {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtDateTime = (d) =>
  new Date(d).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDur = (hours) => {
  const m = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${pad(m % 60)}m` : `${m}m`;
};
const num = (el) => {
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : NaN;
};
const g = (n) => `${Math.round(n)} g`;

const unit = () => getState().settings.tempUnit;
const tempOut = (c) => (unit() === 'F' ? Math.round(cToF(c)) : Math.round(c * 10) / 10);
const tempIn = (v) => (unit() === 'F' ? fToC(v) : v);
const tempLabel = () => `°${unit()}`;

const activeContainers = () => getState().containers.filter((c) => !c.archived);
const factorInfo = () => {
  const s = getState();
  return s.settings.calibrate ? calibrationFactor(s.feedings) : { factor: 1, samples: 0 };
};

/* ---------- tabs ---------- */
const renderers = { feed: renderFeed, plan: renderPlan, history: renderHistory, settings: renderSettings };
let currentTab = 'feed';

function showTab(name) {
  currentTab = name;
  for (const btn of document.querySelectorAll('[data-tab]')) btn.classList.toggle('active', btn.dataset.tab === name);
  for (const t of Object.keys(renderers)) $(`#tab-${t}`).hidden = t !== name;
  renderers[name]();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return showTab(tab.dataset.tab);
  const act = e.target.closest('[data-action]');
  if (act) actions[act.dataset.action]?.(act, e);
});

/* ---------- FEED ---------- */
let form = null;

function newForm() {
  const s = getState();
  const containers = activeContainers();
  const last = containers.find((c) => c.id === s.settings.lastContainerId) || containers[0];
  return {
    containerId: last?.id ?? null,
    at: toLocalInput(new Date()),
    tempC: s.settings.defaultTempC,
    ratio: { ...s.settings.ratio },
    keepG: s.settings.keepG,
    dirty: { discard: false, flour: false, water: false },
    gross: '',
  };
}

function ratioOptions(selected) {
  const opts = [...RATIO_PRESETS];
  if (!opts.some((r) => sameRatio(r, selected))) opts.unshift(selected);
  return opts
    .map((r, i) => `<option value="${i}" ${sameRatio(r, selected) ? 'selected' : ''}>${ratioLabel(r)}</option>`)
    .join('');
}

function renderFeed() {
  const s = getState();
  if (!form) form = newForm();
  const containers = activeContainers();
  const el = $('#tab-feed');

  if (containers.length === 0) {
    el.innerHTML = `
      <div class="card"><div class="card-body">
        <h2 class="h5">Add a container first</h2>
        <p class="mb-3">Weigh your empty jar and save it with its name so feedings can subtract its weight.</p>
        <button class="btn btn-primary" data-tab="settings" type="button">Go to Settings</button>
      </div></div>`;
    return;
  }
  if (!containers.some((c) => c.id === form.containerId)) form.containerId = containers[0].id;

  el.innerHTML = `
    <div id="status" class="mb-3"></div>

    <form id="feed-form" class="card mb-3" autocomplete="off" novalidate>
      <div class="card-body">
        <h2 class="h5 mb-3">New feeding</h2>
        <div class="row g-2 mb-2">
          <div class="col-7">
            <label class="form-label mb-1" for="f-container">Container</label>
            <select id="f-container" class="form-select">
              ${containers.map((c) => `<option value="${c.id}" ${c.id === form.containerId ? 'selected' : ''}>${esc(c.name)} (${g(c.tareG)} empty)</option>`).join('')}
            </select>
          </div>
          <div class="col-5">
            <label class="form-label mb-1" for="f-gross">Jar + starter (g)</label>
            <input id="f-gross" class="form-control" type="number" inputmode="decimal" step="any" min="0" value="${esc(form.gross)}" placeholder="scale reading">
          </div>
        </div>
        <div class="row g-2 mb-2">
          <div class="col-6">
            <label class="form-label mb-1" for="f-at">Fed at</label>
            <input id="f-at" class="form-control" type="datetime-local" value="${form.at}">
          </div>
          <div class="col-6">
            <label class="form-label mb-1" for="f-temp">Room temp (${tempLabel()})</label>
            <input id="f-temp" class="form-control" type="number" inputmode="decimal" step="any" value="${tempOut(form.tempC)}">
          </div>
        </div>
        <div class="row g-2 mb-3">
          <div class="col-6">
            <label class="form-label mb-1" for="f-ratio">Ratio (starter:flour:water)</label>
            <select id="f-ratio" class="form-select">${ratioOptions(form.ratio)}</select>
          </div>
          <div class="col-6">
            <label class="form-label mb-1" for="f-keep">Keep (g)</label>
            <input id="f-keep" class="form-control" type="number" inputmode="decimal" step="any" min="1" value="${form.keepG}">
          </div>
        </div>

        <div id="proposal"></div>

        <h3 class="h6 mt-3">What I actually did (g)</h3>
        <div class="row g-2">
          <div class="col-4"><label class="form-label mb-1" for="a-discard">Discarded</label>
            <input id="a-discard" class="form-control" type="number" inputmode="decimal" step="any" min="0"></div>
          <div class="col-4"><label class="form-label mb-1" for="a-flour">Flour added</label>
            <input id="a-flour" class="form-control" type="number" inputmode="decimal" step="any" min="0"></div>
          <div class="col-4"><label class="form-label mb-1" for="a-water">Water added</label>
            <input id="a-water" class="form-control" type="number" inputmode="decimal" step="any" min="0"></div>
        </div>
        <div id="actual-summary" class="small mt-2"></div>

        <label class="form-label mt-3 mb-1" for="f-note">Note (optional)</label>
        <input id="f-note" class="form-control" type="text" placeholder="e.g. 80% white / 20% rye">
        <div id="form-error" class="text-danger small mt-2" role="alert"></div>
        <button class="btn btn-primary w-100 mt-2" type="submit" id="f-save">Save feeding</button>
      </div>
    </form>`;

  renderStatus();
  updateProposal(true);
}

function renderStatus() {
  const box = $('#status');
  if (!box) return;
  const s = getState();
  const last = s.feedings[s.feedings.length - 1];
  if (!last) {
    box.innerHTML = `<div class="alert alert-secondary mb-0">No feedings logged yet.</div>`;
    return;
  }
  const { factor } = factorInfo();
  const hours = peakHours({ ratio: feedingRatio(last), tempC: last.roomTempC ?? s.settings.defaultTempC, factor });
  const peakAt = new Date(+new Date(last.at) + hours * HOUR);
  const since = (Date.now() - new Date(last.at)) / HOUR;
  const toPeak = (+peakAt - Date.now()) / HOUR;
  const peakLine = last.peakAt
    ? `Peaked ${fmtDur((new Date(last.peakAt) - new Date(last.at)) / HOUR)} after feeding`
    : toPeak > 0
      ? `Expected peak ~${fmtTime(peakAt)} (in ${fmtDur(toPeak)})`
      : `Past expected peak (~${fmtTime(peakAt)}) — use or feed soon`;
  box.innerHTML = `
    <div class="card"><div class="card-body">
      <div class="text-secondary small">Last fed</div>
      <div class="big-num">${since >= 0 ? fmtDur(since) + ' ago' : 'just now'}</div>
      <div class="small">${fmtDateTime(last.at)} · ${esc(last.containerName)} · ${ratioLabel(roundRatio(feedingRatio(last)))}</div>
      <div class="mt-1">${peakLine}</div>
    </div></div>`;
}

const roundRatio = (r) => ({ starter: 1, flour: Math.round(r.flour * 10) / 10, water: Math.round(r.water * 10) / 10 });

/** Recompute the proposal from the form inputs and refresh dependent fields. */
function updateProposal(initial = false) {
  const c = activeContainers().find((x) => x.id === form.containerId);
  const gross = num($('#f-gross'));
  const keep = num($('#f-keep'));
  const box = $('#proposal');
  const inputs = { discard: $('#a-discard'), flour: $('#a-flour'), water: $('#a-water') };

  const p = c && Number.isFinite(gross) ? proposeFeeding({ grossG: gross, tareG: c.tareG, keepG: keep, ratio: form.ratio }) : null;

  if (!c || !Number.isFinite(gross) || gross === 0 && initial) {
    box.innerHTML = `<div class="text-secondary small">Enter the scale reading of the jar with starter to get a proposal.</div>`;
  } else if (p.error) {
    box.innerHTML = `<div class="text-danger small">${esc(p.error)}</div>`;
  } else {
    box.innerHTML = `
      <div class="border rounded p-2">
        <div class="small text-secondary mb-1">Starter on hand ${g(p.starterG)} · proposed (keep ${g(p.keepG)})</div>
        <div class="row text-center g-2">
          ${step('Discard', p.discardG, `jar → ${g(p.targets.afterDiscard)}`)}
          ${step('Add flour', p.flourG, `jar → ${g(p.targets.afterFlour)}`)}
          ${step('Add water', p.waterG, `jar → ${g(p.targets.afterWater)}`)}
        </div>
        ${p.lowStarter ? `<div class="small text-warning-emphasis mt-1">Less starter than your keep amount, so nothing to discard and the feed is scaled down.</div>` : ''}
        <div class="small text-secondary mt-1">Total after feeding: ${g(p.totalG)}</div>
      </div>`;
    if (p && !p.error) {
      const vals = { discard: p.discardG, flour: p.flourG, water: p.waterG };
      for (const k of Object.keys(inputs)) if (!form.dirty[k]) inputs[k].value = vals[k];
    }
  }
  updateActualSummary(p && !p.error ? p : null);
}

const step = (label, grams, target) =>
  `<div class="col-4"><div class="small text-secondary">${label}</div><div class="big-num">${Math.round(grams)}<span class="fs-6"> g</span></div><div class="step-target">${target}</div></div>`;

function updateActualSummary(p) {
  const box = $('#actual-summary');
  const c = activeContainers().find((x) => x.id === form.containerId);
  const gross = num($('#f-gross'));
  const discard = num($('#a-discard'));
  const flour = num($('#a-flour'));
  const water = num($('#a-water'));
  if (!p || ![discard, flour, water].every(Number.isFinite) || !c) {
    box.textContent = '';
    return;
  }
  const starterG = gross - c.tareG;
  const kept = starterG - discard;
  const r = actualRatio({ starterG, discardG: discard, flourG: flour, waterG: water });
  const h = hydration(flour, water);
  const off = (a, b) => b > 0 && Math.abs(a - b) / b > 0.1;
  const warn = off(discard, p.discardG) || off(flour, p.flourG) || off(water, p.waterG);
  box.innerHTML = r
    ? `Actual: kept ${g(kept)}, ratio ${ratioLabel(roundRatio(r))}, total ${g(kept + flour + water)}${h != null ? `, ${Math.round(h)}% hydration (flour/water)` : ''}.${warn ? ' <span class="text-warning-emphasis">More than 10% off the proposal.</span>' : ''}`
    : `<span class="text-danger">Discarded amount leaves no starter.</span>`;
}

document.addEventListener('input', (e) => {
  if (!form || currentTab !== 'feed') return;
  const id = e.target.id;
  if (id === 'f-gross') form.gross = e.target.value;
  else if (id === 'f-keep') form.keepG = num(e.target);
  else if (id === 'f-at') form.at = e.target.value;
  else if (id === 'f-temp') form.tempC = tempIn(num(e.target));
  else if (id === 'a-discard' || id === 'a-flour' || id === 'a-water') form.dirty[id.slice(2)] = true;
  else return;
  if (['f-gross', 'f-keep', 'a-discard', 'a-flour', 'a-water'].includes(id)) updateProposal();
});

document.addEventListener('change', (e) => {
  if (!form || currentTab !== 'feed') return;
  if (e.target.id === 'f-container') {
    form.containerId = e.target.value;
    updateProposal();
  } else if (e.target.id === 'f-ratio') {
    const opts = [...RATIO_PRESETS];
    if (!opts.some((r) => sameRatio(r, form.ratio))) opts.unshift(form.ratio);
    form.ratio = { ...opts[+e.target.value] };
    form.dirty = { discard: false, flour: false, water: false };
    updateProposal();
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'feed-form') return;
  e.preventDefault();
  const err = $('#form-error');
  const c = activeContainers().find((x) => x.id === form.containerId);
  const gross = num($('#f-gross'));
  const keep = num($('#f-keep'));
  const discard = num($('#a-discard'));
  const flour = num($('#a-flour'));
  const water = num($('#a-water'));
  const at = new Date($('#f-at').value);
  const tempC = tempIn(num($('#f-temp')));
  const p = c && Number.isFinite(gross) ? proposeFeeding({ grossG: gross, tareG: c.tareG, keepG: keep, ratio: form.ratio }) : null;
  if (!c) return (err.textContent = 'Pick a container.');
  if (!p || p.error) return (err.textContent = p?.error || 'Enter the jar + starter weight.');
  if (![discard, flour, water].every((n) => Number.isFinite(n) && n >= 0)) return (err.textContent = 'Enter the discarded, flour and water amounts.');
  if (Number.isNaN(+at)) return (err.textContent = 'Enter a valid feeding time.');
  if (discard >= p.starterG) return (err.textContent = 'Discarded amount leaves no starter.');
  const note = $('#f-note').value.trim();

  update((s) => {
    s.feedings.push({
      id: uid(),
      at: at.toISOString(),
      containerId: c.id,
      containerName: c.name,
      tareG: c.tareG,
      grossBeforeG: gross,
      starterG: p.starterG,
      proposed: { keepG: p.keepG, discardG: p.discardG, flourG: p.flourG, waterG: p.waterG },
      actual: { discardG: discard, flourG: flour, waterG: water },
      ratioPlanned: { ...form.ratio },
      roomTempC: Number.isFinite(tempC) ? tempC : s.settings.defaultTempC,
      note,
      peakAt: null,
    });
    s.settings.lastContainerId = c.id;
  });
  form = null;
  renderFeed();
  const box = $('#status');
  box.insertAdjacentHTML('afterbegin', `<div class="alert alert-success py-2" role="status">Feeding saved.</div>`);
  window.scrollTo(0, 0);
});

/* ---------- PLAN ---------- */
let plan = null;

function renderPlan() {
  const s = getState();
  if (!plan) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    plan = { mixAt: toLocalInput(d), tempC: s.settings.defaultTempC, ratio: { ...s.settings.ratio } };
  }
  $('#tab-plan').innerHTML = `
    <div class="card mb-3"><div class="card-body">
      <h2 class="h5 mb-3">When should I feed?</h2>
      <div class="row g-2">
        <div class="col-7">
          <label class="form-label mb-1" for="p-mix">Start mixing dough at</label>
          <input id="p-mix" class="form-control" type="datetime-local" value="${plan.mixAt}">
        </div>
        <div class="col-5">
          <label class="form-label mb-1" for="p-temp">Room temp (${tempLabel()})</label>
          <input id="p-temp" class="form-control" type="number" inputmode="decimal" step="any" value="${tempOut(plan.tempC)}">
        </div>
        <div class="col-12">
          <label class="form-label mb-1" for="p-ratio">Preferred ratio</label>
          <select id="p-ratio" class="form-select">${ratioOptions(plan.ratio)}</select>
        </div>
      </div>
    </div></div>
    <div id="plan-result"></div>`;
  updatePlan();
}

function updatePlan() {
  const s = getState();
  const mixAt = new Date(plan.mixAt);
  const box = $('#plan-result');
  if (Number.isNaN(+mixAt) || !Number.isFinite(plan.tempC)) {
    box.innerHTML = '';
    return;
  }
  const { factor, samples } = factorInfo();
  const { rows, recommended } = alternatives({
    mixAt, tempC: plan.tempC, factor, quiet: s.settings.quiet, current: plan.ratio,
  });
  const mine = rows.find((r) => sameRatio(r.ratio, plan.ratio));
  const day = (d) => new Date(d).toLocaleDateString([], { weekday: 'short' });
  const badges = (r) =>
    `${r.quiet ? '<span class="badge text-bg-warning">sleeping hours</span> ' : ''}${r.past ? '<span class="badge text-bg-danger">already past</span>' : ''}`;

  box.innerHTML = `
    <div class="card mb-3"><div class="card-body">
      <div class="text-secondary small">Feed at (${ratioLabel(plan.ratio)})</div>
      <div class="big-num">${fmtDateTime(mine.feedAt)}</div>
      <div class="mt-1">${badges(mine)}</div>
      <div class="small mt-2">Peak in ~${fmtDur(mine.hours)}. Best to mix between ${fmtTime(mine.window.from)} and ${fmtTime(mine.window.to)} (${day(mine.window.to)}).</div>
      <button class="btn btn-outline-secondary btn-sm mt-2" data-action="ics" data-ratio="${ratioLabel(plan.ratio)}" type="button">Add feed time to calendar</button>
    </div></div>

    ${recommended && !sameRatio(recommended.ratio, plan.ratio) ? `
      <div class="alert alert-info">Your usual ratio lands at an awkward time. Try <strong>${ratioLabel(recommended.ratio)}</strong> and feed at <strong>${fmtDateTime(recommended.feedAt)}</strong>.</div>` : ''}
    ${!recommended ? `<div class="alert alert-warning">No standard ratio gives a waking-hour feed time for this mix time. Consider a different mix time or a cooler/warmer spot.</div>` : ''}

    <div class="card mb-3"><div class="card-body">
      <h3 class="h6">All ratios for this mix time</h3>
      <table class="table table-sm mb-0">
        <thead><tr><th>Ratio</th><th>Feed at</th><th class="text-end">Peak in</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr class="${recommended && r === recommended ? 'table-success' : ''}">
            <td>${ratioLabel(r.ratio)}</td>
            <td>${fmtDateTime(r.feedAt)}<div>${badges(r)}</div></td>
            <td class="text-end">${fmtDur(r.hours)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div></div>
    <p class="small text-secondary">${samples
      ? `Estimates are adjusted ×${factor.toFixed(2)} from ${samples} peak${samples > 1 ? 's' : ''} you logged.`
      : 'Estimates are generic until you log a few actual peaks in History.'}</p>`;
}

document.addEventListener('input', (e) => {
  if (currentTab !== 'plan' || !plan) return;
  if (e.target.id === 'p-mix') plan.mixAt = e.target.value;
  else if (e.target.id === 'p-temp') plan.tempC = tempIn(num(e.target));
  else return;
  updatePlan();
});
document.addEventListener('change', (e) => {
  if (currentTab !== 'plan' || e.target.id !== 'p-ratio') return;
  const opts = [...RATIO_PRESETS];
  if (!opts.some((r) => sameRatio(r, plan.ratio))) opts.unshift(plan.ratio);
  plan.ratio = { ...opts[+e.target.value] };
  updatePlan();
});

/* ---------- HISTORY ---------- */
function renderHistory() {
  const s = getState();
  const list = [...s.feedings].reverse();
  const { factor, samples } = factorInfo();
  $('#tab-history').innerHTML = list.length
    ? `${samples ? `<p class="small text-secondary">Peak calibration ×${factor.toFixed(2)} from ${samples} logged peak${samples > 1 ? 's' : ''}.</p>` : ''}
      ${list.map(historyItem).join('')}`
    : `<div class="alert alert-secondary">No feedings yet.</div>`;
}

function historyItem(f) {
  const a = f.actual;
  const pr = f.proposed;
  const diff = (act, prop) => (Math.round(act) === Math.round(prop) ? '' : ` <span class="text-secondary">(proposed ${Math.round(prop)})</span>`);
  const observed = f.peakAt ? (new Date(f.peakAt) - new Date(f.at)) / HOUR : null;
  return `
    <div class="card mb-2"><div class="card-body py-2">
      <div class="d-flex justify-content-between">
        <strong>${fmtDateTime(f.at)}</strong>
        <span class="text-secondary small">${esc(f.containerName)}</span>
      </div>
      <div class="small">Starter ${g(f.starterG)} → discard ${g(a.discardG)}${diff(a.discardG, pr.discardG)}, flour ${g(a.flourG)}${diff(a.flourG, pr.flourG)}, water ${g(a.waterG)}${diff(a.waterG, pr.waterG)}</div>
      <div class="small text-secondary">Ratio ${ratioLabel(roundRatio(feedingRatio(f)))} · ${tempOut(f.roomTempC)}${tempLabel()}${f.note ? ` · ${esc(f.note)}` : ''}</div>
      <div class="mt-1 d-flex flex-wrap gap-2 align-items-center">
        ${observed != null
          ? `<span class="badge text-bg-success">Peaked after ${fmtDur(observed)}</span>
             <button class="btn btn-link btn-sm p-0" data-action="clear-peak" data-id="${f.id}" type="button">clear</button>`
          : `<button class="btn btn-outline-secondary btn-sm" data-action="peak-now" data-id="${f.id}" type="button">Peaked now</button>
             <input type="datetime-local" class="form-control form-control-sm w-auto" id="pk-${f.id}" aria-label="Peak time">
             <button class="btn btn-outline-secondary btn-sm" data-action="peak-at" data-id="${f.id}" type="button">Set</button>`}
        <button class="btn btn-link btn-sm text-danger p-0 ms-auto" data-action="delete-feeding" data-id="${f.id}" type="button">Delete</button>
      </div>
    </div></div>`;
}

/* ---------- SETTINGS ---------- */
function renderSettings() {
  const s = getState();
  const st = s.settings;
  $('#tab-settings').innerHTML = `
    <div class="card mb-3"><div class="card-body">
      <h2 class="h5">Feeding</h2>
      <label class="form-label mb-1">Ratio (starter : flour : water, by weight)</label>
      <div class="input-group mb-2">
        <input id="s-r-starter" class="form-control" type="number" step="any" min="0.1" value="${st.ratio.starter}" aria-label="Starter parts">
        <span class="input-group-text">:</span>
        <input id="s-r-flour" class="form-control" type="number" step="any" min="0.1" value="${st.ratio.flour}" aria-label="Flour parts">
        <span class="input-group-text">:</span>
        <input id="s-r-water" class="form-control" type="number" step="any" min="0.1" value="${st.ratio.water}" aria-label="Water parts">
      </div>
      <div class="d-flex flex-wrap gap-1 mb-3">
        ${RATIO_PRESETS.map((r) => `<button type="button" class="btn btn-outline-secondary btn-sm" data-action="preset" data-flour="${r.flour}" data-water="${r.water}">${ratioLabel(r)}</button>`).join('')}
      </div>
      <div class="row g-2">
        <div class="col-6"><label class="form-label mb-1" for="s-keep">Starter to keep (g)</label>
          <input id="s-keep" class="form-control" type="number" step="any" min="1" value="${st.keepG}"></div>
        <div class="col-6"><label class="form-label mb-1" for="s-unit">Temperature unit</label>
          <select id="s-unit" class="form-select"><option value="C" ${st.tempUnit === 'C' ? 'selected' : ''}>°C</option><option value="F" ${st.tempUnit === 'F' ? 'selected' : ''}>°F</option></select></div>
        <div class="col-6"><label class="form-label mb-1" for="s-temp">Usual room temp (${tempLabel()})</label>
          <input id="s-temp" class="form-control" type="number" step="any" value="${tempOut(st.defaultTempC)}"></div>
      </div>
    </div></div>

    <div class="card mb-3"><div class="card-body">
      <h2 class="h5">Timing</h2>
      <div class="row g-2 mb-2">
        <div class="col-6"><label class="form-label mb-1" for="s-qs">Sleep from</label>
          <input id="s-qs" class="form-control" type="time" value="${st.quiet.start}"></div>
        <div class="col-6"><label class="form-label mb-1" for="s-qe">Until</label>
          <input id="s-qe" class="form-control" type="time" value="${st.quiet.end}"></div>
      </div>
      <div class="form-text mb-2">The planner avoids suggesting feeds in this window.</div>
      <div class="form-check">
        <input class="form-check-input" type="checkbox" id="s-cal" ${st.calibrate ? 'checked' : ''}>
        <label class="form-check-label" for="s-cal">Learn from my logged peak times</label>
      </div>
    </div></div>

    <div class="card mb-3"><div class="card-body">
      <h2 class="h5">Containers</h2>
      ${s.containers.length ? s.containers.map(containerRow).join('') : '<p class="text-secondary small">None yet.</p>'}
      <form id="add-container" class="row g-2 mt-1" autocomplete="off">
        <div class="col-5"><input id="c-name" class="form-control" type="text" placeholder="Name (e.g. Quart jar)" aria-label="Container name" required></div>
        <div class="col-4"><input id="c-tare" class="form-control" type="number" inputmode="decimal" step="any" min="0" placeholder="Empty g" aria-label="Empty weight in grams" required></div>
        <div class="col-3"><button class="btn btn-primary w-100" type="submit">Add</button></div>
      </form>
    </div></div>

    <div class="card mb-3"><div class="card-body">
      <h2 class="h5">Backup</h2>
      <p class="small text-secondary">Data lives only in this browser. Export a copy now and then.</p>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-outline-secondary" data-action="export" type="button">Export JSON</button>
        <label class="btn btn-outline-secondary mb-0">Import JSON<input id="s-import" type="file" accept="application/json,.json" hidden></label>
      </div>
      <div id="backup-msg" class="small mt-2" role="status"></div>
    </div></div>

    <div class="card mb-3"><div class="card-body">
      <h2 class="h5">About</h2>
      <div>Version <strong>${esc(APP_VERSION)}</strong> <span class="text-secondary small">(${esc(versionDate(APP_VERSION))})</span></div>
      <div id="update-msg" class="small mt-1" role="status"></div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn btn-outline-secondary btn-sm" data-action="check-update" type="button">Check for updates</button>
        <button class="btn btn-primary btn-sm" data-action="apply-update" type="button" hidden>Update now</button>
      </div>
    </div></div>`;
  checkForUpdate();
}

/* ---------- version / updates ---------- */
const APP_VERSION = globalThis.APP_VERSION || 'dev';

/** yymmddhhmm (UTC) -> readable date string. */
function versionDate(v) {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(v);
  return m ? `20${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]} UTC` : 'development build';
}

async function fetchLatestVersion() {
  // the service worker lets ?check requests through to the network
  const res = await fetch(`js/version.js?check=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const m = /APP_VERSION\s*=\s*["'](\d{10})["']/.exec(await res.text());
  if (!m) throw new Error('version not found');
  return m[1];
}

async function checkForUpdate() {
  const msg = $('#update-msg');
  const apply = $('[data-action=apply-update]');
  if (!msg) return;
  msg.className = 'small mt-1 text-secondary';
  msg.textContent = 'Checking…';
  apply.hidden = true;
  try {
    const latest = await fetchLatestVersion();
    if (!$('#update-msg')) return; // left the Settings tab meanwhile
    if (/^\d{10}$/.test(APP_VERSION) ? +latest > +APP_VERSION : latest !== APP_VERSION) {
      msg.className = 'small mt-1 text-success-emphasis';
      msg.textContent = `Newer version available: ${latest} (${versionDate(latest)}).`;
      apply.hidden = false;
    } else {
      msg.textContent = 'You are on the latest version.';
    }
  } catch {
    msg.className = 'small mt-1 text-warning-emphasis';
    msg.textContent = 'Could not check for updates (offline?).';
  }
}

let updating = false;
async function applyUpdate() {
  const msg = $('#update-msg');
  msg.textContent = 'Updating…';
  updating = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return location.reload();
    await reg.update(); // new worker skips waiting + claims, which triggers controllerchange
    setTimeout(() => location.reload(), 4000); // fallback if no controllerchange arrives
  } catch {
    location.reload();
  }
}
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (updating) location.reload();
});

function containerRow(c) {
  return `
    <div class="d-flex align-items-center gap-2 mb-2 ${c.archived ? 'opacity-50' : ''}">
      <div class="flex-grow-1">${esc(c.name)}${c.archived ? ' <span class="badge text-bg-secondary">archived</span>' : ''}</div>
      <input class="form-control form-control-sm w-auto" style="max-width:6rem" type="number" step="any" min="0" value="${c.tareG}" data-container-tare="${c.id}" aria-label="Empty weight of ${esc(c.name)} in grams">
      <span class="small">g</span>
      <button class="btn btn-outline-secondary btn-sm" data-action="archive" data-id="${c.id}" type="button">${c.archived ? 'Restore' : 'Archive'}</button>
    </div>`;
}

function saveSetting(fn) {
  update((s) => fn(s.settings));
  form = null; // pick up new defaults next time the Feed tab renders
  plan = null;
}

document.addEventListener('change', (e) => {
  if (currentTab !== 'settings') return;
  const t = e.target;
  const v = num(t);
  if (t.id.startsWith('s-r-')) {
    const key = t.id.slice(4);
    if (v > 0) saveSetting((st) => (st.ratio[key] = v));
    else t.value = getState().settings.ratio[key];
  } else if (t.id === 's-keep' && v > 0) saveSetting((st) => (st.keepG = v));
  else if (t.id === 's-unit') { saveSetting((st) => (st.tempUnit = t.value)); renderSettings(); }
  else if (t.id === 's-temp' && Number.isFinite(v)) saveSetting((st) => (st.defaultTempC = tempIn(v)));
  else if (t.id === 's-qs' && t.value) saveSetting((st) => (st.quiet.start = t.value));
  else if (t.id === 's-qe' && t.value) saveSetting((st) => (st.quiet.end = t.value));
  else if (t.id === 's-cal') saveSetting((st) => (st.calibrate = t.checked));
  else if (t.dataset.containerTare && v >= 0) {
    update((s) => { const c = s.containers.find((x) => x.id === t.dataset.containerTare); if (c) c.tareG = v; });
    form = null;
  } else if (t.id === 's-import' && t.files[0]) {
    const msg = $('#backup-msg');
    t.files[0].text().then((text) => {
      if (!confirm('Replace all current data with this backup?')) return;
      importJSON(text);
      form = null; plan = null;
      renderSettings();
      $('#backup-msg').textContent = 'Backup imported.';
    }).catch((err) => { msg.textContent = `Import failed: ${err.message}`; msg.className = 'small mt-2 text-danger'; });
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'add-container') return;
  e.preventDefault();
  const name = $('#c-name').value.trim();
  const tare = num($('#c-tare'));
  if (!name || !(tare >= 0)) return;
  update((s) => s.containers.push({ id: uid(), name, tareG: tare, archived: false }));
  form = null;
  renderSettings();
});

/* ---------- actions ---------- */
const setPeak = (id, when) => {
  update((s) => { const f = s.feedings.find((x) => x.id === id); if (f) f.peakAt = when ? new Date(when).toISOString() : null; });
  renderHistory();
};

const actions = {
  preset(btn) {
    const r = { starter: 1, flour: +btn.dataset.flour, water: +btn.dataset.water };
    saveSetting((st) => (st.ratio = r));
    renderSettings();
  },
  archive(btn) {
    update((s) => { const c = s.containers.find((x) => x.id === btn.dataset.id); if (c) c.archived = !c.archived; });
    form = null;
    renderSettings();
  },
  export() {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sourdough-tracker-${toLocalInput(new Date()).slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'peak-now': (btn) => setPeak(btn.dataset.id, new Date()),
  'peak-at'(btn) {
    const v = $(`#pk-${btn.dataset.id}`).value;
    if (v) setPeak(btn.dataset.id, new Date(v));
  },
  'clear-peak': (btn) => setPeak(btn.dataset.id, null),
  'delete-feeding'(btn) {
    if (!confirm('Delete this feeding?')) return;
    update((s) => (s.feedings = s.feedings.filter((f) => f.id !== btn.dataset.id)));
    renderHistory();
  },
  'check-update': () => checkForUpdate(),
  'apply-update': () => applyUpdate(),
  ics(btn) {
    const s = getState();
    const { factor } = factorInfo();
    const p = planFeedTime({ mixAt: new Date(plan.mixAt), ratio: plan.ratio, tempC: plan.tempC, factor });
    const ics = toICS({
      title: `Feed starter (${btn.dataset.ratio})`,
      start: p.feedAt,
      description: `Peak expected around ${fmtTime(plan.mixAt)} — mixing dough then.`,
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = 'feed-starter.ics';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

/* ---------- boot ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.setAttribute('data-bs-theme', mq.matches ? 'dark' : 'light');
applyTheme();
mq.addEventListener?.('change', applyTheme);

setInterval(() => { if (currentTab === 'feed') renderStatus(); }, 60000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
requestPersistence();
showTab('feed');
