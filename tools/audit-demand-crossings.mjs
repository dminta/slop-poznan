// Headless audit of NPC pedestrian demand requests at every demand crossing (two-arm signalised node with crossings).
// Usage:
//   node tools/audit-demand-crossings.mjs [--seeds 4242,77] [--minutes 5] [--fps 15] [--only id1,id2] [--json]
import { buildWorld } from './bench-world.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args[i + 1];
};
const SEEDS = opt('seeds', '4242,77').split(',').map(Number);
const MINUTES = Number(opt('minutes', 5));
const FPS = Number(opt('fps', 15));
const ONLY = opt('only', null) ? new Set(opt('only', '').split(',').map(Number)) : null;
const JSON_OUT = args.includes('--json');

const KERB = 1.6;
const ROAD_CURB = 2.0; // pedestrian-routes.js extends crosswalk tracks 2 m onto each curb
const WARMUP_JUMP_OFFSET = 100; // keep single-node batches within spawnPed's 60-280 m ring

const pct = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null);
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

function getDemandNodes(traffic) {
  const { network, pedestrianRoutes } = traffic;
  const out = [];
  for (const n of network.nodes) {
    if (!n.signal || !n.signalTiming?.pedestrian) continue;
    if (ONLY && !ONLY.has(n.id)) continue;
    const crossings = pedestrianRoutes.across(n);
    let width = 0;
    for (const r of crossings) width = Math.max(width, r.len - 2 * KERB);
    out.push({
      node: n,
      id: n.id,
      x: n.x,
      z: n.z,
      sideCount: n.sideCount,
      crossingCount: crossings.length,
      crossingWidth: width,
      duration: n.signalTiming.duration,
      redClearance: n.signalTiming.duration - 12
    });
  }
  return out;
}

function clusterNodes(nodes) {
  const remaining = [...nodes];
  const batches = [];
  while (remaining.length) {
    const seed = remaining.shift();
    const group = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (Math.hypot(remaining[i].x - seed.x, remaining[i].z - seed.z) <= 200) {
        group.push(remaining.splice(i, 1)[0]);
      }
    }
    const cx = group.reduce((s, n) => s + n.x, 0) / group.length;
    const cz = group.reduce((s, n) => s + n.z, 0) / group.length;
    // If any node is < 60 m from centroid, shift focus by 100 m so spawnPed (60-280 m) can still spawn on it.
    const tooClose = group.some((n) => Math.hypot(n.x - cx, n.z - cz) < 60);
    batches.push({
      focusX: cx + (tooClose ? WARMUP_JUMP_OFFSET : 0),
      focusZ: cz,
      nodes: group
    });
  }
  return batches;
}

