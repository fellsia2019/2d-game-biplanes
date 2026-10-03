import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PLANES, ZONE, MODULES, MAX_UPGRADE_LEVEL, freshProfile, planeStats, researchXp, upgradeSilver, campaignReward, type Profile, type Upgrade } from '../shared/data';
import { sortieReward, operationPlan, operationMission, campaignMinimumSeconds } from '../shared/operations';
import { buyPlane, buyModule, buyUpgrade, researchUpgrade } from '../server/economy';
import { createBattle, makePlane, stepBattle } from '../shared/simulation';

export function weaponBenchmark(model: string, level = 0, module = '', duration = 60) {
  const profile = freshProfile('benchmark'); profile.selected = model;
  profile.upgrades[model] = {hull:level, engine:level, gun:level}; profile.modules = module ? [module] : []; profile.module = module;
  const stats = planeStats(profile), pilot = makePlane(profile.id, {...stats, speed:0});
  const state = createBattle('weapon-benchmark', 'duel', [pilot]); let shots = 0, seen = 0, overheated = 0;
  for (let frame = 0; frame < duration * 30; frame++) {
    stepBattle(state, {[pilot.id]:{turn:0, fire:true, boost:false}}, 1/30);
    shots += state.effects.filter(e => e.id > seen && e.kind === 'shot').length; seen = state.seq;
    if (pilot.overheated) overheated++;
  }
  return {stats, shots, dps:shots * stats.damage / duration, overheatFraction:overheated / (duration * 30)};
}

const FUNDS = {silver:1_000_000, xp:500_000, gold:1000};
const fundedOrigins = new Map<string, Profile>();
function fundedOrigin(model: string) {
  if (!fundedOrigins.has(model)) {
    const p = freshProfile('aircraft-matrix'); Object.assign(p, FUNDS); p.totalXp = FUNDS.xp;
    p.defeatedBosses = ZONE.filter(z => z.boss).map(z => z.level);
    const target = PLANES.find(m => m.id === model); if (!target) throw new Error('Unknown aircraft fixture');
    // Previous free aircraft really pass checkout and research. This is only a
    // funded fixture; boss flags and starting money are explicitly assumed.
    if (target.currency === 'silver') for (const previous of PLANES.filter(m => m.currency === 'silver' && m.hp < target.hp)) {
      buyPlane(p, previous.id); p.selected = previous.id;
      for (const branch of ['hull', 'engine', 'gun'] as const) for (let n = 1; n <= MAX_UPGRADE_LEVEL; n++) { researchUpgrade(p, branch, n); buyUpgrade(p, branch, n); }
    }
    buyPlane(p, model); p.selected = model; fundedOrigins.set(model, p);
  }
  return structuredClone(fundedOrigins.get(model)!);
}

export function purchasedBuild(model: string, build: Record<Upgrade, number>, module = '') {
  const p = fundedOrigin(model);
  for (const branch of ['hull', 'engine', 'gun'] as const) for (let n = 1; n <= build[branch]; n++) { researchUpgrade(p, branch, n); buyUpgrade(p, branch, n); }
  if (module) buyModule(p, module);
  return p;
}

export function boostBenchmark(model: string, module = '') {
  const p = purchasedBuild(model, {hull:0, engine:0, gun:0}, module);
  const pilot = makePlane(p.id, planeStats(p)), state = createBattle('boost-fixture', 'duel', [pilot]);
  let burstSeconds = 0, recoverySeconds = 0;
  while (pilot.energy > .03 && burstSeconds < 20) { stepBattle(state, {[pilot.id]:{turn:0, fire:false, boost:true}}, 1/30); burstSeconds += 1/30; }
  while (pilot.energy < 1 && recoverySeconds < 20) { stepBattle(state, {[pilot.id]:{turn:0, fire:false, boost:false}}, 1/30); recoverySeconds += 1/30; }
  return {burstSeconds, recoverySeconds, fullCharge:pilot.energy === 1, health:pilot.health};
}

