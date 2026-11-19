// Complete deterministic tram overrun audit: tracks every tram continuously across steps and reports
// (1) red-signal stop-line overruns (committed-in-complex clearings vs true red entries),
// (2) occupied-switch overruns (node switches, off-node crossings, single-track blocks),
// (3) closed-gate crossings (including gates first observed behind the tram and newly closed gates).
//
// Usage:
//   node tools/audit-tram-overruns.mjs [--minutes 5] [--fps 20] [--seed 4242] [--seeds 61,67,...] [--jobs N]
//                                      [--only jezyce,kaponiera] [--warmup 20] [--events] [--json out.json]
import { buildWorld } from './bench-world.mjs';
import { cpus } from 'node:os';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DISTRICTS = [
  { key: 'jezyce', x: -2056, z: -391 },
  { key: 'lazarz', x: -1900, z: 1500 },
  { key: 'centrum', x: -900, z: 178 },
  { key: 'kaponiera', x: -1464, z: 88 },
  { key: 'stare', x: 0, z: 0 },
  { key: 'rataje', x: 1108, z: 1439 },
  { key: 'wilda', x: -300, z: 1800 }
];
const DEFAULT_SEEDS = [61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157];

// Instrument a headless copy of js/trams.js without changing any simulation branch, RNG draw or driving output.
function instrumentTramsForOverruns(source) {
  const farVariant = source.includes('    function farConflict(dist, why) {');
  if (!farVariant) throw new Error('Expected farConflict helper in js/trams.js');
  function replace(from, to) {
    if (!source.includes(from)) throw new Error(`Tram overrun marker missing: ${from}`);
    source = source.replace(from, to);
  }
  replace('  const _p = { x: 0, z: 0, tx: 0, tz: 1 };',
    '  const _p = { x: 0, z: 0, tx: 0, tz: 1 };\n  const _orPt = { x: 0, z: 0, tx: 0, tz: 1 };');
  replace('    t.active = true;',
    '    t.active = true;\n    t._overrunSpawnId = (t._overrunSpawnId || 0) + 1;\n    t._overrunTotalU = 0;');
  replace('  let _hold = Infinity;',
    '  let _or = null;\n  let _orCtx = null;\n  let _hold = Infinity;');
  replace('  function considerGate(dist, why) {',
    '  function considerGate(dist, why, meta) {\n    if (_or) { _orCtx = { ...(meta || {}), reason: why, d: dist }; _or.gates.push(_orCtx); }');
  replace('    consider(wall(dist), why);\n  }',
    '    consider(wall(dist), why);\n    _orCtx = null;\n  }');
  replace('    if (gate < _hold) consider(wall(gate), _holdReason);',
    `    if (gate < _hold) {
      if (_or && _hold - gate > 0.05) {
        const orig = _or.gates.find((g) => g.d === _hold && g.reason === _holdReason);
        _or.gates.push({ kind: 'complex', key: 'complex', reason: _holdReason, d: gate, rawD: _hold, rawKey: orig ? orig.key : null, complexPulled: true });
      }
      consider(wall(gate), _holdReason);
    }`);
  replace('    const path = t.path;\n    const u = path.u;\n    const ic = path.indexAt(u);\n    const here = path.edges[ic];',
    `    const path = t.path;
    const u = path.u;
    const ic = path.indexAt(u);
    const here = path.edges[ic];
    _or = t._overrunPre = {
      u, v: t.speed, acc: 0, waitReason: '',
      totalU: t._overrunTotalU || 0,
      spawnId: t._overrunSpawnId || 0,
      commits: t._signalCommits.slice(0, t._signalCommitN),
      signals: [], switches: [], gates: [],
      endGateU: path.end < Infinity ? path.end - path.edges[path.n - 1].endPad : Infinity
    };`);
  // Capture raw gates even when entry <= 0.2 (behind the front) so newly-closed behind-tram gates are never dropped.
  replace("considerGate(entry - 0.5, 'car');",
    "considerGate(entry - 0.5, 'car', { kind: 'road', key: 'road:' + c.node.x + ',' + c.node.z + ':' + c.s0, blocker: pass + ':' + list.indexOf(v), entry });");
  replace("          if (entry <= 0.2 || entry > roadLookahead) continue;",
    `          if (entry > roadLookahead) continue;
          const _roadBehind = entry <= 0.2;
          if (_roadBehind && base + c.s1 - u < 0) continue;`);
  replace("              if (entry > ROAD_GATE_REACH) {\n                consider(wall(entry - 0.5), 'car');\n                continue;\n              }\n              roadCarGate = true;",
    `              if (_roadBehind) {
                if (_or) _or.gates.push({ kind: 'road', key: 'road:' + c.node.x + ',' + c.node.z + ':' + c.s0, reason: 'car', d: entry - 0.5, entry, blocker: pass + ':' + list.indexOf(v), behindProbe: true });
                continue;
              }
              if (entry > ROAD_GATE_REACH) {
                consider(wall(entry - 0.5), 'car');
                continue;
              }
              roadCarGate = true;`);
  replace("      if (entry > 0.2 && tramGap < distA + path.edges[j].foulStart + t.length + 2) {",
    `      if (entry <= 0.2 && distA >= 0 && distA <= CONFLICT_REACH && tramGap < distA + path.edges[j].foulStart + t.length + 2 && _or) {
        _or.gates.push({ kind: 'nodeRoom', key: 'nodeRoom:' + N.x + ',' + N.z, reason: 'room', d: entry - 0.5, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA, behindProbe: true });
      }
      if (entry > 0.2 && tramGap < distA + path.edges[j].foulStart + t.length + 2) {`);
  replace("considerGate(entry - 0.5, 'room');",
    "considerGate(entry - 0.5, 'room', { kind: 'nodeRoom', key: 'nodeRoom:' + N.x + ',' + N.z, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA });");
  replace("else considerGate(distA - mine.foulEnd, 'switch');",
    "else considerGate(distA - mine.foulEnd, 'switch', { kind: 'nodeSwitch', key: 'nodeSwitch:' + N.x + ',' + N.z, blocker: o.id, entry: distA - mine.foulEnd, nodeDistance: distA });");
  replace("        if (entry > 0.2 && tramGap < distA + FOUL + t.length + 2) {",
    `        if (entry <= 0.2 && distA >= 0 && distA <= CONFLICT_REACH && tramGap < distA + FOUL + t.length + 2 && _or) {
          _or.gates.push({ kind: 'crossRoom', key: 'crossRoom:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.s, reason: 'room', d: entry - 0.5, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA, behindProbe: true });
        }
        if (entry > 0.2 && tramGap < distA + FOUL + t.length + 2) {`);
  replace("considerGate(entry - 0.5, 'room');",
    "considerGate(entry - 0.5, 'room', { kind: 'crossRoom', key: 'crossRoom:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.s, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA });");
  replace("else considerGate(distA - FOUL, 'switch');",
    "else considerGate(distA - FOUL, 'switch', { kind: 'crossSwitch', key: 'crossSwitch:' + B.from.x + ',' + B.from.z + ':' + c.os, blocker: o.id, entry: distA - FOUL, nodeDistance: distA });");
  replace("          if (entry > 0.2 && entry <= LOOKAHEAD && tramGap < sj + c.end - u + t.length + 2) {",
    `          if (entry <= 0.2 && sj + c.end - u >= 0 && sj + c.start - u <= CONFLICT_REACH && tramGap < sj + c.end - u + t.length + 2 && _or) {
            _or.gates.push({ kind: 'keepClear', key: 'keepClear:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.start, reason: 'room', d: entry - 0.5, blocker: tramLeader && tramLeader.id, entry, behindProbe: true });
          }
          if (entry > 0.2 && entry <= LOOKAHEAD && tramGap < sj + c.end - u + t.length + 2) {`);
  replace("considerGate(entry - 0.5, 'room');",
    "considerGate(entry - 0.5, 'room', { kind: 'keepClear', key: 'keepClear:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.start, blocker: tramLeader && tramLeader.id, entry });");
  replace("considerGate(distA - path.edges[j - 1].foulEnd, 'block');",
    "considerGate(distA - path.edges[j - 1].foulEnd, 'block', { kind: 'block', key: 'block:' + e.run, blocker: o.id });");
  replace("considerGate(target - u - t.length - 2, 'room');",
    "considerGate(target - u - t.length - 2, 'room', { kind: 'platform', key: 'platform:' + st.stop.name + ':' + st.s, blocker: tramLeader && tramLeader.id });");
  replace("        consider(wall(target - u), 'stop');",
    `        if (_or) _or.gates.push({ kind: 'stop', key: 'stop:' + st.stop.name + ':' + st.s, reason: 'stop', d: target - u });
        consider(wall(target - u), 'stop');`);
  replace("considerGate(gate, 'signal');",
    "considerGate(gate, 'signal', { kind: 'signal', key: 'signal:' + sig.node.x + ',' + sig.node.z + ':' + sig.group, phase, signalDistance: gap, stopLineD: gap });");
  // Capture complete signal, switch/crossing/block, and end-gate states before drive() exits.
  replace("    t.acc = Math.max(-9, _acc);\n    t.waitReason = _reason;\n    if (_reason === 'room') t.leader = tramLeader;\n  }",
    `    t.acc = Math.max(-9, _acc);
    t.waitReason = _reason;
    if (_reason === 'room') t.leader = tramLeader;
    if (_or) {
      _or.acc = t.acc;
      _or.waitReason = t.waitReason;
      if (path.end < Infinity) _or.gates.push({ kind: 'end', key: 'end:' + path.edges[path.n - 1].to.x + ',' + path.edges[path.n - 1].to.z, reason: 'end', d: path.end - u - path.edges[path.n - 1].endPad });
      for (let j = 0; j < path.n; j++) {
        const sj = path.start[j];
        if (sj - u > LOOKAHEAD + 20) break;
        for (const sig of path.edges[j].signals) {
          const stopLineU = sj + sig.s;
          const gap = stopLineU - u;
          if (gap < -5 || gap > LOOKAHEAD) continue;
          const phase = signalPhase(elapsed, sig.group === 0, sig.node);
          let committed = false;
          for (let k = 0; k < t._signalCommitN; k++) if (t._signalCommits[k] === sig.node) committed = true;
          const complexGateU = complexStopGate(path, stopLineU - 0.5, t.length);
          const stoppableAmber = phase === 'amber' && gap >= 0.2 && gap >= (_v * _v) / (2 * D.bMax) + 1;
          const closed = gap >= 0 && !committed && (phase === 'red' || phase === 'redAmber' || stoppableAmber);
          edgePoint(path.edges[j], sig.s, _orPt);
          const key = 'signal:' + sig.node.x + ',' + sig.node.z + ':' + sig.group;
          _or.signals.push({
            key, nodeX: sig.node.x, nodeZ: sig.node.z, group: sig.group,
            stopLineX: _orPt.x, stopLineZ: _orPt.z, stopLineS: sig.s,
            stopLineU, complexGateU, complexGateD: complexGateU - u,
            inComplex: complexGateU < stopLineU - 0.5 - 1e-6,
            phase, committed, closed
          });
          if (closed && gap < 0.2) {
            _or.gates.push({ kind: 'signal', key, reason: 'signal', d: complexGateU - u, phase, signalDistance: gap, stopLineD: gap, behindProbe: true });
          }
        }
      }
      for (let j = 1; j < path.n; j++) {
        const nodeU = path.start[j];
        const mine = path.edges[j - 1];
        const e = path.edges[j];
        const entryU = nodeU - mine.foulEnd;
        const distA = nodeU - u;
        if (distA >= -5 && entryU <= u + LOOKAHEAD) {
          const N = e.from;
          if (N.in.length >= 2 || N.out.length >= 2) {
            let occupied = false, claimed = false, blocker = null;
            for (const o of pool) {
              if (o === t || !o.active) continue;
              if (Math.abs(o.x - N.x) > LOOKAHEAD + 40 || Math.abs(o.z - N.z) > LOOKAHEAD + 40) continue;
              if (occupies(o, mine) || (occupies(o, e) && !holds(o, N))) continue;
              if (holds(o, N)) {
                occupied = true;
                blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason, sameExitEdge: occupies(o, e) };
                break;
              }
              if (distA > 0) {
                const distB = reaches(o, N, distA);
                if (distB >= 0 && !(o.clearance < distB) && _arrive !== mine && (distB < distA || (distB === distA && o.id < t.id))) {
                  claimed = true;
                  if (!blocker) blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason };
                }
              }
            }
            _or.switches.push({
              kind: 'nodeSwitch', key: 'nodeSwitch:' + N.x + ',' + N.z,
              x: N.x, z: N.z, entryU, nodeU, inLookahead: distA <= CONFLICT_REACH,
              occupied, claimed, blocker
            });
          }
          if (e.run >= 0 && mine.run !== e.run) {
            let occupied = false, claimed = false, blocker = null;
            for (const o of pool) {
              if (o === t || !o.active) continue;
              if (inRun(o, e.run, -e.runDir)) {
                occupied = true;
                blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason };
                break;
              }
              if (distA > 0 && entersRun(o, e.run, -e.runDir, distA, t.id)) {
                claimed = true;
                if (!blocker) blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason };
              }
            }
            _or.switches.push({
              kind: 'block', key: 'block:' + e.run,
              x: e.from.x, z: e.from.z, entryU, nodeU, inLookahead: distA <= CONFLICT_REACH,
              occupied, claimed, blocker
            });
          }
        }
      }
      for (let j = 0; j < path.n; j++) {
        const sj = path.start[j];
        if (sj - u > LOOKAHEAD) break;
        for (const c of path.edges[j].crossings) {
          const crossU = sj + c.s;
          const entryU = crossU - FOUL;
          const distA = crossU - u;
          if (distA < -5 || entryU > u + LOOKAHEAD) continue;
          let occupied = false, claimed = false, blocker = null;
          for (const o of pool) {
            if (o === t || !o.active) continue;
            if (Math.abs(o.x - t.x) > LOOKAHEAD + 80 || Math.abs(o.z - t.z) > LOOKAHEAD + 80) continue;
            if (crossHeld(o, c.other, c.os)) {
              occupied = true;
              blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason };
              break;
            }
            if (distA > 0 && crossApproach(o, c.other, c.os, distA, t.id)) {
              claimed = true;
              if (!blocker) blocker = { tramId: o.id, speed: o.speed, waitReason: o.waitReason };
            }
          }
          edgePoint(path.edges[j], c.s, _orPt);
          _or.switches.push({
            kind: 'crossSwitch', key: 'crossSwitch:' + c.other.from.x + ',' + c.other.from.z + ':' + c.os.toFixed(2),
            x: _orPt.x, z: _orPt.z, entryU, nodeU: crossU, inLookahead: distA <= CONFLICT_REACH,
            occupied, claimed, blocker
          });
        }
      }
    }
    _or = null;
  }`);
  replace(`    if (t.atStop) {`,
    `    if (t.atStop) {
      const pre = t._overrunPre;
      if (pre) {
        path.pointAt(path.u, _orPt);
        t._overrunStep = {
          from: path.u, to: path.u, totalUBefore: t._overrunTotalU || 0, totalUAfter: t._overrunTotalU || 0,
          atStop: true, speedPre: pre.v, speedPost: 0, acc: 0, waitReason: 'stop',
          frontX: _orPt.x, frontZ: _orPt.z, pre
        };
      }`);
  replace('    path.trim(t.length + 8);',
    `    const _orTo = path.u;
    const _orDelta = _orTo - from;
    const _orTotalBefore = t._overrunTotalU || 0;
    t._overrunTotalU = _orTotalBefore + _orDelta;
    path.pointAt(_orTo, _orPt);
    t._overrunStep = {
      from, to: _orTo, totalUBefore: _orTotalBefore, totalUAfter: t._overrunTotalU,
      atStop: false, speedPre: t._overrunPre ? t._overrunPre.v : t.speed, speedPost: t.speed,
      acc: t.acc, waitReason: t.waitReason, frontX: _orPt.x, frontZ: _orPt.z,
      pre: t._overrunPre || null
    };
    path.trim(t.length + 8);`);
  return source;
}

