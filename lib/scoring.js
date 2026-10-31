// Explainable, rule-based scoring. All thresholds are constants so they are easy to tune.
// Computed in the dashboard from stored attempts; nothing hidden.

export const T = {
  FOCUS: { SWITCH_RATE_MAX: 5, AWAY_RATIO_MAX: 0.25, IDLE_RATIO_MAX: 0.4, W_SWITCH: 40, W_AWAY: 40, W_IDLE: 20 },
  MIN_DURATION_MS: 60000,        // floor so tiny durations don't explode the rates
  MIN_CLASS_FOR_Z: 5,            // robust z-scores need >= this many submissions
  MIN_CLASS_FOR_MEDIAN_RULE: 3,  // "unusually fast" rule needs a class median
  MAD_FLOOR: { switchesPer10Min: 1, awayRatio: 0.02, duration: 30000 },
  Z_LIMIT: 2,
  RISK: {
    SWITCH_MED: 3, SWITCH_HIGH: 8, PTS_SWITCH_MED: 15, PTS_SWITCH_HIGH: 30,
    AWAY_RATIO: 0.15, PTS_AWAY_RATIO: 20,
    LONG_AWAY_MS: 60000, PTS_LONG_AWAY: 15,
    PASTE_MED: 1, PASTE_HIGH: 3, PTS_PASTE_MED: 10, PTS_PASTE_HIGH: 20,
    FAST_FRACTION: 0.35, PTS_FAST: 20,
    PTS_CLASS_Z: 15,
    PTS_PERSONAL: 15,
  },
  LEVEL: { MEDIUM: 25, HIGH: 55 },
  PERSONAL: { MULT: 2, STD: 2, FLOOR_SWITCH_RATE: 2, FLOOR_AWAY_RATIO: 0.08 },
};

export const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mad = (xs) => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))); };
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

export function metrics(a) {
  const end = a.submittedAt || a.lastSeen || a.startedAt || 0;
  const duration = Math.max(0, end - (a.startedAt || end));
  const d = Math.max(duration, T.MIN_DURATION_MS);
  const gaps = (a.events || []).filter((e) => e.type === "tab_hidden").map((e) => e.durationMs || 0);
  return {
    duration,
    switchesPer10Min: (a.tabSwitches || 0) / (d / 600000),
    awayRatio: Math.min(1, (a.awayMs || 0) / d),
    idleRatio: Math.min(1, (a.idleMs || 0) / d),
    pastes: a.pastes || 0,
    longestAway: gaps.length ? Math.max(...gaps) : 0,
  };
}

export function focusScore(m) {
  const F = T.FOCUS;
  const v = 100 - F.W_SWITCH * Math.min(1, m.switchesPer10Min / F.SWITCH_RATE_MAX)
    - F.W_AWAY * Math.min(1, m.awayRatio / F.AWAY_RATIO_MAX)
    - F.W_IDLE * Math.min(1, m.idleRatio / F.IDLE_RATIO_MAX);
  return Math.round(Math.max(0, Math.min(100, v)));
}

// Class baseline from submitted attempts of one session.
export function classBaseline(attempts) {
  const ms = attempts.filter((a) => a.status === "submitted").map(metrics);
  const col = (k) => ms.map((m) => m[k]);
  const stat = (k) => ({ med: median(col(k)), mad: Math.max(mad(col(k)), T.MAD_FLOOR[k]) });
  return {
    n: ms.length,
    useZ: ms.length >= T.MIN_CLASS_FOR_Z,
    duration: stat("duration"), switchesPer10Min: stat("switchesPer10Min"), awayRatio: stat("awayRatio"),
  };
}
export const robustZ = (x, s) => (0.6745 * (x - s.med)) / s.mad;

// history: array of {switchesPer10Min, awayRatio, durRatio} from the student's earlier ended sessions.
export function personalBaseline(history) {
  const n = history.length;
  const col = (k) => history.map((h) => h[k]);
  return {
    n,
    confidence: n >= 2 ? "High" : n === 1 ? "Medium" : "Low",
    switchesPer10Min: { mean: mean(col("switchesPer10Min")), std: std(col("switchesPer10Min")) },
    awayRatio: { mean: mean(col("awayRatio")), std: std(col("awayRatio")) },
    durRatio: { mean: mean(col("durRatio")), std: std(col("durRatio")) },
  };
}