export function aircraftMatrix() {
  const modes = ['', ...MODULES.map(m => m.id)], width = MAX_UPGRADE_LEVEL + 1;
  const weaponCurves = PLANES.flatMap(p => modes.flatMap(module => Array.from({length:width}, (_, gun) => ({model:p.id, module, gun, ...weaponBenchmark(p.id, gun, module)}))));
  const errors: {key:string; error:string}[] = [], samples: {model:string; module:string; build:Record<Upgrade,number>; stats:ReturnType<typeof planeStats>; cost:typeof FUNDS}[] = [];
  const counts: Record<string, number> = {}; let combinations = 0, simulated = 0;
  for (const p of PLANES) for (const module of modes) for (let index = 0; index < width ** 3; index++) {
    const build = {hull:Math.floor(index / width ** 2), engine:Math.floor(index / width) % width, gun:index % width};
    const key = [p.id, module, ...Object.values(build)].join(':');
    combinations++; counts[p.id] = (counts[p.id] ?? 0) + 1;
    try {
      const profile = purchasedBuild(p.id, build, module), stats = planeStats(profile);
      const pilot = makePlane('matrix', stats), battle = createBattle(key, 'duel', [pilot]);
      for (let frame = 0; frame < 10; frame++) stepBattle(battle, {matrix:{turn:0, fire:true, boost:true}}, 1/30);
      if (![pilot.x,pilot.y,pilot.health,pilot.energy,pilot.heat,pilot.damage,pilot.speed,pilot.turn].every(Number.isFinite) || pilot.health !== pilot.hp || !battle.bullets.some(b => b.owner === 'matrix' && b.damage > 0)) throw new Error('Non-finite combat state, unexpected damage or missing weapon shot');
      simulated++;
      if (index === 0 || index === width ** 3 - 1) samples.push({model:p.id, module, build, stats, cost:{silver:FUNDS.silver-profile.silver, xp:FUNDS.xp-profile.xp, gold:FUNDS.gold-profile.gold}});
    } catch (error) { if (errors.length < 100) errors.push({key, error:String(error)}); }
  }
  const boost = PLANES.flatMap(p => modes.map(module => ({model:p.id, module, ...boostBenchmark(p.id, module)})));
  return {method:'Every aircraft/0..15 hull/0..15 engine/0..15 gun/module combination passes real economy checkout and 10 authoritative combat frames. Previous free aircraft are legally purchased/full-upgraded in funded fixtures. Weapon curves use real 60s heat cycles; boost uses real depletion/recharge. This is not earned campaign progression or timed humans. Costs include required preceding aircraft; the huge matrix is verified in memory and reported as counts plus corner samples.', combinations, simulated, counts, errors, weaponCurves, boost, samples};
}

