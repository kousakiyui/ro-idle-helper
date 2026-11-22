const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'ro-idle-helper.user.js','utf8');
function slice(name){const m=new RegExp('(?:async )?function '+name+'\\(').exec(src); if(!m)throw Error(name);
  let i=src.indexOf('{',m.index+src.slice(m.index).indexOf(')')),d=0,j=i;for(;j<src.length;j++){if(src[j]=='{')d++;else if(src[j]=='}'){d--;if(!d)break;}}return src.slice(m.index,j+1);}
const body=['validateWarehouse','setWarehouseEntry','mergeWarehouseChanges','applyWarehouseData','flushWarehouseSave','saveWarehouseSoon'].map(slice).join('\n');
function make({failFirst=0}={}){
  const calls=[]; let store=JSON.stringify({marks:{},autoLocks:{},pins:{}}); let released; const held=new Promise(r=>released=r); let fails=failFirst;
  const timers=[]; const env={
    state:{whMarks:{},whAutoLocks:{},whPins:{}}, applyingRemote:false, whSaveTimer:null, whRetryUsed:false,
    warehouseFields:{marks:'whMarks',autoLocks:'whAutoLocks',pins:'whPins'},
    isPlainRecord:v=>v&&typeof v==='object'&&!Array.isArray(v), Object, console:{warn(){}},
    GM_getValue:(k,d)=>store, GM_setValue:(k,v)=>{ if(fails-->0) throw Error('boom'); calls.push(v); store=v; },
    navigator:{locks:{request:(n,cb)=>held.then(()=>cb({}))}},
    setTimeout:(f,ms)=>{const t={f,ms,cleared:false};timers.push(t);return t;}, clearTimeout:t=>{if(t)t.cleared=true;}};
  env.pendingWhChanges=Object.fromEntries(Object.keys(env.warehouseFields).map(k=>[k,new Map()]));
  const api=new Function(...Object.keys(env),body+'\nreturn {setWarehouseEntry,flushWarehouseSave,saveWarehouseSoon,pending:pendingWhChanges,state};')(...Object.values(env));
  return {api,calls,release:released,timers,env};
}
(async()=>{
  // 1) 鎖被另一頁持有時，pagehide 同步落盤只寫一次，鎖釋放後的排隊 callback 不重寫
  let t=make(); t.api.setWarehouseEntry('marks','101','lock');
  const queued=t.api.flushWarehouseSave();            // 400ms 備援：進鎖佇列（鎖被占用）
  t.api.flushWarehouseSave({sync:true});              // pagehide：同步
  t.release(); await queued;
  console.log('1. 鎖占用+卸載同步：GM_setValue 次數 =',t.calls.length,'| 內容含 101:',/"101":"lock"/.test(t.calls[0]||''));
  // 2) 同步落盤失敗 → 保留差異並排 2 秒重試，重試仍失敗不再無限排程
  t=make({failFirst:2}); t.api.setWarehouseEntry('pins','7','刀');
  t.api.flushWarehouseSave({sync:true});
  const retry=t.timers.filter(x=>!x.cleared);
  console.log('2. 第一次失敗 → 排程重試 =',retry.length,'(ms:',retry.map(x=>x.ms).join(','),') 待寫差異保留 =',t.api.pending.pins.size);
  retry[0].f();                                       // 觸發重試（仍失敗）
  console.log('2. 重試仍失敗 → 再排程 =',t.timers.filter(x=>!x.cleared&&x!==retry[0]).length,'(0 代表不無限重試) 待寫差異 =',t.api.pending.pins.size);
  // 3) 重試期間又有新變更 → whRetryUsed 重置，能再次嘗試
  t.api.setWarehouseEntry('pins','8','弓');
  console.log('3. 新變更後 whRetryUsed 已重置、已排新的 400ms 儲存 =',t.timers.some(x=>!x.cleared&&x.ms===400));
})();
