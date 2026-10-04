// Ads are requested only by an explicit return from a completed fight.
// A failed/unavailable request also consumes the slot, preventing retry spam.
export class AdSchedule {
  private seconds = 0;
  private battles = 0;
  private previous?: { id: string; time: number; active: boolean };
  private ended = new Set<string>();
  observe(battle: { id: string; time: number; phase: string; paused?: boolean }, active: boolean) {
    if (this.previous?.id === battle.id && this.previous.active && active) {
      this.seconds += Math.max(0, Math.min(1, battle.time - this.previous.time));
    }
    this.previous = { id: battle.id, time: battle.time, active };
    if (battle.phase === 'ended' && !this.ended.has(battle.id)) {
      this.ended.add(battle.id); this.battles++;
    }
  }
  claim() {
    if (this.seconds < 180 || this.battles < 3) return false;
    this.seconds = 0; this.battles = 0; return true;
  }
}
