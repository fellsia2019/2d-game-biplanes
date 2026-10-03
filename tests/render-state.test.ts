import test from 'node:test';
import { readyLastSortie } from './fixtures';
import assert from 'node:assert/strict';
import { RenderBuffer } from '../src/render-state';
import { createBattle, makePlane, stepBattle, IDLE } from '../shared/simulation';
import { freshProfile, planeStats, ZONE } from '../shared/data';

function snapshot(time: number) {
  const s = createBattle('motion', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))]);
  s.time = time; s.totalDistance = time * 100; s.planes[0].x = 200 + time * 120;
  s.obstacles = [{ id: 1, kind: 'fighter', x: 950 - time * 180, y: 300, radius: 24, hp: 30, fire: 1, damage: 5 }];
  s.bullets = [{ id: 2, owner: 'pilot', x: 120 + time * 400, y: 330, vx: 400, vy: 0, life: 2, damage: 10 }];
  return s;
}

test('Снимки 15 Гц с джиттером дают движение всех объектов на каждом кадре 60 Гц', () => {
  const buffer = new RenderBuffer(), samples: ReturnType<RenderBuffer['sample']>[] = [];
  let next = 0;
  for (let frame = 0; frame < 90; frame++) {
    const now = frame * 1000 / 60;
    while (next * 1000 / 15 + (next % 3 === 0 ? 8 : 0) <= now) {
      buffer.push(snapshot(next / 15), now); next++;
    }
    const s = buffer.sample(now); if (s && now > 350) samples.push(s);
  }
  assert.ok(samples.length > 40);
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    assert.ok(b.planes[0].x - a.planes[0].x > .5 && b.planes[0].x - a.planes[0].x < 2.7);
    assert.ok(a.obstacles[0].x - b.obstacles[0].x > 1 && a.obstacles[0].x - b.obstacles[0].x < 4);
    assert.ok(b.bullets[0].x - a.bullets[0].x > 3 && b.bullets[0].x - a.bullets[0].x < 8);
    assert.ok(b.totalDistance > a.totalDistance);
  }
});

test('Переход через край арены и угол ±π не тянут самолёт через весь экран', () => {
  const buffer = new RenderBuffer(), a = snapshot(0), b = snapshot(1 / 15);
  a.phase = b.phase = 'duel'; a.planes[0].x = 1190; b.planes[0].x = 10;
  a.planes[0].angle = Math.PI - .05; b.planes[0].angle = -Math.PI + .05;
  buffer.push(a, 0); buffer.sample(0); buffer.push(b, 1000 / 15);
  const s = buffer.sample(150)!;
  assert.ok(s.planes[0].x > 1180 || s.planes[0].x < 20);
  assert.ok(Math.abs(s.planes[0].angle) > 3);
});

test('Пауза и окончание возвращают точное состояние; потеря пакетов ограничивает прогноз', () => {
  const buffer = new RenderBuffer(), a = snapshot(0), b = snapshot(1 / 15);
  buffer.push(a, 0); buffer.sample(0); buffer.push(b, 67);
  for (let now = 67; now <= 3000; now += 17) buffer.sample(now);
  assert.ok(buffer.sample(3100)!.time <= b.time + .080001);
  const paused = { ...b, paused: true }; buffer.push(paused, 3200);
  assert.equal(buffer.sample(10000), paused);
  const ended = { ...b, phase: 'ended' as const, planes: [{ ...b.planes[0], health: 0 }] }; buffer.push(ended, 11000);
  assert.equal(buffer.sample(12000), ended);
});

test('Пакет с меньшим серверным временем не возвращает движение назад', () => {
  const buffer = new RenderBuffer(); buffer.push(snapshot(1), 1000); buffer.sample(1000);
  buffer.push(snapshot(1.1), 1100); const before = buffer.sample(1150)!;
  buffer.push(snapshot(.5), 1160); const after = buffer.sample(1170)!;
  assert.ok(after.time >= before.time); assert.ok(after.planes[0].x >= before.planes[0].x);
});

test('Обычный новый уровень сохраняет высоту и фиксирует горизонтальный полёт', () => {
  const s = createBattle('transition', 'pve', [makePlane('pilot', planeStats(freshProfile('pilot')))]);
  const p = s.planes[0]; p.x = 190; p.y = 270; p.angle = .55; p.shield = 0;
  s.distance = ZONE[0].length - .01; readyLastSortie(s);
  stepBattle(s, { pilot: IDLE }, 1 / 30);
  assert.equal(s.level, 2); assert.equal(p.x, 220); assert.equal(p.y, 270);
  assert.equal(p.angle, 0); assert.equal(p.shield, 0);
});
