import test from 'node:test';
import assert from 'node:assert/strict';
import { flightControls, joystickHorizontal } from '../src/controls';
const controls = (phase: 'flight' | 'boss' | 'duel', keys: string[], touches: string[] = []) => flightControls({ mode: phase === 'duel' ? 'duel' : 'pve', phase }, new Set(keys), new Set(touches));
test('W/S перемещают по вертикали в карьере, A/D управляют поворотом в дуэли и у боссов', () => {
  assert.equal(controls('flight', ['KeyW']).turn, -1); assert.equal(controls('flight', ['KeyS']).turn, 1);
  assert.equal(controls('flight', ['KeyA', 'KeyD']).turn, 0); assert.equal(controls('flight', ['KeyW', 'KeyS']).turn, 0);
  for (const phase of ['boss', 'duel'] as const) { assert.equal(controls(phase, ['KeyA']).turn, -1); assert.equal(controls(phase, ['KeyD']).turn, 1); assert.equal(controls(phase, ['KeyW']).turn, 0); }
});
test('Стрелки, экранные кнопки, огонь и форсаж работают в обоих режимах', () => {
  for (const phase of ['flight', 'boss', 'duel'] as const) {
    assert.equal(controls(phase, ['ArrowUp']).turn, -1); assert.equal(controls(phase, ['ArrowDown']).turn, 1);
    assert.deepEqual(controls(phase, [], ['left', 'fire', 'boost']), { turn: -1, ...(phase === 'flight' ? {horizontal: 0} : {}), fire: true, boost: true });
    assert.deepEqual(controls(phase, ['Space', 'ShiftRight'], ['right']), { turn: 1, ...(phase === 'flight' ? {horizontal: 0} : {}), fire: true, boost: true });
  }
});

test('A/D и стрелки меняют X только в обычной карьере; джойстик имеет мёртвую зону', () => {
  for (const [key, direction] of [['KeyA', -1], ['KeyD', 1], ['ArrowLeft', -1], ['ArrowRight', 1]] as const) {
    assert.equal(controls('flight', [key]).horizontal, direction);
    assert.equal(controls('flight', [key]).turn, 0);
    assert.equal(controls('boss', [key]).horizontal, undefined);
  }
  assert.equal(controls('flight', ['KeyA', 'KeyD']).horizontal, 0);
  assert.equal(joystickHorizontal(.1), 0); assert.equal(joystickHorizontal(-.8), -1); assert.equal(joystickHorizontal(.8), 1);
});
