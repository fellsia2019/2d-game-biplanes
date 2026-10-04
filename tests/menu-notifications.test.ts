import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, resetTasks, claimTask } from '../shared/data';
import { countTaskRewards, ModifierInbox } from '../src/menu-notifications';

const now = new Date('2026-10-04T12:00:00Z');
function profile(id = 'notifications') {
  const p = freshProfile(id); resetTasks(p, now); return p;
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('Счётчик включает вход, дневные и недельные награды и уменьшается только после получения', () => {
  const p = profile();
  assert.equal(countTaskRewards(p, +now), 1);
  p.daily.activity = 3; p.daily.kills = 5; p.weekly.duels = 10;
  assert.equal(countTaskRewards(p, +now), 4);
  claimTask(p, 'daily', 'activity', undefined, now);
  assert.equal(countTaskRewards(p, +now), 3);
  p.loginDay = now.toISOString().slice(0, 10);
  assert.equal(countTaskRewards(p, +now), 2);
  claimTask(p, 'daily', 'kills', undefined, now); claimTask(p, 'weekly', 'duels', undefined, now);
  assert.equal(countTaskRewards(p, +now), 0);
});

test('Счётчик учитывает архив и смену дня, исключает истёкшие награды и не изменяет профиль', () => {
  const p = profile(); p.loginDay = '2026-10-03'; p.daily.key = '2026-10-03'; p.daily.wins = 1;
  p.taskArchive = [
    {period:'weekly', key:'2026-09-28', expiresAt:+now+1000, completed:['levels','duels'], claimed:['levels']},
    {period:'daily', key:'2026-09-20', expiresAt:+now-1, completed:['wins'], claimed:[]},
  ];
  const before = structuredClone(p);
  assert.equal(countTaskRewards(p, +now), 3);
  assert.deepEqual(p, before);
  assert.equal(countTaskRewards(p, +now+1000), 2);
});

test('Модификатор и улучшение остаются новыми после перезагрузки до просмотра коллекции', () => {
  const saved = storage(), p = profile(), inbox = new ModifierInbox(saved);
  inbox.sync(p); p.modifiers = [{id:'tailwind',level:1}];
  assert.deepEqual(inbox.unseen(p), ['tailwind']);
  const reloaded = new ModifierInbox(saved);
  assert.deepEqual(reloaded.unseen(p), ['tailwind']);
  reloaded.markSeen(p); assert.deepEqual(reloaded.unseen(p), []);
  assert.deepEqual(new ModifierInbox(saved).unseen(p), []);
  p.modifiers[0].level = 2;
  assert.deepEqual(reloaded.unseen(p), ['tailwind']);
});

test('Первая загрузка не объявляет старые карточки новыми; профили имеют независимые отметки', () => {
  const saved = storage(), inbox = new ModifierInbox(saved), a = profile('a'), b = profile('b');
  a.modifiers = [{id:'tailwind',level:2}]; inbox.sync(a);
  assert.deepEqual(inbox.unseen(a), []);
  inbox.sync(b); b.modifiers = [{id:'tailwind',level:1}];
  assert.deepEqual(inbox.unseen(b), ['tailwind']);
  assert.deepEqual(inbox.unseen(a), []);
  inbox.markSeen(a); assert.deepEqual(inbox.unseen(b), ['tailwind']);
});

test('Повреждённое или недоступное хранилище не мешает уведомлениям в текущем сеансе', () => {
  for (const getItem of [() => '{broken', () => { throw new Error('Storage unavailable'); }]) {
    const inbox = new ModifierInbox({getItem,setItem:() => { throw new Error('Read only'); }}), p = profile();
    inbox.sync(p); p.modifiers = [{id:'reinforced-hull',level:1}];
    assert.deepEqual(inbox.unseen(p), ['reinforced-hull']);
    inbox.markSeen(p); assert.deepEqual(inbox.unseen(p), []);
  }
});
