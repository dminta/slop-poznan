// Summarise distinct OSM ways in the furnished-network P-22 regression. Reasons use precedence: painted,
// eligible without room/clearance, lane count, blocked lane, then no retained designated-direction edge.
function busReport(ways, edges, marks, withoutRail, withoutCrossings) {
  const tags = (w) => w.tags || {};
  const entries = (w) => Object.entries(tags(w));
  const position = (w) => entries(w).some(([k]) => /^(bus|psv):lanes(?::(forward|backward))?$/.test(k));
  const count = (w) => entries(w).some(([k]) => /^lanes:(bus|psv)(?::|$)/.test(k));
  const turn = (w) => entries(w).some(([k]) => /^turn:(bus|psv):lanes/.test(k));
  const designated = ways.filter((w) => entries(w).some(([k, v]) =>
    /^(bus|psv):lanes(?::(forward|backward))?$/.test(k) && v.split(/[|;]/).includes('designated')));
  const opposite = ways.filter((w) => {
    const t = tags(w);
    return t.oneway && t.oneway !== 'no' && (t['oneway:bus'] === 'no' || t['oneway:psv'] === 'no');
  });
  const ids = (list) => new Set(list.map((m) => m.way));
  const painted = ids(marks), noRail = ids(withoutRail), noCrossings = ids(withoutCrossings);
  const status = new Map();
  for (const e of edges) if (e.busWay && e.busStatus !== 'direction') {
    if (!status.has(e.busWay)) status.set(e.busWay, new Set());
    status.get(e.busWay).add(e.busStatus);
  }
  const result = { designated: designated.length, painted: 0, countMismatch: 0, short: 0, rail: 0, crossing: 0,
    blocked: 0, absent: 0, countOnly: ways.filter((w) => !position(w) && count(w)).length,
    turnOnly: ways.filter((w) => !position(w) && !count(w) && turn(w)).length, contraflow: opposite.length };
  for (const w of designated) {
    const state = status.get(w.id) || new Set();
    if (painted.has(w.id)) result.painted++;
    else if (state.has('eligible')) {
      if (noRail.has(w.id)) result.rail++;
      else if (noCrossings.has(w.id)) result.crossing++;
      else result.short++;
    } else if (state.has('count')) result.countMismatch++;
    else if (state.has('blocked')) result.blocked++;
    else result.absent++;
  }
  return result;
}

function formatBusReport(r) {
  return `P-22 ways: ${r.designated} designated, ${r.painted} painted, ${r.countMismatch} lane-count mismatch, ` +
    `${r.short} too short, ${r.rail} rail clearance, ${r.crossing} crossing clearance, ${r.blocked} blocked lanes, ` +
    `${r.absent} no retained edge; ${r.countOnly} count-only, ${r.turnOnly} turn-only, ` +
    `${r.contraflow} one-way ways allow opposite buses/PSVs`;
}

module.exports = { busReport, formatBusReport };