function round(v, d = 2) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
}

// Continuous per-tram overrun tracker. Tracks every active tram across consecutive simulation steps so gates first
// observed behind the front, red stop-line crossings, and occupied/claimed switch entries are caught without
// double-counting across path.trim() shifts or multi-frame traversals.
function createOverrunTracker({ seed = 0, district = '', warmup = 20 } = {}) {
  const tramStates = new Map();
  const trueRedOverruns = [];
  const committedSignalClearings = [];
  const occupiedSwitchOverruns = [];
  const closedGateCrossings = [];

  function findEntry(map, key, absPos) {
    const list = map.get(key);
    if (!list) return null;
    for (const entry of list) {
      if (Math.abs(entry.absPos - absPos) < 2.0) return entry;
    }
    return null;
  }

  function ensureEntry(map, key, absPos) {
    let entry = findEntry(map, key, absPos);
    if (!entry) {
      entry = { absPos, wasClosed: false, triggered: false, switchTriggered: false };
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(entry);
    } else {
      entry.absPos = absPos;
    }
    return entry;
  }

  function pruneOld(map, absFrom) {
    for (const [key, list] of map) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].absPos < absFrom - 120) list.splice(i, 1);
      }
      if (!list.length) map.delete(key);
    }
  }

  function step(tramsList, time) {
    const activeSet = new Set();
    const record = time >= warmup;
    const tRound = +time.toFixed(2);
    for (const t of tramsList) {
      if (!t.active || !t._overrunStep) continue;
      activeSet.add(t.id);
      const st = t._overrunStep;
      const pre = st.pre;
      const spawnId = pre ? pre.spawnId : (t._overrunSpawnId || 0);
      let state = tramStates.get(t.id);
      const isFreshSpawn = !state || state.spawnId !== spawnId;
      if (isFreshSpawn) {
        state = { spawnId, gates: new Map(), switches: new Map(), signalsDone: new Set() };
        tramStates.set(t.id, state);
      }
      if (!pre) continue;
      const { from, to, totalUBefore, totalUAfter } = st;
      const trimOffset = totalUBefore - pre.u;
      const absFrom = totalUBefore;
      const absTo = totalUAfter;
      const baseMeta = {
        seed,
        district,
        tramId: t.id,
        line: t.line || '',
        model: t.model || '',
        time: tRound,
        speedPre: round(st.speedPre, 2),
        speedPost: round(st.speedPost, 2),
        acc: round(st.acc, 2),
        waitReason: st.waitReason || ''
      };

      // 1. Red-signal stop-line crossings (during movement from -> to).
      for (const sig of pre.signals) {
        if (from <= sig.stopLineU && to > sig.stopLineU) {
          if (sig.phase === 'red' || sig.phase === 'redAmber') {
            const absLine = trimOffset + sig.stopLineU;
            const sigKey = `${sig.key}@${Math.round(absLine)}`;
            if (!state.signalsDone.has(sigKey)) {
              state.signalsDone.add(sigKey);
              if (record) {
                const ev = {
                  ...baseMeta,
                  x: round(sig.stopLineX, 2),
                  z: round(sig.stopLineZ, 2),
                  classification: sig.committed ? 'committed_complex_clearing' : 'true_red_overrun',
                  committed: sig.committed,
                  signal: {
                    nodeX: sig.nodeX,
                    nodeZ: sig.nodeZ,
                    group: sig.group,
                    phase: sig.phase,
                    stopLineS: round(sig.stopLineS, 2),
                    complexGateD: round(sig.complexGateD, 2),
                    inComplex: sig.inComplex
                  },
                  uFrom: round(from, 3),
                  uTo: round(to, 3),
                  stopLineU: round(sig.stopLineU, 3),
                  overshoot: round(to - sig.stopLineU, 3)
                };
                if (sig.committed) committedSignalClearings.push(ev);
                else trueRedOverruns.push(ev);
              }
            }
          }
        }
      }

      // 2. Occupied / claimed switch, crossing, and single-track block overruns.
      for (const sw of pre.switches) {
        const absEntry = trimOffset + sw.entryU;
        const swEntry = ensureEntry(state.switches, sw.key, absEntry);
        if (!sw.occupied && !sw.claimed) continue;
        const switchState = sw.occupied ? 'occupied' : 'claimed';
        const crossedEntry = from <= sw.entryU && to > sw.entryU;
        const crossedNode = !crossedEntry && !swEntry.switchTriggered && sw.occupied && from <= sw.nodeU && to > sw.nodeU;
        if ((crossedEntry || crossedNode) && !swEntry.switchTriggered) {
          swEntry.switchTriggered = true;
          if (record) {
            occupiedSwitchOverruns.push({
              ...baseMeta,
              x: round(sw.x, 2),
              z: round(sw.z, 2),
              switchKind: sw.kind,
              switchKey: sw.key,
              boundary: crossedEntry ? 'foulEntry' : 'node',
              switchState,
              inLookahead: sw.inLookahead,
              blocker: sw.blocker,
              uFrom: round(from, 3),
              uTo: round(to, 3),
              boundaryU: round(crossedEntry ? sw.entryU : sw.nodeU, 3),
              overshoot: round(to - (crossedEntry ? sw.entryU : sw.nodeU), 3)
            });
          }
        }
      }

      // 3. Closed-gate crossings (including gates first observed behind the tram and newly closed behind-tram gates).
      // First deduplicate multiple entries for the same gate key in pre.gates (keep closest).
      const closedThisStep = new Map();
      for (const gate of pre.gates) {
        if (!gate.key) continue;
        // Signal gates are handled by pre.signals below only if gap >= 0; drive()'s considerGate already checked gap >= 0.2.
        const existing = closedThisStep.get(gate.key);
        if (!existing || gate.d < existing.d) closedThisStep.set(gate.key, gate);
      }

      // Mark open gates so transitions from open -> closed behind the tram are distinguished from never-seen gates.
      for (const sig of pre.signals) {
        if (!sig.closed) {
          const absG = trimOffset + sig.stopLineU;
          const entry = findEntry(state.gates, sig.key, absG);
          if (entry) entry.wasClosed = false;
          else if (sig.complexGateU >= from || !isFreshSpawn) {
            ensureEntry(state.gates, sig.key, absG).wasClosed = false;
          }
        }
      }
      for (const sw of pre.switches) {
        if (!sw.occupied && !sw.claimed) {
          const absG = trimOffset + sw.entryU;
          const entry = ensureEntry(state.gates, sw.key, absG);
          entry.wasClosed = false;
        }
      }
      for (const [key, list] of state.gates) {
        if (!closedThisStep.has(key)) {
          for (const entry of list) entry.wasClosed = false;
        }
      }

      for (const gate of closedThisStep.values()) {
        const absGateU = trimOffset + pre.u + gate.d;
        const trackAbsU = gate.stopLineD != null ? trimOffset + pre.u + gate.stopLineD : absGateU;
        const entry = ensureEntry(state.gates, gate.key, trackAbsU);
        const wasPreviouslyOpen = !entry.wasClosed;
        const dPost = absGateU - absTo;

        const makeGateEvent = (crossingType, firstObservedBehind) => ({
          ...baseMeta,
          x: round(st.frontX, 2),
          z: round(st.frontZ, 2),
          gateKind: gate.kind,
          gateKey: gate.rawKey ? `${gate.key}:${gate.rawKey}` : gate.key,
          crossingType,
          gateState: {
            reason: gate.reason,
            phase: gate.phase || null,
            dPre: round(gate.d, 3),
            dPost: round(dPost, 3),
            firstObservedBehind,
            wasPreviouslyOpen,
            complexPulled: Boolean(gate.complexPulled),
            rawKey: gate.rawKey ?? null,
            behindProbe: Boolean(gate.behindProbe),
            blocker: gate.blocker ?? null
          }
        });

        if (absFrom <= absGateU && absTo > absGateU) {
          if (!entry.triggered && record) closedGateCrossings.push(makeGateEvent('forward', false));
          entry.triggered = true;
          entry.wasClosed = true;
        } else if (absGateU < absFrom) {
          if (isFreshSpawn) {
            // Tram spawned past this already-closed gate; establish baseline without a false crossing.
            entry.wasClosed = true;
            entry.triggered = true;
          } else if (!entry.triggered && !entry.wasClosed) {
            if (record) closedGateCrossings.push(makeGateEvent('behind', true));
            entry.triggered = true;
            entry.wasClosed = true;
          } else {
            entry.wasClosed = true;
          }
        } else {
          entry.wasClosed = true;
        }
      }

      pruneOld(state.gates, absFrom);
      pruneOld(state.switches, absFrom);
      t._overrunStep = null;
    }

    for (const id of tramStates.keys()) {
      if (!activeSet.has(id)) tramStates.delete(id);
    }
  }

  function countsBy(list, fn) {
    const out = {};
    for (const item of list) {
      const k = fn(item);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  const isNonCreep = (e) => e.speedPre >= 0.3 || e.gateState.dPost < -0.1;

  function summary() {
    const nonCreep = closedGateCrossings.filter(isNonCreep);
    return {
      trueRedOverruns: trueRedOverruns.length,
      committedSignalClearings: committedSignalClearings.length,
      occupiedSwitchOverruns: occupiedSwitchOverruns.length,
      closedGateCrossings: closedGateCrossings.length,
      closedGateForward: closedGateCrossings.filter((e) => e.crossingType === 'forward').length,
      closedGateBehind: closedGateCrossings.filter((e) => e.crossingType === 'behind').length,
      closedGateNonCreep: nonCreep.length,
      closedGateNonCreepForward: nonCreep.filter((e) => e.crossingType === 'forward').length,
      closedGateNonCreepBehind: nonCreep.filter((e) => e.crossingType === 'behind').length,
      closedGateCreep: closedGateCrossings.length - nonCreep.length,
      redByPhase: countsBy(trueRedOverruns, (e) => e.signal.phase),
      switchByKind: countsBy(occupiedSwitchOverruns, (e) => `${e.switchKind}:${e.switchState}`),
      closedGateByKind: countsBy(closedGateCrossings, (e) => `${e.gateKind}:${e.crossingType}`),
      closedGateNonCreepByKind: countsBy(nonCreep, (e) => `${e.gateKind}:${e.crossingType}`)
    };
  }

  return {
    step,
    summary,
    events: () => ({
      trueRedOverruns,
      committedSignalClearings,
      occupiedSwitchOverruns,
      closedGateCrossings
    })
  };
}

function runDistrictOverrunAudit({ seed = 4242, district, minutes = 5, fps = 20, warmup = 20 } = {}) {
  let s = seed;
  Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const { traffic, trams } = buildWorld({ tramSource: instrumentTramsForOverruns });
  const player = { type: 'person', position: { x: -1e5, y: 0, z: -1e5 }, heading: 0, speed: 0 };
  const tracker = createOverrunTracker({ seed, district: district.key, warmup });
  const dt = 1 / fps;
  let time = 0;
  let tramSeconds = 0;
  let tramMetres = 0;
  while (time < minutes * 60) {
    time += dt;
    trams.update(dt, time, district, null, player, 'person');
    traffic.update(dt, time, district, player, 'person', null);
    tracker.step(trams.trams, time);
    if (time >= warmup) {
      for (const t of trams.trams) {
        if (!t.active) continue;
        tramSeconds += dt;
        tramMetres += t.speed * dt;
      }
    }
  }
  return {
    district: district.key,
    seed,
    minutes,
    fps,
    warmup,
    tramHours: +(tramSeconds / 3600).toFixed(3),
    tramSeconds: +tramSeconds.toFixed(2),
    tramMetres: +tramMetres.toFixed(1),
    ...tracker.summary(),
    events: tracker.events()
  };
}

function aggregateTotals(items, extra = {}) {
  const sum = (k) => items.reduce((a, r) => a + (r[k] || 0), 0);
  const mergeMap = (k) => {
    const out = {};
    for (const r of items) {
      for (const [m, v] of Object.entries(r[k] || {})) out[m] = (out[m] || 0) + v;
    }
    return out;
  };
  return {
    ...extra,
    tramHours: +sum('tramHours').toFixed(3),
    trueRedOverruns: sum('trueRedOverruns'),
    committedSignalClearings: sum('committedSignalClearings'),
    occupiedSwitchOverruns: sum('occupiedSwitchOverruns'),
    closedGateCrossings: sum('closedGateCrossings'),
    closedGateForward: sum('closedGateForward'),
    closedGateBehind: sum('closedGateBehind'),
    closedGateNonCreep: sum('closedGateNonCreep'),
    closedGateNonCreepForward: sum('closedGateNonCreepForward'),
    closedGateNonCreepBehind: sum('closedGateNonCreepBehind'),
    closedGateCreep: sum('closedGateCreep'),
    redByPhase: mergeMap('redByPhase'),
    switchByKind: mergeMap('switchByKind'),
    closedGateByKind: mergeMap('closedGateByKind'),
    closedGateNonCreepByKind: mergeMap('closedGateNonCreepByKind')
  };
}

async function runMultiSeed({ seeds, only, minutes, fps, warmup, jobs, includeEvents, jsonOut }) {
  const self = fileURLToPath(import.meta.url);
  const tasks = seeds.map((seed) => () => new Promise((res, rej) => {
    const childArgs = [self, '--seed', String(seed), '--minutes', String(minutes), '--fps', String(fps), '--warmup', String(warmup), '--json-stdout'];
    if (only) childArgs.push('--only', only);
    if (includeEvents) childArgs.push('--events');
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', rej);
    child.on('close', (code) => (code === 0 ? res(JSON.parse(out)) : rej(new Error(`seed ${seed} failed (${code}): ${err.slice(-400)}`))));
  }));
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, async () => {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
      process.stderr.write(`[${idx + 1}/${tasks.length}] seed ${seeds[idx]}\n`);
    }
  }));
  const totals = aggregateTotals(results.map((r) => r.totals), { seeds, minutes, fps, warmup });
  const payload = { totals, perSeed: results };
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 2));
}

