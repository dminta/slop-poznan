const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const roads = readFileSync(join(__dirname, '../js/road-network.js'), 'utf8');
function harness() {
  const context = { Math, Float64Array, boxSample: { x: 0, z: 0, dx: 0, dz: 0 } };
  context.curvePoint = vm.runInNewContext(`(${roads.match(/function curvePoint\([^]*?\n\}/)[0]})`, context);
  for (const name of ['boxSamples', 'bendSpeed']) {
    const block = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
    if (block) context[name] = vm.runInNewContext(`(${block[0].trim()})`, context);
    else if (name === 'bendSpeed') {
      const line = source.match(/  const bendSpeed = [^\n]+;/)[0].trim();
      context.bendSpeed = vm.runInNewContext(`${line} bendSpeed`, context);
    }
  }
  return context;
}

// Real right-turn connector by Św. Marcin: a short sharp exit bend once forced a 0.9 m/s crawl over all 38.7 m.
const fixture = {"x0":-790.076562790187,"z0":229.79280417106784,"x3":-769.3984936286233,"z3":197.27005150619354,"x1":-780.1640770974939,"z1":211.42351250279035,"x2":-770.9003021131134,"z2":196.85331930892667,"lut":[0,3.867722272872925,7.6306986808776855,11.269753456115723,14.76570987701416,18.099393844604492,21.25164222717285,24.203327178955078,26.935361862182617,29.428741455078125,31.664592742919922,33.62427520751953,35.28958511352539,36.64322280883789,37.670074462890625,38.36194610595703,38.74467468261719],"len":38.74467478610695,"curv":4.533013444295661};
const car = { driver: { aLat: 3.5, b: 3 } };

test('a short sharp exit bend slows cars near the bend while allowing the long approach to move', () => {
  const { bendSpeed } = harness();
  const curve = { ...fixture };
  assert.ok(bendSpeed(car, curve, 0) > 8, 'room to brake before the distant exit bend');
  assert.ok(bendSpeed(car, curve, curve.len) < 1, 'the sharp exit still requires a crawl');
});

test('bend profiles respect local lateral limits, brake before tighter bends and reuse their buffers', () => {
  const { bendSpeed } = harness();
  const curve = { ...fixture };
  bendSpeed(car, curve);
  const profile = curve.bendProfiles.get(car.driver);
  const step = curve.len / (profile.length - 1);
  for (let i = 0; i < profile.length; i++) {
    const cap = bendSpeed(car, curve, i * step);
    assert.ok(cap * cap * curve.boxBends[i] <= car.driver.aLat + 1e-8, `lateral acceleration at ${i}`);
    if (i + 1 < profile.length) assert.ok(profile[i] <= profile[i + 1] + 2 * car.driver.b * step + 1e-8);
  }
  assert.equal(curve.bendProfiles.get(car.driver), profile);
  const bus = { driver: { aLat: 2, b: 2.5 } };
  assert.ok(bendSpeed(bus, curve, 0) < bendSpeed(car, curve, 0));
  assert.equal(curve.bendProfiles.size, 2);
});
