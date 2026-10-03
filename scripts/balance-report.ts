import { mkdir, writeFile } from 'node:fs/promises';
import { PLANES, ZONE, freshProfile, planeStats, RESEARCH_XP, upgradeSilver, campaignReward } from '../shared/data';
import { createBattle, makePlane, stepBattle } from '../shared/simulation';

export function weaponBenchmark(model: string, level = 0, module = '', duration = 60) {
  const profile = freshProfile('benchmark'); profile.selected = model;
  profile.upgrades[model] = {hull:level, engine:level, gun:level}; profile.modules = module ? [module] : []; profile.module = module;
  const stats = planeStats(profile), pilot = makePlane(profile.id,stats); pilot.speed = 0; pilot.y = 100;
  const state = createBattle('weapon-benchmark','duel',[pilot]); let shots = 0, seen = 0, overheated = 0;
  for (let frame=0;frame<duration*30;frame++) {
    stepBattle(state,{[pilot.id]:{turn:0,fire:true,boost:false}},1/30);
    shots += state.effects.filter(e=>e.id>seen&&e.kind==='shot').length; seen=state.seq;
    if(pilot.overheated) overheated++;
  }
  return {stats, shots, dps: shots*stats.damage/duration, overheatFraction: overheated/(duration*30)};
}
export function spawnBenchmark(first: number, last: number, boost = false, seeds = 12) {
  let targets = 0, seconds = 0;
  for (let seed=0;seed<seeds;seed++) for(let level=first;level<=last;level++) {
    const pilot=makePlane('observer',planeStats(freshProfile('observer')));
    const state=createBattle('spawn-'+seed+'-'+level,'pve',[pilot],level);
    pilot.y=85; pilot.shield=9999; pilot.ram=9999;
    const seen=new Set<number>();
    while(state.phase==='flight'&&state.level===level&&state.time<60) {
      stepBattle(state,{observer:{turn:0,fire:false,boost}},1/30);
      for(const unit of state.obstacles) if(unit.kind!=='rock'&&unit.x<1000&&unit.hp>0) seen.add(unit.id);
    }
    targets+=seen.size; seconds+=state.time;
  }
  return {seeds,averageVisibleTargets:targets/(seeds*(last-first+1)),averageSeconds:seconds/(seeds*(last-first+1))};
}
export function balanceReport() {
  const planes = PLANES.map(model => {
    const base=weaponBenchmark(model.id), max=weaponBenchmark(model.id,5), radiator=weaponBenchmark(model.id,5,'radiator');
    return {id:model.id,name:model.name,price:model.price,base,max,radiator};
  });
  const transitions=planes.slice(1).map((next,i)=>{
    const previous=planes[i];
    return {from:previous.name,to:next.name,hpGain:next.base.stats.hp/previous.max.stats.hp-1,
      dpsGain:next.base.dps/Math.max(previous.max.dps,previous.radiator.dps)-1,
      speedGain:next.base.stats.speed/previous.max.stats.speed-1,turnGain:next.base.stats.turn/previous.max.stats.turn-1};
  });
  const phases=[[1,10,'universal','swift'],[11,25,'swift','yantar'],[26,50,'yantar','bastion']] as const;
  const economy=phases.map(([first,last,model,next])=>{
    const levels=ZONE.slice(first-1,last), tier=levels[0].tier;
    const boss=levels.at(-1)!.boss!;
    // Conservative scenario, not telemetry: three ordinary kills per level; no heavy/PVO bonus.
    const guaranteedSilver=levels.reduce((sum,l)=>sum+campaignReward(l.rewardSilver),0)+campaignReward(boss.silver);
    const guaranteedXp=levels.reduce((sum,l)=>sum+campaignReward(l.rewardXp),0)+campaignReward(boss.xp);
    const expectedKills=levels.length*3, killsSilver=expectedKills*campaignReward(levels[0].killSilver), killsXp=expectedKills*campaignReward(levels[0].killXp);
    const build = tier===1 ? {hull:2,engine:1,gun:3} : tier===2 ? {hull:2,engine:2,gun:3} : {hull:4,engine:3,gun:5};
    const buildSilver=Object.values(build).reduce((sum,n)=>sum+Array.from({length:n},(_,i)=>upgradeSilver(i+1)).reduce((a,b)=>a+b,0),0);
    const buildXp=Object.values(build).reduce((sum,n)=>sum+RESEARCH_XP.slice(0,n).reduce((a,b)=>a+b,0),0);
    const target=PLANES.find(p=>p.id===next)!;
    const reference=weaponBenchmark(model,3), maximum=weaponBenchmark(model,5), naked=weaponBenchmark(model), recommended=weaponBenchmark(model,build.gun);
    const recommendedHp=PLANES.find(p=>p.id===model)!.hp*(1+build.hull*.06);
    return {first,last,model,next,build,guaranteedSilver,guaranteedXp,expectedKills,killsSilver,killsXp,buildSilver,buildXp,planePrice:target.price,
      preBossSilver: guaranteedSilver-campaignReward(boss.silver)-campaignReward(levels.at(-1)!.rewardSilver)+killsSilver+(tier===1?200:0)-buildSilver,
      preBossXp: guaranteedXp-campaignReward(boss.xp)-campaignReward(levels.at(-1)!.rewardXp)+killsXp-buildXp,
      incomeCases:[1,3,5].map(killsPerLevel=>({killsPerLevel,silverAfterBuildAndPlane:guaranteedSilver+levels.length*killsPerLevel*campaignReward(levels[0].killSilver)-buildSilver-target.price+(tier===1?200:0)})),
      silverAfterBuildAndPlane:guaranteedSilver+killsSilver-buildSilver-target.price+(tier===1?200:0),
      xpAfterBuild:guaranteedXp+killsXp-buildXp,
      spawn:{normal:spawnBenchmark(first,last),boost:spawnBenchmark(first,last,true)},
      enemyShotsToKill:levels.map(l=>({level:l.level,base:Math.ceil(l.enemyHp/naked.stats.damage),recommended:Math.ceil(l.enemyHp/recommended.stats.damage),heavy:Math.ceil(l.enemyHp*2/recommended.stats.damage)})),
      boss:{...boss,silver:campaignReward(boss.silver),xp:campaignReward(boss.xp),baseTtk:boss.hp/(naked.dps*.4),level3Ttk:boss.hp/(reference.dps*.4),recommendedTtk:boss.hp/(recommended.dps*.4),maxTtk:boss.hp/(maximum.dps*.4),
        hitsToDefeatPlayer:Math.ceil(recommendedHp/boss.damage),survivalSeconds:[.1,.2,.3].map(hitRate=>({hitRate,seconds:recommendedHp/(boss.damage/boss.cooldown*hitRate)})),
        maxTtkRange:[boss.hp/(maximum.dps*.55),boss.hp/(maximum.dps*.3)]}};
  });
  return {generatedAt:new Date().toISOString(),method:'30 Hz authoritative simulation, 60 seconds held fire, no aim assist. TTK uses 40% hit rate; range 30–55%. Income scenario assumes three kills per level, no ads, paid gold, tasks or login bonuses.',planes,transitions,economy};
}
if (process.argv[1]?.endsWith('balance-report.ts')) {
  const report=balanceReport(); await mkdir('design-review',{recursive:true});
  await writeFile('design-review/balance-report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({transitions:report.transitions,economy:report.economy},null,2));
}
