import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightLesson, lessonInput, tutorialKey, createTrainingBattle, stepTrainingBattle, LESSON_ACTION_SECONDS } from '../src/tutorial';
import { freshProfile } from '../shared/data';
import { joystickTurn } from '../src/controls';
test('Обучение отдельно для аккаунтов и режимов, неверный ввод не проходит шаг', () => {
  assert.notEqual(tutorialKey('one', 'pve'), tutorialKey('one', 'duel')); assert.notEqual(tutorialKey('one', 'pve'), tutorialKey('two', 'pve'));
  const lesson = new FlightLesson('pve');
  for (let i = 0; i < 100; i++) lesson.tick({ turn: 1, fire: true, boost: true }, 1 / 60);
  assert.equal(lesson.step, 1); assert.equal(lesson.progress, 0);
});
test('Быстрое нажатие запоминается до кадра, действие показывается за 0,25 секунды', () => {
  assert.ok(LESSON_ACTION_SECONDS <= .8 / 3);
  const lesson = new FlightLesson('duel');
  assert.equal(lesson.trigger({ turn: 1, fire: false, boost: false }), false);
  for (let step = 1; step <= 4; step++) {
    assert.equal(lesson.trigger(lessonInput(step)), true); assert.equal(lesson.demonstrating, true);
    // Key/pointer has already been released; the latched action still plays.
    for (let i = 0; i < 16 && lesson.step === step; i++) lesson.tick(lessonInput(step), 1 / 60);
    assert.equal(lesson.step, step + 1); assert.equal(lesson.progress, 0); assert.equal(lesson.demonstrating, false);
  }
  lesson.advance(); assert.equal(lesson.step, 5);
});
test('Подсказки учитывают режим и устройство', () => {
  const career = new FlightLesson('pve'), duel = new FlightLesson('duel');
  assert.equal(career.copy(false).key, 'W'); assert.equal(duel.copy(false).key, 'A');
  assert.match(career.copy(true).text, /контрол вверх/); assert.match(duel.copy(true).text, /контрол вверх/);
  career.advance(); assert.equal(career.copy(false).key, 'S');
});
test('Круговой контрол: мёртвая зона, только высота в карьере и кратчайший поворот в дуэли', () => {
  assert.equal(joystickTurn(true, 0, .1, .1), 0); assert.equal(joystickTurn(true, 0, 1, 0), 0);
  assert.equal(joystickTurn(true, 0, 0, -1), -1); assert.equal(joystickTurn(true, 0, 0, 1), 1);
  assert.equal(joystickTurn(false, 0, 0, -1), -1); assert.equal(joystickTurn(false, 0, 0, 1), 1);
  assert.equal(joystickTurn(false, Math.PI / 2, 0, 1), 0);
  assert.equal(joystickTurn(false, Math.PI - .2, -1, -.1), 1);
});

test('Долгая тренировка не создаёт угроз, наград, смены уровней или изменений профиля', () => {
  const profile = freshProfile('learner'), saved = JSON.stringify(profile);
  for (const mode of ['pve', 'duel'] as const) {
    const battle = createTrainingBattle('lesson', mode, profile);
    for (let i = 0; i < 6000; i++) stepTrainingBattle(battle, profile.id, { turn: i % 100 < 50 ? -1 : 1, fire: true, boost: true }, .04);
    assert.equal(battle.level, 1); assert.equal(battle.phase, mode === 'pve' ? 'flight' : 'duel');
    assert.deepEqual(battle.obstacles, []); assert.deepEqual(battle.earned[profile.id], { silver: 0, xp: 0 });
    assert.equal(battle.planes[0].health, battle.planes[0].hp); assert.equal(JSON.stringify(profile), saved);
  }
});
