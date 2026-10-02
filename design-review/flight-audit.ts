import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createBattle, makePlane, stepBattle, IDLE, beginBoss } from '../shared/simulation';
import { freshProfile, planeStats, ZONE } from '../shared/data';
import { RenderBuffer } from '../src/render-state';

// This audits the unchanged game. No proposed physics are installed in the game.
const dt = 1 / 30;
const plane = () => makePlane('pilot', planeStats(freshProfile('pilot')));
const battle = (mode: 'pve' | 'duel' = 'duel') => createBattle('audit', mode, [plane()]);
const degrees = (r: number) => r * 180 / Math.PI;
const tracePoint = (time: number, p: ReturnType<typeof plane>) => ({ time, x: p.x, y: p.y, angle: degrees(p.angle), energy: p.energy });

const ceilingCases = (['pve', 'duel'] as const).map(mode => {
  const s = battle(mode), p = s.planes[0]; p.y = 76; p.angle = -1;
  const before = tracePoint(s.time, p); stepBattle(s, { pilot: IDLE }, dt);
  const after = tracePoint(s.time, p);
  assert.equal(p.y, 75); assert.equal(p.angle, 1);
  return { mode, before, after, jumpDegrees: after.angle - before.angle, verticalSpeedBefore: Math.sin(-1) * p.speed, verticalSpeedAfter: Math.sin(p.angle) * p.speed };
});

const boostState = battle(), boosting = { ...IDLE, boost: true };
const boostTrace: (ReturnType<typeof tracePoint> & { boosting: boolean; speed: number })[] = [];
for (let i = 0; i < 240; i++) {
  const p = boostState.planes[0], x = p.x, wasBoosting = p.energy > .03;
  stepBattle(boostState, { pilot: boosting }, dt);
  boostTrace.push({ ...tracePoint(boostState.time, p), boosting: wasBoosting, speed: ((p.x - x + 1200) % 1200) / dt });
}
const depleted = boostTrace.filter(p => p.time > 3);
const boostSwitches = depleted.slice(1).filter((p, i) => p.boosting !== depleted[i].boosting).length;
assert.ok(boostSwitches > 50);

const released = battle('pve'); released.planes[0].angle = .6;
const releaseTrace = [tracePoint(0, released.planes[0])];
for (let i = 0; i < 30; i++) { stepBattle(released, { pilot: IDLE }, dt); releaseTrace.push(tracePoint(released.time, released.planes[0])); }
assert.equal(released.planes[0].angle, .6);

const boundaryState = battle('pve'); boundaryState.planes[0].x = 388; boundaryState.planes[0].angle = 0;
const horizontalTrace = [tracePoint(0, boundaryState.planes[0])];
for (let i = 0; i < 20; i++) { stepBattle(boundaryState, { pilot: IDLE }, dt); horizontalTrace.push(tracePoint(boundaryState.time, boundaryState.planes[0])); }
assert.equal(boundaryState.planes[0].x, 390);

const enteringBoss = battle('pve'); enteringBoss.level = 10; enteringBoss.planes[0].x = 385; enteringBoss.planes[0].y = 520; enteringBoss.planes[0].angle = .6;
const bossBefore = tracePoint(enteringBoss.time, enteringBoss.planes[0]); beginBoss(enteringBoss);
const bossAfter = tracePoint(enteringBoss.time, enteringBoss.planes[0]);
assert.equal(bossAfter.x, 230); assert.equal(bossAfter.y, 330);

// Snapshot interpolation is delayed, but it extrapolates positions without field limits.
const makeFrame = (time: number, y: number, angle: number) => { const s = battle('pve'); s.time = time; s.planes[0].y = y; s.planes[0].angle = angle; return s; };
const buffer = new RenderBuffer(); buffer.push(makeFrame(0, 90, -1), 0); buffer.sample(0);
buffer.push(makeFrame(2 / 30, 79.6, -1), 67);
const predictionTrace = [];
for (let now = 67; now <= 360; now += 1000 / 60) { const s = buffer.sample(now)!; predictionTrace.push({ arrivalMs: now, renderTime: s.time, y: s.planes[0].y, angle: degrees(s.planes[0].angle) }); }
const lowestPredictedY = Math.min(...predictionTrace.map(p => p.y));
assert.ok(lowestPredictedY < 75);

