// Multi-seed traffic acceptance: compares a baseline git ref against the working tree on N fresh seeds, with paired
// differences and bootstrap confidence intervals, so a change is judged against seed noise instead of eight tuned seeds.
// Usage and how to read the verdicts: docs/testing.md "Accepting traffic changes".
//   node tools/accept-traffic.mjs [--base HEAD] [--seeds 61,67,...] [--jobs N] [--ped] [--demand] [--minutes 5] [--fps 15]
//                                 [--work REF] [--baseline-seed-shift K] [--no-cache] [--json out.json]
// --base worktree compares the working tree with itself (use with --baseline-seed-shift to measure the noise floor).
import { spawn, execFileSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareMetric, failures, newDeadlockPatterns, perSeedTable, summarizeBench, summaryTable
} from './accept-stats.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.accept-cache');
// Twenty seeds that are none of the historical eight (1 2 3 5 7 11 99 4242, which earlier rounds tuned against) nor the
// twelve of the curb-fix record (13 17 19 23 29 31 37 41 43 47 53 59).
const DEFAULT_SEEDS = [61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157];
const DISTRICT_KEYS = ['Jeżyce', 'Łazarz', 'Centrum', 'Kaponiera', 'Stare Miasto', 'Rataje', 'Wilda'];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const BASE = opt('base', 'HEAD');
const WORK = opt('work', 'worktree'); // another ref instead of the working tree, e.g. to reproduce an old commit pair
const SEEDS = opt('seeds', DEFAULT_SEEDS.join(',')).split(',').map(Number);
const JOBS = Number(opt('jobs', Math.max(1, Math.floor(cpus().length / 2))));
const MINUTES = Number(opt('minutes', 5));
const FPS = Number(opt('fps', 15));
const SHIFT = Number(opt('baseline-seed-shift', 0));
const WITH_PED = args.includes('--ped');
const WITH_DEMAND = args.includes('--demand');
const USE_CACHE = !args.includes('--no-cache');
const JSON_OUT = opt('json', null);

for (const s of [...SEEDS, ...SEEDS.map((x) => x + SHIFT)]) {
  if (!Number.isInteger(s) || s <= 0 || s >= 2147483647) throw new Error(`Invalid seed ${s}`);
}
if (!(JOBS >= 1)) throw new Error('Invalid --jobs');

