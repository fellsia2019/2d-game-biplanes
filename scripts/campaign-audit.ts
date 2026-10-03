import { mkdir, writeFile } from 'node:fs/promises';
import { aircraftCombatMatrix, independentCampaignScenarios, estimateHumanTime, type PlaythroughResult } from './campaign-playthrough';

function summarize(run: PlaythroughResult) {
  const {visits, ...summary} = run;
  return {...summary, bossVisits:visits.filter(v=>v.phase==='boss'), visitedFlightLevels:[...new Set(visits.filter(v=>v.phase==='flight').map(v=>v.level))]};
}

const campaigns = independentCampaignScenarios();
const report = {
  generatedAt:new Date().toISOString(), qualification:campaigns.qualification,
  aircraftCombat:aircraftCombatMatrix(),
  careers:{firstOffer:summarize(campaigns.firstOffer),earlyNoUpgrade:summarize(campaigns.earlyNoUpgrade),paidPhoenix:summarize(campaigns.paidPhoenix),sampledKeyboard:summarize(campaigns.sampledKeyboard)},
  humanEstimate:{
    qualification:'Scenario estimates, not timed human participants. Full careers are estimated separately; the early 50-level test is not extrapolated to the whole campaign.',
    freeFirstOffer:estimateHumanTime([campaigns.firstOffer]),paidPhoenix:estimateHumanTime([campaigns.paidPhoenix]),sampledKeyboard:estimateHumanTime([campaigns.sampledKeyboard]),
  },
};
await mkdir('design-review',{recursive:true});
await writeFile('design-review/campaign-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({careers:Object.fromEntries(Object.entries(report.careers).map(([key,run])=>[key,{completed:run.completed,level:run.reachedLevel,finalPhase:run.finalPhase,activeSeconds:run.activeSeconds,deaths:run.deaths,bossDeaths:run.bossDeaths,scenario:run.scenario}])),humanEstimate:report.humanEstimate},null,2));
if ([campaigns.firstOffer,campaigns.paidPhoenix,campaigns.sampledKeyboard].some(r=>!r.completed||r.finalPhase!=='ended')||!campaigns.earlyNoUpgrade.completed) process.exitCode=1;
