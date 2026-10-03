import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPGRADE_LEVEL, PLANES, freshProfile, planeStats } from '../shared/data';
import { duelBotStats } from '../server/duel-bot';
import { buyModule, equipModule } from '../server/economy';

test('Стартовый самолёт встречает случайно Сокол или Стриж, без дорогих и золотых моделей', () => {
  const profile = freshProfile('pilot');
  const models = new Set(Array.from({ length: 100 }, (_, i) => duelBotStats(profile, () => i / 100).model));
  assert.deepEqual([...models], ['universal', 'swift']);
});

test('Для каждого самолёта и уровня улучшений бот остаётся в пределах 10% силы игрока', () => {
  for (const model of PLANES) for (const upgrades of [0, 5, MAX_UPGRADE_LEVEL, MAX_UPGRADE_LEVEL + 5]) {
    const profile = freshProfile('pilot'); profile.selected = model.id;
    profile.owned = [...new Set([...profile.owned, model.id])]; profile.gold = 240;
    profile.upgrades[model.id] = { hull: upgrades, engine: upgrades, gun: upgrades };
    buyModule(profile, 'radiator'); buyModule(profile, 'carburetor');
    equipModule(profile, upgrades ? 'radiator' : 'carburetor');
    const player = planeStats(profile), before = structuredClone(profile);
    for (let i = 0; i < 100; i++) {
      const bot = duelBotStats(profile, () => i / 100);
      const botModel = PLANES.find(p => p.id === bot.model)!;
      assert.ok(botModel);
      assert.ok(Math.abs(PLANES.indexOf(botModel) - PLANES.indexOf(model)) <= 1);
      if (model.currency !== 'gold') assert.notEqual(botModel.currency, 'gold');
      for (const key of ['hp', 'speed', 'turn', 'damage'] as const) assert.ok(bot[key] / player[key] >= .9 - 1e-12 && bot[key] / player[key] <= 1.1 + 1e-12, `${model.id}: ${key}`);
      for (const key of ['cooling', 'boostDuration', 'boostRecharge'] as const) assert.equal(bot[key], player[key]);
    }
    assert.deepEqual(profile, before);
  }
});

test('Выбор модели делает новый бросок для каждого боя', () => {
  const profile = freshProfile('pilot'); profile.selected = 'yantar';
  let calls = 0;
  const random = () => [0, .5, .999][calls++ % 3];
  assert.deepEqual(Array.from({ length: 3 }, () => duelBotStats(profile, random).model), ['swift', 'yantar', 'bastion']);
  assert.equal(calls, 3);
});
