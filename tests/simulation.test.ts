import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, resetTasks, ZONE } from '../shared/data';
import { beginBoss, createBattle, makePlane, stepBattle, forfeitDuel, IDLE } from '../shared/simulation';
const human = () => makePlane('pilot', planeStats(freshProfile('pilot')));
test('В зоне ровно 50 уровней и боссы только на 10/25/50', () => {
  assert.equal(ZONE.length, 50);
  assert.deepEqual(ZONE.filter(x => x.boss).map(x => x.level), [10, 25, 50]);
  for (let i = 1; i < ZONE.length; i++) { assert.ok(ZONE[i].enemyHp > ZONE[i - 1].enemyHp); assert.ok(ZONE[i].scroll > ZONE[i - 1].scroll); }
});
test('Переход обычного уровня происходит во время полёта и выдаёт награду один раз', () => {
  const s = createBattle('run', 'pve', [human()]); s.distance = ZONE[0].length;
  const reward = stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(s.level, 2); assert.equal(s.phase, 'flight'); assert.equal(reward[0].silver, 20); assert.equal(reward[0].xp, 10);
  assert.equal(stepBattle(s, { pilot: IDLE }, 1 / 30).length, 0);
});
for (const level of [10, 25, 50]) test('Босс ' + level + ': остановка карты, дуэль и правильный переход', () => {
  const s = createBattle('boss-' + level, 'pve', [human()], level); s.distance = ZONE[level - 1].length;
  stepBattle(s, { pilot: IDLE }, 1 / 30); assert.equal(s.phase, 'boss'); assert.equal(s.planes.length, 2);
  const distance = s.totalDistance;
  stepBattle(s, { pilot: IDLE }, 1 / 30); assert.equal(s.totalDistance, distance);
  s.planes[1].health = 0;
  const rewards = stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(rewards.length, 2); assert.equal(s.phase, level === 50 ? 'ended' : 'flight');
  assert.equal(s.level, level === 50 ? 50 : level + 1);
  assert.equal(stepBattle(s, { pilot: IDLE }, 1 / 30).length, 0);
});
test('Точная контрольная точка восстанавливает бой без повторных наград', () => {
  const s = createBattle('checkpoint', 'pve', [human()], 10); beginBoss(s); s.planes[1].health = 83; s.earned.pilot = { silver: 333, xp: 111 }; s.paused = true;
  const restored = JSON.parse(JSON.stringify(s));
  assert.equal(restored.planes[1].health, 83); assert.equal(restored.earned.pilot.silver, 333);
  assert.deepEqual(stepBattle(restored, { pilot: IDLE }, 1 / 30), []); assert.equal(restored.time, s.time);
});
test('Пауза замораживает движение, пули, врагов и таймер', () => {
  const s = createBattle('paused', 'pve', [human()]); s.paused = true; const before = JSON.stringify(s);
  stepBattle(s, { pilot: { turn: 1, fire: true, boost: true } }, 1);
  assert.equal(JSON.stringify(s), before);
});
test('Смерть игрока в PvE завершает забег и не выдаёт награду победителя', () => {
  const s = createBattle('death', 'pve', [human()], 25); beginBoss(s); s.planes[0].health = 0;
  assert.deepEqual(stepBattle(s, {}, 1 / 30), []); assert.equal(s.phase, 'ended'); assert.equal(s.result, 'Самолёт потерян');
});
test('Дуэль заканчивается на 3 победах и не награждает повторно', () => {
  const s = createBattle('duel', 'duel', [human(), makePlane('bot', planeStats(freshProfile('bot')), true, 1)]);
  s.planes[0].score = 2; s.planes[1].health = 0;
  s.activity.pilot = 10;
  const rewards = stepBattle(s, {}, 1 / 30); assert.equal(s.phase, 'ended'); assert.equal(s.planes[0].score, 3);
  assert.equal(rewards.find(r => r.kind === 'duel')?.silver, 120);
  assert.deepEqual(stepBattle(s, {}, 1 / 30), []);
});
test('Задачи сбрасываются в UTC независимо от локального часового пояса', () => {
  const p = freshProfile('pilot'); resetTasks(p, new Date('2026-10-04T23:59:59Z')); p.daily.kills = 5; p.weekly.levels = 8;
  resetTasks(p, new Date('2026-10-05T00:00:00Z')); assert.equal(p.daily.kills, 0); assert.equal(p.weekly.levels, 0);
  assert.equal(p.daily.key, '2026-10-05'); assert.equal(p.weekly.key, '2026-10-05');
});
test('Бездействие в дуэли не выдаёт валюту и опыт', () => {
  const s = createBattle('afk', 'duel', [human(), makePlane('bot', planeStats(freshProfile('bot')), true, 1)]);
  s.time = 120; s.planes[0].score = 3;
  assert.deepEqual(stepBattle(s, {}, 1 / 30), []); assert.equal(s.earned.pilot.silver, 0); assert.equal(s.phase, 'ended');
});
test('Перегрев блокирует выстрел до охлаждения', () => {
  const s = createBattle('heat', 'pve', [human()]); const plane = s.planes[0]; plane.heat = .99;
  stepBattle(s, { pilot: { turn: 0, fire: true, boost: false } }, 1 / 30); assert.equal(plane.overheated, true);
  const shots = s.effects.filter(e => e.kind === 'shot').length;
  for (let i = 0; i < 20; i++) stepBattle(s, { pilot: { turn: 0, fire: true, boost: false } }, 1 / 30);
  assert.equal(s.effects.filter(e => e.kind === 'shot').length, shots);
});
test('Выход из онлайн-дуэли не лишает активного соперника награды и не выдаёт её дважды', () => {
  const s = createBattle('forfeit', 'duel', [human(), makePlane('second', planeStats(freshProfile('second')), false, 1)]);
  s.activity.pilot = 6; s.activity.second = 6;
  const rewards = forfeitDuel(s, 'second');
  assert.equal(rewards.find(r => r.player === 'pilot')?.silver, 120);
  assert.equal(rewards.find(r => r.player === 'second')?.silver, 70);
  assert.deepEqual(forfeitDuel(s, 'second'), []);
});
