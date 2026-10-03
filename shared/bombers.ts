export interface Bomber {
  id: number; x: number; y: number; warning: number; dropX: number; bombs: number;
  dropped?: number; hp?: number; aimLocked?: boolean;
}

export const BOMBER = {
  altitude: 80, speed: 140, spacing: 95, bayOffset: 24,
  halfWidth: 84, halfHeight: 30, warningSeconds: 2,
};

export function bomberFormation(level: number) {
  return {
    count: level < 26 ? 1 : level < 101 ? 2 : 3,
    bombs: level < 51 ? 1 : level < 151 ? 2 : level < 201 ? 3 : 5,
    interval: level < 26 ? 26 : level < 101 ? 23 : 21,
  };
}

// An odd carpet is symmetric. For an even payload, one of the two middle
// bombs still crosses the target instead of leaving a gap over the pilot.
export const bomberAimDropX = (targetX: number, bombs: number) => targetX + Math.floor(bombs / 2) * BOMBER.spacing;

// Older checkpoints released their whole payload when the warning expired.
export const bombsDropped = (bomber: Bomber) => bomber.dropped ?? (bomber.warning <= 0 ? bomber.bombs : 0);
export function bomberBombLanes(bomber: Bomber) {
  return Array.from({length: bomber.bombs - bombsDropped(bomber)}, (_, n) => bomber.dropX - (n + bombsDropped(bomber)) * BOMBER.spacing);
}

export function touchesBomber(x: number, y: number, radius: number, bomber: Bomber) {
  return ((x - bomber.x) / (BOMBER.halfWidth + radius)) ** 2 + ((y - bomber.y) / (BOMBER.halfHeight + radius)) ** 2 <= 1;
}
