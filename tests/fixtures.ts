import type { Battle } from '../shared/simulation';
import { freshOperation, operationMission, operationPlan } from '../shared/operations';

// Only for transition/geometry fixtures. Earned playthroughs must complete
// their actual missions through input, combat and elapsed simulation time.
export function readyLastSortie(state: Battle) {
  const completed = operationPlan(state.level).sorties - 1;
  const mission = operationMission(state.level, completed);
  state.operation = {
    ...freshOperation(completed), seconds: mission.seconds,
    kills: mission.targetKills, specialKills: mission.targetSpecial,
    collected: mission.targetPickups,
  };
  return mission;
}
