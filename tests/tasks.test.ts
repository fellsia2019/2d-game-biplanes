import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, resetTasks, claimTask } from '../shared/data';

test('Дневная награда сохраняется после смены дня и выдаётся только один раз', () => {
  const p = freshProfile('pilot');
  resetTasks(p, new Date('2026-10-02T22:00:00Z')); p.daily.kills = 5;
  const next = new Date('2026-10-03T00:00:00Z'); resetTasks(p, next); resetTasks(p, next);
  assert.equal(p.daily.kills, 0); assert.equal(p.taskArchive.length, 1);
  assert.equal(p.taskArchive[0].expiresAt, Date.parse('2026-10-10T00:00:00Z'));
  assert.ok(claimTask(p, 'daily', 'kills', '2026-10-02', next));
  assert.equal(p.silver, 300); assert.equal(p.xp, 30); assert.equal(p.gold, 0);
  assert.equal(claimTask(p, 'daily', 'kills', '2026-10-02', next), false);
  assert.equal(p.silver, 300);
  assert.throws(() => claimTask(p, 'daily', 'wins', '2026-10-03', next), /не выполнена/);
});

test('Архив истекает ровно через семь дней после конца периода, а не после входа', () => {
  const p = freshProfile('pilot');
  resetTasks(p, new Date('2026-10-02T10:00:00Z')); p.daily.wins = 1;
  const last = new Date('2026-10-09T23:59:59Z'); resetTasks(p, last);
  assert.equal(p.taskArchive.length, 1);
  const expired = new Date('2026-10-10T00:00:00Z');
  assert.equal(claimTask(p, 'daily', 'wins', '2026-10-02', expired), false);
  assert.equal(p.taskArchive.length, 0); assert.equal(p.silver, 200);
});

test('Недельный бонус сохраняет прежние получения и начисляется один раз', () => {
  const p = freshProfile('pilot'), old = new Date('2026-10-02T12:00:00Z');
  resetTasks(p, old); p.weekly.activity = 20; p.weekly.levels = 10; p.weekly.duels = 10;
  claimTask(p, 'weekly', 'activity', p.weekly.key, old);
  const next = new Date('2026-10-05T00:00:00Z'); resetTasks(p, next);
  const key = '2026-09-28';
  assert.equal(p.taskArchive[0].expiresAt, Date.parse('2026-10-12T00:00:00Z'));
  assert.ok(claimTask(p, 'weekly', 'levels', key, next));
  assert.ok(claimTask(p, 'weekly', 'duels', key, next));
  assert.equal(p.silver, 2200); assert.equal(p.xp, 600);
  assert.equal(claimTask(p, 'weekly', 'duels', key, next), false);
  assert.equal(p.silver, 2200); assert.equal(p.weekly.claimed.length, 0);
});

test('Долгое отсутствие не продлевает архив и не сохраняет невыполненные задачи', () => {
  const p = freshProfile('pilot'); resetTasks(p, new Date('2026-10-02T10:00:00Z'));
  p.daily.activity = 2; p.weekly.levels = 10;
  resetTasks(p, new Date('2026-10-20T10:00:00Z'));
  assert.equal(p.taskArchive.length, 0); assert.equal(p.silver, 200);
});
