import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftCombatMatrix, campaignPilot, estimateHumanTime, runCampaign } from '../scripts/campaign-playthrough';
import { PLANES, RESEARCH_XP, ZONE, bossBalance, freshProfile, planeStats, upgradeSilver } from '../shared/data';
import { beginBoss, createBattle, makePlane } from '../shared/simulation';
import { makeModifierOffer, type OwnedModifier } from '../shared/modifiers';

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
  const mixed = estimateHumanTime([run, {...run, completed: false, stoppedReason: 'death limit', reachedLevel: 50}])!;
  assert.equal(mixed.excludedIncompleteRuns.length, 1);
  assert.equal(mixed.excludedIncompleteRuns[0].reachedLevel, 50);
  assert.equal(mixed.automatedActiveSeconds, run.activeSeconds);
});

test('Все пять самолётов проверяются без карточек в базовой, рабочей и полной сборке обычным управлением', {timeout: 60000}, () => {
  const matrix = aircraftCombatMatrix();
  assert.equal(matrix.rows.length, 15);
  assert.match(matrix.qualification, /not earned careers or a human benchmark/);
  for (const model of PLANES) {
    const rows = matrix.rows.filter(r => r.options.model === model.id);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].outcome, 'won', `${model.name}: базовая сборка доступного ей босса`);
    const maximum = rows[2];
    assert.ok(Math.abs(maximum.stats.hp / model.hp - 1.3) < 1e-10);
    assert.ok(Math.abs(maximum.stats.damage / model.damage - 1.3) < 1e-10);
    assert.ok(Math.abs(maximum.stats.speed / model.speed - 1.1) < 1e-10);
    assert.ok(Math.abs(maximum.stats.turn / model.turn - 1.05) < 1e-10);
    const escape = matrix.alternateEscape.find(r => r.options.model === model.id && r.options.upgrades?.gun === 5);
    assert.ok(maximum.outcome === 'won' || escape?.outcome === 'won', `${model.name}: полная сборка требует подходящей траектории`);
  }
  for (const row of [...matrix.rows, ...matrix.controlSensitivity, ...matrix.alternateEscape]) {
    assert.equal(row.fixture, true);
    assert.ok(Number.isFinite(row.seconds) && row.seconds > 0);
    assert.equal(row.options.modifiers, undefined);
    if (row.outcome === 'won') {
      assert.equal(row.bossHealthRemaining, 0);
      assert.ok(row.healthRemaining > 0 && row.projectilesLaunched > 0 && row.damagingFrames > 0);
      assert.ok(Math.abs(row.bossDamageDealt - bossBalance(row.options.level).hp) < 1e-7);
    } else if (row.outcome === 'lost') {
      assert.equal(row.healthRemaining, 0);
      assert.ok(row.lossCause);
    }
  }
});

test('Бесплатная кампания завершается и при выборе первой карточки без ранжирования её выгоды', {timeout: 60000}, () => {
  const run = runCampaign({seed: 7, modifierChoice: 'first-offer', maxDeaths: 60, maxActiveSeconds: 6 * 3600});
  assert.equal(run.completed, true, `${run.reachedLevel}: ${run.stoppedReason}`);
  assert.equal(run.finalPhase, 'ended');
  assert.equal(run.scenario.paidGoldCredit, 0);
  assert.equal(run.finalProfile.gold, 0);
  const previous: OwnedModifier[] = [];
  for (const choice of run.timeline.filter(e => e.kind === 'modifier')) {
    const offer = makeModifierOffer(run.finalProfile.id, choice.level, previous);
    assert.equal(choice.detail, offer.options[0]);
    previous.push({id: offer.options[0], level: 1});
  }
  assert.equal(previous.length, 11);
});

test('Платный Феникс покупается за явный золотой кредит после настоящей победы50 и не подменяет бесплатное прохождение', {timeout: 60000}, () => {
  const run = runCampaign({seed: 7, endLevel: 51, paidPhoenix: true, maxDeaths: 60, maxActiveSeconds: 3 * 3600});
  assert.equal(run.completed, true);
  assert.equal(run.scenario.paidGoldCredit, PLANES.find(p => p.id === 'skate')!.price);
  assert.equal(run.finalProfile.gold, 0);
  const bought = run.timeline.filter(e => e.kind === 'paid-aircraft');
  assert.equal(bought.length, 1);
  assert.equal(bought[0].level, 51);
  assert.ok(run.bossVictories.includes(50));
  assert.ok(run.visits.filter(v => v.level <= 50).every(v => v.model !== 'skate'));
  assert.equal(run.finalProfile.selected, 'skate');
  assert.ok(run.finalProfile.owned.includes('skate'));
});

test('Ранние боссы10/25/50 проходят заработанными базовыми самолётами без исследований и покупки улучшений', {timeout: 60000}, () => {
  const run = runCampaign({seed: 7, endLevel: 50, modifierChoice: 'first-offer', upgradePolicy: 'none', maxDeaths: 60, maxActiveSeconds: 3 * 3600});
  assert.equal(run.completed, true, `${run.reachedLevel}: ${run.stoppedReason}`);
  assert.deepEqual(run.bossVictories, [10, 25, 50]);
  assert.deepEqual(run.finalProfile.upgrades, {});
  assert.deepEqual(run.finalProfile.research, {});
  assert.equal(run.finalProfile.xp, run.earned.xp);
  assert.equal(run.scenario.paidGoldCredit, 0);
  assert.equal(run.finalProfile.gold, 0);
  assert.ok(run.timeline.every(e => e.kind !== 'upgrade' && e.kind !== 'paid-aircraft'));
  assert.equal(run.finalPhase, 'flight', 'точечный прогон после50 честно готов продолжиться на51');
});
