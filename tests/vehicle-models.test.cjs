const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
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

const { BODY_SPECS, BUS_SPEC, BUS_18_SPEC, carDimensions, PLATE_FONT_FAMILY, polishRegistration, encodeRegistration } = loadModule(
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

test('registration plates use a narrow font stack with Linux and Android fallbacks', () => {
  assert.ok(typeof PLATE_FONT_FAMILY === 'string' && PLATE_FONT_FAMILY.length > 0);
  assert.match(PLATE_FONT_FAMILY, /"Arial Narrow"/);
  assert.match(PLATE_FONT_FAMILY, /"Liberation Sans Narrow"/, 'Linux metric-compatible fallback');
  assert.match(PLATE_FONT_FAMILY, /"Roboto Condensed"/, 'Android system fallback');
  assert.match(PLATE_FONT_FAMILY, /sans-serif-condensed/, 'Android generic keyword');
});

test('NPC plate atlas uses the player font and preserves glyph proportions', () => {
  const source = readFileSync(join(__dirname, '../js/actor-models.js'), 'utf8');
  const player = readFileSync(join(__dirname, '../js/controllers.js'), 'utf8');
  function context() {
    const calls = [], stack = [];
    let transform = { x: 0, y: 0, sx: 1, sy: 1 };
    const ctx = {
      measureText: (text) => ({ width: [...text].reduce((w, c) => w + (c === 'W' ? 100 : 60), 0) }),
      fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
      save() { stack.push({ ...transform }); },
      restore() { transform = stack.pop(); },
      translate(x, y) { transform.x += x * transform.sx; transform.y += y * transform.sy; },
      scale(x, y) { transform.sx *= x; transform.sy *= y; },
      fillText(text, x, y) { calls.push({ text, x: transform.x + x * transform.sx, y: transform.y + y * transform.sy,
        sx: transform.sx, sy: transform.sy, font: this.font, baseline: this.textBaseline }); }
    };
    const canvas = { getContext: () => ctx };
    return { calls, canvas };
  }
  const npc = context(), own = context();
  const THREE = { CanvasTexture: class { constructor(image) { this.image = image; } } };
  const draw = source.slice(source.indexOf('function carPlateGlyphTexture()'), source.indexOf('// Livery lettering'));
  const makeTexture = vm.runInNewContext(`let _carPlateTexture; ${draw}; carPlateGlyphTexture`, {
    document: { createElement: () => npc.canvas }, THREE, PLATE_FONT_FAMILY, PLATE_GLYPHS: GLYPHS
  });
  assert.equal(makeTexture(), makeTexture(), 'atlas is shared');
  const playerDraw = player.slice(player.indexOf('const PLATE_W ='), player.indexOf('class ThirdPersonControllerManager'));
  vm.runInNewContext(`${playerDraw}; createPolishLicensePlateTexture('PO', '4K217')`, {
    document: { createElement: () => own.canvas }, THREE, PLATE_FONT_FAMILY
  });
  const district = own.calls.find((call) => call.text === 'PO');
  const number = own.calls.find((call) => call.text === '4K217');
  const glyph = npc.calls.find((call) => call.text === '0');
  assert.equal(glyph.font, district.font);
  assert.equal(glyph.baseline, district.baseline);
  assert.ok(Math.abs(glyph.sy / npc.canvas.height - district.sy / own.canvas.height) < 0.001, 'same relative glyph height');
  assert.ok(Math.abs(glyph.y / npc.canvas.height - district.y / own.canvas.height) < 0.001, 'same baseline');
  assert.ok(glyph.sx > 0.85, 'ordinary glyphs are not excessively squeezed');
  const wide = npc.calls.find((call) => call.text === 'W');
  assert.ok(wide.sx < glyph.sx && wide.sy === glyph.sy, 'only wide glyphs are fitted horizontally');
  const shader = source.slice(source.indexOf('function plateColor('), source.indexOf('/**\n * Creates the TSL material'));
  const [, start, width] = shader.match(/plateU\.sub\(([\d.]+)\)\.div\(([\d.]+)\)/);
  const npcExtent = Number(width) * 8;
  const playerExtent = (number.x + 300 * number.sx - district.x) / own.canvas.width;
  assert.ok(Math.abs(npcExtent - playerExtent) < 0.15, 'registration occupies a comparable plate width');
  assert.ok(Number(start) + npcExtent <= 1, 'registration fits on the plate');
});

test('body classes have Polish-market proportions and unique material names', () => {
  // [length, width, roof, wheelbase] of the class, within a few centimetres
  const expected = {
    saloon: [4.6, 1.78, 1.44, 2.7],
    hatch: [4.24, 1.78, 1.47, 2.6],
    estate: [4.68, 1.82, 1.47, 2.69],
    crossover: [4.46, 1.85, 1.66, 2.68],
    van: [5.6, 2.02, 2.5, 3.44],
    fireTruck: [8.3, 2.54, 3.25, 4.3]
  };
  const names = new Set();
  for (const [kind, [len, width, roof, base]] of Object.entries(expected)) {
    const spec = BODY_SPECS[kind];
    const d = carDimensions(spec);
    assert.ok(Math.abs(d.half * 2 - len) < 0.02, `${kind} length ${d.half * 2}`);
    assert.ok(Math.abs(d.halfWidth * 2 - width) < 0.02, `${kind} width ${d.halfWidth * 2}`);
    assert.ok(Math.abs(d.roof - roof) < 0.02, `${kind} roof ${d.roof}`);
    assert.ok(Math.abs(spec.wheelZ * 2 - base) < 0.02, `${kind} wheelbase ${spec.wheelZ * 2}`);
    if (kind !== 'van' && kind !== 'fireTruck') assert.ok(d.halfWidth * 2 < 1.896, `${kind} is narrower than the old US sedan`);
    names.add(spec.name);
  }
  names.add(BODY_SPECS.taxi.name);
  assert.equal(names.size, 7);
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

test('BUS_18_SPEC has Solaris Urbino 18 proportions, 4 passenger doors and 3 axles', () => {
  const frontLen = BUS_18_SPEC.front.zFront - BUS_18_SPEC.front.zRear;
  const rearLen = BUS_18_SPEC.rear.zFront - BUS_18_SPEC.rear.zRear;
  const bellowsLen = 0.85;
  assert.equal(frontLen, 10.4);
  assert.equal(rearLen, 6.8);
  const totalLength = frontLen + rearLen + bellowsLen;
  assert.ok(Math.abs(totalLength - 18.05) < 0.01, 'total length is ~18.0 m');
  assert.equal(BUS_18_SPEC.front.halfWidth[0][1] * 2, 2.55);
  assert.equal(BUS_18_SPEC.rear.halfWidth[0][1] * 2, 2.55);

  // 4 passenger entrance doors across both sections (2 on front, 2 on rear)
  assert.ok(BUS_18_SPEC.front.door1 && BUS_18_SPEC.front.door2);
  assert.ok(BUS_18_SPEC.rear.door3 && BUS_18_SPEC.rear.door4);

  // 3 axles: Section A steering front and fixed mid axle, Section B drive rear axle
  assert.equal(BUS_18_SPEC.front.axles.length, 2);
  assert.equal(BUS_18_SPEC.front.axles[0], 2.45);
  assert.equal(BUS_18_SPEC.front.axles[1], -3.45);
  assert.equal(BUS_18_SPEC.rear.axles.length, 1);
  assert.equal(BUS_18_SPEC.rear.axles[0], -0.85);
  assert.ok(typeof BUS_18_SPEC.front.wheelZFront === 'number');
  assert.ok(typeof BUS_18_SPEC.front.wheelZMid === 'number');
  assert.ok(typeof BUS_18_SPEC.rear.wheelZRear === 'number');
});

test('BODY_SPECS.fireTruck specifies heavy rescue pumper equipment and truck wheels', () => {
  const spec = BODY_SPECS.fireTruck;
  assert.equal(spec.fireEquipment, true, 'fireEquipment is configured');
  assert.equal(spec.wheelRadius, 0.50, 'truck size wheels (0.50 m)');
  assert.equal(spec.panelVan, true, 'closed equipment body');
});
