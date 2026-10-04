import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { hasPremium, PREMIUM_DURATION_MS } from '../shared/premium';
class DebugPeer {
  ws = new WebSocket('ws://127.0.0.1:5198/socket'); messages: any[]=[];
  waiters: {predicate:(m:any)=>boolean;resolve:(m:any)=>void}[]=[];
  constructor() { this.ws.on('message', raw=>{const m=JSON.parse(String(raw));this.messages.push(m);for(const w of [...this.waiters])if(w.predicate(m)){this.waiters.splice(this.waiters.indexOf(w),1);w.resolve(m);}}); }
  async open(){await new Promise<void>((r,j)=>{this.ws.once('open',r);this.ws.once('error',j);});}
  wait(predicate:(m:any)=>boolean){return new Promise<any>((r,j)=>{const timer=setTimeout(()=>j(new Error('Ожидание debug-сервера')),5000);this.waiters.push({predicate,resolve:m=>{clearTimeout(timer);r(m);}});});}
  send(m:object){this.ws.send(JSON.stringify(m));}
  last(type:string){return this.messages.filter(m=>m.type===type).at(-1);}
  async call(type:string,data:object={}){const requestId=randomUUID(),result=this.wait(m=>m.type==='reply'&&m.requestId===requestId);this.send({type,requestId,...data});const reply=await result;if(!reply.ok)throw new Error(reply.error);return reply.result;}
  async auth(token?:string){const welcome=this.wait(m=>m.type==='welcome'),profile=this.wait(m=>m.type==='profile');this.send({type:'auth',token});return {welcome:await welcome,profile:await profile};}
}
async function withServer(debug:boolean, work:(peer:DebugPeer,store:string)=>Promise<void>){
  const dir=await mkdtemp(join(tmpdir(),'biplanes-debug-test-')),store=join(dir,'profiles.json');
  const proc=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:'5198',HOST:'127.0.0.1',NODE_ENV:'test',BIPLANES_DEBUG:debug?'1':'0',BIPLANES_DATA:store},stdio:['ignore','pipe','pipe']});
  let peer:DebugPeer|undefined;
  try{
    await new Promise<void>((r,j)=>{proc.stdout.on('data',d=>{if(String(d).includes('Сервер Бипланы'))r();});proc.once('exit',code=>j(new Error('Server exit '+code)));setTimeout(()=>j(new Error('Server timeout')),6000).unref();});
    peer=new DebugPeer();await peer.open();await work(peer,store);
  }finally{
    peer?.ws.close();proc.kill();await new Promise<void>(r=>{if(proc.exitCode!==null)r();else{proc.once('exit',()=>r());setTimeout(r,3000).unref();}});
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'\\')||resolve(dir).startsWith(resolve(tmpdir())+'/'));await rm(dir,{recursive:true,force:true});
  }
}
test('Обычный сервер отклоняет debug-команды и не меняет баланс',async()=>{
  await withServer(false,async peer=>{const auth=await peer.auth();assert.equal(auth.welcome.debugEnabled,false);await assert.rejects(peer.call('debug',{action:'gold',amount:1000}),/отключена/);const p=peer.wait(m=>m.type==='profile');peer.send({type:'refresh'});assert.equal((await p).profile.gold,0);});
});

