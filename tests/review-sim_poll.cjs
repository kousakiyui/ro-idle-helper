const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'ro-idle-helper.user.js','utf8');
function slice(name){ // 取 "function name(" 或 "async function name(" 到配對的大括號
  const m=new RegExp('(?:async )?function '+name+'\\(').exec(src); if(!m) throw Error('no '+name);
  let i=src.indexOf('{',m.index+m[0].length+src.slice(m.index+m[0].length).indexOf(')')), d=0, j=i;
  for(;j<src.length;j++){ if(src[j]=='{')d++; else if(src[j]=='}'){d--; if(!d)break;} }
  return src.slice(m.index,j+1);
}
const names=['validateCharPoll','readSharedCharPoll','matchesCharAccount','applySharedCharPoll','applyPollZeny','applyCharRoster','recordCharAlert'];
const body=names.map(slice).join('\n');
function run(scenario){
  const alerts=[], store={}; let now=1_000_000_000_000;
  const ctx={
    state:{chars:[],charAlerts:{},charZenyMap:{},initZenyMap:{},myCharIds:new Set(),activeCharId:1,hudMin:false,charRosterLoaded:false},
    document:{getElementById:()=>null}, renderChars(){}, alertUser:(t,m)=>alerts.push(m),
    positiveId:v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null,
    isPlainRecord:v=>v&&typeof v==='object'&&!Array.isArray(v), localZenyAt:new Map(),
    GM_getValue:(k,d)=>store[k]??d, nativeRosterIds:null, charPollKey:'roi-char-poll-v1', lastSharedCharPollAt:0, Date:{now:()=>now}};
  const fn=new Function(...Object.keys(ctx),body+'\nreturn {applyCharRoster,applySharedCharPoll,readSharedCharPoll,store:null};');
  const api=fn(...Object.values(ctx)); return {ctx,api,alerts,store,setNow:v=>now=v,getNow:()=>now};
}
// 情境 A：上一輪共享快取（角色1 掛機中），隔了 3 小時才重開頁面，現在角色1 已停止。
{
  const s=run(); const T=s.getNow();
  s.store['roi-char-poll-v1']={at:T-3*3600e3,characters:[{id:1,name:'甲',running:true}],zeny:{}};
  const previous=s.api.readSharedCharPoll();   // 3.5.1 pollChars 取 previous
  console.log('A. 3小時前的快取是否被 validateCharPoll 接受:', !!previous);
  // 模擬 pollChars leader 分支：baseline = sameAccount ? previous.characters : state.chars
  const fresh=[{id:1,name:'甲',running:false}];
  const sameAccount=previous?.characters.some(c=>fresh.some(f=>f.id===c.id));
  const baseline=sameAccount?previous.characters:s.ctx.state.chars;
  s.api.applyCharRoster(fresh,true,baseline);
  console.log('A. 重開頁面後首輪輪詢 → 通知數:',s.alerts.length,'| 警示:',JSON.stringify(s.ctx.state.charAlerts));
}
// 情境 B：同樣但快取只有 30 秒前（合理基線）
{
  const s=run(); const T=s.getNow();
  s.store['roi-char-poll-v1']={at:T-30e3,characters:[{id:1,name:'甲',running:true}],zeny:{}};
  const previous=s.api.readSharedCharPoll();
  s.api.applyCharRoster([{id:1,name:'甲',running:false}],true,previous.characters);
  console.log('B. 30秒前基線 → 通知數:',s.alerts.length,'(此為正確行為)');
}
// 情境 C：原生名單（較新）已顯示角色1停止；其他分頁稍早寫入的共享快取（較舊，角色1掛機）隨後被套用
{
  const s=run(); const T=s.getNow();
  s.ctx.state.chars=[{id:1,name:'甲',running:true}];               // 本頁先前狀態
  s.ctx.nativeRosterIds=new Set([1]);                                // 原生 API 已建立身分
  s.store['roi-char-poll-v1']={at:T-20e3,characters:[{id:1,name:'甲',running:true}],zeny:{}}; // 20 秒前的快取
  // 與 onApiData('/api/characters') 相同順序：先套原生名單，再 applySharedCharPoll(readSharedCharPoll())
  s.api.applyCharRoster([{id:1,name:'甲',running:false}],false);
  console.log('C. 套用原生名單後 → 角色1 running =',s.ctx.state.chars[0].running,'| 警示 =',JSON.stringify(s.ctx.state.charAlerts));
  s.api.applySharedCharPoll(s.api.readSharedCharPoll());
  console.log('C. 套用較舊共享快取後 → 角色1 running =',s.ctx.state.chars[0].running,'| 警示 =',JSON.stringify(s.ctx.state.charAlerts));
}
