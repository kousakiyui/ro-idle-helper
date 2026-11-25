// 倉庫列 WeakMap 簽名略過後的出售保護：被略過的列若被勾成「賣掉」仍須取消。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const src = fs.readFileSync(process.argv[2], 'utf8');
function slice(name) { const m = new RegExp('(?:async )?function ' + name + '\\(').exec(src); if (!m) throw Error(name);
  let i = src.indexOf('{', m.index + src.slice(m.index).indexOf(')')), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] == '{') d++; else if (src[j] == '}') { d--; if (!d) break; } } return src.slice(m.index, j + 1); }
const dom = new JSDOM(`<body><fieldset id="wh"><legend>倉庫</legend><ul>
  <li><img src="/client/item/4001.png"><input type="checkbox" aria-label="賣掉 波利卡片"><button aria-label="波利卡片的物品資訊">波利卡片</button></li>
  <li><img src="/client/item/909.png"><input type="checkbox" aria-label="賣掉 杰勒比結晶"><button aria-label="杰勒比結晶的物品資訊">杰勒比結晶</button> ×30</li>
</ul></fieldset></body>`, { pretendToBeVisual: true });
const { document } = dom.window;
const state = { whProtect: true, whProtectPins: true, whSaleReview: true, whAutoEquipCard: true, whMarks: {}, whAutoLocks: {}, whPins: {}, customProtectWords: [] };
const env = { document, state, getReactFiber: row => row.testFiber, clean: s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
  visible: el => Boolean(el && el.isConnected), instanceLockReasons: new Set(['自動保護：精煉裝備', '自動保護：有洞裝備', '自動保護：特殊/插卡']),
  priceOptions: { enabled: false }, ITEM_NAME_CACHE: new Map(), syncWarehouseCustomView() {}, setWarehouseSaleReview() {},
  savePrefs() {}, syncHudSettings() {}, findTownSearchUI: () => null, syncMktMount() {}, triggerNativeTownSearch() {}, sleep: () => Promise.resolve(),
  warehouseTotal: () => 1, setWarehouseEntry(field, id, v) { const k = { marks: 'whMarks', autoLocks: 'whAutoLocks', pins: 'whPins' }[field]; if (v === null) delete state[k][id]; else state[k][id] = v; } };
const body = ['refreshWarehouse', 'getLockReason', 'warehouseItemId', 'readSaleItems'].map(slice).join('\n');
const pre = /warehouseRowSignatures/.test(src) ? 'const warehouseRowSignatures = new WeakMap(); let whSearchBusy = false;' : 'let whSearchBusy = false;';
// 3.5.1.2 起 getLockReason 依賴 isStarProtected（單行 const），一併取出。
const starLine = (/^\s*const isStarProtected = .*$/m.exec(src) || [''])[0];
const api = new Function(...Object.keys(env), pre + starLine + body + '\nreturn { refreshWarehouse, readSaleItems };')(...Object.values(env));
const [card, gem] = document.querySelectorAll('li input[type=checkbox]');
let ok = true; const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok &&= cond; };
api.refreshWarehouse();
check('首輪：卡片自動上鎖', card.closest('li').hasAttribute('data-roi-wh-locked'));
api.refreshWarehouse();                       // 第二輪：簽名相同 → 略過
card.checked = true;                          // 原生勾選（property 變更，無 DOM mutation，簽名不變）
api.refreshWarehouse();
check('簽名未變的鎖定列被勾「賣掉」→ 仍被取消', card.checked === false);
gem.checked = true; api.refreshWarehouse();
check('未鎖定列的勾選保持', gem.checked === true);
state.whMarks['909'] = 'lock'; api.refreshWarehouse();   // 跨頁同步改鎖（DOM 不變）
check('遠端改為鎖定（DOM 未變）→ 已勾選的賣掉被取消並標鎖', gem.checked === false && gem.closest('li').hasAttribute('data-roi-wh-locked'));
const gemRow = gem.closest('li');
const style = document.createElement('style');
const highlightRule = src.match(/li\[data-roi-wh-locked\] \{[^}]+\}/g) || [];
check('倉庫高亮只有一條樣式規則', highlightRule.length === 1);
style.textContent = highlightRule.join(''); document.head.append(style);
gemRow.className = '';
check('React 清空 class 後依然高亮（未重跑刷新）', gemRow.dataset.roiWhLocked === '' &&
  dom.window.getComputedStyle(gemRow).borderLeftWidth === '3px');
check('鎖定按鈕使用 data 狀態', gemRow.querySelector('[data-ro-lock]').dataset.roiWhBadge === 'lock');
document.querySelector('[data-ro-wh-bar] button').click();
check('React 清空 class 後批次勾選仍排除鎖定列', !gem.checked);
// 舊版倉庫沒有圖示。DOM 仍指向舊 Fiber 時，應使用已提交的列。
gemRow.querySelector('img').remove();
delete state.whMarks['909'];
const oldRoot = { stateNode: {} };
const currentRoot = { stateNode: oldRoot.stateNode };
oldRoot.stateNode.current = currentRoot;
const item = { sid: 'stack-1', itemId: 909 };
gemRow.testFiber = { return: oldRoot, child: { memoizedProps: { it: { ...item, itemId: 4001 } } },
  alternate: { stateNode: gemRow, key: item.sid, return: currentRoot, child: { memoizedProps: { it: item } } } };
gem.checked = true;
const sale = document.createElement('button');
sale.textContent = '直接賣掉 1 項';
const readSale = () => api.readSaleItems(document.querySelector('#wh'), sale);
const reviewed = readSale().items[0];
check('舊版無圖示：從已提交的倉庫列核對物品與數量', reviewed.id === '909' && reviewed.qty === 30);
const saleError = () => { try { readSale(); } catch (error) { return error.message; } };
state.whMarks['909'] = 'lock';
check('舊版無圖示：上鎖道具仍阻擋出售', saleError()?.includes('已上鎖'));
delete state.whMarks['909'];
const quantity = document.createElement('input');
quantity.type = 'number';
quantity.value = '31.5';
gemRow.append(quantity);
check('舊版無圖示：無效數量仍阻擋出售', saleError()?.includes('無法核對'));
quantity.remove();
item.sid = 'other-stack';
check('舊版無圖示：倉庫列識別不一致時阻擋出售', saleError()?.includes('無法核對'));
console.log(ok ? 'ALL PASS' : 'SOME FAIL');
if (!ok) process.exitCode = 1;
