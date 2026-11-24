// 3.5.2 單元模擬：Zeny 新舊順序、未升階判定、倉庫 🔍 data 屬性、攤位 🔍 品名、稀有掉落掃描閘門。
const fs = require('fs'); const path = require('path');
const { JSDOM } = require(path.join(__dirname, 'node_modules/jsdom'));
const src = fs.readFileSync(process.argv[2], 'utf8');
function slice(name, optional) { const m = new RegExp('(?:async )?function ' + name + '\\(').exec(src); if (!m) { if (optional) return ''; throw Error(name); }
  let i = src.indexOf('{', m.index + src.slice(m.index).indexOf(')')), d = 0, j = i;
  for (; j < src.length; j++) { if (src[j] == '{') d++; else if (src[j] == '}') { d--; if (!d) break; } } return src.slice(m.index, j + 1); }
const constLine = (name) => { const m = new RegExp('^\\s*const ' + name + ' = .*$', 'm').exec(src); return m ? m[0] : ''; };
let ok = true; const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); ok &&= cond; };

// ---- 1. Zeny：舊攤位快照不得反覆蓋掉較新的 API 餘額；目前角色的輪詢值不改清單
{
  const state = { activeCharId: 7, activeCharName: 'A', chars: [{ id: 7, name: 'A' }, { id: 8, name: 'B' }], curZeny: 0, charZenyMap: {}, initZenyMap: {} };
  const localZenyAt = new Map();
  const positiveId = (v) => (typeof v === 'number' || (typeof v === 'string' && /^[1-9]\d*$/.test(v))) && Number(v) > 0 && Number.isSafeInteger(Number(v)) ? Number(v) : null;
  const snapshotCharacterId = (s) => positiveId(s?.character?.id ?? s?.characterId ?? s?.character?.characterId);
  const pre = /seenBalanceSnapshots/.test(src) ? 'const seenBalanceSnapshots = new WeakSet();' : '';
  const api = new Function('state', 'localZenyAt', 'positiveId', 'snapshotCharacterId', 'updateHUD', 'renderChars',
    pre + slice('syncMarketBalance') + slice('applyPollZeny') + 'return { syncMarketBalance, applyPollZeny };')(state, localZenyAt, positiveId, snapshotCharacterId, () => {}, () => {});
  const apiSet = (z) => { state.curZeny = z; state.charZenyMap[7] = z; localZenyAt.set(7, Date.now()); };   // 等同 onApiData 前景
  const stale = { character: { id: 7, name: 'A', zeny: 1000 } };
  api.syncMarketBalance(stale, 7);               // 第一次看到攤位快照
  const seen = [state.curZeny];
  for (let i = 0; i < 5; i++) { apiSet(2000 + i); seen.push(state.curZeny); api.syncMarketBalance(stale, 7); seen.push(state.curZeny); }
  const flips = seen.filter((z, i) => i && z < seen[i - 1]).length;
  check(`舊攤位快照不再把餘額改回（回跳 ${flips} 次，序列 ${seen.join('→')}）`, flips === 0 && state.curZeny === 2004);
  api.syncMarketBalance({ character: { id: 7, name: 'A', zeny: 2500 } }, 7);
  check('新的攤位快照物件仍會套用（購買後餘額 2500）', state.curZeny === 2500 && state.charZenyMap[7] === 2500);
  api.applyPollZeny({ at: Date.now() + 1, characters: [{ id: 7 }, { id: 8 }], zeny: { 7: 1, 8: 333 } });
  check('輪詢值不改本頁目前角色清單餘額（與儀表盤一致），其他角色照常更新', state.charZenyMap[7] === 2500 && state.charZenyMap[8] === 333);
}

