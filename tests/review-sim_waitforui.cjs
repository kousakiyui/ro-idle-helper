const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const text = source.slice(source.indexOf('  function waitForUi('), source.indexOf('  function waitForCartView('));
const dom = new JSDOM('<body><main></main></body>', { pretendToBeVisual: true });
const w = dom.window;
const { document } = w;
const pageNet = { events: new w.EventTarget() };
let observers = 0;
const timers = new Set(), listeners = new Set();
class MutationObserver extends w.MutationObserver {
  observe(...args) { super.observe(...args); observers++; }
  disconnect() { super.disconnect(); observers--; }
}
for (const target of [document, pageNet.events]) {
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (type, fn) => { if (fn.name === "schedule") listeners.add(type); add(type, fn); };
  target.removeEventListener = (type, fn) => { if (fn.name === "schedule") listeners.delete(type); remove(type, fn); };
}
function startTimer(callback, ms) {
  const timer = setTimeout(callback, ms);
  timers.add(timer);
  return timer;
}
const waitForUi = new Function('document','pageNet','MutationObserver','setTimeout','clearTimeout',text + 'return waitForUi;')(
  document, pageNet, MutationObserver, startTimer,
  timer => { clearTimeout(timer); timers.delete(timer); }
);
const root = document.querySelector('main');
function checkClean(label) {
  assert.equal(observers, 0);
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  console.log('PASS ' + label);
}
async function run() {
  assert.equal(await waitForUi(() => 'ready'), 'ready');
  checkClean('立即成立與清理');

  const wait = waitForUi(() => root.querySelector('button'), { root });
  root.append(document.createElement('button'));
  assert.equal(await wait, root.firstElementChild);
  checkClean('指定容器 DOM 晚到成立與清理');

  let reads = 0, ready = false;
  const settled = waitForUi(() => { reads++; return ready; }, { root });
  ready = true;
  for (let i = 0; i < 3; i++) pageNet.events.dispatchEvent(new w.Event('settled'));
  assert.equal(await settled, true);
  assert.equal(reads, 2);
  checkClean('同一輪事件只排一次讀取，網路回應可喚醒');

  assert.equal(await waitForUi(() => false, { root, timeout: 10 }), null);
  checkClean('逾時只做最後確認後清理');

  let stopped = false;
  const stoppedWait = waitForUi(() => false, { root, shouldAbort: () => stopped });
  stopped = true;
  pageNet.events.dispatchEvent(new w.Event('ui-abort'));
  await assert.rejects(stoppedWait, /停止/);
  checkClean('中止事件立即拒絕並清理');

  const hiddenWait = waitForUi(() => false, { root });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new w.Event('visibilitychange'));
  await assert.rejects(hiddenWait, /停止/);
  checkClean('切到背景立即拒絕並清理');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });

  let checkThrows = false;
  const errorWait = waitForUi(() => {
    if (checkThrows) throw Error('讀取失敗');
    return false;
  }, { root });
  checkThrows = true;
  pageNet.events.dispatchEvent(new w.Event('settled'));
  await assert.rejects(errorWait, /讀取失敗/);
  checkClean('讀取拋錯後清理');
  console.log('ALL PASS');
}
run().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => w.close());
