const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Absorbs every three.js / TSL call actor-models.js makes at load time (as in trams.test.cjs)
function inert() {
  const store = {};
  return new Proxy(function () {}, {
    get(_target, key) {
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === 'then') return undefined;
      if (key === 'length') return 0;
      return key in store ? store[key] : (store[key] = inert());
    },
    set(_target, key, value) { store[key] = value; return true; },
    apply: () => inert(),
    construct: () => inert()
  });
}

const { BODY_SPECS, carDimensions, polishRegistration, encodeRegistration } = loadModule(
  readFileSync(join(__dirname, '../js/actor-models.js'), 'utf8'),
  {
    imports: {
      'three/webgpu': inert(),
      'three/tsl': inert(),
      'three/addons/utils/BufferGeometryUtils.js': inert(),
      './tsl-materials.js': { cityUniforms: inert() }
    }
  }
);

// The material's glyph atlas order and its decoding of plateCode (createLoftedCarMaterial), mirrored
const GLYPHS = '0123456789ACEFGHJKLMNPRSTUVWXYOZ';
function decode(code) {
  let text = '';
  for (let slot = 0; slot < 7; slot++) {
    const packed = code[Math.floor(slot / 2)];
    const high = Math.floor(packed / 32);
    text += GLYPHS[slot % 2 ? packed - high * 32 : high];
  }
  return `${text.slice(0, 2)} ${text.slice(2)}`;
}

test('registrations are plausible Poznań plates and the same for the same seed', () => {
  const seen = new Set();
  const districts = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const reg = polishRegistration(seed);
    assert.equal(reg, polishRegistration(seed));
    assert.match(reg, /^P[OYZ] [1-9A-Z][0-9A-Z]{4}$/);
    const rest = reg.slice(3);
    assert.match(rest, /^(\d{5}|\d{4}[A-Z]|\d{3}[A-Z]{2}|\d[A-Z]\d{3}|\d[A-Z]{2}\d{2}|[A-Z]\d{4}|[A-Z]{2}\d{3})$/, reg);
    assert.doesNotMatch(rest, /[BDIOQZ]/, `${reg}: no letters that read like digits`);
    seen.add(reg);
    districts.add(reg.slice(0, 2));
  }
  assert.ok(seen.size >= 199, 'every car has its own registration');
  assert.deepEqual([...districts].sort(), ['PO', 'PY', 'PZ']);
});

test('plateCode packs all seven glyphs exactly and the material decodes them back', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const reg = polishRegistration(seed);
    const code = encodeRegistration(reg);
    for (const v of code) assert.ok(Number.isInteger(v) && v < 2 ** 24, 'exact in float32');
    assert.equal(decode(code), reg);
  }
});

test('body classes have Polish-market proportions and unique material names', () => {
  // [length, width, roof, wheelbase] of the class, within a few centimetres
  const expected = {
    saloon: [4.6, 1.78, 1.44, 2.7],
    hatch: [4.24, 1.78, 1.47, 2.6],
    estate: [4.68, 1.82, 1.47, 2.69],
    crossover: [4.46, 1.85, 1.66, 2.68],
    van: [5.6, 2.02, 2.5, 3.44]
  };
  const names = new Set();
  for (const [kind, [len, width, roof, base]] of Object.entries(expected)) {
    const spec = BODY_SPECS[kind];
    const d = carDimensions(spec);
    assert.ok(Math.abs(d.half * 2 - len) < 0.02, `${kind} length ${d.half * 2}`);
    assert.ok(Math.abs(d.halfWidth * 2 - width) < 0.02, `${kind} width ${d.halfWidth * 2}`);
    assert.ok(Math.abs(d.roof - roof) < 0.02, `${kind} roof ${d.roof}`);
    assert.ok(Math.abs(spec.wheelZ * 2 - base) < 0.02, `${kind} wheelbase ${spec.wheelZ * 2}`);
    if (kind !== 'van') assert.ok(d.halfWidth * 2 < 1.896, `${kind} is narrower than the old US sedan`);
    names.add(spec.name);
  }
  names.add(BODY_SPECS.taxi.name);
  assert.equal(names.size, 6);
  assert.equal(BODY_SPECS.taxi.sign, true);
  assert.equal(BODY_SPECS.taxi.zFront, BODY_SPECS.saloon.zFront);
});

test('painted plates clear the bumper trims and the lamps', () => {
  const PLATE_HH = 0.057;
  for (const [kind, spec] of Object.entries(BODY_SPECS)) {
    spec.plates.forEach((y, end) => {
      const [bumperY, bumperH] = spec.bumpers[end];
      assert.ok(y - PLATE_HH > bumperY + bumperH, `${kind} ${end ? 'rear' : 'front'} plate above the bumper trim`);
    });
    const [, hlY, , hlH] = spec.headlight;
    const [, tlY, , tlH] = spec.taillight;
    assert.ok(spec.plates[0] + PLATE_HH < hlY - hlH, `${kind} front plate below the headlights`);
    assert.ok(spec.plates[1] + PLATE_HH < tlY - tlH, `${kind} rear plate below the tail lamps`);
  }
});