// ---- 2. 未升階判定：網路回應完成後連續兩次一致才確定；無 fetch 活動時不提前判定
{
  const fn = slice('refineNoUpgradeSettled', true);
  check('事件式精煉結果讀取有呼叫 refineNoUpgradeSettled', !!fn && /if \(refineNoUpgradeSettled\(settleGate, confirmedNoUpgrade, net\) \|\|/.test(src));
  if (fn) {
    const settled = new Function(fn + 'return refineNoUpgradeSettled;')();
    const run = (timeline) => { const gate = { since: 10, candidate: null }; for (let i = 0; i < timeline.length; i++) if (settled(gate, ...timeline[i])) return i + 1; return null; };
    // 每次訊號觸發一讀：[confirmed, {inFlight, settled}]
    check('正常：第 1 讀請求中、第 2 讀回應後扣款 → 第 3 讀確定',
      run([[false, { inFlight: 1, settled: 10 }], [true, { inFlight: 0, settled: 11 }], [true, { inFlight: 0, settled: 11 }]]) === 3);
    check('遊戲不走 fetch（settled 不變）→ 不提前判定，沿用 8 秒上限', run(Array.from({ length: 80 }, () => [true, { inFlight: 0, settled: 10 }])) === null);
    check('兩讀之間又有新回應 → 重新確認', run([[true, { inFlight: 0, settled: 11 }], [true, { inFlight: 0, settled: 12 }], [true, { inFlight: 0, settled: 12 }]]) === 3);
    check('仍有請求進行中 → 不判定', run([[true, { inFlight: 1, settled: 11 }], [true, { inFlight: 1, settled: 11 }]]) === null);
    check('中間一讀變回未確認（晚到的成功）→ 重新計算', run([[true, { inFlight: 0, settled: 11 }], [false, { inFlight: 0, settled: 11 }], [true, { inFlight: 0, settled: 11 }]]) === null);
  }
}

// ---- 3. 倉庫 🔍：data 屬性、無 class、CSS 只定義一次
{
  const dom = new JSDOM(`<body><fieldset><legend>倉庫</legend><ul>
    <li><img src="/client/item/909.png"><input type="checkbox" aria-label="賣掉 杰勒比結晶"><button aria-label="杰勒比結晶的物品資訊">杰勒比結晶</button></li></ul></fieldset></body>`);
  const { document } = dom.window;
  const state = { whProtect: true, whProtectPins: true, whAutoEquipCard: true, whMarks: {}, whAutoLocks: {}, whPins: {}, customProtectWords: [], whSaleReview: true };
  const env = { document, state, clean: s => String(s || '').replace(/\s+/g, ' ').trim(), visible: el => !!el?.isConnected,
    instanceLockReasons: new Set(), priceOptions: { enabled: false }, ITEM_NAME_CACHE: new Map(), syncWarehouseCustomView() {}, setWarehouseSaleReview() {},
    savePrefs() {}, syncHudSettings() {}, findTownSearchUI: () => null, syncMktMount() {}, triggerNativeTownSearch() {}, sleep: async () => {},
    warehouseTotal: () => 0, setWarehouseEntry() {}, bulkWhLock() {} };
  const api = new Function(...Object.keys(env), 'const warehouseRowSignatures = new WeakMap(); let whSearchBusy = false;' + constLine('isStarProtected') +
    ['refreshWarehouse', 'getLockReason', 'warehouseItemId'].map(n => slice(n)).join('\n') + 'return { refreshWarehouse };')(...Object.values(env));
  api.refreshWarehouse(); api.refreshWarehouse();
  const li = document.querySelector('li');
  check('倉庫 🔍 以 data-roi-wh-pin-search 標記且只有一顆', li.querySelectorAll('[data-roi-wh-pin-search]').length === 1);
  check('倉庫 ☆／🔍 不再使用 roi-warehouse-pin* class', !li.querySelector('[class*="roi-warehouse-pin"]') && !/roi-warehouse-pin/.test(src));
  check('CSS 中 [data-roi-wh-pin-search] 規則只出現一次', (src.match(/\[data-roi-wh-pin-search\] \{|\[data-roi-wh-pin-search\],|, \[data-roi-wh-pin-search\]/g) || []).length === 1);
}

// ---- 4. 攤位價格欄 🔍：React 重用列後點擊搜尋目前品名
{
  const dom = new JSDOM(`<body><table class="xp-table roi-market-table"><tbody><tr>
    <td data-roi-market-col="item"><button>紅色藥水</button></td><td data-roi-market-col="price">50</td><td data-roi-market-col="input"><input type="number"></td></tr></tbody></table></body>`);
  const { document } = dom.window; const searched = [];
  const env = { document, state: { moneyColor: false }, clean: s => String(s || '').replace(/\s+/g, ' ').trim(), roiPriceText: el => el.textContent,
    findTownSearchUI: () => ({}), applyMoneyColor() {}, triggerNativeTownSearch: n => searched.push(n) };
  const body = [constLine('amtRx'), constLine('headRx'), slice('alignAndColorizeNativeMarkets')].join('\n');
  const align = new Function(...Object.keys(env), body + 'return alignAndColorizeNativeMarkets;')(...Object.values(env));
  align();
  document.querySelector('td[data-roi-market-col="item"] button').textContent = '藍色藥水';   // React 重用此列
  align();
  document.querySelector('[data-roi-price-search]').click();
  check(`攤位 🔍 搜尋目前品名（實得 ${searched.join(',')}）`, searched.length === 1 && searched[0] === '藍色藥水');
}

// ---- 5. 稀有掉落：頁面無標題文字時不做整頁掃描
{
  const dom = new JSDOM('<body><div>其他頁面</div></body>');
  const w = dom.window; let scans = 0;
  const env = { document: w.document, XPathResult: w.XPathResult, findRareRoots: () => { scans++; return []; }, rarePanels: new WeakMap(), rareAutoMap: false,
    rareLastMap: new WeakMap(), isRareHeading: () => false, getRareContext: () => null, fastSelectRare: () => false };
  const pre = constLine('rareHeadingXPath');
  const refresh = new Function(...Object.keys(env), pre + slice('refreshRareHelper') + 'return refreshRareHelper;')(...Object.values(env));
  refresh();
  const noHeading = scans;
  w.document.body.insertAdjacentHTML('beforeend', '<fieldset><legend>必撿稀有掉落 (3 項)</legend></fieldset>');
  refresh();
  check(`無「必撿稀有掉落」時略過掃描（${noHeading} 次），出現後照常掃描（${scans - noHeading} 次）`, noHeading === 0 && scans === 1);
}
// ---- 6. 收藏與道具學習快取：讀取最新已存值再合併，不整包覆寫
{
  const fn = slice('updateStoredValue', true);
  check('有 updateStoredValue（讀取→合併→驗證→寫入）', !!fn);
  if (fn) {
    const store = new Map();
    const env = { GM_getValue: (k, d) => store.has(k) ? JSON.parse(store.get(k)) : d, GM_setValue: (k, v) => store.set(k, JSON.stringify(v)), MAX_BACKUP_BYTES: 2 * 1024 * 1024 };
    const lib = new Function(...Object.keys(env), ['isPlainRecord', 'checkDataTree', 'readValidatedSetting', 'validateFavorites', 'validateLearnedItems', 'updateStoredValue'].map(n => slice(n)).join('\n') +
      'return { updateStoredValue, validateFavorites, validateLearnedItems };')(...Object.values(env));
    const tabA = new Set([5]), tabB = new Set([5]);       // 兩分頁開頭都只有 5
    const toggle = (local, id) => lib.updateStoredValue('roi-favorites-v1', lib.validateFavorites, [...local], (latest) => { const n = new Set(latest); n.has(id) ? n.delete(id) : n.add(id); return [...n]; });
    toggle(tabA, 11); toggle(tabB, 22);
    const favs = JSON.parse(store.get('roi-favorites-v1'));
    check(`收藏：兩分頁各加一項都保留（${favs.join(',')}）`, [5, 11, 22].every(x => favs.includes(x)));
    let threw = false; try { lib.updateStoredValue('roi-favorites-v1', lib.validateFavorites, [], () => [1, -3]); } catch { threw = true; }
    check('收藏：無效內容在寫入前被拒絕，已存值不變', threw && JSON.parse(store.get('roi-favorites-v1')).includes(22));
  }
}
console.log(ok ? 'ALL PASS' : 'SOME FAIL');
