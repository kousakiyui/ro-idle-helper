// 倉庫已存資料損毀（驗證不過）時，待寫差異是否還能落盤。
const fs=require('fs'); const src=fs.readFileSync(process.argv[2],'utf8');
function slice(name){const m=new RegExp('^( *)(?:async )?function '+name+'\\(','m').exec(src); if(!m)throw Error(name); const e=src.indexOf('\n'+m[1]+'}',m.index); return src.slice(m.index,e+m[1].length+2);}
const body=['validateWarehouse','setWarehouseEntry','mergeWarehouseChanges','applyWarehouseData','flushWarehouseSave','saveWarehouseSoon'].map(slice).join('\n');
const calls=[]; let store=JSON.stringify({marks:{'abc':'lock'},autoLocks:{}}); // id 'abc' 不合格式 → validateWarehouse 丟錯
const timers=[];
const env={state:{whMarks:{'5':'lock'},whAutoLocks:{},whPins:{}}, applyingRemote:false, whSaveTimer:null, whRetryUsed:false,
  warehouseFields:{marks:'whMarks',autoLocks:'whAutoLocks',pins:'whPins'}, isPlainRecord:v=>v&&typeof v==='object'&&!Array.isArray(v), Object, console:{warn(){}},
  GM_getValue:()=>store, GM_setValue:(k,v)=>{calls.push(v);store=v;}, navigator:{},
  setTimeout:(f,ms)=>{const t={f,ms};timers.push(t);return t;}, clearTimeout(){}};
env.pendingWhChanges=Object.fromEntries(Object.keys(env.warehouseFields).map(k=>[k,new Map()]));
const api=new Function(...Object.keys(env),body+'\nreturn {setWarehouseEntry,flushWarehouseSave,pending:pendingWhChanges};')(...Object.values(env));
api.setWarehouseEntry('pins','7','短劍');
api.flushWarehouseSave({sync:true});
for (const t of timers.filter(t=>t.ms===2000)) t.f();
const saved = calls.length ? JSON.parse(calls.at(-1)) : null;
const ok = !!saved && saved.pins?.['7']==='短劍' && saved.marks?.['5']==='lock' && api.pending.pins.size===0;
console.log((ok?'PASS':'FAIL')+` 已存資料損毀 → 寫入次數 ${calls.length}，自選 7 已存=${saved?.pins?.['7']==='短劍'}，原有鎖定 5 保留=${saved?.marks?.['5']==='lock'}，待寫差異剩 ${api.pending.pins.size}`);
