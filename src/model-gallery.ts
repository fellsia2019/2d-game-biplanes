import Phaser from 'phaser';
import './model-gallery.css';
import { PLANES, ZONE, freshProfile, planeStats } from '../shared/data';
import { createBattle, makePlane, stepBattle, beginBoss } from '../shared/simulation';
import { GROUND_Y, type PvoModel } from '../shared/terrain';
import { bossAircraft, aircraftAsset, prepareAircraft, paintAircraft } from './aircraft';
import { drawGoldenTrail } from './aircraft-effects';
import { canvasPainter, drawPvo, drawRock } from './ground-art';
import { PVO_MODELS, pvoAsset, preparePvo } from './pvo-art';
import { SkyScene } from './scene';
type Frame = { canvas: HTMLCanvasElement; type: 'plane' | 'pvo' | 'rock'; model?: string; pvoModel?: PvoModel; variant?: number; height?: number; width?: number; buffer?: HTMLCanvasElement };
const frames: Frame[] = [];
function card(section: string, title: string, tag: string, detail: string, frame: Omit<Frame, 'canvas'>) {
  const article = document.createElement('article'); article.className = 'model-card';
  article.innerHTML = `<canvas class="model-frame" width="720" height="360" role="img" aria-label="${title}"></canvas><div class="model-copy"><span class="model-tag">${tag}</span><h3>${title}</h3><p>${detail}</p></div>`;
  document.querySelector('#' + section + ' .model-grid')!.append(article);
  frames.push({ canvas: article.querySelector('canvas')!, ...frame });
}
for (const model of PLANES) card('players', model.name, model.currency === 'gold' ? 'За золото' : model.price ? 'За серебро' : 'Стартовый', model.role, { type:'plane',model:model.id,width:470 });
card('enemies','Истребитель','Карьера','Собственный оливковый биплан. Летит влево и стреляет по носу.',{type:'plane',model:'enemy',width:360});
card('enemies','Тяжёлый истребитель','Карьера','Собственный тяжёлый самолёт с двумя двигателями и двойным хвостом.',{type:'plane',model:'enemy-heavy',width:470});
card('enemies','Бот дуэли','Один на один','Пример. Случайная модель из ангара игрока, близкая по силе.',{type:'plane',model:'swift',width:470});
for (const zone of ZONE.filter(z => z.boss)) card('enemies',zone.boss!.name,'Босс · уровень '+zone.level,zone.level===10?'Синий гоночный биплан с молниями.':zone.level===25?'Алый перехватчик с крылом «чайка».':'Четырёхмоторная крепость с золотыми деталями.',{type:'plane',model:bossAircraft(zone.level),width:530});
for (const [index, pvoModel] of PVO_MODELS.entries()) card('ground', ['Гусеничная ПВО','Колёсная ПВО','Стационарная ПВО'][index], 'С уровня ' + [11,26,51][index], index===2?'Для продолжения после текущих 50 уровней.':'Появляется вместе с ранее открытыми моделями.', {type:'pvo',pvoModel});
const names=['Песчаный выступ','Скальные колонны','Горный гребень'];
for (let variant=0;variant<3;variant++) for (const height of [140,280]) card('obstacles',names[variant]+' · '+(height===140?'низкий':'высокий'),'Препятствие · отдельный кадр',height===140?'Обход сверху. Высота 140.':'Обход сверху. Высота 280.',{type:'rock',variant,height});
const art = new Map<string, ReturnType<typeof prepareAircraft>>();
await Promise.all(Array.from(new Set(frames.filter(f=>f.type==='plane').map(f=>f.model!))).map(async id=>{
  const image = new Image(); image.src = aircraftAsset(id); await image.decode(); art.set(id,prepareAircraft(image,id));
}));
await Promise.all(PVO_MODELS.map(async model => { const image = new Image(); image.src = pvoAsset(model); await image.decode(); preparePvo(image, model); }));
let paused=false,time=0,last=performance.now(),boost=false;
const scene=new SkyScene(), profile=freshProfile('gallery'); let pilot=makePlane(profile.id,planeStats(profile)); pilot.shield=9999;
let battle=createBattle('gallery-flight','pve',[pilot]); battle.spawn=99999;
function seedObstacles(){battle.obstacles=[0,1,2].map((id)=>({id,kind:'rock' as const,x:750+id*330,y:GROUND_Y,radius:72,height:150+id*50,hp:99999,fire:99999,damage:0}));battle.obstacles.push({id:4,pvoModel:'tracked',kind:'pvo',x:1850,y:GROUND_Y,radius:24,hp:100,fire:99999,damage:0});}
seedObstacles();
scene.onReady=()=>{scene.active=true;scene.accept(structuredClone(battle),profile.id);};
new Phaser.Game({type:Phaser.AUTO,parent:'flight-canvas',width:1200,height:675,scene:[scene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},audio:{noAudio:true}});
document.querySelector('#preview-mode')!.addEventListener('change', event => {
 const mode=(event.target as HTMLSelectElement).value; pilot=makePlane(profile.id,planeStats(profile));
 battle=createBattle('gallery-'+mode+'-'+Date.now(),mode==='duel'?'duel':'pve',mode==='duel'?[pilot,makePlane('gallery-bot',{...planeStats(profile),model:'swift'},true,1)]:[pilot],mode==='flight'||mode==='duel'?1:Number(mode));
 if(mode==='flight')seedObstacles();else if(mode!=='duel')beginBoss(battle);
 battle.paused=paused;battle.spawn=99999; scene.accept(structuredClone(battle),profile.id);
});
document.querySelector('#pause')!.addEventListener('click',event=>{paused=!paused;battle.paused=paused;scene.accept(structuredClone(battle),profile.id);(event.target as HTMLButtonElement).textContent=paused?'Продолжить анимацию':'Пауза анимации';});
document.querySelector('#boost')!.addEventListener('click',event=>{boost=!boost;(event.target as HTMLButtonElement).textContent=boost?'Выключить форсаж':'Включить форсаж';});
function draw(frame:Frame){const ctx=frame.canvas.getContext('2d')!;ctx.clearRect(0,0,720,360);ctx.save();
 if(frame.type==='plane'){const a=art.get(frame.model!)!,tmp=frame.buffer??(frame.buffer=document.createElement('canvas'));if(tmp.width!==400){tmp.width=400;tmp.height=200;}paintAircraft(tmp.getContext('2d')!,a,time);ctx.translate(frame.model==='skate'?410:360,180);ctx.scale((frame.width??350)/350,(frame.width??350)/350);if(frame.model==='skate')drawGoldenTrail(ctx,350,155,time,1);if(frame.model!.startsWith('enemy'))ctx.scale(-1,1);ctx.drawImage(tmp,-200,-100);}
 else {ctx.translate(360,330);const scale=frame.type==='pvo'?3:1.05;ctx.scale(scale,scale);ctx.translate(0,-GROUND_Y);const g=canvasPainter(ctx);if(frame.type==='pvo')drawPvo(g,0,-Math.PI*.7,frame.pvoModel);else drawRock(g,{id:frame.variant!,x:0,radius:72,height:frame.height});ctx.fillStyle='#51826a';ctx.fillRect(-360,GROUND_Y,720,40);ctx.fillStyle='#8bb37a';ctx.fillRect(-360,GROUND_Y,720,5);}
 ctx.restore();}
function tick(now:number){const dt=Math.min(.04,(now-last)/1000);last=now;if(!paused&&!document.hidden){time+=dt;battle.distance=0;battle.spawn=99999;pilot.shield=99999;for(const plane of battle.planes)plane.ram=99999;stepBattle(battle,{[profile.id]:{turn:battle.mode==='duel'?1:0,fire:false,boost}},dt);if(battle.phase==='flight'&&battle.obstacles.length===0)seedObstacles();if(battle.mode==='duel')battle.time=Math.min(60,battle.time);document.querySelector('#boost-state')!.textContent=battle.phase==='boss'?'Патруль и прицельный огонь':battle.mode==='duel'?'Масштаб дуэли':pilot.boosting?'Форсаж · прокрутка ×1,7':boost?'Запас исчерпан · восстановление':'Обычный полёт';scene.accept(structuredClone(battle),profile.id);}if(!paused&&!document.hidden)frames.filter(f=>f.type==='plane').forEach(draw);requestAnimationFrame(tick);}frames.forEach(draw);requestAnimationFrame(tick);
