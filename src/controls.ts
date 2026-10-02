import type { Battle, Controls } from '../shared/simulation';
export function flightControls(battle: Pick<Battle, 'mode' | 'phase'>, keys: ReadonlySet<string>, touches: ReadonlySet<string>): Controls {
  const vertical = battle.mode === 'pve' && battle.phase === 'flight';
  const up = vertical ? keys.has('KeyW') || keys.has('ArrowUp') : keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('ArrowUp');
  const down = vertical ? keys.has('KeyS') || keys.has('ArrowDown') : keys.has('KeyD') || keys.has('ArrowRight') || keys.has('ArrowDown');
  return { turn: Number(down || touches.has('right')) - Number(up || touches.has('left')), ...(vertical ? { horizontal: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) } : {}), fire: keys.has('Space') || touches.has('fire'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight') || touches.has('boost') };
}

export function joystickHorizontal(x: number): number { return Math.abs(x) < .2 ? 0 : Math.sign(x); }

export function joystickTurn(vertical: boolean, angle: number, x: number, y: number): number {
  if (Math.hypot(x, y) < .2) return 0;
  if (vertical) return Math.abs(y) < .2 ? 0 : Math.sign(y);
  const target = Math.atan2(y, x), delta = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
  return Math.abs(delta) < .12 ? 0 : Math.sign(delta);
}
