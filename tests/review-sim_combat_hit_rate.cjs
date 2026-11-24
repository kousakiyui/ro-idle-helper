const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const state = { paused: false, processedLines: new WeakMap(), dmgSum: 0, hits: 0, maxDmg: 0 };
const env = {
  state, document: { hidden: false },
  clean: (value) => String(value ?? '').normalize('NFKC').trim(),
  getReactFiber: (line) => ({ return: { memoizedProps: { l: line.event } } }),
  recordMvpLog() {}, scheduleLogBatch() {}
};
const production = read('  const rxRareDrop =', '  const mvpBattleHistory =')
  + read('  const rxExpLog =', '  let whSaleApproval =')
  + 'const logSnapshots = [];\n'
  + read('  function flushLogBatch(', '  function scheduleLogBatch(')
  + read('  function queueLogLine(', '  function clearQueuedCharacterLogs(');
const { meter, queueLogLine, flushLogBatch } = new Function(...Object.keys(env),
  production + 'return { meter: combatHitMeter, queueLogLine, flushLogBatch };'
)(...Object.values(env));
const found = '發現 波利 Lv.1，接近中...';
const hit = '對 波利 造成 50 點傷害。';
const kill = '成功擊敗 波利！';
const search = '正在搜尋附近的怪物...';
const line = (id, wall, text, historical = false) => queueLogLine({ textContent: '[12:00:00] ' + text,
  event: { id, wall, text } }, historical);
const flush = () => flushLogBatch(1000);

function check(title, run) {
  run();
  console.log('PASS ' + title);
}

check('兩場完整交戰用原生時間戳加權，找怪與待機不稀釋速率', () => {
  meter.reset(1000);
  line(1, 1000, found);
  line(2, 1250, hit);
  line(3, 1800, hit);
  line(4, 2000, kill);
  line(5, 2100, search);
  flush();
  assert.equal(meter.rate, 2);
  line(6, 31000, found);
  line(7, 31200, hit);
  line(7, 31200, hit);
  line(8, 31800, hit);
  line(9, 32900, hit);
  flush();
  assert.equal(meter.rate, 2);
  line(10, 33000, kill);
  flush();
  assert.equal(meter.rate, 5 / 3);
});

check('切到搜尋會丟棄無擊倒的區段，後續戰鬥不混入未完成紀錄', () => {
  meter.reset(1000);
  line(1, 1000, found);
  line(2, 1500, hit);
  line(3, 5000, search);
  line(4, 6000, kill);
  flush();
  assert.equal(meter.rate, null);
  line(5, 20000, '波利 Lv.1 主動朝你衝過來！（距離 1 格）');
  line(6, 20200, hit);
  line(7, 20700, hit);
  line(8, 21000, kill);
  flush();
  assert.equal(meter.rate, 2);
});

check('排除歷史日誌、無時間戳現場日誌與零耗時戰鬥', () => {
  meter.reset(5000);
  line(1, 1000, found);
  line(2, 2000, hit);
  line(3, 3000, kill);
  line(4, 6000, found, true);
  line(5, 6500, hit);
  line(6, 7000, kill);
  line(7, NaN, found);
  line(8, 7500, hit);
  line(9, 8000, kill);
  line(10, 9000, found);
  line(11, 9000, hit);
  line(12, 9000, kill);
  flush();
  assert.equal(meter.rate, null);
});

check('暫停捨棄未完成交戰但保留已有速率，歸零或切角可清空', () => {
  meter.reset(1000);
  line(1, 1000, found);
  line(2, 1250, hit);
  line(3, 2000, kill);
  line(4, 2500, found);
  line(5, 2600, hit);
  flush();
  meter.interrupt(2700);
  line(6, 3000, kill);
  flush();
  assert.equal(meter.rate, 1);
  meter.reset(4000);
  assert.equal(meter.rate, null);
  line(1, 4100, found);
  line(2, 4300, hit);
  line(3, 4600, kill);
  flush();
  assert.equal(meter.rate, 2);
});
