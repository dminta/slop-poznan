// Separating-axis penetration depth for two oriented rectangles, shared by the tram audits.
// Positive means the bodies interpenetrate by that many metres, zero means they just touch and negative means a gap.
function penetration(a, b) {
  let depth = Infinity;
  for (const rect of [a, b]) {
    for (const angle of [rect.h, rect.h + Math.PI / 2]) {
      const x = Math.sin(angle), z = Math.cos(angle);
      const distance = Math.abs((a.x - b.x) * x + (a.z - b.z) * z);
      const radius = (r) => r.hl * Math.abs(Math.sin(r.h) * x + Math.cos(r.h) * z) +
        r.hw * Math.abs(Math.cos(r.h) * x - Math.sin(r.h) * z);
      depth = Math.min(depth, radius(a) + radius(b) - distance);
    }
  }
  return depth;
}

// Touching counts as overlap, matching the original audit's `distance > radius` test.
function overlap(a, b) {
  return penetration(a, b) >= 0;
}

// Tolerance 0 keeps the original touching-inclusive definition (a pair whose deepest sampled penetration is 0 still
// counts), so the recorded raw numbers stay comparable. A positive tolerance drops pairs that never cut deeper than it.
function exceedsTolerance(depth, tolerance) {
  return tolerance > 0 ? depth > tolerance : depth >= 0;
}

export { penetration, overlap, exceedsTolerance };
