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

// The only real three.js geometry surface the tests need: buildCarSidePatch's buffer, index and vertex normals
class TestBufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
  }
  get count() { return this.array.length / this.itemSize; }
}

class TestBufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
  }
  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  setIndex(index) { this.index = index; return this; }
  computeVertexNormals() {
    const p = this.attributes.position.array;
    const normals = new Float32Array(p.length);
    for (let i = 0; i < this.index.length; i += 3) {
      const a = this.index[i] * 3, b = this.index[i + 1] * 3, c = this.index[i + 2] * 3;
      const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
      const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      for (const v of [a, b, c]) {
        normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz;
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
      normals[i] /= l; normals[i + 1] /= l; normals[i + 2] /= l;
    }
    this.attributes.normal = new TestBufferAttribute(normals, 3);
    return this;
  }
}

const THREE = inert();
THREE.BufferGeometry = TestBufferGeometry;
THREE.Float32BufferAttribute = TestBufferAttribute;

const {
  BODY_SPECS, BUS_SPEC, BUS_18_SPEC, EMERGENCY_PAINT, LETTERING, LETTERING_ROWS, carDimensions,
  PLATE_FONT_FAMILY, polishRegistration, encodeRegistration, drawPoznanCrest, drawPoliceStar,
  drawPrmBadge, drawPspBadge, drawPrmTeamBadge, buildCarSidePatch
} = loadModule(
  readFileSync(join(__dirname, '../js/actor-models.js'), 'utf8'),
  {
    imports: {
      'three/webgpu': THREE,
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

test('Poznań crest draws the city arms in the statutory colours', () => {
  const fills = [], strokes = [], rects = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {},
    fill() { fills.push(this.fillStyle); },
    stroke() { strokes.push(this.strokeStyle); },
    fillRect() { rects.push(this.fillStyle); }
  };
  drawPoznanCrest(ctx, 0, 0, 100, 133);
  assert.ok(fills.includes('#0091c9'), 'official city blue field');
  assert.ok(fills.includes('#eef3f7'), 'white walls, towers and saints');
  assert.ok(fills.includes('#e8b923'), 'gold crown, keys, stars and crescents');
  assert.ok(fills.includes('#b4222c'), 'red gothic shield of the Piast eagle');
  assert.ok(strokes.includes('#006b96') && strokes.includes('#e8b923'), 'shield rim and gold details');
  assert.ok(rects.length > 8, 'three crenellated towers and the wall');
});

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

test('taxi side patches face out on both sides and keep their lettering upright', () => {
  const spec = BODY_SPECS.taxi;
  const z0 = spec.doors[2] + 0.06, z1 = spec.doors[0] - 0.05;
  const nz = 10, ny = 6;
  for (const side of [-1, 1]) {
    const g = buildCarSidePatch(spec, side, z0, z1, 0.55, 0.72, 0.003, nz, ny);
    const p = g.attributes.position.array;
    const uv = g.attributes.uv.array;
    const n = g.attributes.normal.array;
    const index = g.index;
    assert.ok(index.length > 0, `side ${side} has triangles`);
    for (let i = 0; i < p.length; i += 3) {
      assert.equal(Math.sign(p[i]), side, `side ${side} vertex sits on its own side`);
    }
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3;
      const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
      const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
      const nx = aby * acz - abz * acy;
      assert.ok(nx * side > 0, `side ${side} triangle ${i / 3} winds outward`);
    }
    for (let i = 0; i < n.length; i += 3) {
      assert.ok(n[i] * side > 0, `side ${side} vertex normal ${i / 3} points outward`);
    }
    // From outside the car, +x is viewed with -z to the right and -x with +z to the right (front is +z), so u must
    // rise as z moves that way for text drawn left to right on a per-side canvas.
    const cols = nz + 1;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nz; i++) {
        const a = (j * cols + i) * 2, b = (j * cols + i + 1) * 2;
        const az = p[(j * cols + i) * 3 + 2], bz = p[(j * cols + i + 1) * 3 + 2];
        assert.ok(uv[a] < uv[b], 'u rises along the texture');
        assert.ok((bz - az) * side < 0, `side ${side} u runs to the viewer's right`);
      }
    }
    for (let i = 0; i < cols; i++) {
      assert.ok(p[i * 3 + 1] < p[(cols + i) * 3 + 1], 'v rises with y');
      assert.ok(uv[i * 2 + 1] < uv[(cols + i) * 2 + 1], 'v rises with the texture');
    }
  }
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

test('emergency base paints are the statutory Policja silver, PRM yellow and PSP red', () => {
  assert.equal(EMERGENCY_PAINT.length, 4, 'index 0 is the ordinary-car sentinel');
  const [silver, yellow, red] = [EMERGENCY_PAINT[1], EMERGENCY_PAINT[2], EMERGENCY_PAINT[3]];
  assert.notEqual(silver, yellow);
  assert.notEqual(silver, red);
  assert.notEqual(yellow, red);
  const parts = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
  const [sr, sg, sb] = parts(silver);
  assert.ok(Math.abs(sr - sg) < 8 && Math.abs(sg - sb) < 12 && sr > 180, 'silver is near-neutral and light');
  const [yr, yg, yb] = parts(yellow);
  assert.ok(yr > 220 && yg > 210 && yb < 80, 'PRM yellow (CMYK 10/0/90/0, RAL 1016 class)');
  const [rr, rg, rb] = parts(red);
  assert.ok(rr > 140 && rg < 40 && rb < 40, 'PSP signal red (RAL 3000 class)');
});

test('emergency lettering atlas carries every statutory word and mark', () => {
  for (const word of ['POLICJA', 'AMBULANS', 'STRAŻ', '998', 'ZESPÓŁ RATOWNICTWA MEDYCZNEGO']) {
    assert.ok(LETTERING.includes(word), word);
  }
  assert.equal(LETTERING[LETTERING_ROWS.POLICE], 'POLICJA');
  assert.equal(LETTERING[LETTERING_ROWS.AMBULANS], 'AMBULANS');
  assert.equal(LETTERING[LETTERING_ROWS.STRAZ], 'STRAŻ');
  assert.equal(LETTERING[LETTERING_ROWS.PRM_TEAM], 'ZESPÓŁ RATOWNICTWA MEDYCZNEGO');
  assert.equal(LETTERING[LETTERING_ROWS.EMERGENCY], '998');
  assert.equal(LETTERING[LETTERING_ROWS.TAXI], 'TAXI');
});

function recordingContext() {
  const calls = { fills: [], strokes: [], texts: [] };
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, ellipse() {},
    fill() { calls.fills.push(this.fillStyle); },
    stroke() { calls.strokes.push(this.strokeStyle); },
    fillRect() { calls.fills.push(this.fillStyle); },
    strokeRect() { calls.strokes.push(this.strokeStyle); },
    fillText(text) { calls.texts.push({ text, fill: this.fillStyle }); }
  };
  return { ctx, calls };
}

