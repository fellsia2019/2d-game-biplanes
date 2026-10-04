import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProfile, planeStats, careerStage } from '../shared/data';
import { createBattle, makePlane, beginBoss } from '../shared/simulation';
import { finishCareer, prepareBossAttempt, type CareerAccount } from '../server/career';
const now = 1800000000000;
function account(premium = false): CareerAccount {
  const profile = freshProfile('premium-boss');
  if (premium) profile.premium = {active:true, purchasedAt:now-1000, expiresAt:now+1000};
  return {profile, restartLevel:25, restartBoss:true};
}
function lose(a: CareerAccount, id: string, time = now) {
  const battle = createBattle(id,'pve',[makePlane(a.profile.id,planeStats(a.profile,true))],25);
  beginBoss(battle); prepareBossAttempt(a,battle,time);
  battle.planes[0].health=0; battle.phase='ended'; finishCareer(a,battle,time);
  return battle;
}
test('Active premium permits repeated boss defeats without a stage reset, including reconnect state',()=>{
  let a=account(true);
  for(let n=0;n<8;n++) {
    const battle=lose(a,'premium-loss-'+n);
    assert.equal(battle.bossAttemptsUnlimited,true);
    assert.equal(battle.bossAttemptsExhausted,undefined);
    assert.equal(a.restartLevel,25); assert.equal(a.restartBoss,true);
    const saved=JSON.stringify(a); finishCareer(a,battle,now); assert.equal(JSON.stringify(a),saved,'duplicate loss is ignored');
    a=JSON.parse(saved);
  }
});
test('Free, expired and malformed premium profiles still reset after three boss defeats',()=>{
  for(const state of ['free','expired','malformed']) {
    const a=account(state!=='free');
    if(state==='expired')a.profile.premium!.expiresAt=now;
    if(state==='malformed')a.profile.premium!.purchasedAt=NaN;
    lose(a,state+'-1'); lose(a,state+'-2'); const third=lose(a,state+'-3');
    assert.equal(third.bossAttemptsUnlimited,false); assert.equal(third.bossAttemptsExhausted,true);
    assert.equal(a.restartLevel,careerStage(25).start); assert.equal(a.restartBoss,false);
  }
});
test('Premium purchased after two losses protects the next defeat; expiry starts a fresh normal limit',()=>{
  const a=account(); lose(a,'free-1');lose(a,'free-2');
  a.profile.premium={active:true,purchasedAt:now-100,expiresAt:now+1000};
  assert.equal(lose(a,'now-premium').bossAttemptsExhausted,undefined);
  assert.equal(a.bossFailures?.count,0);
  for(let n=1;n<=3;n++) {
    const loss=lose(a,'expired-'+n,now+1000);
    assert.equal(loss.bossAttemptsExhausted,n===3?true:undefined);
  }
});
test('Premium is checked at the defeat, including an expiry during the battle',()=>{
  const a=account(true); a.bossFailures={level:25,count:2};
  const battle=createBattle('expiring','pve',[makePlane(a.profile.id,planeStats(a.profile,true))],25);
  beginBoss(battle); prepareBossAttempt(a,battle,now); assert.equal(battle.bossAttemptsUnlimited,true);
  battle.planes[0].health=0; battle.phase='ended';finishCareer(a,battle,now+1000);
  assert.equal(battle.bossAttemptsUnlimited,false); assert.equal(battle.bossAttemptsExhausted,true);
});
