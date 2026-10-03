import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { aircraftCombatMatrix, independentCampaignScenarios, estimateHumanTime, auditCampaign, campaignSourceFingerprint, type PlaythroughResult } from './campaign-playthrough';

function summarize(run: PlaythroughResult) {
  const {visits, missions, timeline, ...summary} = run;
  const kinds = [...new Set(missions.map(m => m.kind))];
  return {...summary, audit:auditCampaign(run), timeline,
    missionStatistics:kinds.map(kind => {
      const rows=missions.filter(m=>m.kind===kind),passed=rows.filter(m=>m.outcome==='passed');
      return {kind,attempts:rows.length,passed:passed.length,lost:rows.length-passed.length,
        seconds:rows.reduce((n,m)=>n+m.seconds,0),maxSuccessfulSeconds:Math.max(0,...passed.map(m=>m.seconds)),
        minSuccessfulSeconds:passed.length?Math.min(...passed.map(m=>m.seconds)):null};
    }),bossVisits:visits.filter(v=>v.phase==='boss'),
    lostMissions:missions.filter(m=>m.outcome==='lost'),
    visitedFlightLevels:[...new Set(visits.filter(v=>v.phase==='flight').map(v=>v.level))]};
}

// Reuse a genuinely executed raw route when auditing it; fixtures never replace
// an incomplete earned career and no mission or boss is skipped by this option.
const rawInput=process.env.CAMPAIGN_RAW_INPUT;
const loaded=rawInput?JSON.parse(await readFile(rawInput,'utf8')):undefined;
const sourceBefore=await campaignSourceFingerprint();
if(loaded&&(loaded.version!=='v0.9'||!loaded.source?.unchangedDuringRun||JSON.stringify(loaded.source.files)!==JSON.stringify(sourceBefore)))throw new Error('Raw report does not match current v0.9 physics/economy/controller sources; execute a fresh route. Historical v0.8 reports stay unchanged.');
const career:PlaythroughResult=loaded?(loaded.runs?.[0]??loaded):independentCampaignScenarios().earnedCareer;
const summary=summarize(career);
const report={generatedAt:new Date().toISOString(),version:'v0.9',
  qualification:'One authoritative earned free career, with real timers, objectives, collisions and boss hits. Separate aircraft point fights are funded combat fixtures, not economic progression or human playtests. Native duration, automated active time and assumed human/menu/retry time are reported separately.',
  execution:rawInput?'Audited previously executed raw full route':'Executed by this command', rawInput:rawInput??null,
  aircraftCombat:aircraftCombatMatrix(),careers:{earnedCareer:summary},humanEstimate:estimateHumanTime([career])};
const sourceAfter=await campaignSourceFingerprint();
const currentReport={...report,source:{files:sourceBefore,unchangedDuringRun:JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter)}};
await mkdir('design-review',{recursive:true});
await writeFile('design-review/campaign-v09-audit.json',JSON.stringify(currentReport,null,2)+'\n');
console.log(JSON.stringify({completed:career.completed,level:career.reachedLevel,finalPhase:career.finalPhase,
  activeSeconds:career.activeSeconds,deaths:career.deaths,audit:summary.audit,humanEstimate:report.humanEstimate},null,2));
if(!career.completed||career.finalPhase!=='ended'||!summary.audit.passed||!currentReport.source.unchangedDuringRun)process.exitCode=1;
