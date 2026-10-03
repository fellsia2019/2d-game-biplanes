import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTutorialPosition, type TutorialPosition, type TutorialRect, type TutorialSize } from '../src/tutorial-layout';

function overlap(a: TutorialRect, b: TutorialRect, padding = 0) {
  return a.x < b.x + b.width + padding && a.x + a.width > b.x - padding && a.y < b.y + b.height + padding && a.y + a.height > b.y - padding;
}
function safe(frame: TutorialSize, card: TutorialSize, plane: TutorialRect, result: TutorialPosition, focus?: TutorialRect) {
  assert.equal(result.placement, 'overlay', JSON.stringify({frame, card, plane, result, focus}));
  const rect = {x: result.left, y: result.top, width: result.maxWidth ?? card.width, height: result.maxHeight ?? card.height};
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= frame.width && rect.y + rect.height <= frame.height);
  assert.equal(overlap(rect, plane, 16), false, JSON.stringify({rect, plane}));
  if (focus) assert.equal(overlap(rect, focus, 8), false, JSON.stringify({rect, focus}));
}

test('All four occupied corners move the tutorial card to a free on-screen corner', () => {
  const frame = {width: 800, height: 450}, card = {width: 280, height: 100};
  for (const x of [10, 650]) for (const y of [40, 320]) {
    const plane = {x, y, width: 80, height: 70}; const result = chooseTutorialPosition(frame, card, plane);
    safe(frame, card, plane, result); assert.ok(result.top >= 40); assert.ok(result.top + card.height <= frame.height - 32);
  }
});

test('Previous position remains steady while aircraft and focus move elsewhere', () => {
  const frame = {width: 844, height: 390}, card = {width: 300, height: 110};
  const previous = {left: 20, top: 60};
  for (const x of [500, 600, 730]) {
    const plane = {x, y: 170, width: 60, height: 70}, result = chooseTutorialPosition(frame, card, plane, undefined, previous);
    safe(frame, card, plane, result); assert.equal(result.left, previous.left); assert.equal(result.top, previous.top);
  }
});

test('Moving through the card and wrapping across the screen always relocates without masking the plane', () => {
  const frame = {width: 800, height: 450}, card = {width: 280, height: 100}; let previous: TutorialPosition | undefined;
  const path = [...Array.from({length: 40}, (_, i) => ({x: i * 20, y: 50})), {x: -25, y: 50}, ...Array.from({length: 40}, (_, i) => ({x: 760 - i * 20, y: 315}))];
  for (const point of path) {
    const plane = {...point, width: 80, height: 80}; const result = chooseTutorialPosition(frame, card, plane, undefined, previous);
    safe(frame, card, plane, result);
    if (previous) {
      const old = {x: previous.left, y: previous.top, width: card.width, height: card.height};
      if (!overlap(old, plane, 16)) assert.deepEqual(result, previous);
    }
    previous = result;
  }
});

test('Touch focus is protected independently of the plane on landscape and fitted portrait frames', () => {
  for (const frame of [{width: 844, height: 390}, {width: 800, height: 450}, {width: 442, height: 248}, {width: 459, height: 258.1875}]) {
    const card = {width: Math.min(300, frame.width * .46), height: Math.min(105, frame.height * .4)};
    const plane = {x: frame.width * .42, y: frame.height * .38, width: 42, height: 42};
    for (const x of [10, frame.width - 104]) {
      const focus = {x, y: frame.height - 100, width: 94, height: 90}; const result = chooseTutorialPosition(frame, card, plane, focus);
      safe(frame, card, plane, result, focus);
    }
  }
});

test('A 320x180 frame uses available space instead of assuming fixed desktop corners', () => {
  const frame = {width: 320, height: 180}, card = {width: 140, height: 68}, plane = {x: 230, y: 75, width: 45, height: 45};
  const focus = {x: 230, y: 145, width: 60, height: 30}, result = chooseTutorialPosition(frame, card, plane, focus);
  safe(frame, card, plane, result, focus);
});

test('Header/footer exclusion is a preference and yields to an otherwise safe small-screen position', () => {
  const frame = {width: 320, height: 180}, card = {width: 220, height: 50}, plane = {x: 90, y: 90, width: 110, height: 60};
  const result = chooseTutorialPosition(frame, card, plane); safe(frame, card, plane, result); assert.ok(result.top < 40);
});

test('A tall card becomes scrollable when a safe 64px+ reading region exists', () => {
  const frame = {width: 390, height: 219}, card = {width: 180, height: 160}, plane = {x: 180, y: 120, width: 20, height: 20};
  const result = chooseTutorialPosition(frame, card, plane); safe(frame, card, plane, result);
  assert.ok(result.maxHeight !== undefined && result.maxHeight >= 64 && result.maxHeight < card.height);
  assert.deepEqual(chooseTutorialPosition(frame, card, plane, undefined, result), result);
  const measuredCard = {...card, height: result.maxHeight!};
  assert.deepEqual(chooseTutorialPosition(frame, measuredCard, plane, undefined, result), result, 'Measured CSS cap is preserved instead of alternating between natural and capped height');
});

test('Impossible tiny layouts explicitly request an external rail instead of covering the aircraft or controls', () => {
  const frame = {width: 320, height: 180}, card = {width: 145, height: 110}, plane = {x: 140, y: 60, width: 40, height: 60};
  const result = chooseTutorialPosition(frame, card, plane); assert.equal(result.placement, 'rail'); assert.ok(result.maxHeight! > 0);
  const full = chooseTutorialPosition({width: 390, height: 219}, {width: 180, height: 110}, {x: 0, y: 0, width: 390, height: 219});
  assert.equal(full.placement, 'rail');
});

test('Frame resize invalidates the old off-screen position, and oversized widths expose a CSS cap', () => {
  const frame = {width: 390, height: 219}, card = {width: 500, height: 65}, plane = {x: 100, y: 145, width: 30, height: 30};
  const result = chooseTutorialPosition(frame, card, plane, undefined, {left: 620, top: 320});
  safe(frame, card, plane, result); assert.equal(result.maxWidth, 370);
  const capped = chooseTutorialPosition(frame, card, plane, undefined, {left: 10, top: 10, maxWidth: 500, maxHeight: 65});
  safe(frame, card, plane, capped); assert.equal(capped.maxWidth, 370); assert.equal(capped.maxHeight, 65);
});

test('Deterministic inputs never produce NaN or out-of-bounds fallback caps', () => {
  const plane = {x: 0, y: 0, width: 10, height: 10};
  for (const frame of [{width: 0, height: 0}, {width: NaN, height: Infinity}, {width: 12, height: 9}]) {
    const result = chooseTutorialPosition(frame, {width: 100, height: 80}, plane);
    assert.equal(result.placement, 'rail'); assert.ok(Object.values(result).filter(value => typeof value === 'number').every(value => Number.isFinite(value) && value >= 0));
  }
});
