import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, resetTasks, ZONE } from '../shared/data';
import { beginBoss, createBattle, makePlane, stepBattle, forfeitDuel, IDLE, FLIGHT_RIGHT, FLIGHT_BOTTOM, normalizeCampaignPlane } from '../shared/simulation';
const human = () => makePlane('pilot', planeStats(freshProfile('pilot')));
test('В зоне ровно 50 уровней и боссы только на 10/25/50', () => {
  assert.equal(ZONE.length, 50);
  assert.deepEqual(ZONE.filter(x => x.boss).map(x => x.level), [10, 25, 50]);
  for (let i = 1; i < ZONE.length; i++) { assert.ok(ZONE[i].enemyHp > ZONE[i - 1].enemyHp); assert.ok(ZONE[i].scroll > ZONE[i - 1].scroll); }
});
test('Переход обычного уровня происходит во время полёта и выдаёт награду один раз', () => {
  const s = createBattle('run', 'pve', [human()]); s.distance = ZONE[0].length;
  const reward = stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(s.level, 2); assert.equal(s.phase, 'flight'); assert.equal(reward[0].silver, 90); assert.equal(reward[0].xp, 34);
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

test('Карьера: старт по центру Y, фиксированный X, горизонтальный огонь и остановка после отпускания', () => {
  const s = createBattle('vertical', 'pve', [human()]), p = s.planes[0];
  assert.equal(p.x, 220); assert.equal(p.y, 675 / 2); assert.equal(p.angle, 0);
  stepBattle(s, { pilot: { turn: -1, fire: true, boost: false } }, .1);
  assert.equal(p.x, 220); assert.equal(p.y, 675 / 2 - p.speed * .1); assert.equal(p.angle, 0);
  assert.equal(s.bullets[0].vy, 0); assert.equal(s.bullets[0].vx, 650);
  const y = p.y; stepBattle(s, { pilot: IDLE }, .1); assert.equal(p.y, y); assert.equal(p.x, 220); assert.ok(s.totalDistance > 0);
  stepBattle(s, { pilot: { turn: 1, fire: false, boost: true } }, .1);
  assert.equal(p.y, y + p.speed * 1.3 * .1); assert.equal(p.x, 220); assert.equal(p.angle, 0);
});
test('Карьера: границы вертикального перемещения и нормализация старого сохранения', () => {
  const s = createBattle('bounds', 'pve', [human()]), p = s.planes[0];
  p.x = 390; p.angle = .7; p.y = 76;
  stepBattle(s, { pilot: { turn: -1, fire: false, boost: false } }, .1);
  assert.equal(p.y, 75); assert.equal(p.x, 390); assert.equal(p.angle, 0);
  p.y = 599; stepBattle(s, { pilot: { turn: 1, fire: false, boost: false } }, .1);
  assert.equal(p.y, FLIGHT_BOTTOM); assert.equal(p.health, 0); assert.equal(s.phase, 'ended');
});
for (const mode of ['duel', 'boss'] as const) test(mode + ': свободный поворот на полный оборот и неподвижная карта', () => {
  const s = createBattle('rotation-' + mode, mode === 'boss' ? 'pve' : 'duel', [human(), makePlane('opponent', planeStats(freshProfile('other')), false, 1)], 10);
  if (mode === 'boss') beginBoss(s);
  const p = s.planes[0]; p.turn = Math.PI * 2; p.speed = 0;
  for (let i = 0; i < 4; i++) { stepBattle(s, { pilot: { turn: 1, fire: false, boost: false } }, .25); if (i === 1) assert.ok(Math.abs(p.angle) > 3); }
  assert.ok(Math.abs(p.angle) < 1e-8); assert.equal(s.totalDistance, 0);
  p.speed = 185; p.angle = -.5; const y = p.y, x = p.x; stepBattle(s, { pilot: IDLE }, .1);
  assert.ok(p.x > x); assert.ok(p.y < y);
});
test('После босса возвращаются вертикальные перемещения, после обычного уровня высота сохраняется', () => {
  const s = createBattle('boss-return', 'pve', [human()], 10); beginBoss(s);
  s.planes[0].x = 700; s.planes[0].y = 220; s.planes[0].angle = 1.5; s.planes[1].health = 0;
  stepBattle(s, { pilot: IDLE }, 1 / 30); const p = s.planes[0];
  assert.equal(s.phase, 'flight'); assert.equal(p.x, 220); assert.equal(p.y, 675 / 2); assert.equal(p.angle, 0);
  stepBattle(s, { pilot: { turn: -1, fire: false, boost: false } }, .1); const y = p.y;
  s.distance = ZONE[10].length; stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(s.level, 12); assert.equal(p.y, y); assert.equal(p.x, 220); assert.equal(p.angle, 0);
});

test('Карьера: D продвигает, A возвращает, отпускание и сохранение удерживают X', () => {
  const s = createBattle('horizontal', 'pve', [human()]), p = s.planes[0]; s.spawn = 100;
  stepBattle(s, {pilot: {...IDLE, horizontal: 1}}, .5);
  assert.equal(p.x, 220 + p.speed * .5); assert.equal(p.angle, 0); assert.equal(p.y, 675/2);
  const x = p.x; stepBattle(s, {pilot: IDLE}, .1); assert.equal(p.x, x);
  const restored = JSON.parse(JSON.stringify(s)); normalizeCampaignPlane(restored.planes[0]); assert.equal(restored.planes[0].x, x);
  s.distance = ZONE[0].length; stepBattle(s, {pilot: IDLE}, 0); assert.equal(p.x, x);
  stepBattle(s, {pilot: {...IDLE, horizontal: -1}}, 1); assert.equal(p.x, 220);
  p.x = FLIGHT_RIGHT - 1; stepBattle(s, {pilot: {...IDLE, horizontal: 1, boost: true}}, .1); assert.equal(p.x, FLIGHT_RIGHT);
});
test('Столкновение на границе уровня не превращается в победу или восстановление у босса', () => {
  for (const level of [1, 10]) {
    const s = createBattle('fatal-boundary', 'pve', [human()], level); s.distance = ZONE[level-1].length; s.spawn = 100;
    s.planes[0].y = 500; s.obstacles = [{id: 1, kind: 'rock', x: 220, y: 626, radius: 72, height: 200, hp: 99999, fire: 100, damage: 0}];
    assert.deepEqual(stepBattle(s, {pilot: IDLE}, 0), []); assert.equal(s.phase, 'ended'); assert.equal(s.level, level); assert.equal(s.planes[0].health, 0);
  }
});
test('Дуэль: таран снимает 50% максимального HP у каждого самолёта', () => {
  const s = createBattle('ram', 'duel', [human(), human()]);
  const [a, b] = s.planes; b.id = 'opponent'; b.bot = false; a.x = b.x = 400; a.y = b.y = 300; a.speed = b.speed = 0;
  a.hp = a.health = 400; b.hp = b.health = 200;
  stepBattle(s, {}, 0); assert.equal(a.health, 200); assert.equal(b.health, 100);
  stepBattle(s, {}, .1); assert.equal(a.health, 200); assert.equal(b.health, 100);
});

test('Боссы патрулируют по разным маршрутам, медленнее игрока, без форсажа и выхода из экрана', () => {
  const signatures: string[] = [];
  for (const level of [10,25,50]) {
    const s = createBattle('boss-route', 'pve', [human()], level); beginBoss(s);
    const [p, bot] = s.planes; p.speed = 0; p.y = 100; p.shield = 9999;
    const path: number[] = [], visited = new Set<number>(); let travelled = 0;
    for (let frame = 0; frame < 1200; frame++) {
      const {x,y} = bot; stepBattle(s, {pilot: IDLE}, 1/30);
      const distance = Math.hypot(bot.x-x,bot.y-y); travelled += distance; visited.add(bot.patrolIndex ?? 0);
      assert.ok(distance <= bot.speed/30 + 1e-8); assert.ok(bot.speed <= 102); assert.equal(bot.boosting, false);
      assert.ok(bot.x > 60 && bot.x < 1140); assert.ok(bot.y >= 75 && bot.y < 570); assert.ok(bot.health > 0);
      if (frame % 120 === 0) path.push(Math.round(bot.x),Math.round(bot.y));
    }
    assert.ok(travelled > bot.speed * 39); assert.ok(visited.size >= 3); signatures.push(path.join(','));
  }
  assert.equal(new Set(signatures).size,3);
});
