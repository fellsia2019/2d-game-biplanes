import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, makePlane, stepBattle } from '../shared/simulation';
import { armMissionIntro, finishMissionIntro, missionKey, MissionIntroClock } from '../shared/mission-intro';
const flight = () => createBattle('briefing', 'pve', [makePlane('pilot', {model:'trainer', hp:100, speed:200, turn:2, damage:10})], 3);

test('mission briefing freezes authoritative simulation including incoming damage and objective time', () => {
  const battle = flight(), pilot = battle.planes[0];
  battle.bullets.push({id:1, owner:'enemy', x:pilot.x, y:pilot.y, vx:0, vy:0, damage:80, life:3});
  pilot.shield = 0; armMissionIntro(battle);
  const frozen = structuredClone(battle);
  for (let n=0;n<180;n++) assert.deepEqual(stepBattle(battle, {}, 1/30), []);
  assert.deepEqual(battle, frozen);
  assert.equal(finishMissionIntro(battle, 'old-sortie', false), false);
  assert.equal(battle.paused, true);
  assert.equal(finishMissionIntro(battle, missionKey(battle), false), true);
  assert.equal(battle.paused, false); assert.equal(battle.missionIntro, undefined);
  stepBattle(battle, {}, 1/30); assert.ok(battle.time > 0);
});

test('new sorties get distinct gates; completing briefing preserves another pause', () => {
  const battle = flight(); armMissionIntro(battle); const old = battle.missionIntro;
  battle.operation!.completed++; armMissionIntro(battle);
  assert.notEqual(battle.missionIntro, old);
  assert.equal(finishMissionIntro(battle, old, false), false);
  assert.equal(finishMissionIntro(battle, battle.missionIntro, true), true);
  assert.equal(battle.paused, true);
  battle.phase = 'boss-intro'; armMissionIntro(battle); assert.equal(battle.missionIntro, undefined);
  battle.mode = 'duel'; battle.phase = 'duel'; assert.equal(missionKey(battle), undefined);
});

test('countdown lasts fifteen active seconds, ignores inactive time and duplicate snapshots', () => {
  const clock = new MissionIntroClock(); clock.sync('first'); clock.tick(0, true);
  for (let n=1;n<=8;n++) { clock.sync('first'); clock.tick(n*250, true); }
  assert.equal(clock.remaining, 13);
  clock.tick(2100, false); clock.tick(100000, false); clock.tick(100100, true);
  assert.equal(clock.remaining, 13);
  for (let n=1;n<=52;n++) clock.tick(100100+n*250, true);
  assert.equal(clock.remaining, 0); assert.equal(clock.finish(), 'first');
  clock.sync('first'); assert.equal(clock.key, undefined);
  clock.sync('second'); assert.equal(clock.remaining, 15);
  clock.reset(); clock.sync('first'); assert.equal(clock.remaining, 15);
});