function runSeed(seedValue) {
  let seed = seedValue;
  Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const world = buildWorld();
  const { traffic, trams } = world;
  const demandList = getDemandNodes(traffic);
  const batches = clusterNodes(demandList);

  const stats = new Map();
  for (const d of demandList) {
    stats.set(d.id, {
      id: d.id,
      x: d.x,
      z: d.z,
      crossingWidth: d.crossingWidth,
      duration: d.duration,
      redClearance: d.redClearance,
      clearanceOk: d.redClearance >= d.crossingWidth - 1e-6,
      requests: 0,
      phasesServed: 0,
      latencies: [],
      minRoadGreen: Infinity,
      roadGreenOk: true,
      minRequestDelay: Infinity,
      requestDelayOk: true,
      starved: 0,
      maxCurbWait: 0,
      enteredOnGreen: 0,
      onRoadwayDuringGreen: 0,
      visitors: 0
    });
  }

  const dt = 1 / FPS;
  const steps = Math.round(MINUTES * 60 * FPS);
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  let clock = 0;

  // Per-pedestrian tracking across frames within a batch
  const pedState = new Map();

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx];
    const focus = { x: batch.focusX, z: batch.focusZ };
    // Jump focus far away first if needed so the next update triggers a full >140 m camera-jump respawn
    if (bIdx > 0) {
      traffic.update(dt, (clock += dt), { x: focus.x + 5000, z: focus.z + 5000 }, player, 'person', null);
    }
    pedState.clear();

    const batchMap = new Map();
    for (const d of batch.nodes) {
      const t = d.node.signalTiming;
      batchMap.set(d.node, {
        info: d,
        st: stats.get(d.id),
        pendingReq: null,
        wasWalk: false,
        prevStart: t.start,
        lastPhaseEnd: Number.isFinite(t.start) ? t.start + t.duration : 0
      });
    }

    const batchStartClock = clock;
    for (let step = 0; step < steps; step++) {
      clock += dt;

      // Snapshot pre-update signal state
      for (const [node, rec] of batchMap) {
        rec.prevStart = node.signalTiming.start;
      }

      trams.update(dt);
      traffic.update(dt, clock, focus, player, 'person', null);

      // Post-update signal state checks
      for (const [node, rec] of batchMap) {
        const t = node.signalTiming;
        const st = rec.st;

        if (t.start !== rec.prevStart && Number.isFinite(t.start)) {
          st.requests++;
          const delay = t.start - clock;
          if (delay < st.minRequestDelay) st.minRequestDelay = delay;
          if (delay < 2 - 1e-6) st.requestDelayOk = false;

          const greenDur = Number.isFinite(rec.prevStart)
            ? t.start - (rec.prevStart + t.duration)
            : t.start - batchStartClock;
          // Note: on the very first request in a batch, road has been green since simulation start (clock >= 0)
          const effectiveGreen = Number.isFinite(rec.prevStart) ? greenDur : t.start;
          if (effectiveGreen < st.minRoadGreen) st.minRoadGreen = effectiveGreen;
          if (effectiveGreen < 20 - 1e-6) st.roadGreenOk = false;

          rec.pendingReq = { reqTime: clock, scheduledStart: t.start };
        }

        const isWalk = !!t.walk1;
        if (isWalk && !rec.wasWalk) {
          st.phasesServed++;
          if (rec.pendingReq) {
            st.latencies.push(clock - rec.pendingReq.reqTime);
            rec.pendingReq = null;
          }
        }
        rec.wasWalk = isWalk;
      }

      // Pedestrian checks
      for (const p of traffic.peds) {
        if (!p.placed) {
          pedState.delete(p);
          continue;
        }
        let ps = pedState.get(p);
        if (!ps) {
          ps = {
            lastNode: null,
            visitedNodes: new Set(),
            waitNoReq: 0,
            totalCurbWait: 0,
            starvedCounted: false,
            prevOnRoadway: false,
            violationCounted: false
          };
          pedState.set(p, ps);
        }

        const n = p.node;
        const rec = n ? batchMap.get(n) : null;
        if (!rec) {
          ps.lastNode = null;
          ps.waitNoReq = 0;
          ps.totalCurbWait = 0;
          ps.starvedCounted = false;
          ps.prevOnRoadway = false;
          ps.violationCounted = false;
          continue;
        }

        const st = rec.st;
        if (ps.lastNode !== n) {
          ps.lastNode = n;
          ps.waitNoReq = 0;
          ps.totalCurbWait = 0;
          ps.starvedCounted = false;
          ps.prevOnRoadway = false;
          ps.violationCounted = false;
          if (!ps.visitedNodes.has(n)) {
            ps.visitedNodes.add(n);
            st.visitors++;
          }
        }

        const prog = p.dir > 0 ? p.t : p.len - p.t;
        const t = n.signalTiming;
        const hasPendingOrActive = Number.isFinite(t.start) && clock < t.start + t.duration;

        // Waiting at the curb
        if (p.waiting || (prog <= KERB + 0.5 && (p.roomCause === 'curb' || p.roomCause === 'curbQueue'))) {
          ps.totalCurbWait += dt;
          if (ps.totalCurbWait > st.maxCurbWait) st.maxCurbWait = ps.totalCurbWait;
          if (!hasPendingOrActive) {
            ps.waitNoReq += dt;
            if (ps.waitNoReq > 60 && !ps.starvedCounted) {
              st.starved++;
              ps.starvedCounted = true;
            }
          } else {
            ps.waitNoReq = 0;
          }
        } else {
          ps.waitNoReq = 0;
          ps.totalCurbWait = 0;
        }

        // Crossing on road green
        const onRoadway = prog > ROAD_CURB && prog < p.len - ROAD_CURB;
        if (onRoadway && t.phase0 === 'green') {
          if (!ps.prevOnRoadway) st.enteredOnGreen++;
          if (!ps.violationCounted) {
            st.onRoadwayDuringGreen++;
            ps.violationCounted = true;
          }
        } else if (!onRoadway) {
          ps.violationCounted = false;
        }
        ps.prevOnRoadway = onRoadway;
      }
    }
  }

  return stats;
}

const perSeed = new Map();
for (const s of SEEDS) perSeed.set(s, runSeed(s));

