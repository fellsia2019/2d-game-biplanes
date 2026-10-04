import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_UPGRADE_LEVEL, BOSS_LEVELS, CAMPAIGN_LEVELS, CAMPAIGN_REGIONS, CAREER_STAGES, ZONE, bossBalance, bossReferenceAircraft, campaignAircraft, campaignLevel, campaignReward, careerStage, freshProfile, planeStats } from '../shared/data';
import { campaignEncounter, GROUND_Y, PVO_MODELS, pvoModelsForLevel, ROCK_MAX_HEIGHT, rockPoints } from '../shared/terrain';
import { createBattle, finishBossReward, IDLE, makePlane, startBossFight, stepBattle } from '../shared/simulation';
import { weaponBenchmark } from '../scripts/balance-report';
import { modifierBonuses } from '../shared/modifiers';
import { readyLastSortie } from './fixtures';
import { operationPlan } from '../shared/operations';

test('250-level route has eleven contiguous stages, with a boss every25 levels after50', () => {
  assert.equal(CAMPAIGN_LEVELS, 250); assert.equal(ZONE.length, 250);
  assert.deepEqual(BOSS_LEVELS, [10, 25, 50, 75, 100, 125, 150, 175, 200, 225, 250]);
  assert.deepEqual(ZONE.filter(level => level.boss).map(level => level.level), BOSS_LEVELS);
  assert.equal(CAREER_STAGES.length, 11);
  let previous = 0;
  for (const stage of CAREER_STAGES) {
    assert.equal(stage.start, previous + 1); assert.equal(stage.end, BOSS_LEVELS[stage.number - 1]);
    for (let level = stage.start; level <= stage.end; level++) assert.equal(careerStage(level), stage);
    previous = stage.end;
  }
  assert.equal(previous, CAMPAIGN_LEVELS);
});

test('Long operations retain a gentle opening, named bosses and separate half campaign rewards', () => {
  const first = campaignLevel(1);
  assert.equal(first.name,'Лазурные острова'); assert.equal(first.enemyHp,24); assert.equal(first.enemyDamage,5); assert.equal(first.spawn,4.8);
  assert.equal(first.length/first.scroll,45); assert.equal(first.boss,null);
  assert.equal(bossBalance(10).name,'Капитан Буря'); assert.equal(bossBalance(25).name,'Алый охотник'); assert.equal(bossBalance(50).name,'Командор');
  for (const level of ZONE) {
    assert.equal(level.rewardSilver,180); assert.equal(level.rewardXp,80);
    assert.equal(campaignReward(level.rewardSilver),90); assert.equal(campaignReward(level.rewardXp),40);
    if (level.boss) {
      assert.equal(campaignReward(level.boss.silver),Math.round(level.boss.silver/2));
      assert.equal(campaignReward(level.boss.xp),Math.round(level.boss.xp/2));
    }
  }
  assert.equal(campaignReward(ZONE[249].boss!.silver),7500);
});

test('Generated levels are deterministic with bounded sorties and smooth threat between aircraft unlocks', () => {
  for (const level of ZONE) {
    assert.deepEqual(campaignLevel(level.level), level);
    if (level.level > 50) assert.deepEqual(campaignEncounter(level.level), level.encounter);
    const previous = ZONE[level.level - 2];
    if (previous) {
      assert.ok(level.enemyHp > previous.enemyHp && level.scroll > previous.scroll);
      const aircraft = campaignAircraft(level.level), previousAircraft = campaignAircraft(previous.level);
      assert.ok((level.enemyHp/aircraft.damage)/(previous.enemyHp/previousAircraft.damage)<1.04, 'No jump in required hits relative to the available free aircraft');
      assert.ok((level.enemyDamage/aircraft.hp)/(previous.enemyDamage/previousAircraft.hp)<1.04, 'No damage spike relative to the available free aircraft');
    }
    assert.ok(Math.abs(level.length/level.scroll-operationPlan(level.level).seconds)<1e-9, 'Flight distance matches its 45/90-second sortie');
    for (const key of ['length', 'scroll', 'spawn', 'enemyHp', 'enemyDamage', 'mobCooldown', 'pvoCooldown', 'rewardSilver', 'rewardXp', 'killSilver', 'killXp'] as const) {
      assert.ok(Number.isFinite(level[key]) && level[key] > 0, `${level.level}: ${key}`);
    }
    for (const key of ['rewardSilver', 'rewardXp', 'killSilver', 'killXp'] as const) assert.ok(Number.isInteger(level[key]));
  }
  assert.throws(() => campaignLevel(0), RangeError); assert.throws(() => campaignLevel(251), RangeError);
  assert.throws(() => campaignLevel(50.5), RangeError); assert.throws(() => campaignLevel(NaN), RangeError);
});

