import type { Battle } from './simulation';

export const MISSION_INTRO_SECONDS = 15;
export function missionKey(battle: Battle): string | undefined {
  return battle.mode === 'pve' && battle.phase === 'flight'
    ? `${battle.id}:${battle.level}:${battle.operation?.completed ?? 0}` : undefined;
}
/** Called by the server before publishing a new sortie, before its next simulation tick. */
export function armMissionIntro(battle: Battle) {
  const key = missionKey(battle);
  if (key) { battle.missionIntro = key; battle.paused = true; }
  else delete battle.missionIntro;
}
export function finishMissionIntro(battle: Battle, key: unknown, paused: boolean): boolean {
  if (!battle.missionIntro || key !== battle.missionIntro || key !== missionKey(battle)) return false;
  delete battle.missionIntro;
  battle.paused = paused;
  return true;
}

/** Repeated snapshots do not restart the countdown; inactive time does not consume it. */
export class MissionIntroClock {
  key?: string;
  remaining = 0;
  private previous?: number;
  private finished?: string;
  sync(key: string | undefined) {
    if (key === this.key || key === this.finished && key !== undefined) return;
    this.key = key; this.remaining = key ? MISSION_INTRO_SECONDS : 0; this.previous = undefined;
  }
  tick(now: number, active: boolean) {
    if (this.key && active && this.previous !== undefined) this.remaining = Math.max(0, this.remaining - Math.min(.25, (now - this.previous) / 1000));
    this.previous = active ? now : undefined;
    return !!this.key && this.remaining <= 0;
  }
  finish() { const key = this.key; this.finished = key; this.key = undefined; this.remaining = 0; this.previous = undefined; return key; }
  reset() { this.key = this.finished = this.previous = undefined; this.remaining = 0; }
}