test('Debug premium toggles persist and update the current boss; normal server rejects both actions', async()=>{
  await withServer(false, async peer=>{
    await peer.auth();
    for(const action of ['premium-on','premium-off']) await assert.rejects(peer.call('debug',{action}), /отключена/);
    const profile=peer.wait(m=>m.type==='profile');peer.send({type:'refresh'});
    assert.equal(hasPremium((await profile).profile),false);
  });
  await withServer(true, async(peer,store)=>{
    await peer.auth();
    await peer.call('debug',{action:'premium-on'});
    let saved=JSON.parse(await readFile(store,'utf8'))[0];
    assert.equal(hasPremium(saved.profile),true);
    assert.equal(saved.profile.premium.expiresAt-saved.profile.premium.purchasedAt,PREMIUM_DURATION_MS);
    const start=peer.wait(m=>m.type==='start');peer.send({type:'pve'});await start;
    for(let level=2;level<=10;level++)await peer.call('debug',{action:'next-level',paused:true});
    assert.equal(peer.last('start').battle.bossAttemptsUnlimited,true);
    const before=peer.last('start').battle;
    await peer.call('debug',{action:'premium-off'});
    assert.equal(peer.last('state').battle.bossAttemptsUnlimited,false);
    assert.equal(peer.last('state').battle.id,before.id);
    assert.equal(peer.last('state').battle.paused,true);
    saved=JSON.parse(await readFile(store,'utf8'))[0];assert.equal(saved.profile.premium,undefined);
    await peer.call('debug',{action:'premium-on'});
    assert.equal(peer.last('state').battle.bossAttemptsUnlimited,true);
    assert.equal(hasPremium(peer.last('profile').profile),true);
  });
});
test('Debug: ресурсы сохраняются, +1 идёт через уровни, босс и ангар заморожены, выбор карточки атомарен', {timeout:20000}, async()=>{
  await withServer(true,async(peer,store)=>{
    const auth=await peer.auth();assert.equal(auth.welcome.debugEnabled,true);
    for(const action of ['xp','gold','silver'])await peer.call('debug',{action,amount:1000});
    const disk=JSON.parse(await readFile(store,'utf8'))[0];assert.equal(disk.profile.gold,1000);assert.equal(disk.profile.silver,1200);assert.equal(disk.profile.xp,1000);assert.equal(disk.profile.totalXp,1000);
    await assert.rejects(peer.call('debug',{action:'xp',amount:-10}),/количество/);
    let start=peer.wait(m=>m.type==='start');peer.send({type:'pve'});await start;
    for(let level=2;level<=10;level++){await peer.call('debug',{action:'next-level',paused:true});assert.equal(peer.last('start').battle.level,level);}
    const intro=peer.last('start').battle;assert.equal(intro.phase,'boss-intro');assert.equal(intro.bossAttempt,1);
    peer.send({type:'input',turn:1,fire:true,boost:true});peer.send({type:'pause',paused:false});const idle=await peer.wait(m=>m.type==='state');assert.equal(idle.battle.time,intro.time);assert.equal(idle.battle.planes[0].health,intro.planes[0].health);
    let menu=peer.wait(m=>m.type==='profile');peer.send({type:'leave'});assert.equal((await menu).bossGateLevel,10);
    peer.send({type:'research',branch:'hull',level:1,nonce:randomUUID()});await peer.wait(m=>m.type==='profile');
    peer.send({type:'upgrade',branch:'hull',level:1,nonce:randomUUID()});await peer.wait(m=>m.type==='profile');
    start=peer.wait(m=>m.type==='start');peer.send({type:'pve',resume:true});const returned=(await start).battle;assert.equal(returned.id,intro.id);assert.equal(returned.phase,'boss-intro');assert.equal(returned.planes[0].hp,102);assert.equal(returned.bossAttempt,1);
    await peer.call('debug',{action:'win-boss'});const offer=peer.last('profile').bossOffer;assert.equal(offer.options.length,3);assert.equal(peer.last('state').battle.phase,'reward');
    const token=auth.welcome.token;
    menu=peer.wait(m=>m.type==='profile');peer.send({type:'leave'});assert.deepEqual((await menu).bossOffer,offer);
    const reload=new DebugPeer();try{
      await reload.open();const same=await reload.auth(token);assert.deepEqual(same.profile.bossOffer,offer);
      await reload.call('modifier-choose',{offerId:offer.id,id:offer.options[0]});
      const saved=JSON.parse(await readFile(store,'utf8'))[0];assert.equal(saved.profile.modifiers.length,1);assert.equal(saved.profile.modifiers[0].id,offer.options[0]);
      await reload.call('modifier-choose',{offerId:offer.id,id:offer.options[0]});await assert.rejects(reload.call('modifier-choose',{offerId:offer.id,id:offer.options[1]}),/Перевыбрать/);
      start=reload.wait(m=>m.type==='start');reload.send({type:'pve',resume:true});assert.equal((await start).battle.level,11);
      for(let level=12;level<=25;level++)await reload.call('debug',{action:'next-level',paused:true});
      await reload.call('debug',{action:'win-boss'});const nextOffer=reload.last('profile').bossOffer;assert.ok(!nextOffer.options.includes(offer.options[0]));
      await reload.call('modifier-choose',{offerId:nextOffer.id,id:nextOffer.options[0],paused:true});assert.equal(reload.last('state').battle.level,26);assert.equal(reload.last('profile').profile.modifiers.length,2);
    }finally{reload.ws.close();}
  });
});