test('Eight new regions provide repeatable varied encounters, palettes and regular easier flights', () => {
  const tail = CAMPAIGN_REGIONS.slice(3);
  assert.equal(tail.length, 8); assert.equal(new Set(tail.map(region => region.name)).size, 8);
  assert.equal(new Set(tail.map(region => JSON.stringify(region.scenery))).size, 8);
  for (const region of tail) {
    const levels = ZONE.slice(region.start - 1, region.end);
    assert.equal(levels.length, 25); assert.equal(levels.filter(level => (level.level - region.start) % 5 === 0 && level.encounter?.theme === 'open-sky').length, 5);
    assert.ok(new Set(levels.map(level => level.encounter!.theme)).size >= 3);
    for (const level of levels) assert.equal(level.name, region.name);
    assert.equal(levels.at(-1)!.boss!.name, bossBalance(region.end).name);
    assert.ok(region.scenery);
    for (const triplet of [region.scenery.skyTop, region.scenery.skyBottom]) for (const channel of triplet) assert.ok(channel >= 0 && channel <= 255);
  }
  assert.equal(new Set(ZONE.slice(50).map(level => level.encounter!.seed)).size, 200);
  assert.equal(new Set(BOSS_LEVELS.slice(3).map(level => bossBalance(level).pattern)).size, 4);
  assert.equal(new Set(BOSS_LEVELS.slice(3).map(level => bossBalance(level).appearance)).size, 3);
});

test('Hazard limits leave a wide clear upper corridor and retain all three PVO models', () => {
  for (const level of ZONE.slice(50)) {
    const encounter = level.encounter!;
    assert.ok(encounter.rockChance + encounter.pvoChance + encounter.heavyChance < .6);
    assert.ok(encounter.pvoChance <= .24); assert.ok(encounter.spacingMultiplier >= 1);
    assert.ok(encounter.minRockHeight >= 140 && encounter.maxRockHeight <= ROCK_MAX_HEIGHT);
    for (const id of [0, 1, 2]) {
      const points = rockPoints({id, x: 600, radius: 72, height: encounter.maxRockHeight});
      assert.ok(Math.min(...points.map(point => point.y)) - 22 - 18 > 300, 'Tallest rock allows over225px of clear flight altitude');
    }
    assert.equal(GROUND_Y - encounter.maxRockHeight, Math.min(...rockPoints({id: 0, x: 600, radius: 72, height: encounter.maxRockHeight}).map(point => point.y)));
    assert.deepEqual(pvoModelsForLevel(level.level), PVO_MODELS);
  }
});

