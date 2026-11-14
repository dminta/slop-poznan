const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

function harness() {
  const pad = {
    connected: true, mapping: 'standard', index: 0, id: 'test', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  };
  const signals = [];
  const document = { hidden: false, hasFocus: () => true, activeElement: null, addEventListener() {} };
  const controller = {
    activeMode: 'car', clearGamepadInput() {}, setGamepadInput() {},
    toggleCarSignal: (direction) => signals.push(direction)
  };
  const { GamepadControls } = loadModule(readFileSync(join(__dirname, '../js/gamepad-controls.js'), 'utf8'), {
    imports: { './city-config.js': { isTypingInField: ({ target }) => target?.tagName === 'INPUT' } },
    globals: { document, window: { addEventListener() {} }, navigator: { getGamepads: () => [pad] } }
  });
  const controls = new GamepadControls(controller, { resetOrbit() {}, applyGamepadInput() {} });
  const press = (index, pressed) => {
    pad.buttons[index] = { pressed, value: Number(pressed) };
    controls.update(1 / 60);
  };
  return { controls, controller, document, signals, press };
}

test('gamepad D-pad left/right signals once per press and suppresses held buttons after reset', () => {
  const h = harness();
  h.press(14, true);
  assert.deepEqual(h.signals, [], 'connecting while held does not signal');
  h.press(14, false);
  h.press(14, true);
  h.controls.update(1 / 60);
  assert.deepEqual(h.signals, [1]);
  h.controls.reset();
  h.controls.update(1 / 60);
  assert.deepEqual(h.signals, [1]);
  h.press(14, false);
  h.press(15, true);
  assert.deepEqual(h.signals, [1, -1]);
});

test('gamepad signal shortcuts respect mode, typing and disabled map controls', () => {
  const h = harness();
  h.controls.update(1 / 60);
  h.controller.activeMode = 'person';
  h.press(14, true);
  h.press(14, false);
  h.controller.activeMode = 'car';
  h.document.activeElement = { tagName: 'INPUT' };
  h.press(15, true);
  h.press(15, false);
  h.document.activeElement = null;
  h.controls.setEnabled(false);
  h.press(14, true);
  h.press(14, false);
  assert.deepEqual(h.signals, []);
  h.controls.setEnabled(true);
  h.press(14, true);
  assert.deepEqual(h.signals, [1]);
});
