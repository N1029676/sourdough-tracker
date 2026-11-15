// Pure sourdough logic: no DOM, no storage. Unit-tested in tests/logic.test.mjs.

export const HOUR = 3600000;

export const RATIO_PRESETS = [
  { starter: 1, flour: 1, water: 1 },
  { starter: 1, flour: 2, water: 2 },
  { starter: 1, flour: 3, water: 3 },
  { starter: 1, flour: 5, water: 5 },
  { starter: 1, flour: 10, water: 10 },
];

export const ratioLabel = (r) => `${r.starter}:${r.flour}:${r.water}`;
export const sameRatio = (a, b) =>
  Math.abs(a.flour / a.starter - b.flour / b.starter) < 1e-9 &&
  Math.abs(a.water / a.starter - b.water / b.starter) < 1e-9;

const round = (n) => Math.round(n);

/**
 * Propose how much to discard and how much flour/water to add.
 * grossG = scale reading of jar + starter, tareG = empty jar, keepG = starter to keep.
 */
export function proposeFeeding({ grossG, tareG, keepG, ratio }) {
  const starterG = grossG - tareG;
  if (!(starterG >= 0)) return { error: 'Scale reading is lower than the empty container weight.' };
  if (!(keepG > 0)) return { error: 'Keep amount must be greater than zero.' };
  const rf = ratio.flour / ratio.starter;
  const rw = ratio.water / ratio.starter;
  const lowStarter = starterG < keepG;
  const effectiveKeep = lowStarter ? starterG : keepG;
  const discardG = lowStarter ? 0 : round(starterG - keepG);
  const flourG = round(effectiveKeep * rf);
  const waterG = round(effectiveKeep * rw);
  const afterDiscard = round(tareG + effectiveKeep);
  const afterFlour = afterDiscard + flourG;
  const afterWater = afterFlour + waterG;
  return {
    starterG: round(starterG),
    keepG: round(effectiveKeep),
    discardG,
    flourG,
    waterG,
    totalG: round(effectiveKeep) + flourG + waterG,
    lowStarter,
    targets: { afterDiscard, afterFlour, afterWater },
  };
}

/** Ratio normalised to 1 part starter, from what was actually kept/added. */
export function actualRatio({ starterG, discardG, flourG, waterG }) {
  const kept = starterG - discardG;
  if (!(kept > 0)) return null;
  return { starter: 1, flour: flourG / kept, water: waterG / kept };
}

export const hydration = (flourG, waterG) => (flourG > 0 ? (waterG / flourG) * 100 : null);

/** Expected hours from feeding to peak. */
export function peakHours({ ratio, tempC, factor = 1 }) {
  const t = Math.min(35, Math.max(10, tempC));
  const doubling = 3 * Math.pow(2, (24 - t) / 10); // hours per doubling
  const dilution = (ratio.starter + ratio.flour + ratio.water) / ratio.starter;
  return (doubling * Math.log2(dilution) + 0.5) * factor;
}

/** Work backward from when you want to start mixing dough. */
export function planFeedTime({ mixAt, ratio, tempC, factor = 1 }) {
  const mix = +mixAt;
  const hours = peakHours({ ratio, tempC, factor });
  return {
    hours,
    feedAt: new Date(mix - hours * HOUR),
    window: {
      from: new Date(mix - hours * HOUR + 0.75 * hours * HOUR),
      peak: new Date(mix),
      to: new Date(mix + HOUR),
    },
  };
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function inQuietHours(date, quiet) {
  if (!quiet) return false;
  const d = new Date(date);
  const m = d.getHours() * 60 + d.getMinutes();
  const s = toMin(quiet.start);
  const e = toMin(quiet.end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Compare ratios for the same mix time; mark which feed times are awkward. */
export function alternatives({ mixAt, tempC, factor = 1, quiet, now = Date.now(), current }) {
  const ratios = [...RATIO_PRESETS];
  if (current && !ratios.some((r) => sameRatio(r, current))) ratios.unshift(current);
  const rows = ratios.map((ratio) => {
    const plan = planFeedTime({ mixAt, ratio, tempC, factor });
    return {
      ratio,
      ...plan,
      quiet: inQuietHours(plan.feedAt, quiet),
      past: +plan.feedAt < now,
    };
  });
  rows.sort((a, b) => b.hours - a.hours);
  const ok = (r) => !r.quiet && !r.past;
  const recommended =
    rows.find((r) => current && sameRatio(r.ratio, current) && ok(r)) || rows.find(ok) || null;
  return { rows, recommended };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Ratio used for a logged feeding: what was actually done, else what was planned. */
export function feedingRatio(f) {
  return (f.actual && actualRatio({ starterG: f.starterG, ...f.actual })) || f.ratioPlanned;
}

/**
 * Scale factor (observed / predicted peak time) from logged peaks.
 * Peaks under 1h are ignored as mis-taps, and the median is shrunk toward 1
 * so a single odd reading barely moves the estimate (weight n / (n + 2)).
 * Feedings after fridge storage (fromFridge) are calibrated separately: pass
 * { fridge: true } for those, the default only uses normal feedings.
 */
export function calibrationFactor(feedings, n = 10, { fridge = false } = {}) {
  const ratios = feedings
    .filter((f) => !!f.fromFridge === fridge)
    .filter((f) => f.peakAt && f.roomTempC != null)
    .slice(-n)
    .map((f) => {
      const observed = (new Date(f.peakAt) - new Date(f.at)) / HOUR;
      if (observed < 1) return NaN;
      const predicted = peakHours({ ratio: feedingRatio(f), tempC: f.roomTempC });
      return observed / predicted;
    })
    .filter((x) => Number.isFinite(x) && x > 0);
  if (ratios.length === 0) return { factor: 1, samples: 0 };
  const m = Math.min(2, Math.max(0.5, median(ratios)));
  const w = ratios.length / (ratios.length + 2);
  return { factor: 1 + (m - 1) * w, samples: ratios.length };
}

export const cToF = (c) => (c * 9) / 5 + 32;
export const fToC = (f) => ((f - 32) * 5) / 9;

/** Minimal iCalendar event for "add to calendar". */
export function toICS({ title, start, end, description = '' }) {
  const fmt = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => s.replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sourdough-tracker//EN',
    'BEGIN:VEVENT',
    `UID:${fmt(start)}@sourdough-tracker`,
    `DTSTAMP:${fmt(Date.now())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end ?? +start + 15 * 60000)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