test('Actual tail hazard sequences and rock geometry repeat despite different session IDs and critical firing', () => {
  function hazards(level: number, session: string, fire: boolean) {
    // An observation fixture, not the earned-progression playthrough. Keep the
    // observer out of the encounter lanes so shooting cannot remove a sample.
    const stats = planeStats(freshProfile('observer'));
    const plane = makePlane('pilot', {...stats, hp: 10000, traits: modifierBonuses([{id: 'critical-strike', level: 1}])});
    const state = createBattle(session, 'pve', [plane], level); plane.y = 85; plane.speed = 0;
    const seen = new Set<number>(), result: Array<unknown> = [];
    for (let frame = 0; frame < 1800 && result.length < 4; frame++) {
      stepBattle(state, {pilot: {turn: 0, fire, boost: false}}, 1 / 30);
      for (const obstacle of state.obstacles) if (!seen.has(obstacle.id)) {
        seen.add(obstacle.id);
        result.push({kind: obstacle.kind, y: obstacle.y, hp: obstacle.hp, damage: obstacle.damage,
          height: obstacle.height, pvoModel: obstacle.pvoModel,
          outline: obstacle.kind === 'rock' ? rockPoints({...obstacle, x: 0}) : undefined});
      }
    }
    assert.equal(state.level, level); assert.ok(result.length >= 4); return result;
  }
  for (let level = 51; level <= CAMPAIGN_LEVELS; level++) {
    assert.deepEqual(hazards(level, 'quiet-' + level, false), hazards(level, 'firing-' + level, true), 'Terrain changed with combat input at level' + level);
  }
});

test('The available fully upgraded free aircraft covers HP, damage and boss response without paid bonuses', () => {
  for (const level of ZONE) {
    const aircraft=level.boss?bossReferenceAircraft(level.level):campaignAircraft(level.level);
    const profile=freshProfile('free'); profile.selected=aircraft.id; profile.owned=[aircraft.id];
    profile.upgrades[aircraft.id]={hull:MAX_UPGRADE_LEVEL,engine:MAX_UPGRADE_LEVEL,gun:MAX_UPGRADE_LEVEL};
    const stats=planeStats(profile,true), weapon=weaponBenchmark(aircraft.id,MAX_UPGRADE_LEVEL,'');
    assert.equal(stats.rewardMultiplier,1); assert.equal(profile.module,''); assert.equal(stats.traits?.damage??0,0);
    assert.ok(Math.ceil(level.enemyHp / stats.damage) <= 6);
    assert.ok(Math.ceil(level.enemyHp * 2 / stats.damage) <= 12);
    assert.ok(Math.ceil(stats.hp / level.enemyDamage) >= 12);
    if (level.boss) {
      assert.ok(Math.ceil(stats.hp / level.boss.damage) >= 8);
      assert.ok(level.boss.speed < stats.speed / 2);
      assert.ok(level.boss.cooldown >= 1 && level.boss.windup >= .35);
      assert.ok(weapon.dps>0 && level.boss.hp/(weapon.dps*.4)<=190, `Boss ${level.level} exceeds 190s at 40% hits with its free aircraft`);
    }
  }
});

test('Every level can advance without NaN, and50 is an intermediate reward gate while250 is final', () => {
  for (const level of ZONE) {
    const plane = makePlane('pilot', planeStats(freshProfile('pilot')));
    const state = createBattle(`boundary-${level.level}`, 'pve', [plane], level.level);
    state.distance = level.length; state.spawn = 999; readyLastSortie(state);
    stepBattle(state, {pilot: IDLE}, 0);
    if (!level.boss) {
      assert.equal(state.level, level.level + 1); assert.equal(state.phase, 'flight');
    } else {
      assert.equal(state.phase, 'boss-intro'); assert.equal(state.planes[1].hp, level.boss.hp);
      startBossFight(state); state.planes[1].health = 0;
      const rewards = stepBattle(state, {pilot: IDLE}, 0);
      assert.equal(rewards.filter(reward => reward.bossLevel === level.level).length, 1);
      assert.equal(state.phase, 'reward'); assert.equal(state.rewardNextPhase, level.level === CAMPAIGN_LEVELS ? 'ended' : 'flight');
      finishBossReward(state);
      assert.equal(state.phase, level.level === CAMPAIGN_LEVELS ? 'ended' : 'flight');
      if (level.level < CAMPAIGN_LEVELS) assert.equal(state.level, level.level + 1);
    }
    assert.ok(Number.isFinite(state.planes[0].health)); assert.ok(Number.isFinite(state.distance));
  }
});
