// Instrument only the headless copy of trams.js. The production driver remains untouched.
function instrumentTrams(source) {
  const farVariant = source.includes('    function farConflict(dist, why) {');
  function replace(from, to) {
    if (!source.includes(from)) throw new Error(`Tram trace marker missing: ${from}`);
    source = source.replace(from, to);
  }
  replace("  let _hold = Infinity;", "  let _audit = null;\n  let _auditContext = null;\n  let _hold = Infinity;");
  replace("      _reason = why;", "      _reason = why;\n      if (_audit) _audit.binding = _auditContext ? { ..._auditContext } : { reason: why, kind: 'other' };");
  replace("  function considerGate(dist, why) {", `  function considerGate(dist, why, meta) {
    _auditContext = { ...meta, reason: why, d: dist };
    _audit.gates.push(_auditContext);`);
  replace("    consider(wall(dist), why);\n  }", "    consider(wall(dist), why);\n    _auditContext = null;\n  }");
  replace("    if (gate < _hold) consider(wall(gate), _holdReason);", `    if (gate < _hold) {
      const original = _audit.gates.find((g) => g.d === _hold && g.reason === _holdReason);
      _auditContext = { ...original, d: gate, rawD: _hold, complex: true };
      _audit.gates.push(_auditContext);
      consider(wall(gate), _holdReason);
      _auditContext = null;
    }`);
  replace("    const path = t.path;\n    const u = path.u;\n    const ic = path.indexAt(u);\n    const here = path.edges[ic];", "    _audit = t._audit = { gates: [], probes: [], binding: null, v: t.speed, x: t.x, z: t.z };\n    const path = t.path;\n    const u = path.u;\n    const ic = path.indexAt(u);\n    const here = path.edges[ic];");
  replace("      if (entry > 0.2 && tramGap < distA + path.edges[j].foulStart + t.length + 2) {", "      _audit.probes.push({ key: 'nodeRoom:' + N.x + ',' + N.z, d: entry - 0.5, gap: tramGap, threshold: distA + path.edges[j].foulStart + t.length + 2 });\n      _audit.probes.push({ key: 'nodeSwitch:' + N.x + ',' + N.z, d: entry });\n      if (entry > 0.2 && tramGap < distA + path.edges[j].foulStart + t.length + 2) {");
  replace("        if (entry > 0.2 && tramGap < distA + FOUL + t.length + 2) {", "        _audit.probes.push({ key: 'crossRoom:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.s, d: entry - 0.5, gap: tramGap, threshold: distA + FOUL + t.length + 2 });\n        _audit.probes.push({ key: 'crossSwitch:' + c.other.from.x + ',' + c.other.from.z + ':' + c.os, d: entry });\n        if (entry > 0.2 && tramGap < distA + FOUL + t.length + 2) {");
  const clearReach = farVariant ? 'LOOKAHEAD' : 'CONFLICT_REACH';
  replace(`          if (entry > 0.2 && entry <= ${clearReach} && tramGap < sj + c.end - u + t.length + 2) {`, `          _audit.probes.push({ key: 'keepClear:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.start, d: entry - 0.5, gap: tramGap, threshold: sj + c.end - u + t.length + 2 });\n          if (entry > 0.2 && entry <= ${clearReach} && tramGap < sj + c.end - u + t.length + 2) {`);
  replace("        if (tramGap < target - u + 2 && target - u > t.length + 2) {", "        _audit.probes.push({ key: 'platform:' + st.stop.name + ':' + st.s, d: target - u - t.length - 2, gap: tramGap, threshold: target - u + 2 });\n        if (tramGap < target - u + 2 && target - u > t.length + 2) {");
  replace("        if (phase === 'green') continue;", "        _audit.probes.push({ key: 'signal:' + sig.node.x + ',' + sig.node.z + ':' + sig.group, phase, d: gap });\n        if (phase === 'green') continue;");
  if (source.includes("consider(wall(entry - 0.5), 'car');")) replace("consider(wall(entry - 0.5), 'car');", "_auditContext = { kind: 'farRoad', key: 'road:' + c.node.x + ',' + c.node.z + ':' + c.s0, reason: 'car', d: entry - 0.5, entry };\n                _audit.gates.push(_auditContext);\n                consider(wall(entry - 0.5), 'car');\n                _auditContext = null;");
  replace("considerGate(entry - 0.5, 'car');", "considerGate(entry - 0.5, 'car', { kind: 'road', key: 'road:' + c.node.x + ',' + c.node.z + ':' + c.s0, blocker: pass + ':' + list.indexOf(v), entry });");
  replace("considerGate(entry - 0.5, 'room');", "considerGate(entry - 0.5, 'room', { kind: 'nodeRoom', key: 'nodeRoom:' + N.x + ',' + N.z, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA });");
  const nodeSwitch = farVariant ? 'else' : 'if (block)';
  replace(`${nodeSwitch} considerGate(distA - mine.foulEnd, 'switch');`, `${nodeSwitch} considerGate(distA - mine.foulEnd, 'switch', { kind: 'nodeSwitch', key: 'nodeSwitch:' + N.x + ',' + N.z, blocker: o.id, entry: distA - mine.foulEnd, nodeDistance: distA });`);
  replace("considerGate(entry - 0.5, 'room');", "considerGate(entry - 0.5, 'room', { kind: 'crossRoom', key: 'crossRoom:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.s, blocker: tramLeader && tramLeader.id, entry, nodeDistance: distA });");
  replace("considerGate(distA - FOUL, 'switch');", "considerGate(distA - FOUL, 'switch', { kind: 'crossSwitch', key: 'crossSwitch:' + B.from.x + ',' + B.from.z + ':' + c.os, blocker: o.id, entry: distA - FOUL, nodeDistance: distA });");
  replace("considerGate(entry - 0.5, 'room');", "considerGate(entry - 0.5, 'room', { kind: 'keepClear', key: 'keepClear:' + path.edges[j].from.x + ',' + path.edges[j].from.z + ':' + c.start, blocker: tramLeader && tramLeader.id, entry });");
  replace("considerGate(distA - path.edges[j - 1].foulEnd, 'block');", "considerGate(distA - path.edges[j - 1].foulEnd, 'block', { kind: 'block', key: 'block:' + e.run, blocker: o.id });");
  replace("considerGate(target - u - t.length - 2, 'room');", "considerGate(target - u - t.length - 2, 'room', { kind: 'platform', key: 'platform:' + st.stop.name + ':' + st.s, blocker: tramLeader && tramLeader.id });");
  replace("        consider(wall(target - u), 'stop');", "        _auditContext = { kind: 'stop', key: 'stop:' + st.stop.name + ':' + st.s, reason: 'stop', d: target - u };\n        _audit.gates.push(_auditContext);\n        consider(wall(target - u), 'stop');\n        _auditContext = null;");
  replace("considerGate(gate, 'signal');", "considerGate(gate, 'signal', { kind: 'signal', key: 'signal:' + sig.node.x + ',' + sig.node.z + ':' + sig.group, phase, signalDistance: gap });");
  replace("          consider(idm(Math.max(gap, 0.1), _obsV), 'car');", "          _auditContext = { kind: 'body', key: 'body:' + (v.benchId ?? list.indexOf(v)) + ':' + pass, reason: 'car', d: gap };\n          _audit.gates.push(_auditContext);\n          consider(idm(Math.max(gap, 0.1), _obsV), 'car');\n          _auditContext = null;");
  replace("        consider(idm(Math.max(gap, 0.1), _obsV), 'pedestrian');", "        _auditContext = { kind: 'pedestrian', key: 'pedestrian:' + i, reason: 'pedestrian', d: gap };\n        _audit.gates.push(_auditContext);\n        consider(idm(Math.max(gap, 0.1), _obsV), 'pedestrian');\n        _auditContext = null;");
  replace("          consider(idm(Math.max(gap, 0.1), headOn ? 0 : o.speed), 'tram');", "          _auditContext = { kind: 'tramLeader', key: 'tram:' + o.id, reason: 'tram', d: gap, blocker: o.id };\n          _audit.gates.push(_auditContext);\n          consider(idm(Math.max(gap, 0.1), headOn ? 0 : o.speed), 'tram');\n          _auditContext = null;");
  replace("        consider(idm(Math.max(gap, 0.1), _obsV), 'player');", "        _auditContext = { kind: 'player', key: 'player', reason: 'player', d: gap };\n        _audit.gates.push(_auditContext);\n        consider(idm(Math.max(gap, 0.1), _obsV), 'player');\n        _auditContext = null;");
  replace("    if (path.end < Infinity) consider(wall(path.end - u - path.edges[path.n - 1].endPad), 'end');", "    if (path.end < Infinity) {\n      _auditContext = { kind: 'end', key: 'end:' + path.edges[path.n - 1].to.x + ',' + path.edges[path.n - 1].to.z, reason: 'end', d: path.end - u - path.edges[path.n - 1].endPad };\n      consider(wall(_auditContext.d), 'end');\n      _auditContext = null;\n    }");
  if (farVariant) replace("      consider(wall(gate), why);\n    }\n\n    // Switches", "      path.pointAt(u + dist, _p);\n      _auditContext = { kind: 'farConflict', key: 'far:' + why + ':' + Math.round(_p.x) + ',' + Math.round(_p.z), reason: why, d: gate };\n      _audit.gates.push(_auditContext);\n      consider(wall(gate), why);\n      _auditContext = null;\n    }\n\n    // Switches");
  return source;
}
export { instrumentTrams };