const git = (cwd, gitArgs, env = {}) => execFileSync('git', gitArgs, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();

// Content hash of the code that decides the result: js/ and tools/ of that tree as it stands on disk (so uncommitted
// edits count), without this runner and its statistics.
function treeHash(dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'accept-index-'));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, 'index') };
    git(dir, ['add', '-A', '--', 'js', 'tools', ':(exclude)tools/accept-traffic.mjs', ':(exclude)tools/accept-stats.mjs'], env);
    return git(dir, ['write-tree'], env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function run(dir, script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(dir, 'tools', script), ...scriptArgs], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} ${scriptArgs.join(' ')} exited ${code}: ${err.slice(-400)}`))));
  });
}

// One job per (tool, seed): each returns a small JSON record that is cached under (tree hash, tool, seed, minutes, fps).
const TOOLS = {
  bench: async (dir, seed, tmp) => {
    const file = join(tmp, `bench-${seed}.json`);
    await run(dir, 'bench-traffic.mjs', ['--seed', String(seed), '--minutes', String(MINUTES), '--fps', String(FPS), '--json', file]);
    return summarizeBench(JSON.parse(readFileSync(file, 'utf8')));
  },
  tram: async (dir, seed) => {
    const out = await run(dir, 'audit-tram-overlaps.mjs', ['--seed', String(seed), '--minutes', String(MINUTES), '--fps', String(FPS)]);
    const rows = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    const byDistrict = {};
    for (const r of rows) byDistrict[r.district] = r.overlapPairs;
    return { pairs: rows.reduce((n, r) => n + r.overlapPairs, 0), byDistrict };
  },
  ped: async (dir, seed, tmp) => {
    const file = join(tmp, `ped-${seed}.json`);
    await run(dir, 'audit-ped-overlaps.mjs', ['--seeds', String(seed), '--fps', String(FPS), '--json', file]);
    const { results } = JSON.parse(readFileSync(file, 'utf8'));
    return {
      clusters: results.reduce((n, r) => n + r.clusterCount, 0),
      pairsPerSecond: results.reduce((n, r) => n + r.overlapPairSecondsPerSecond, 0) / results.length
    };
  },
  demand: async (dir, seed) => {
    const out = await run(dir, 'audit-demand-crossings.mjs', ['--seeds', String(seed), '--minutes', String(MINUTES), '--fps', String(FPS), '--json']);
    const { summary } = JSON.parse(out);
    return {
      onRoadwayDuringGreen: summary.totalOnRoadwayDuringGreen, starved: summary.totalStarved,
      roadGreenFailures: summary.roadGreenFailures, requestDelayFailures: summary.requestDelayFailures
    };
  }
};

async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function main() {
  const kinds = ['bench', 'tram', ...(WITH_PED ? ['ped'] : []), ...(WITH_DEMAND ? ['demand'] : [])];
  const tmp = mkdtempSync(join(tmpdir(), 'accept-traffic-'));
  let baseDir = null;
  let workDir = null;
  const cleanup = () => {
    for (const dir of [baseDir, workDir]) {
      if (dir) {
        try { git(ROOT, ['worktree', 'remove', '--force', dir]); } catch { /* already gone */ }
      }
    }
    rmSync(tmp, { recursive: true, force: true });
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
  try {
    if (BASE === 'worktree') {
      baseDir = null;
    } else {
      baseDir = join(tmp, 'baseline');
      git(ROOT, ['worktree', 'add', '--detach', baseDir, BASE]);
    }
    if (WORK !== 'worktree') {
      workDir = join(tmp, 'work');
      git(ROOT, ['worktree', 'add', '--detach', workDir, WORK]);
    }
    const trees = { base: baseDir || ROOT, work: workDir || ROOT };
    const hashes = { base: treeHash(trees.base), work: treeHash(trees.work) };
    console.error(`baseline ${BASE} tree ${hashes.base.slice(0, 10)}, working tree ${hashes.work.slice(0, 10)}, ` +
      `${SEEDS.length} seeds, ${JOBS} jobs${SHIFT ? `, baseline seeds shifted by ${SHIFT}` : ''}`);
    mkdirSync(CACHE_DIR, { recursive: true });

    const data = { base: {}, work: {} };
    const tasks = [];
    const inflight = new Map(); // identical (tree, seed) jobs, e.g. --base worktree without a shift, run once
    let done = 0;
    const total = kinds.length * SEEDS.length * 2;
    for (const side of ['base', 'work']) {
      for (const seed of SEEDS) {
        const actual = side === 'base' ? seed + SHIFT : seed;
        for (const kind of kinds) {
          // the bench variants (tools/bench-world.mjs) change a tree's result, whichever side it is on
          const variant = [process.env.BENCH_RUNTIME_HEADS && `h${process.env.BENCH_RUNTIME_HEADS}`,
            process.env.BENCH_STOP_MIN_LINK && `l${process.env.BENCH_STOP_MIN_LINK}`].filter(Boolean).join('-');
          const cacheFile = join(CACHE_DIR, `${hashes[side]}-${kind}-s${actual}-m${MINUTES}-f${FPS}${variant ? `-${variant}` : ''}.json`);
          tasks.push(async () => {
            if (!inflight.has(cacheFile)) {
              inflight.set(cacheFile, (async () => {
                if (USE_CACHE && existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
                const result = await TOOLS[kind](trees[side], actual, tmp);
                writeFileSync(cacheFile, JSON.stringify(result));
                return result;
              })());
            }
            const value = await inflight.get(cacheFile);
            (data[side][seed] ||= {})[kind] = value;
            console.error(`[${++done}/${total}] ${side} ${kind} seed ${actual}`);
          });
        }
      }
    }
    await pool(tasks, JOBS);

    const metric = (name, dir, gate, pick) => {
      const get = (side) => Object.fromEntries(SEEDS.map((s) => [s, pick(data[side][s])]));
      return { ...compareMetric(name, dir, get('base'), get('work')), gate };
    };
    const comparisons = [
      metric('car–tram pairs', 'lower', true, (d) => d.tram.pairs),
      metric('holds > 120 s', 'lower', true, (d) => d.bench.holds120),
      metric('deadlocks', 'lower', true, (d) => d.bench.deadlocks),
      metric('max wait s', 'lower', true, (d) => d.bench.maxWait),
      metric('km/h all', 'higher', true, (d) => d.bench.kmhAll),
      ...DISTRICT_KEYS.map((k) => metric(`km/h ${k}`, 'higher', false, (d) => d.bench.kmh[k]))
    ];
    if (WITH_PED) {
      comparisons.push(metric('ped clusters', 'lower', true, (d) => d.ped.clusters));
      comparisons.push(metric('ped overlap pairs/s', 'lower', false, (d) => d.ped.pairsPerSecond));
    }
    if (WITH_DEMAND) {
      comparisons.push(metric('demand: walkers on road during green', 'lower', true, (d) => d.demand.onRoadwayDuringGreen));
      comparisons.push(metric('demand: road-green failures', 'lower', true, (d) => d.demand.roadGreenFailures));
      comparisons.push(metric('demand: starved requests', 'lower', false, (d) => d.demand.starved));
    }
    const patterns = (side) => Object.fromEntries(SEEDS.map((s) => [s, data[side][s].bench.deadlockPatterns]));
    const newPatterns = newDeadlockPatterns(patterns('base'), patterns('work'));
    const failed = failures(comparisons, newPatterns);

    console.log(`## Traffic acceptance: ${BASE} vs ${WORK === 'worktree' ? 'working tree' : WORK} (${SEEDS.length} seeds, ${MINUTES} min, ${FPS} fps)\n`);
    console.log(`Seeds: ${SEEDS.join(' ')}${SHIFT ? `; baseline ran seeds + ${SHIFT}` : ''}. Diff = working − baseline; ` +
      '95 % CI is a paired bootstrap of the mean diff per seed.\n');
    console.log(summaryTable(comparisons));
    console.log('\nPer-seed paired values (baseline → working (diff)):\n');
    console.log(perSeedTable(comparisons.slice(0, 3)));
    console.log(`\nNew deadlock patterns (in ≥ 3 working seeds, none of the baseline's): ${newPatterns.length ? newPatterns.map((p) => `${p.signature} [${p.seeds.join(' ')}]`).join('; ') : 'none'}`);
    console.log(failed.length ? `\nREGRESSION: ${failed.join('; ')}` : '\nNo statistically clear regression.');
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, seeds: SEEDS, shift: SHIFT, hashes, comparisons, newPatterns, failed, data }, null, 2));
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    cleanup();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 2; });
