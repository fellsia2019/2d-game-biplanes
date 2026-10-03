import { createBattle, makePlane, stepBattle, type Battle, type Controls } from '../shared/simulation';
import { planeStats, type Profile } from '../shared/data';
export type TutorialMode = 'pve' | 'duel';
export const tutorialKey = (player: string, mode: TutorialMode) => `biplanes-tutorial-v1-${player}-${mode}`;
export const needsBossLesson = (hasLearned: (mode: TutorialMode) => boolean) => !hasLearned('duel');
type LessonAction = 'up' | 'down' | 'left' | 'right' | 'fire' | 'boost';
const actions: Record<TutorialMode, readonly LessonAction[]> = {
  pve: ['up', 'down', 'left', 'right', 'fire', 'boost'],
  duel: ['left', 'right', 'fire', 'boost'],
};
export const lessonInput = (step: number, mode: TutorialMode = 'duel'): Controls => {
  const action = actions[mode][step - 1];
  return {
    turn: action === 'up' || mode === 'duel' && action === 'left' ? -1 : action === 'down' || mode === 'duel' && action === 'right' ? 1 : 0,
    ...(mode === 'pve' ? {horizontal: action === 'left' ? -1 : action === 'right' ? 1 : 0} : {}),
    fire: action === 'fire', boost: action === 'boost',
  };
};
export function lessonMatches(step: number, input: Controls, mode: TutorialMode = 'duel') {
  const expected = lessonInput(step, mode);
  return expected.turn ? input.turn * expected.turn > 0 : expected.horizontal ? (input.horizontal ?? 0) * expected.horizontal > 0 : expected.fire ? input.fire : expected.boost ? input.boost : false;
}
export const LESSON_ACTION_SECONDS = .25;
export class FlightLesson {
  step = 1; progress = 0; demonstrating = false;
  constructor(public mode: TutorialMode) {}
  get total() { return actions[this.mode].length; }
  get complete() { return this.step > this.total; }
  get action() { return actions[this.mode][this.step - 1]; }
  advance() { this.step = Math.min(this.total + 1, this.step + 1); this.progress = 0; this.demonstrating = false; }
  trigger(input: Controls) {
    if (!lessonMatches(this.step, input, this.mode)) return false;
    this.demonstrating = true; return true;
  }
  tick(input: Controls, dt: number) {
    if (!lessonMatches(this.step, input, this.mode)) { this.progress = 0; return false; }
    this.progress += Math.max(0, Math.min(.05, dt));
    if (this.progress >= LESSON_ACTION_SECONDS) { this.advance(); return true; } return false;
  }
  controls(input: Controls): Controls {
    const expected = lessonInput(this.step, this.mode);
    return {turn: expected.turn ? input.turn : 0, ...(this.mode === 'pve' ? {horizontal: expected.horizontal ? input.horizontal ?? 0 : 0} : {}), fire: expected.fire && input.fire, boost: expected.boost && input.boost};
  }
  get target() { return this.action === 'fire' ? 'fire' : this.action === 'boost' ? 'boost' : 'stick'; }
  copy(mobile: boolean) {
    if (this.complete) return {title:'Готово!', text:'Можно в бой!', key:''};
    const campaign = this.mode === 'pve', action = this.action;
    const titles = {up:'Вверх', down:'Вниз', left:campaign ? 'Влево' : 'Поворот влево', right:campaign ? 'Вправо' : 'Поворот вправо', fire:'Огонь', boost:'Форсаж'};
    const keys = {up:'W', down:'S', left:'A', right:'D', fire:'Пробел', boost:'Shift'};
    const touch = {up:'Потяни контрол вверх.', down:'Потяни контрол вниз.', left:campaign ? 'Потяни контрол влево.' : 'Потяни контрол вверх.', right:campaign ? 'Потяни контрол вправо.' : 'Потяни контрол вниз.', fire:'Нажми огонь справа.', boost:'Нажми молнию.'};
    return {title:titles[action], text:mobile ? touch[action] : 'Нажми ' + keys[action] + '.', key:keys[action]};
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
