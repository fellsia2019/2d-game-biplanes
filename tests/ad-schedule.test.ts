import test from 'node:test';
import assert from 'node:assert/strict';
import { AdSchedule } from '../src/ad-schedule';
test('Реклама требует три завершённых боя и 180 активных секунд', () => {
  const schedule = new AdSchedule();
  for (let fight = 0; fight < 3; fight++) {
    for (let time = 0; time <= 60; time++) schedule.observe({ id: String(fight), time, phase: 'flying' }, true);
    assert.equal(schedule.claim(), false);
    schedule.observe({ id: String(fight), time: 60, phase: 'ended' }, false);
    schedule.observe({ id: String(fight), time: 60, phase: 'ended' }, false);
    if (fight < 2) assert.equal(schedule.claim(), false);
  }
  assert.equal(schedule.claim(), true);
  assert.equal(schedule.claim(), false);
});
test('Пауза, скрытая вкладка и разрыв снимков не набирают рекламное время', () => {
  const schedule = new AdSchedule();
  for (let fight = 0; fight < 4; fight++) {
    schedule.observe({id: String(fight), time: 0, phase: 'flying'}, true);
    schedule.observe({id: String(fight), time: 300, phase: 'flying'}, false);
    schedule.observe({id: String(fight), time: 600, phase: 'flying'}, true);
    schedule.observe({id: String(fight), time: 900, phase: 'ended'}, false);
  }
  assert.equal(schedule.claim(), false);
});
