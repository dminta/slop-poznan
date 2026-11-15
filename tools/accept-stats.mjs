// Pure statistics and verdict logic for tools/accept-traffic.mjs (no I/O, no simulation), unit-tested in
// tests/accept-traffic.test.mjs. Every metric is compared as a paired per-seed difference (working tree - baseline).

const BOOTSTRAP_RESAMPLES = 10000;
const CI_LEVEL = 0.95;
// A deadlock pattern (district + junction set) that shows up in this many seeds of the working tree and in none of the
// baseline's seeds is a new cycle, not seed noise.
const NEW_PATTERN_MIN_SEEDS = 3;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// Small deterministic PRNG (mulberry32) so the same diffs always print the same interval.
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Percentile bootstrap interval of the mean of `diffs` (resampling the seeds with replacement).
function bootstrapMeanCI(diffs, { resamples = BOOTSTRAP_RESAMPLES, level = CI_LEVEL, seed = 12345 } = {}) {
  const n = diffs.length;
  if (n === 0) return { lo: 0, hi: 0 };
  const rng = makeRng(seed);
  const means = new Float64Array(resamples);
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rng() * n)];
    means[r] = sum / n;
  }
  means.sort();
  const tail = (1 - level) / 2;
  return { lo: means[Math.floor(tail * resamples)], hi: means[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)] };
}

// `dir` is 'lower' when a smaller value is better (pairs, holds, waits) or 'higher' (km/h). A change is only "better" or
// "worse" when the whole interval lies on one side of zero; touching zero (including an all-zero difference) is noise.
function verdictOf(ci, dir) {
  if (ci.lo > 0) return dir === 'lower' ? 'worse' : 'better';
  if (ci.hi < 0) return dir === 'lower' ? 'better' : 'worse';
  return 'within noise';
}

// One metric over the seeds both trees have: base and work are { seed: value } maps.
function compareMetric(name, dir, base, work, options) {
  const seeds = Object.keys(work).filter((s) => s in base);
  const b = seeds.map((s) => base[s]);
  const w = seeds.map((s) => work[s]);
  const diffs = seeds.map((s, i) => w[i] - b[i]);
  const ci = bootstrapMeanCI(diffs, options);
  return {
    name, dir, seeds, base: b, work: w, diffs,
    baseTotal: b.reduce((x, y) => x + y, 0), workTotal: w.reduce((x, y) => x + y, 0),
    meanDiff: mean(diffs), ci, verdict: verdictOf(ci, dir)
  };
}

// 'Jeżyce (Rynek Jeżycki)' -> 'Jeżyce', 'Rondo Kaponiera' -> 'Kaponiera', 'Stare Miasto' stays.
function districtKey(name) {
  if (name.startsWith('Rondo ')) return name.slice(6).split(' ')[0];
  if (name.startsWith('Stare Miasto')) return 'Stare Miasto';
  return name.split(' ')[0];
}

// Flatten a bench-traffic --json report into the numbers the runner compares and the deadlock patterns it tracks.
function summarizeBench(report) {
  const kmh = {};
  const deadlocks = [];
  for (const row of report.districts) {
    const key = districtKey(row.district);
    kmh[key] = row.meanKmh;
    for (const d of row.deadlockDetails || []) deadlocks.push({ district: key, signature: deadlockSignature(key, d.members), members: d.members });
  }
  return {
    holds120: report.total.held120, deadlocks: report.total.deadlocks, maxWait: report.total.waitMax,
    kmhAll: report.total.meanKmh, kmh, deadlockPatterns: deadlocks
  };
}

// A cycle is identified by where it sits: the junctions its cars wait at (members read `#id reason [in box] at (jx, jz)
// (x, z) turn`), or the 50 m cell of each tram (`tram L reason (x, z)`) when only trams are in it. Vehicle ids differ
// between seeds, so they cannot be part of the key.
function deadlockSignature(district, members) {
  const junctions = new Set();
  for (const m of members) {
    const car = /\bat \((-?\d+), (-?\d+)\) \(/.exec(m);
    if (car) { junctions.add(`${car[1]},${car[2]}`); continue; }
    const tram = /\((-?\d+), (-?\d+)\)\s*$/.exec(m);
    if (tram) junctions.add(`~${Math.round(Number(tram[1]) / 50) * 50},${Math.round(Number(tram[2]) / 50) * 50}`);
  }
  return `${district}@${[...junctions].sort().join(';') || '?'}`;
}

// patterns by seed: { seed: [{ signature, ... }] } for each tree. Returns the signatures that appear in at least `min`
// seeds of the working tree and in no seed of the baseline.
function newDeadlockPatterns(baseBySeed, workBySeed, min = NEW_PATTERN_MIN_SEEDS) {
  const count = (bySeed) => {
    const counts = new Map();
    for (const [seed, list] of Object.entries(bySeed)) {
      for (const sig of new Set(list.map((p) => p.signature))) {
        if (!counts.has(sig)) counts.set(sig, []);
        counts.get(sig).push(seed);
      }
    }
    return counts;
  };
  const base = count(baseBySeed);
  const out = [];
  for (const [signature, seeds] of count(workBySeed)) {
    if (seeds.length >= min && !base.has(signature)) out.push({ signature, seeds });
  }
  return out;
}

// Exit status: non-zero only on a clear regression of a gating metric or a new deadlock pattern.
function failures(comparisons, newPatterns) {
  const out = comparisons.filter((c) => c.gate && c.verdict === 'worse').map((c) => `${c.name} worse (mean diff ${round(c.meanDiff)})`);
  for (const p of newPatterns) out.push(`new deadlock pattern ${p.signature} in seeds ${p.seeds.join(' ')}`);
  return out;
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? String(round(x, d)) : '-');
const signed = (x, d = 2) => (x > 0 ? '+' : '') + fmt(x, d);

function summaryTable(comparisons) {
  const lines = [
    '| metric | baseline | working | mean diff / seed | 95 % CI | verdict |',
    '|---|---|---|---|---|---|'
  ];
  for (const c of comparisons) {
    const d = 2;
    lines.push(`| ${c.name}${c.gate ? '' : ' (info)'} | ${fmt(c.baseTotal, d)} | ${fmt(c.workTotal, d)} | ${signed(c.meanDiff, d)} | ` +
      `[${signed(c.ci.lo, d)}, ${signed(c.ci.hi, d)}] | ${c.verdict} |`);
  }
  return lines.join('\n');
}

// Per-seed paired differences of the given comparisons, one row per seed.
function perSeedTable(comparisons) {
  const seeds = comparisons[0] ? comparisons[0].seeds : [];
  const head = ['| seed', ...comparisons.map((c) => c.name)].join(' | ') + ' |';
  const lines = [head, '|' + '---|'.repeat(comparisons.length + 1)];
  seeds.forEach((s, i) => {
    lines.push(`| ${s} | ` + comparisons.map((c) => `${fmt(c.base[i], 1)} → ${fmt(c.work[i], 1)} (${signed(c.diffs[i], 1)})`).join(' | ') + ' |');
  });
  return lines.join('\n');
}

export {
  BOOTSTRAP_RESAMPLES, NEW_PATTERN_MIN_SEEDS, mean, makeRng, bootstrapMeanCI, verdictOf, compareMetric, districtKey,
  summarizeBench, deadlockSignature, newDeadlockPatterns, failures, summaryTable, perSeedTable
};