// Energy is held constant between snapshots: the current drawEngine test fires for one render frame only.
const energyBuffer = new RenderBuffer(); const energyFrames = []; let next = 0, previousEnergy = 1;
for (let frame = 0; frame < 120; frame++) {
  const now = frame * 1000 / 60;
  while (next * 1000 / 15 <= now) { const s = battle(); s.time = next / 15; s.planes[0].energy = 1 - next / 30; energyBuffer.push(s, now); next++; }
  const s = energyBuffer.sample(now)!; const energy = s.planes[0].energy;
  if (frame > 30) energyFrames.push({ frame, energy, longFlame: energy < previousEnergy - .0001 });
  previousEnergy = energy;
}
const longFlameFrames = energyFrames.filter(p => p.longFlame).length;
assert.ok(longFlameFrames < energyFrames.length / 2);

const coolingAt = (angle: number) => {
  const profile = freshProfile('pilot'); profile.selected = 'skate';
  const p = makePlane('pilot', planeStats(profile)); p.angle = angle; p.heat = 1;
  const s = createBattle('cooling', 'duel', [p]); stepBattle(s, { pilot: IDLE }, dt);
  return { angleDegrees: degrees(p.angle), verticalSpeed: Math.sin(p.angle) * p.speed, coolingPerSecond: (1 - p.heat) / dt };
};
const coolingRight = coolingAt(0), coolingLeft = coolingAt(Math.PI);
assert.ok(coolingLeft.coolingPerSecond > coolingRight.coolingPerSecond);
assert.ok(Math.abs(coolingLeft.coolingPerSecond / coolingRight.coolingPerSecond - 1.25) < .000001);

const p = plane();
const report = {
  version: '0.6.0', sourceCommit: '2632f71', date: '2026-10-02', method: 'Deterministic checks against unchanged shared/simulation.ts and src/render-state.ts; dt=1/30; render=60 Hz.',
  ceilingCases,
  boost: { trace: boostTrace, switchesAfter3Seconds: boostSwitches, speedNormal: p.speed, speedBoosted: p.speed * 1.3, observationSeconds: depleted.at(-1)!.time - depleted[0].time },
  release: { trace: releaseTrace, persistentAngleDegrees: degrees(.6), dropIn1Second: released.planes[0].y - 330 },
  horizontalClamp: { trace: horizontalTrace, minX: 130, maxX: 390, worldScroll: ZONE[0].scroll, freeScreenSpeed: p.speed - ZONE[0].scroll },
  bossTransition: { before: bossBefore, after: bossAfter, distancePixels: Math.hypot(bossAfter.x - bossBefore.x, bossAfter.y - bossBefore.y) },
  prediction: { trace: predictionTrace, lowestPredictedY, ceiling: 75 },
  engineFlicker: { frames: energyFrames.length, longFlameFrames, trace: energyFrames },
  skateCooling: { horizontalRight: coolingRight, horizontalLeft: coolingLeft },
  handling: { speed: p.speed, turnRadiansPerSecond: p.turn, turnDegreesPerSecond: degrees(p.turn), radiusPixels: p.speed / p.turn, fullTurnSeconds: 2 * Math.PI / p.turn },
  sprite: { viewBoxWidth: 400, viewBoxHeight: 200, spriteScale: .45, nominalWidthPixels: 180, collisionRadius: 26, bulletOffset: 38, propellerOffsetX: (373 - 200) * .45, propellerOffsetY: (108 - 100) * .45 },
  checksPassed: 13,
};
writeFileSync(new URL('./flight-evidence.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ checksPassed: report.checksPassed, ceilingJumpDegrees: ceilingCases[0].jumpDegrees, boostSwitches, dropAfterRelease: report.release.dropIn1Second, lowestPredictedY, longFlameFrames, sampledRenderFrames: energyFrames.length, turnRadius: report.handling.radiusPixels, bossTeleport: report.bossTransition.distancePixels }, null, 2));