function parseCli(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i < 0 ? fallback : argv[i + 1];
  };
  const minutes = Number(opt('minutes', 5));
  const fps = Number(opt('fps', 20));
  const warmup = Number(opt('warmup', 20));
  const only = opt('only', null);
  const seedsArg = opt('seeds', null);
  const seedArg = opt('seed', null);
  const defaultMulti = argv.includes('--default-seeds');
  const seeds = defaultMulti ? DEFAULT_SEEDS : seedsArg ? seedsArg.split(',').map(Number) : [Number(seedArg ?? 4242)];
  const jobs = Number(opt('jobs', Math.max(1, Math.floor(cpus().length / 2))));
  const includeEvents = argv.includes('--events');
  const jsonStdout = argv.includes('--json-stdout');
  const jsonOut = opt('json', null);
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(warmup) || warmup < 0 ||
      seeds.some((s) => !Number.isInteger(s) || s <= 0 || s >= 2147483647) ||
      (only && only.split(',').some((key) => !DISTRICTS.some((d) => d.key === key)))) {
    throw new Error('Invalid minutes, fps, warmup, seed(s) or district');
  }
  return { minutes, fps, warmup, only, seeds, jobs, includeEvents, jsonStdout, jsonOut };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const cfg = parseCli(process.argv.slice(2));
  if (cfg.seeds.length > 1) {
    await runMultiSeed(cfg);
  } else {
    const seed = cfg.seeds[0];
    const rows = [];
    for (const district of DISTRICTS) {
      if (cfg.only && !cfg.only.split(',').includes(district.key)) continue;
      const row = runDistrictOverrunAudit({ seed, district, minutes: cfg.minutes, fps: cfg.fps, warmup: cfg.warmup });
      if (!cfg.includeEvents) delete row.events;
      rows.push(row);
      if (!cfg.jsonStdout) console.log(JSON.stringify(row));
    }
    if (cfg.jsonStdout || cfg.jsonOut) {
      const totals = aggregateTotals(rows, { seed });
      const out = { seed, totals, districts: rows };
      if (cfg.jsonOut) writeFileSync(cfg.jsonOut, JSON.stringify(out, null, 2));
      if (cfg.jsonStdout) console.log(JSON.stringify(out));
    }
  }
}

export {
  DISTRICTS,
  DEFAULT_SEEDS,
  instrumentTramsForOverruns,
  createOverrunTracker,
  runDistrictOverrunAudit
};