function personalDeviation(m, durRatio, pb) {
  if (!pb || pb.n === 0) return null;
  const P = T.PERSONAL;
  const high = (cur, s, floor) => cur >= floor && cur > Math.max(s.mean * P.MULT, pb.n >= 2 ? s.mean + P.STD * s.std : 0);
  if (high(m.switchesPer10Min, pb.switchesPer10Min, P.FLOOR_SWITCH_RATE)) return "far more tab switching than their own past sessions";
  if (high(m.awayRatio, pb.awayRatio, P.FLOOR_AWAY_RATIO)) return "far more time away than their own past sessions";
  if (durRatio != null && pb.durRatio.mean > 0 && durRatio < pb.durRatio.mean * 0.5 && durRatio < 0.6) return "much faster than their own past sessions";
  return null;
}

// Full assessment for one attempt.
export function assess(a, cls, pb) {
  const m = metrics(a);
  const R = T.RISK;
  let pts = 0;
  const reasons = [];
  const add = (p, why) => { pts += p; reasons.push(why); };
  const sw = a.tabSwitches || 0;

  if (sw >= R.SWITCH_HIGH) add(R.PTS_SWITCH_HIGH, `${sw} tab switches`);
  else if (sw >= R.SWITCH_MED) add(R.PTS_SWITCH_MED, `${sw} tab switches`);
  if (m.awayRatio > R.AWAY_RATIO) add(R.PTS_AWAY_RATIO, `${Math.round(m.awayRatio * 100)}% of time away`);
  if (m.longestAway > R.LONG_AWAY_MS) add(R.PTS_LONG_AWAY, `one absence of ${Math.round(m.longestAway / 1000)}s`);
  const p = a.pastes || 0;
  if (p >= R.PASTE_HIGH) add(R.PTS_PASTE_HIGH, `${p} pastes`);
  else if (p >= R.PASTE_MED) add(R.PTS_PASTE_MED, `${p} paste${p > 1 ? "s" : ""}`);

  const durRatio = cls && cls.duration.med > 0 && a.status === "submitted" ? m.duration / cls.duration.med : null;
  if (a.status === "submitted" && cls && cls.n >= T.MIN_CLASS_FOR_MEDIAN_RULE && durRatio != null && durRatio < R.FAST_FRACTION)
    add(R.PTS_FAST, `finished in ${Math.round(durRatio * 100)}% of the class median time`);

  if (cls && cls.useZ) {
    const zs = robustZ(m.switchesPer10Min, cls.switchesPer10Min), za = robustZ(m.awayRatio, cls.awayRatio);
    if (zs > T.Z_LIMIT || za > T.Z_LIMIT) add(R.PTS_CLASS_Z, "unusual compared with the rest of the class");
  }
  const dev = a.status === "submitted" ? personalDeviation(m, durRatio, pb) : personalDeviation(m, null, pb);
  if (dev) add(R.PTS_PERSONAL, dev);

  pts = Math.min(100, pts);
  const level = pts >= T.LEVEL.HIGH ? "High" : pts >= T.LEVEL.MEDIUM ? "Medium" : "Low";
  let confidence = pb ? pb.confidence : "Low";
  if (confidence === "High" && (!cls || !cls.useZ)) confidence = "Medium";
  if (!reasons.length) reasons.push(
    pb && pb.n ? "Consistent with class and own baseline — no concerns." : "Consistent with the class — no concerns (no personal history yet).");
  const notes = [];
  if (a.status !== "submitted") notes.push("Not submitted — metrics are up to the last heartbeat.");
  if (!cls || !cls.useZ) notes.push(`Class baseline is weak (${cls ? cls.n : 0} submissions; need ${T.MIN_CLASS_FOR_Z}), so absolute thresholds are used.`);
  return { metrics: m, focus: focusScore(m), points: pts, level, reasons, confidence, notes, durRatio };
}
