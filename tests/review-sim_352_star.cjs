// 方案 A：★ 一律保護。neutral 不再壓過 ★；★ 物品按解鎖只提示；本頁全解略過 ★；加／移除 ★ 清除 neutral。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const src = fs.readFileSync(process.argv[2], 'utf8');
function slice(name) { const m = new RegExp('(?:async )?function ' + name + '\\(').exec(src); if (!m) throw Error(name);
  let i = src.indexOf('{', m.index + src.slice(m.index).indexOf(')')), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] == '{') d++; else if (src[j] == '}') { d--; if (!d) break; } } return src.slice(m.index, j + 1); }
const constLine = (name) => (new RegExp('^\\s*const ' + name + ' = .*$', 'm').exec(src) || [''])[0];
const li = (id, name) => `<li><img src="/client/item/${id}.png"><input type="checkbox" aria-label="賣掉 ${name}"><button aria-label="${name}的物品資訊">${name}</button> ×5</li>`;
const dom = new JSDOM(`<body><fieldset><legend>倉庫</legend><ul>${li(909, '杰勒比結晶')}${li(910, '小草')}${li(911, '綠色藥草')}</ul></fieldset></body>`);
const { document } = dom.window; dom.window.confirm = () => true;
const state = { whProtect: true, whProtectPins: true, whSaleReview: true, whAutoEquipCard: true, whMarks: {}, whAutoLocks: {}, whPins: { 909: '杰勒比結晶', 910: '小草' }, customProtectWords: [] };
const env = { document, state, confirm: () => true, clean: s => String(s || '').replace(/\s+/g, ' ').trim(), visible: el => !!el?.isConnected,
  instanceLockReasons: new Set(['自動保護：精煉裝備', '自動保護：有洞裝備', '自動保護：特殊/插卡']), priceOptions: { enabled: false }, ITEM_NAME_CACHE: new Map(),
  syncWarehouseCustomView() {}, setWarehouseSaleReview() {}, savePrefs() {}, syncHudSettings() {}, findTownSearchUI: () => null, syncMktMount() {},
  triggerNativeTownSearch() {}, sleep: async () => {}, warehouseTotal: () => 0,
  setWarehouseEntry(field, id, v) { const k = { marks: 'whMarks', autoLocks: 'whAutoLocks', pins: 'whPins' }[field]; if (v === null) delete state[k][id]; else state[k][id] = v; } };
const api = new Function(...Object.keys(env), 'const warehouseRowSignatures = new WeakMap(); let whSearchBusy = false;' + constLine('isStarProtected') +
  ['refreshWarehouse', 'getLockReason', 'warehouseItemId', 'bulkWhLock'].map(slice).join('\n') + 'return { refreshWarehouse, getLockReason, bulkWhLock };')(...Object.values(env));
let ok = true; const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok &&= cond; };
const row = id => document.querySelector(`img[src="/client/item/${id}.png"]`).closest('li');
const status = () => document.querySelector('[data-ro-wh-status]').textContent;

state.whMarks[910] = 'neutral';                          // 舊版留下的 ★ + neutral
api.refreshWarehouse();
check('既有 ★ + neutral → 仍視為上鎖（自選保護）', api.getLockReason('910', '小草', '') === '自選保護（★）' && row(910).hasAttribute('data-roi-wh-locked'));
row(909).querySelector('[data-ro-lock]').click();
check('★ 物品按 🔒 不寫入 neutral，仍上鎖', state.whMarks[909] === undefined && api.getLockReason('909', '杰勒比結晶', '') === '自選保護（★）');
check('並以既有 data-ro-wh-status 節點提示先取消 ★', /請先取消 ★/.test(status()) && document.querySelectorAll('[data-ro-wh-status]').length === 1);
check('★ 物品鎖頭提示文字為「請先取消 ★ 再解鎖」', /請先取消 ★ 再解鎖/.test(row(909).querySelector('[data-ro-lock]').title));
row(909).className = '';
check('React 清空 class 後 ★ 列與鎖頭仍保留鎖定狀態', row(909).dataset.roiWhLocked === '' &&
  row(909).querySelector('[data-ro-lock]').dataset.roiWhBadge === 'lock');
const cb = row(909).querySelector('input'); cb.checked = true; api.refreshWarehouse();
check('★ 物品被勾「賣掉」→ 被取消', cb.checked === false);
state.whMarks[909] = 'lock'; api.refreshWarehouse(); row(909).querySelector('[data-ro-lock]').click();
check('★ + 手動鎖按 🔓 → 移除手動鎖但不寫 neutral，★ 仍保護', state.whMarks[909] === undefined && api.getLockReason('909', '杰勒比結晶', '') === '自選保護（★）');
api.bulkWhLock(document.querySelector('fieldset'), false);
check('本頁全解略過 ★ 物品，只解非 ★ 物品', state.whMarks[911] === 'neutral' && state.whMarks[909] === undefined && /略過 2 種 ★/.test(status()));
row(910).querySelector('[data-roi-wh-pin]').click();   // 移除 ★
check('移除 ★ 時清掉殘留 neutral，回到一般規則', !('910' in state.whPins) && state.whMarks[910] === undefined);
row(911).querySelector('[data-roi-wh-pin]').click();   // 加入 ★（911 目前 neutral）
check('加入 ★ 時清掉 neutral，立即受保護', '911' in state.whPins && state.whMarks[911] === undefined && api.getLockReason('911', '綠色藥草', '') === '自選保護（★）');
state.whProtectPins = false;
check('關閉「清倉排除自選」時 ★ 不保護，可正常解鎖', api.getLockReason('911', '綠色藥草', '') === '');
console.log(ok ? 'ALL PASS' : 'SOME FAIL');
if (!ok) process.exitCode = 1;