// Aggregate across seeds
const first = perSeed.get(SEEDS[0]);
const rows = [];
for (const id of first.keys()) {
  const agg = {
    id,
    x: round(first.get(id).x, 1),
    z: round(first.get(id).z, 1),
    width: round(first.get(id).crossingWidth, 2),
    duration: round(first.get(id).duration, 2),
    redClearance: round(first.get(id).redClearance, 2),
    clearanceOk: first.get(id).clearanceOk,
    requests: 0,
    phasesServed: 0,
    latencies: [],
    minRoadGreen: Infinity,
    roadGreenOk: true,
    minRequestDelay: Infinity,
    requestDelayOk: true,
    starved: 0,
    maxCurbWait: 0,
    enteredOnGreen: 0,
    onRoadwayDuringGreen: 0,
    visitors: 0
  };
  for (const s of SEEDS) {
    const r = perSeed.get(s).get(id);
    agg.requests += r.requests;
    agg.phasesServed += r.phasesServed;
    agg.latencies.push(...r.latencies);
    agg.minRoadGreen = Math.min(agg.minRoadGreen, r.minRoadGreen);
    agg.roadGreenOk = agg.roadGreenOk && r.roadGreenOk;
    agg.minRequestDelay = Math.min(agg.minRequestDelay, r.minRequestDelay);
    agg.requestDelayOk = agg.requestDelayOk && r.requestDelayOk;
    agg.starved += r.starved;
    agg.maxCurbWait = Math.max(agg.maxCurbWait, r.maxCurbWait);
    agg.enteredOnGreen += r.enteredOnGreen;
    agg.onRoadwayDuringGreen += r.onRoadwayDuringGreen;
    agg.visitors += r.visitors;
  }
  agg.latencies.sort((a, b) => a - b);
  rows.push({
    id: agg.id,
    x: agg.x,
    z: agg.z,
    width: agg.width,
    duration: agg.duration,
    redClearance: agg.redClearance,
    clearanceOk: agg.clearanceOk,
    requests: agg.requests,
    phasesServed: agg.phasesServed,
    latMin: round(agg.latencies[0] ?? null, 2),
    latP50: round(pct(agg.latencies, 0.5), 2),
    latMax: round(agg.latencies[agg.latencies.length - 1] ?? null, 2),
    minRoadGreen: round(agg.minRoadGreen, 2),
    roadGreenOk: agg.roadGreenOk,
    minRequestDelay: round(agg.minRequestDelay, 2),
    requestDelayOk: agg.requestDelayOk,
    starved: agg.starved,
    maxCurbWait: round(agg.maxCurbWait, 1),
    enteredOnGreen: agg.enteredOnGreen,
    onRoadwayDuringGreen: agg.onRoadwayDuringGreen,
    visitors: agg.visitors
  });
}

const unvisited = rows.filter((r) => r.visitors === 0);
const summary = {
  seeds: SEEDS,
  minutesPerBatch: MINUTES,
  fps: FPS,
  demandNodes: rows.length,
  unvisitedNodes: unvisited.length,
  totalRequests: rows.reduce((s, r) => s + r.requests, 0),
  totalPhasesServed: rows.reduce((s, r) => s + r.phasesServed, 0),
  totalStarved: rows.reduce((s, r) => s + r.starved, 0),
  totalEnteredOnGreen: rows.reduce((s, r) => s + r.enteredOnGreen, 0),
  totalOnRoadwayDuringGreen: rows.reduce((s, r) => s + r.onRoadwayDuringGreen, 0),
  clearanceFailures: rows.filter((r) => !r.clearanceOk).length,
  roadGreenFailures: rows.filter((r) => !r.roadGreenOk).length,
  requestDelayFailures: rows.filter((r) => !r.requestDelayOk).length
};

if (JSON_OUT) {
  console.log(JSON.stringify({ summary, rows }, null, 2));
} else {
  console.log('Demand crossings audit summary:', summary);
  console.log('');
  console.log(
    '| id | x | z | width | clear | clrOk | req | served | lat min/p50/max | minGreen | minDelay | starved | maxWait | enterGreen | roadGreen | visitors |'
  );
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const lat = r.latMin == null ? '-' : `${r.latMin}/${r.latP50}/${r.latMax}`;
    console.log(
      `| ${r.id} | ${r.x} | ${r.z} | ${r.width} | ${r.redClearance} | ${r.clearanceOk ? 'ok' : 'FAIL'} | ${r.requests} | ${r.phasesServed} | ${lat} | ${r.minRoadGreen ?? '-'} | ${r.minRequestDelay ?? '-'} | ${r.starved} | ${r.maxCurbWait} | ${r.enteredOnGreen} | ${r.onRoadwayDuringGreen} | ${r.visitors} |`
    );
  }
}
