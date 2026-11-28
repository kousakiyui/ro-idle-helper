const assert=require('node:assert/strict'),fs=require('node:fs');
const src=fs.readFileSync(process.argv[2],'utf8').replace(/\r\n/g,'\n');
const fragment=src.slice(src.indexOf('  const WAREHOUSE_OPEN_BOXES ='),src.indexOf('  function openWarehouseBoxDialog('));
assert.ok(fragment.includes("[644, '禮物箱']"));
const env={positiveId:n=>n,refineIdentityEpoch:0,state:{activeCharId:1},partyApiJson:null,partyCommand:null,sleep:async()=>{},performance:{now:()=>Date.now()},isPlainRecord:o=>o&&typeof o==='object',ITEM_NAME_CACHE:new Map(),readFiberForUi:()=>null};
const run=Function(...Object.keys(env),fragment+';return runWarehouseBoxOpener')(...Object.values(env));
async function simulate({weight=0,autoDeposit=true,failDeposit=false,baseCount=96}={}){
 const items=Array.from({length:baseCount},(_,i)=>({uid:1000+i,itemId:2000+i,qty:1}));
 let snapshot={inventory:items,character:{zeny:100},mapId:'town',weight,derived:{weightMax:1000},equipment:{}},rev=0,trace=[];
 const clone=()=>JSON.parse(JSON.stringify(snapshot));
 const apiJson=async url=>url==='/api/storage'?{storage:{fees:{town:0},items:[{sid:1,itemId:644,qty:2}]}}:{characterId:1,snapshot:clone(),commandRevision:rev};
 const sendCommand=async(_id,cmd)=>{trace.push(cmd.type);if(cmd.type==='storageWithdraw')snapshot.inventory.push({uid:5,itemId:644,qty:2});if(cmd.type==='useItem'){snapshot.inventory.find(x=>x.uid===5).qty--;snapshot.inventory.push({uid:500+rev,itemId:9000+rev,qty:1});snapshot.weight+=weight?25:0}if(cmd.type==='storageDeposit'){if(failDeposit)throw Error('network');for(const x of cmd.items)snapshot.inventory=snapshot.inventory.filter(y=>y.uid!==x.uid);snapshot.weight-=weight?25:0}return {view:{snapshot:clone(),commandRevision:++rev}}};
 let result;try{result=await run({characterId:1,itemId:644,targetCount:2,autoDeposit,pack:{items:new Map([[644,{weight:0}]])},apiJson,sendCommand,wait:async()=>{}})}catch(e){result=e}
 return {trace,result};
}
(async()=>{
 let a=await simulate();assert.deepEqual(a.trace,['storageWithdraw','useItem','useItem','storageDeposit']);assert.equal(a.result.opened,2);
 a=await simulate({baseCount:97});assert.deepEqual(a.trace,['storageWithdraw','useItem','storageDeposit','useItem','storageDeposit']);assert.equal(a.result.opened,2);
 a=await simulate({weight:890});assert.deepEqual(a.trace,['storageWithdraw','useItem','storageDeposit','useItem','storageDeposit']);assert.equal(a.result.opened,2);
 a=await simulate({weight:890,autoDeposit:false});assert.deepEqual(a.trace,['storageWithdraw','useItem']);assert.match(a.result.stopNote,/上限/);
 a=await simulate({weight:890,failDeposit:true});assert.equal(a.trace.filter(x=>x==='storageDeposit').length,1);assert.match(a.result.message,/network/);
 console.log('PASS 禮物箱開啟、90% 存倉續開、關閉存倉停止、存倉失敗不重送');
})().catch(e=>{console.error(e);process.exitCode=1});
