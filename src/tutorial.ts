import { createBattle, makePlane, stepBattle, type Battle, type Controls } from '../shared/simulation';
import { planeStats, type Profile } from '../shared/data';
export type TutorialMode = 'pve' | 'duel';
export const tutorialKey = (player: string, mode: TutorialMode) => `biplanes-tutorial-v1-${player}-${mode}`;
export const lessonInput = (step: number): Controls => ({ turn: step === 1 ? -1 : step === 2 ? 1 : 0, fire: step === 3, boost: step === 4 });
export function lessonMatches(step: number, input: Controls) {
  return step === 1 ? input.turn < 0 : step === 2 ? input.turn > 0 : step === 3 ? input.fire : step === 4 ? input.boost : false;
}
export const LESSON_ACTION_SECONDS = .25;
export class FlightLesson {
  step = 1; progress = 0; demonstrating = false;
  constructor(public mode: TutorialMode) {}
  advance() { this.step = Math.min(5, this.step + 1); this.progress = 0; this.demonstrating = false; }
  trigger(input: Controls) {
    if (!lessonMatches(this.step, input)) return false;
    this.demonstrating = true; return true;
  }
  tick(input: Controls, dt: number) {
    if (!lessonMatches(this.step, input)) { this.progress = 0; return false; }
    this.progress += Math.max(0, Math.min(.05, dt));
    if (this.progress >= LESSON_ACTION_SECONDS) { this.advance(); return true; } return false;
  }
  get target() { return this.step === 3 ? 'fire' : this.step === 4 ? 'boost' : 'stick'; }
  copy(mobile: boolean) {
    const vertical = this.mode === 'pve';
    const titles = ['Учимся летать', vertical ? 'Вверх' : 'Поворот влево', vertical ? 'Вниз' : 'Поворот вправо', 'Огонь', 'Форсаж', 'Готово!'];
    const texts = mobile ? [
      'Попробуй управление.', 'Потяни контрол вверх.', 'Потяни контрол вниз.', 'Нажми огонь справа.', 'Нажми молнию.', 'Можно в бой!',
    ] : [
      'Попробуй управление.', vertical ? 'Нажми W.' : 'Нажми A.', vertical ? 'Нажми S.' : 'Нажми D.', 'Нажми Пробел.', 'Нажми Shift.', 'Можно в бой!',
    ];
    return { title: titles[this.step], text: texts[this.step], key: this.step === 1 ? vertical ? 'W' : 'A' : this.step === 2 ? vertical ? 'S' : 'D' : this.step === 3 ? 'Пробел' : this.step === 4 ? 'Shift' : '' };
  }
}

export function createTrainingBattle(id: string, mode: TutorialMode, profile: Profile): Battle {
  const pilot = makePlane(profile.id, planeStats(profile)); pilot.shield = 9999;
  const enemy = makePlane('practice-target', { ...planeStats(profile), speed: 0, turn: 0 }, false, 1); enemy.shield = 9999;
  const battle = createBattle(id, mode, mode === 'pve' ? [pilot] : [pilot, enemy]); battle.spawn = 99999;
  return battle;
}
export function stepTrainingBattle(battle: Battle, player: string, input: Controls, dt: number) {
  // A lesson never progresses campaign levels, spawns threats, or awards rewards.
  battle.distance = 0; battle.spawn = 99999; battle.obstacles = [];
  // The demonstration target is safe to overlap; real matches use normal ramming.
  for (const plane of battle.planes) plane.ram = 9999;
  stepBattle(battle, { [player]: input }, dt);
  battle.time = Math.min(60, battle.time);
  const pilot = battle.planes.find(p => p.id === player)!;
  pilot.health = pilot.hp; pilot.y = Math.max(100, Math.min(540, pilot.y)); pilot.shield = 9999;
}