export function balanceReport() {
  const planes = PLANES.map(model => ({id:model.id, name:model.name, price:model.price, base:weaponBenchmark(model.id), max:weaponBenchmark(model.id,MAX_UPGRADE_LEVEL), radiator:weaponBenchmark(model.id,MAX_UPGRADE_LEVEL,'radiator')}));
  const transitions = planes.slice(1).map((next, i) => {
    const previous = planes[i];
    return {from:previous.name, to:next.name, hpGain:next.base.stats.hp/previous.max.stats.hp-1, dpsGain:next.base.dps/Math.max(previous.max.dps,previous.radiator.dps)-1, speedGain:next.base.stats.speed/previous.max.stats.speed-1, turnGain:next.base.stats.turn/previous.max.stats.turn-1};
  });
  const phases = [{first:1,last:25,model:'universal',next:'swift'}, {first:26,last:100,model:'swift',next:'yantar'}, {first:101,last:200,model:'yantar',next:'bastion'}, {first:201,last:250,model:'bastion',next:undefined}];
  const missionIncome=(levels:typeof ZONE,killsPerCombatSortie:number,quietKills:number)=>{
    let killsSilver=0,killsXp=0,bonusSilver=0,bonusXp=0,killCount=0;
    for(const l of levels)for(let sortie=0;sortie<operationPlan(l.level).sorties;sortie++) {
      const mission=operationMission(l.level,sortie),quiet=mission.kind==='recon'||mission.kind==='supply';
      const kills=Math.max(mission.targetKills,mission.targetSpecial,quiet?quietKills:killsPerCombatSortie);
      const silver=kills*campaignReward(l.killSilver),xp=kills*campaignReward(l.killXp),budget=sortieReward(l.level);
      killCount+=kills;killsSilver+=silver;killsXp+=xp;
      bonusSilver+=Math.max(0,silver-campaignReward(budget.silver));bonusXp+=Math.max(0,xp-campaignReward(budget.xp));
    }
    return {killsSilver,killsXp,bonusSilver,bonusXp,killCount};
  };
  const economy = phases.map(phase => {
    const levels = ZONE.slice(phase.first-1,phase.last), sorties = levels.reduce((sum,l) => sum + operationPlan(l.level).sorties,0);
    const guaranteedSilver = levels.reduce((sum,l) => sum + operationPlan(l.level).sorties*campaignReward(sortieReward(l.level).silver)+campaignReward(l.rewardSilver)+(l.boss?campaignReward(l.boss.silver):0),0);
    const guaranteedXp = levels.reduce((sum,l) => sum + operationPlan(l.level).sorties*campaignReward(sortieReward(l.level).xp)+campaignReward(l.rewardXp)+(l.boss?campaignReward(l.boss.xp):0),0);
    const upgradeCost = Array.from({length:MAX_UPGRADE_LEVEL},(_,i) => ({silver:upgradeSilver(i+1,phase.model),xp:researchXp(i+1,phase.model)}));
    const buildSilver = 3 * upgradeCost.reduce((s,c) => s+c.silver,0), buildXp = 3 * upgradeCost.reduce((s,c) => s+c.xp,0), target = PLANES.find(p => p.id === phase.next);
    const nativeSeconds = campaignMinimumSeconds(phase.last) - campaignMinimumSeconds(phase.first-1);
    return {...phase, sorties, nativeSeconds, guaranteedSilver, guaranteedXp, build:{hull:MAX_UPGRADE_LEVEL,engine:MAX_UPGRADE_LEVEL,gun:MAX_UPGRADE_LEVEL}, buildSilver, buildXp, planePrice:target?.price ?? 0,
      // Scenarios are explicit. Actual kills, purchases, retries and time are
      // supplied by the authoritative earned campaign playthrough report.
      incomeCases:[2,4,6,8].map(killsPerSortie => {
        const income=missionIncome(levels,killsPerSortie,Math.floor(killsPerSortie/2));
        return {killsPerSortie,quietKillsPerSortie:Math.floor(killsPerSortie/2),...income,silverAfterFullBuildAndPlane:guaranteedSilver+income.bonusSilver-buildSilver-(target?.price??0)+(phase.first===1?200:0),xpAfterFullBuild:guaranteedXp+income.bonusXp-buildXp};
      })};
  });
  const careerBudgetCases=[{name:'goals-only',combatKills:0,quietKills:0},{name:'novice6',combatKills:6,quietKills:2},{name:'novice8',combatKills:8,quietKills:3},{name:'competent10',combatKills:10,quietKills:4}].map(scenario=>{
    let silver=200,xp=0;
    const stages=economy.map(phase=>{
      const income=missionIncome(ZONE.slice(phase.first-1,phase.last),scenario.combatKills,scenario.quietKills),start={silver,xp};
      const earned={silver:phase.guaranteedSilver+income.bonusSilver,xp:phase.guaranteedXp+income.bonusXp};
      const optionalPhaseSkill=phase.first===1?{silver:1200,xp:300}:{silver:0,xp:0};
      silver+=earned.silver-phase.buildSilver-phase.planePrice-optionalPhaseSkill.silver;xp+=earned.xp-phase.buildXp-optionalPhaseSkill.xp;
      return {model:phase.model,first:phase.first,last:phase.last,start,earned,killCount:income.killCount,fullUpgradeCost:{silver:phase.buildSilver,xp:phase.buildXp},nextPlanePrice:phase.planePrice,optionalPhaseSkill,end:{silver,xp},affordable:silver>=0&&xp>=0};
    });
    return {...scenario,qualification:'Successful missions with their actual minimum objectives enforced. Quiet missions have a separate kill assumption. Kill credits count toward the guaranteed sortie total; only amounts above it increase income. Banks carry across aircraft stages. One optional permanent phase skill is budgeted, although the actual free controller does not require it.',stages,affordable:stages.every(stage=>stage.affordable)};
  });
  return {generatedAt:new Date().toISOString(),version:'v0.8',method:'Authoritative 60s weapon fixtures and all 61440 legal funded aircraft/module/upgrade checkouts. Economy models guaranteed TOTAL sortie earnings, including already paid kills, plus only above-floor bonuses. Goals-only/6/8/10 kill scenarios carry banks between aircraft and include one optional phase skill. Native mission duration is a hard minimum; human timing and earned affordability require the separate actual campaign report.',planes,transitions,economy,careerBudgetCases,
    nativeDuration:{campaignSeconds:campaignMinimumSeconds(ZONE.length),aircraft:PLANES.map(p=>({id:p.id,unlockBoss:p.unlockBoss,minimumSeconds:campaignMinimumSeconds(p.unlockBoss)}))},aircraftAudit:aircraftMatrix()};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = balanceReport(); await mkdir('design-review',{recursive:true});
  await writeFile('design-review/balance-v08-report.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({nativeDuration:report.nativeDuration,economy:report.economy,audit:{combinations:report.aircraftAudit.combinations,simulated:report.aircraftAudit.simulated,errors:report.aircraftAudit.errors}},null,2));
  if (report.aircraftAudit.errors.length) process.exitCode=1;
}
