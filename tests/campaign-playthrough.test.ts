import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignPilot, estimateHumanTime, runCampaign } from '../scripts/campaign-playthrough';
import { PLANES, RESEARCH_XP, ZONE, bossBalance, freshProfile, planeStats, upgradeSilver } from '../shared/data';
import { beginBoss, createBattle, makePlane } from '../shared/simulation';

test('Автопилот использует только управление и не меняет здоровье, щиты, врагов или положение', () => {
  const p = freshProfile('read-only-controller'), flight = createBattle('read-only-flight', 'pve', [makePlane(p.id, planeStats(p, true))]);
  flight.obstacles.push({id: 1, kind: 'rock', x: 440, y: 626, radius: 72, height: 280, hp: 99999, fire: 1, damage: 0});
  flight.bullets.push({id: 2, owner: 'enemy', x: 450, y: 330, vx: -240, vy: 0, life: 4, damage: 20});
  for (const phase of ['flight', 'boss'] as const) {
    if (phase === 'boss') { flight.level = 50; beginBoss(flight); }
    const before = structuredClone(flight), input = campaignPilot(flight);
    assert.deepEqual(flight, before);
    assert.ok(input.turn >= -1 && input.turn <= 1);
    assert.equal(typeof input.fire, 'boolean');
    assert.equal(typeof input.boost, 'boolean');
  }
});

test('Полная бесплатная кампания проходит 250 уровней и 11 настоящих боссов на заработанной экономике', {timeout: 60000}, () => {
  const run = runCampaign({seed: 7, maxDeaths: 60, maxActiveSeconds: 6 * 3600});
  assert.equal(run.completed, true, `уровень ${run.reachedLevel}: ${run.stoppedReason}`);
  assert.equal(run.reachedLevel, ZONE.length);
  assert.equal(run.finalPhase, 'ended', 'последняя карточка выбрана, финальная пауза награды снята');
  assert.equal(ZONE.length, 250);
  assert.deepEqual(run.bossVictories, ZONE.filter(z => z.boss).map(z => z.level));
  const flights = new Set(run.visits.filter(v => v.phase === 'flight' && v.outcome === 'passed').map(v => v.level));
  assert.equal(flights.size, 250);
  for (const visit of run.visits.filter(v => v.phase === 'boss' && v.outcome === 'passed')) {
    assert.ok(visit.shots > 0 && visit.landedProjectiles > 0, 'победа требует попаданий');
    assert.ok(Math.abs(visit.damageDealt - bossBalance(visit.level).hp) < 1e-7, 'вся прочность босса снята оружием');
    assert.ok(visit.seconds > 0 && visit.observedHitRate <= 1);
  }
  const p = run.finalProfile;
  assert.equal(p.gold, 0);
  assert.ok(!p.owned.includes('skate'), 'золотой самолёт не нужен для прохождения');
  assert.equal(p.selected, 'bastion');
  assert.equal(p.totalXp, run.earned.xp);
  const aircraftCost = PLANES.filter(model => p.owned.includes(model.id) && model.currency === 'silver').reduce((sum, model) => sum + model.price, 0);
  const upgradeLevels = Object.values(p.upgrades).flatMap(u => Object.values(u));
  const silverSpent = upgradeLevels.reduce((sum, n) => sum + Array.from({length: n}, (_, i) => upgradeSilver(i + 1)).reduce((a, b) => a + b, 0), 0);
  const xpSpent = upgradeLevels.reduce((sum, n) => sum + RESEARCH_XP.slice(0, n).reduce((a, b) => a + b, 0), 0);
  assert.equal(p.silver, 200 + run.earned.silver - aircraftCost - silverSpent);
  assert.equal(p.xp, run.earned.xp - xpSpent);
  assert.equal(new Set(p.modifiers!.map(m => m.id)).size, p.modifiers!.length);
  assert.equal(p.modifiers!.length, 11);
  assert.ok(Math.abs(run.activeSeconds - run.flightSeconds - run.bossSeconds) < 1e-6);
});

test('Одинаковые seed и стартовый профиль воспроизводят заработок и время', () => {
  const options = {seed: 13, endLevel: 5, maxActiveSeconds: 600};
  assert.deepEqual(runCampaign(options), runCampaign(options));
});

test('Оценка человеко-часов явно отделяет сценарные допущения от измеренного игрового времени', () => {
  const run = runCampaign({seed: 13, endLevel: 5, maxActiveSeconds: 600});
  const estimate = estimateHumanTime([run])!;
  assert.match(estimate.basis, /no human participants/);
  assert.equal(estimate.automatedActiveSeconds, run.activeSeconds);
  assert.ok(estimate.firstTime.totalHours > estimate.experienced.totalHours);
  assert.ok(estimate.experienced.totalHours > run.activeSeconds / 3600);
  assert.equal(estimateHumanTime([{...run, completed: false}]), undefined);
});
