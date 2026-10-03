import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, PLANES, MAX_UPGRADE_LEVEL } from '../shared/data';
import { beginBoss, createBattle, IDLE, makePlane, stepBattle, angleDiff } from '../shared/simulation';

const DT = 1 / 30;
function duel(seed = 7, model = 'universal') {
  const profile = freshProfile('pilot'); profile.selected = model;
  const stats = planeStats(profile);
  const battle = createBattle('duel-controller', 'duel', [makePlane('pilot', stats), makePlane('bot', stats, true, 1)]);
  battle.seed = seed;
  return battle;
}

test('Дуэльный бот замечает смену направления через 250–300 мс', () => {
  const battle = duel(), [target, bot] = battle.planes;
  // Isolate steering from translation: the opponent abruptly crosses the aim line.
  target.x = 800; target.y = 430; target.speed = 0;
  bot.x = 600; bot.y = 330; bot.angle = 0; bot.speed = 0;
  stepBattle(battle, {pilot: IDLE}, DT);
  target.y = 230;
  let reactedAt = 0;
  for (let frame = 1; frame <= 12; frame++) {
    const before = bot.angle;
    stepBattle(battle, {pilot: IDLE}, DT);
    if (angleDiff(bot.angle, before) < -1e-6) { reactedAt = frame * DT; break; }
  }
  assert.ok(reactedAt >= .25 && reactedAt <= .3 + 1e-12, `Реакция: ${reactedAt}s`);
});

test('Решения воспроизводимы по seed и не используют идеальное непрерывное прицеливание', () => {
  function run(seed: number) {
    const battle = duel(seed);
    const trace: number[][] = [];
    for (let frame = 0; frame < 360; frame++) {
      stepBattle(battle, {pilot:{turn:frame % 150 < 50 ? 1 : 0, fire:true, boost:false}}, DT);
      const bot = battle.planes[1];
      assert.ok(Math.abs(bot.duelDecision!.aimError) <= Math.PI / 18 + 1e-12);
      trace.push([bot.x, bot.y, bot.angle, bot.health, battle.seq]);
    }
    return trace;
  }
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(42));
});

test('Каждый бот сохраняет попадания и даёт паузы между очередями', () => {
  for (const model of PLANES) {
    const battle = duel(7, model.id), [target, bot] = battle.planes;
    // A stationary target is a weapon sanity check, not a human win-rate model.
    target.x = 850; target.y = 330; target.speed = 0;
    bot.x = 600; bot.y = 330; bot.angle = 0; bot.speed = 0;
    const seen = new Set<number>(), shots: number[] = [];
    let hits = 0;
    for (let frame = 0; frame < 180 && target.health > 0; frame++) {
      const before = target.health;
      stepBattle(battle, {pilot: IDLE}, DT);
      if (target.health < before) hits++;
      for (const effect of battle.effects) if (effect.kind === 'shot' && !seen.has(effect.id)) {
        seen.add(effect.id); shots.push(battle.time);
      }
    }
    assert.ok(shots.length >= 8, `${model.id}: ${shots.length} выстрелов`);
    assert.ok(hits >= 3, `${model.id}: ${hits} попаданий`);
    assert.ok(shots.slice(1).some((time, i) => time - shots[i] >= .4), `${model.id}: нет паузы между очередями`);
  }
});

test('Замедленная реакция не отменяет избегание земли для всех корпусов', () => {
  for (const model of PLANES) for (const engine of [0, MAX_UPGRADE_LEVEL]) {
    const profile = freshProfile('pilot'); profile.selected = model.id;
    profile.upgrades[model.id] = {hull:0, gun:0, engine};
    const stats = planeStats(profile);
    const battle = createBattle('ground-safety', 'duel', [makePlane('pilot', stats), makePlane('bot', stats, true, 1)]);
    const [target, bot] = battle.planes;
    target.x = 200; target.y = 200;
    bot.x = 1000; bot.y = 490; bot.angle = Math.PI / 2;
    for (let frame = 0; frame < 90; frame++) {
      stepBattle(battle, {pilot: IDLE}, DT);
      assert.ok(bot.health > 0, `${model.id}/${engine}: авария на кадре ${frame}`);
    }
  }
});

test('Маршрут и выстрелы босса не меняются из-за послабления дуэльных ботов', () => {
  const battle = createBattle('boss-controller-regression', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))], 10);
  beginBoss(battle);
  for (let frame = 0; frame < 30; frame++) stepBattle(battle, {pilot: IDLE}, DT);
  const boss = battle.planes[1];
  for (const [field, expected] of Object.entries({x:937.9463728817891, y:256.8727316952197, angle:-1.9515926535897947, shot:.19999999999999962})) {
    assert.ok(Math.abs(boss[field as 'x' | 'y' | 'angle' | 'shot'] - expected) < 1e-8, field);
  }
  assert.equal(boss.health, 650);
  assert.equal(battle.seed, 3727844267);
});