test('emergency badges draw the Policja star, PRM star of life, PSP shield and P roundel', () => {
  const police = recordingContext();
  drawPoliceStar(police.ctx, 0, 0, 128, 128);
  assert.ok(police.calls.fills.includes('#dfe4e8'), 'silver star');
  assert.ok(police.calls.fills.includes('#1d3f8f'), 'blue star centre');
  assert.ok(police.calls.texts.some((t) => t.text === 'POLICJA' && t.fill === '#f4f6f8'));

  const prm = recordingContext();
  drawPrmBadge(prm.ctx, 0, 0, 128, 128);
  assert.ok(prm.calls.fills.includes('#f4f6f8'), 'white roundel');
  assert.ok(prm.calls.fills.includes('#1f4fbf'), 'blue six-point star of life');
  assert.ok(prm.calls.strokes.includes('#f4f6f8'), 'white staff and serpent');

  const psp = recordingContext();
  drawPspBadge(psp.ctx, 0, 0, 128, 128);
  assert.ok(psp.calls.fills.includes('#ab1017'), 'red shield');
  assert.ok(psp.calls.fills.includes('#f2c81a'), 'gold flame');
  assert.ok(psp.calls.fills.includes('#f4f6f8'), 'white flame core');

  const team = recordingContext();
  drawPrmTeamBadge(team.ctx, 0, 0, 128, 128);
  assert.ok(team.calls.strokes.includes('#c8161e'), 'red 4 cm roundel');
  assert.ok(team.calls.texts.some((t) => t.text === 'P' && t.fill === '#c8161e'));
});

test('the shared car material paints statutory bands and keeps one instanced draw path', () => {
  const source = readFileSync(join(__dirname, '../js/actor-models.js'), 'utf8');
  const shader = source.slice(source.indexOf('// ---- Colour'), source.indexOf('// Panel shading'));
  for (const token of ['policeBandArea', 'policeRect', 'policeFluoro', 'prmRed', 'prmBlue', 'prmRoof',
    'pspBandArea', 'pspYellow', 'emergencyBadgeTexture', 'carLetteringTexture']) {
    assert.ok(shader.includes(token), token);
  }
  assert.match(shader, /0x1d3f8f/, 'Policja reflective blue');
  assert.match(shader, /0xc8f000/, 'fluorescent yellow-green');
  assert.match(shader, /0xc8161e/, 'PRM red');
  assert.match(shader, /0x1f4fbf/, 'PRM blue');
  assert.match(shader, /0xf2c81a/, 'PSP yellow');
  assert.match(shader, /0xf4f6f8/, 'reflective white');
  const traffic = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
  assert.match(traffic, /EMERGENCY_PAINT\[1\]/, 'traffic uses the shared Policja paint');
  assert.match(traffic, /EMERGENCY_PAINT\[2\]/, 'traffic uses the shared PRM paint');
  assert.match(traffic, /EMERGENCY_PAINT\[3\]/, 'traffic uses the shared PSP paint');
});
