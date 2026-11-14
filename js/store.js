// Persistence: one JSON blob in localStorage (falls back to memory if unavailable).

const KEY = 'sourdough-tracker:v1';
const VERSION = 1;

export const defaultState = () => ({
  version: VERSION,
  settings: {
    ratio: { starter: 1, flour: 1, water: 1 },
    keepG: 50,
    tempUnit: 'C',
    defaultTempC: 22,
    quiet: { start: '23:00', end: '06:30' },
    calibrate: true,
    lastContainerId: null,
  },
  containers: [],
  feedings: [],
});

let memory = null;
let state = null;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : memory;
  } catch {
    return memory;
  }
}

function write(s) {
  memory = JSON.stringify(s);
  try {
    localStorage.setItem(KEY, memory);
  } catch {
    /* storage blocked or full: keep in memory for this session */
  }
}

/** Fill in any missing fields so older/partial data still works. */
function normalise(raw) {
  const d = defaultState();
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    version: VERSION,
    settings: {
      ...d.settings,
      ...(s.settings || {}),
      ratio: { ...d.settings.ratio, ...(s.settings?.ratio || {}) },
      quiet: { ...d.settings.quiet, ...(s.settings?.quiet || {}) },
    },
    containers: Array.isArray(s.containers) ? s.containers : [],
    feedings: Array.isArray(s.feedings) ? s.feedings : [],
  };
}

export function getState() {
  if (!state) {
    const raw = read();
    state = normalise(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return state;
}

/** Mutate state inside fn, then persist. */
export function update(fn) {
  const s = getState();
  fn(s);
  s.feedings.sort((a, b) => new Date(a.at) - new Date(b.at));
  write(s);
  return s;
}

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const exportJSON = () => JSON.stringify(getState(), null, 2);

/** Replace all data from a backup file. Throws on invalid input. */
export function importJSON(text) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.feedings) || !Array.isArray(raw.containers)) {
    throw new Error('Not a sourdough tracker backup file.');
  }
  state = normalise(raw);
  write(state);
  return state;
}

export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
