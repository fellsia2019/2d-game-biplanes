import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightLesson, lessonInput, tutorialKey, createTrainingBattle, stepTrainingBattle, LESSON_ACTION_SECONDS } from '../src/tutorial';
import { freshProfile } from '../shared/data';
import { joystickHorizontal, joystickTurn, flightControls } from '../src/controls';
test('Обучение отдельно для аккаунтов и режимов, неверный ввод не проходит шаг', () => {
  assert.notEqual(tutorialKey('one', 'pve'), tutorialKey('one', 'duel')); assert.notEqual(tutorialKey('one', 'pve'), tutorialKey('two', 'pve'));
  const lesson = new FlightLesson('pve');
  for (let i = 0; i < 100; i++) lesson.tick({ turn: 1, fire: true, boost: true }, 1 / 60);
  assert.equal(lesson.step, 1); assert.equal(lesson.progress, 0);
});
for (const mode of ['pve', 'duel'] as const) test(`Быстрое нажатие в ${mode} запоминается до кадра, действие показывается за 0,25 секунды`, () => {
  assert.ok(LESSON_ACTION_SECONDS <= .8 / 3);
  const lesson = new FlightLesson(mode);
  assert.equal(lesson.total, mode === 'pve' ? 6 : 4);
  assert.equal(lesson.trigger({ turn: 1, fire: false, boost: false }), false);
  for (let step = 1; step <= lesson.total; step++) {
    assert.equal(lesson.trigger(lessonInput(step, mode)), true); assert.equal(lesson.demonstrating, true);
    // Key/pointer has already been released; the latched action still plays.
    for (let i = 0; i < 16 && lesson.step === step; i++) lesson.tick(lessonInput(step, mode), 1 / 60);
    assert.equal(lesson.step, step + 1); assert.equal(lesson.progress, 0); assert.equal(lesson.demonstrating, false);
    assert.equal(lesson.complete, step === lesson.total);
  }
  lesson.advance(); assert.equal(lesson.step, lesson.total + 1);
});
test('Подсказки учитывают режим и устройство', () => {
  const career = new FlightLesson('pve'), duel = new FlightLesson('duel');
  assert.equal(career.copy(false).key, 'W'); assert.equal(duel.copy(false).key, 'A');
  assert.match(career.copy(true).text, /контрол вверх/); assert.match(duel.copy(true).text, /контрол вверх/);
  career.advance(); assert.equal(career.copy(false).key, 'S');
  career.advance(); assert.equal(career.copy(false).key, 'A'); assert.match(career.copy(true).text, /контрол влево/);
  career.advance(); assert.equal(career.copy(false).key, 'D'); assert.match(career.copy(true).text, /контрол вправо/);
});
test('Шаги A/D требуют горизонтального ввода и действительно сдвигают самолёт без подъёма, огня или форсажа', () => {
  const profile = freshProfile('learner'), battle = createTrainingBattle('horizontal-lesson', 'pve', profile), lesson = new FlightLesson('pve');
  lesson.advance(); lesson.advance();
  for (const [key, direction] of [['KeyA', -1], ['KeyD', 1]] as const) {
    assert.equal(lesson.trigger({turn:direction, fire:true, boost:true}), false);
    const keyboard = flightControls(battle, new Set([key,'KeyW','Space','ShiftLeft']), new Set());
    const touch = {turn:1, horizontal:joystickHorizontal(direction), fire:false, boost:false};
    assert.equal(lesson.trigger(touch), true);
    const input = lesson.controls(keyboard), before = {...battle.planes[0]};
    for (let i=0; i<16; i++) stepTrainingBattle(battle, profile.id, input, 1/60);
    assert.ok((battle.planes[0].x-before.x)*direction > 0);
    assert.equal(battle.planes[0].y,before.y); assert.equal(battle.bullets.length,0); assert.equal(battle.planes[0].boosting,false);
    assert.equal(lesson.target,'stick'); lesson.advance();
  }
  assert.equal(lesson.target,'fire'); assert.equal(lesson.copy(false).key,'Пробел');
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
