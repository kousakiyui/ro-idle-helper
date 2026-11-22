// 模型：setInterval(45000) 與 TTL「Date.now()-previous.at < 45000」同值。
// at 取在 tick 開始後、鎖取得並讀完快取「之後」；下一輪檢查取在 tick 開始後、鎖取得「之後」。
function trial(jitterMs){
  let fetches=0, skips=0, at=null, t=0;
  for(let n=0;n<2000;n++){
    t += 45000 + Math.random()*jitterMs;          // 計時器只會晚、不會早
    const checkAt = t + Math.random()*3;          // 鎖授予延遲
    if(at!==null && checkAt-at < 45000){ skips++; continue; }
    at = checkAt + Math.random()*3;               // 檢查之後才呼叫 fetchCharPoll 取 at
    fetches++;
  }
  return {fetches,skips,effectivePeriodSec:(2000*45)/fetches};
}
for (const j of [0,2,10,50]) console.log('timer 抖動上限',j+'ms →',JSON.stringify(trial(j)));
