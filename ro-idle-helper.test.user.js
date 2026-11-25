// ==UserScript==
// @name         RO Idle 便利助手｜測試版
// @namespace    local.ro-idle.warehouse-helper.test
// @version      3.5.8.2
// @description  整合倉庫保護、跨城查價、掛機設定、背包精煉、全裝備精煉傷害標記、露天懸浮完整數值與插卡檢視及角色收支統計與個人 MVP 時刻表。
// @match        https://ro-idle.app/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_setValue
// @grant        GM_notification
// @downloadURL https://raw.githubusercontent.com/kousakiyui/ro-idle-helper/main/ro-idle-helper.test.user.js
// @updateURL https://raw.githubusercontent.com/kousakiyui/ro-idle-helper/main/ro-idle-helper.test.user.js
// ==/UserScript==

(() => {
  'use strict';
  const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
  const validMaterialBatch = (value) => Number.isSafeInteger(value) && value >= 1 && value <= 1000;
  function validateMaterialBatch(value) {
    if (!validMaterialBatch(value)) throw Error('每次領料數量須為 1～1000 的整數');
    return value;
  }
  function isPlainRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  }
  function checkDataTree(value, depth = 0, budget = { keys: 0 }) {
    if (depth > 12 || (typeof value === 'string' && value.length > 16384)) throw Error('資料結構超過上限');
    if (value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && !isPlainRecord(value)) throw Error('資料物件格式不符');
    for (const key of Object.keys(value)) {
      if (++budget.keys > 30000 || ['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('資料包含不安全欄位或超過上限');
      checkDataTree(value[key], depth + 1, budget);
    }
  }
  const hudMetricLabels = {
    bexp: 'Base EXP/h', jexp: 'Job EXP/h', kph: '擊殺 (累計)', dmg: 'DPS',
    zeny: '隨身 Zeny (本角淨變動)', miss: '漏撿', total: '總輸出', peak: '最高單次傷害',
    hits: '傷害次數（累計）', hitRate: '每秒傷害次數（交戰）', taken: '承受傷害', pickups: '一般撿取量'
  };
  const defaultHudMetrics = ['bexp', 'jexp', 'kph', 'dmg', 'zeny', 'miss'];
  const defaultCompactHudMetrics = ['dmg', 'kph', 'zeny'];
  const hudNumberFormats = { auto: '自動（萬／億）', wan: '以萬顯示', yi: '以億顯示', full: '完整數字' };

  function validatePrefs(value) {
    if (!isPlainRecord(value)) throw Error('偏好設定格式不符');
    const result = {};
    for (const key of ['sound', 'notify', 'moneyColor', 'itemHover', 'marketHover', 'whProtectPins', 'mvpMergeRoster', 'whProtect', 'whSaleReview', 'whAutoEquipCard', 'hudMin', 'mktUpperFold', 'charAttentionOnly', 'charAttentionFirst']) {
      if (!Object.hasOwn(value, key)) continue;
      if (typeof value[key] !== 'boolean') throw Error('偏好設定的 ' + key + ' 必須是開關');
      result[key] = value[key];
    }
    for (const key of ['hudMetrics', 'hudCompactMetrics']) {
      if (!Object.hasOwn(value, key)) continue;
      const metrics = value[key];
      if (!Array.isArray(metrics) || metrics.length > Object.keys(hudMetricLabels).length ||
          metrics.some(key => typeof key !== 'string' || !Object.hasOwn(hudMetricLabels, key))) throw Error('儀表盤欄位不符');
      result[key] = [...new Set(metrics)];
    }
    if (Object.hasOwn(value, 'hudNumberFormat')) {
      if (typeof value.hudNumberFormat !== 'string' || !Object.hasOwn(hudNumberFormats, value.hudNumberFormat)) {
        throw Error('儀表盤數字格式不符');
      }
      result.hudNumberFormat = value.hudNumberFormat;
    }
    if (Object.hasOwn(value, 'hudPos')) {
      if (value.hudPos === null) result.hudPos = null;
      else {
        const pos = value.hudPos;
        if (!isPlainRecord(pos) || !['left', 'top'].every((key) => Number.isFinite(pos[key]) && Math.abs(pos[key]) <= 1e6)) {
          throw Error('浮窗位置格式不符');
        }
        result.hudPos = { left: pos.left, top: pos.top };
      }
    }
    return result;
  }
  function validateWords(value) {
    if (!Array.isArray(value) || value.length > 500 || value.some((word) => typeof word !== 'string' || word.length > 80)) {
      throw Error('貴重詞清單格式或長度不符');
    }
    return [...new Set(value.map((word) => word.trim()).filter(Boolean))];
  }
  function validateFavorites(value) {
    if (!Array.isArray(value) || value.length > 5000 || value.some((id) => !Number.isSafeInteger(id) || id <= 0 || id > 1e9)) {
      throw Error('收藏清單格式或長度不符');
    }
    return [...new Set(value)];
  }
  function validateWarehouse(value) {
    if (!isPlainRecord(value) || !isPlainRecord(value.marks) || !isPlainRecord(value.autoLocks)) throw Error('倉庫鎖定資料格式不符');
    const result = { marks: {}, autoLocks: {} };
    for (const field of ['marks', 'autoLocks']) {
      const entries = Object.entries(value[field]);
      if (entries.length > 5000) throw Error('倉庫鎖定資料超過上限');
      for (const [id, reason] of entries) {
        if (!/^[1-9]\d*$/.test(id) || Number(id) > 1e9) throw Error('倉庫道具 ID 格式不符');
        if (field === 'marks' ? !['lock', 'neutral'].includes(reason) : typeof reason !== 'string' || reason.length > 256) {
          throw Error('倉庫鎖定原因格式不符');
        }
        result[field][id] = reason;
      }
    }
    if (Object.hasOwn(value, 'pins')) {
      if (!isPlainRecord(value.pins)) throw Error('倉庫自選資料格式不符');
      const entries = Object.entries(value.pins);
      if (entries.length > 5000 || entries.some(([id, name]) =>
        !/^[1-9]\d*$/.test(id) || Number(id) > 1e9 || typeof name !== 'string' || !name.trim() || name.length > 160)) {
        throw Error('倉庫自選物品格式或數量不符');
      }
      result.pins = Object.fromEntries(entries);
    }
    return result;
  }
  function validatePriceOptions(value) {
    if (!isPlainRecord(value) || typeof value.enabled !== 'boolean' ||
        !Number.isSafeInteger(value.threshold) || value.threshold <= 0 || value.threshold > 1e12) throw Error('掛牌保護設定格式不符');
    return { enabled: value.enabled, threshold: value.threshold };
  }
  function readValidatedSetting(key, validate, fallback, json = false) {
    try {
      let value = GM_getValue(key, undefined);
      if (value === undefined) return fallback;
      if (json && typeof value === 'string') {
        if (value.length > MAX_BACKUP_BYTES) return fallback;
        value = JSON.parse(value);
      }
      checkDataTree(value);
      return validate(value);
    } catch { return fallback; }
  }
  // 遠端（其他分頁）送來的值與寫入前使用同一組驗證；JSON 字串先檢查大小再解析。
  function validateStoredValue(value, validate, json = false) {
    if (json && typeof value === 'string') {
      if (value.length > MAX_BACKUP_BYTES) throw Error('資料超過大小上限');
      value = JSON.parse(value);
    }
    checkDataTree(value);
    return validate(value);
  }
  // 讀取最新已存值（無效時改用 fallback）→ 只套用本頁的變更 → 驗證 → 寫入，避免整包覆寫其他分頁剛寫入的欄位。
  function updateStoredValue(key, validate, fallback, mutate, json = false) {
    const latest = readValidatedSetting(key, validate, fallback, json);
    const next = validate(mutate(latest));
    checkDataTree(next);
    GM_setValue(key, json ? JSON.stringify(next) : next);
    return next;
  }
  function validateLearnedItems(value) {
    if (!isPlainRecord(value) || Object.keys(value).length > 3500) throw Error('道具快取超過上限');
    const result = {};
    for (const [id, info] of Object.entries(value)) {
      if (!/^[1-9]\d*$/.test(id) || Number(id) > 1e9 || !isPlainRecord(info)) continue;
      const item = {};
      for (const key of ['name', 'desc']) {
        if (typeof info[key] === 'string' && info[key].length <= (key === 'name' ? 160 : 1200)) item[key] = info[key];
      }
      for (const key of ['atk', 'matk', 'def', 'weight', 'wLv']) {
        if (Number.isFinite(info[key]) && info[key] >= 0 && info[key] <= 1e6) item[key] = info[key];
      }
      result[id] = item;
    }
    return result;
  }
  function validateCategoryProfiles(value) {
    if (!isPlainRecord(value) || Object.keys(value).length > 128) throw Error('分類設定超過上限');
    const result = {};
    for (const [id, profile] of Object.entries(value)) {
      if (id.length > 80 || !isPlainRecord(profile) || typeof profile.enabled !== 'boolean' || !isPlainRecord(profile.modes)) throw Error('角色分類設定格式不符');
      const modes = {};
      for (const cat of ['consumable', 'equipment', 'card', 'other']) {
        if (!['off', 'store', 'priority', 'valuable'].includes(profile.modes[cat])) throw Error('道具分類處理方式不符');
        modes[cat] = profile.modes[cat];
      }
      const usedMapToggle = typeof profile.currentMap === 'string' && /^[\w-]{1,80}$/.test(profile.currentMap);
      result[id] = { enabled: profile.enabled || usedMapToggle, modes };
    }
    return result;
  }
  // 讀取用：略過格式不符的角色項目，保留其他角色；寫入前仍以嚴格版驗證。
  function salvageCategoryProfiles(value) {
    if (!isPlainRecord(value)) throw Error('分類設定格式不符');
    const result = {};
    for (const [id, profile] of Object.entries(value).slice(0, 128)) {
      try { Object.assign(result, validateCategoryProfiles({ [id]: profile })); } catch { /* Preserve other valid profiles. */ }
    }
    return result;
  }
  function prepareBackupWrites(data) {
    checkDataTree(data);
    if (!isPlainRecord(data) || !['ro-idle-lean-backup', 'ro-idle-helper-backup'].includes(data.format)) throw Error('備份格式不符');
    if (data.version !== undefined && data.version !== 1) throw Error('不支援此備份版本');
    if (data.settings !== undefined && !isPlainRecord(data.settings)) throw Error('舊版設定格式不符');
    const settings = data.settings ?? {}, writes = [];
    const add = (key, value, validate, json = false) => {
      if (value === undefined) return;
      const validatedValue = validate(value);
      writes.push([key, json ? JSON.stringify(validatedValue) : validatedValue]);
    };
    // 相同資料若同時出現在新舊欄位，兩份都須有效，寫入順序沿用舊版優先規則。
    for (const value of [data.prefs, settings.ro_lean_prefs_v091]) add('ro_lean_prefs_v091', value, validatePrefs);
    for (const value of [data.words, settings.ro_custom_protect_words_v091]) add('ro_custom_protect_words_v091', value, validateWords);
    for (let value of [data.wh, settings['warehouse-helper-v1']]) {
      if (typeof value === 'string') value = JSON.parse(value);
      add('warehouse-helper-v1', value, validateWarehouse, true);
    }
    for (const value of [data.favs, settings['roi-favorites-v1']]) add('roi-favorites-v1', value, validateFavorites);
    for (const value of [data.priceOptions, settings['warehouse-auto-protect-v1']]) add('warehouse-auto-protect-v1', value, validatePriceOptions);
    for (const batch of [data.refineMaterialBatch, settings['roi-refine-material-batch-v1']]) {
      add('roi-refine-material-batch-v1', batch, validateMaterialBatch);
    }
    return [...new Map(writes)];
  }
  function commitBackupWrites(writes) {
    const originals = new Map(writes.map(([key]) => [key, GM_getValue(key, undefined)]));
    const changed = [];
    try {
      for (const [key, value] of writes) { changed.push(key); GM_setValue(key, value); }
    } catch (error) {
      const failed = [];
      for (const key of changed.reverse()) {
        try { GM_setValue(key, originals.get(key)); } catch { failed.push(key); }
      }
      throw Error(failed.length ? '寫入失敗且部分設定無法還原，請檢查儲存權限' : '寫入失敗，已還原原設定');
    }
  }
  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (page.top !== page.self) return;

  const TIMING = Object.freeze({
    // Network reuse, expiry and notification cadence in milliseconds.
    charPollInterval: 45000, charPollReuseMargin: 5000,
    notifyCooldown: 5000, notifyDuration: 5000,
    // Background UI, battle log and temporary character alerts.
    hudRefresh: 1500, charAlertExpiry: 600000, recentInteraction: 5000, pointerSample: 100,
    activeRouter: 160, visibleRouter: 300, hiddenRouter: 700, textRouter: 1500,
    activeLogFlush: 120, idleLogFlush: 250, alertRenderGap: 250,
    // MVP background and render cadence.
    mvpCaptureGap: 1000, mvpBackground: 15000, mvpRender: 30000,
    // Minimum spacing between native refinement-related requests (not a UI readiness check).
    refineCommandGap: 1000,
    // Market refresh and query spacing.
    marketRefresh: 15000, marketSnapshotWait: 800, marketCrossSearchGap: 2200
  });

  function debugEnabled() {
    try { return localStorage.getItem('roi-debug') === '1'; }
    catch { return false; }
  }

  function log(scope, ...details) {
    if (debugEnabled()) console.debug('[ROI ' + scope + ']', ...details);
  }

  function element(tag, content, style) {
    const node = document.createElement(tag);
    if (content != null) node.textContent = content;
    if (style) node.style.cssText = style;
    return node;
  }

  const rareLimit = 100;
  const nonAsciiRx = /[^\x20-\x7E]/;
  const clean = (s) => {
    const str = String(s || '');
    if (!str) return '';
    return (nonAsciiRx.test(str) ? str.normalize('NFKC') : str).replace(/\s+/g, ' ').trim();
  };
  const visible = (el) => Boolean(el && el.isConnected && !el.closest('[hidden],[inert],[aria-hidden="true"]') && el.getClientRects().length > 0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const zhCollator = new Intl.Collator('zh-Hant');

  const DAY_COLORS = ['#006d65', '#7900b8', '#243cc9', '#a74700', '#b40092', '#172dcc', '#006d20', '#bc2222', '#785800', '#b00057'];
  const NIGHT_COLORS = ['#00e5d0', '#d48aff', '#90a8ff', '#ffae3d', '#ff63df', '#87bcff', '#5fea83', '#ff7070', '#ffe05a', '#ff78b6'];

  function applyMoneyColor(el, numOrStr) {
    const digits = Math.max(1, String(numOrStr).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').length);
    const dStr = String(digits);
    if (el.dataset.roiDigit === dStr && el.classList.contains('roi-mc-text')) return;
    const idx = Math.min(digits, DAY_COLORS.length) - 1;
    el.dataset.roiDigit = dStr;
    el.classList.add('roi-mc-text');
    el.style.setProperty('--roi-mc', DAY_COLORS[idx]);
    el.style.setProperty('--roi-mn', NIGHT_COLORS[idx]);
  }
  const getMoneyColorVars = (numOrStr) => {
    const digits = Math.max(1, String(numOrStr).replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').length);
    const idx = Math.min(digits, DAY_COLORS.length) - 1;
    return `--roi-mc:${DAY_COLORS[idx]};--roi-mn:${NIGHT_COLORS[idx]};`;
  };

  function roiPriceText(el) {
    if (!el.querySelector('[data-roi-price-search],[data-roi-browse-switch],[data-roi-upper-fold]')) return el.textContent;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, txt = '';
    while ((n = w.nextNode())) {
      if (!n.parentElement.closest('[data-roi-price-search],[data-roi-browse-switch],[data-roi-upper-fold]')) txt += n.textContent;
    }
    return txt;
  }

  const SLOTS_RAW = {
    1: '1119,1123,1146,1148,1157,1160,1175,1222,1245,1252,1255,1270,1306,1357,1360,1371,1376,1377,1387,1417,1420,1421,1422,1457,1463,1476,1513,1517,1524,1535,1552,1558,1561,1610,1618,1620,1629,1713,1714,1721,1730,1731,1732,1733,1737,1741,1809,1811,1815,1908,1909,1911,1957,1958,1960,1973,2000,2005,2102,2104,2106,2108,2113,2114,2115,2116,2123,2124,2125,2133,2138,2209,2217,2221,2225,2227,2229,2231,2233,2302,2304,2306,2308,2310,2311,2313,2315,2317,2318,2319,2320,2322,2324,2326,2329,2331,2333,2336,2340,2342,2345,2353,2355,2357,2364,2365,2366,2367,2402,2404,2406,2412,2416,2420,2421,2422,2424,2440,2502,2504,2506,2512,2513,2514,2515,2521,2524,2527,2528,2530,2531,2607,2621,2622,2624,2625,2626,2627,2628,2701,2702,2703,2716,2718,5093,5108,5119,5120,5123,5125,5141,5160,5162,5169,5171,5173,5174,5177,5243,5398,5399,13003,13008,13012,13015,13017,13404,13421,18539',
    2: '1110,1113,1120,1122,1126,1128,1147,1151,1154,1158,1162,1176,1210,1213,1216,1219,1226,1246,1250,1253,1284,1285,1311,1354,1358,1361,1375,1451,1454,1458,1460,1464,1507,1510,1514,1519,1551,1560,1564,1572,1573,1604,1607,1611,1622,1646,1707,1710,1715,1716,1723,1745,1803,1805,1810,1812,1903,1905,1952,1954,1972,13004,13013,13034,13405,16000,16001',
    3: '1101,1104,1107,1111,1114,1116,1125,1127,1152,1155,1189,1201,1204,1207,1211,1214,1217,1220,1251,1301,1351,1355,1401,1404,1407,1452,1455,1461,1501,1504,1508,1511,1520,1544,1550,1601,1605,1608,1701,1704,1708,1711,1801,1806,1818,1819,1820,1821,1901,1904,1906,1925,1950,13011,13027',
    4: '1105,1108,1117,1202,1205,1208,1264,1302,1352,1402,1405,1408,1502,1505,1602,1702,1705,1802,1822,1951,13035'
  };
  const SLOTS_MAP = new Map();
  for (const [s, ids] of Object.entries(SLOTS_RAW)) ids.split(',').forEach((id) => SLOTS_MAP.set(Number(id), Number(s)));

  const WLV_RAW = {
    1: '1101,1102,1104,1105,1107,1108,1116,1117,1201,1202,1204,1205,1207,1208,1301,1302,1401,1402,1404,1405,1407,1408,1501,1502,1504,1505,1601,1602,1701,1702,1704,1705,1901,1950,1951',
    2: '1110,1111,1113,1114,1122,1123,1125,1128,1151,1152,1154,1155,1210,1211,1213,1214,1216,1217,1219,1220,1250,1251,1351,1352,1354,1355,1451,1452,1454,1455,1460,1461,1507,1508,1510,1511,1519,1520,1550,1604,1605,1607,1608,1707,1708,1710,1711,1713,1715,1801,1802,1903,1904,1905,1906,1952,1954',
    4: '1124,1130,1131,1132,1133,1135,1136,1138,1140,1141,1163,1164,1165,1166,1167,1168,1170,1175,1176,1223,1228,1229,1230,1231,1232,1233,1234,1235,1236,1237,1239,1241,1242,1261,1262,1263,1265,1268,1269,1270,1304,1306,1307,1311,1363,1364,1365,1366,1370,1371,1375,1376,1377,1387,1413,1415,1417,1420,1421,1422,1466,1468,1469,1470,1471,1473,1474,1476,1477,1478,1523,1524,1525,1527,1535,1557,1559,1560,1572,1573,1613,1614,1616,1620,1625,1626,1629,1630,1646,1648,1720,1722,1724,1734,1737,1741,1745,1807,1814,1815,1911,1918,1920,1962,1964,1969,1970,1972,1973,2000,2001,2004,2005,13001,13002,13017,13027,13034,13035,16000,16001'
  };
  const WLV_MAP = new Map();
  for (const [lv, ids] of Object.entries(WLV_RAW)) ids.split(',').forEach((id) => WLV_MAP.set(Number(id), Number(lv)));

  const HEAD_SUB_RAW = {
    headMid: '2201,2203,2205,2212,2239,2242,2243,2263,2276,2286,2291,2296,5014,5043,5068,5074,5085,5104,5175',
    headLow: '2218,2241,2262,2265,2266,2267,2268,2269,2270,5004,5053,5096,5107,5113',
    'headTop+headMid': '2224,2225,5091,5092,5093,5094,5121,5169,5177,5243',
    'headMid+headLow': '2278,2281,2288,2292,2297,5005,5086,5087,5088,5089,5090,5176',
    'headTop+headMid+headLow': '2264,5046'
  };
  const HEAD_SUB_MAP = new Map();
  for (const [k, ids] of Object.entries(HEAD_SUB_RAW)) ids.split(',').forEach((id) => HEAD_SUB_MAP.set(Number(id), k));

  const ITEM_NAME_CACHE = new Map([[984, '神之金屬'], [985, '鋁'], [756, '神之金屬原石'], [757, '鋁原石'], [7054, '布里刊'], [934, '亡者遺物'], [7053, '賽依伐']]);

  const ITEM_DETAIL_DB = new Map();
  const isPollutedDesc = (s) => typeof s === 'string' && /(?:\bZeny\b|🔍|剩\s*\d+|購買\s*\()/.test(s);
  try {
    const savedDb = readValidatedSetting('roi_learned_item_db_v1', validateLearnedItems, {});
    let cleanedPolluted = false;
    for (const [k, v] of Object.entries(savedDb)) {
      const numId = Number(k);
      if (v && isPollutedDesc(v.desc)) {
        delete v.desc;
        cleanedPolluted = true;
      }
      ITEM_DETAIL_DB.set(numId, v);
      if (v?.name) ITEM_NAME_CACHE.set(numId, v.name);
    }
    if (cleanedPolluted) GM_setValue('roi_learned_item_db_v1', validateLearnedItems(Object.fromEntries(ITEM_DETAIL_DB)));
  } catch { log("items", "無法讀寫本機道具資料"); }
  let dbSaveTimer = null;
  function recordItemDetail(id, info) {
    const numId = Number(id);
    if (!numId || !info) return;
    const old = ITEM_DETAIL_DB.get(numId);
    let changed = !old;
    if (old) {
      for (const k of Object.keys(info)) {
        if (old[k] !== info[k]) { changed = true; break; }
      }
    }
    if (!changed) return;
    const merged = old ? { ...old, ...info } : { ...info };
    ITEM_DETAIL_DB.set(numId, merged);
    if (ITEM_DETAIL_DB.size > 3500) ITEM_DETAIL_DB.delete(ITEM_DETAIL_DB.keys().next().value);
    if (info.name) ITEM_NAME_CACHE.set(numId, info.name);
    if (!dbSaveTimer) {
      dbSaveTimer = setTimeout(() => {
        dbSaveTimer = null;
        try {
          // 與其他分頁已存的學習資料合併（本頁較新者優先），驗證後再寫入。
          updateStoredValue('roi_learned_item_db_v1', validateLearnedItems, {}, (latest) => {
            const merged = { ...latest };
            for (const [id, info] of ITEM_DETAIL_DB) merged[id] = { ...(merged[id] || {}), ...info };
            const ids = Object.keys(merged);
            for (const id of ids.slice(0, Math.max(0, ids.length - 3500))) if (!ITEM_DETAIL_DB.has(Number(id))) delete merged[id];
            const keep = Object.keys(merged);
            for (const id of keep.slice(0, Math.max(0, keep.length - 3500))) delete merged[id];
            return merged;
          });
        } catch { log("items", "無法讀寫本機道具資料"); }
      }, 2000);
    }
  }

  const TOWN_NAMES = {
    alberta: '艾爾貝塔', aldebaran: '艾爾帕蘭', amatsu: '天津町', ayothaya: '哎喲泰雅', comodo: '克魔島',
    einbech: '艾音貝赫', einbroch: '艾音布羅克', geffen: '吉芬', gonryun: '崑崙', hugel: '毀葛',
    izlude: '依斯魯得', lighthalzen: '里希塔樂', louyang: '龍之城', moc_ruins: '金字塔營地', morocc: '夢羅克',
    niflheim: '尼芙菲姆', pay_arche: '弓箭手村', payon: '斐揚', prontera: '普隆德拉', rachel: '拉赫',
    umbala: '汶巴拉', xmas: '薑餅城', yuno: '朱諾'
  };

  const SUB_LABELS = {
    '1hSword': '單手劍', '2hSword': '雙手劍', dagger: '短劍', katar: '拳刃', '1hAxe': '單手斧', '2hAxe': '雙手斧',
    '1hSpear': '單手矛', '2hSpear': '雙手矛', mace: '鈍器', book: '書', staff: '手杖', '2hStaff': '雙手杖',
    bow: '弓', knuckle: '拳套', instrument: '樂器', whip: '鞭子',
    headTop: '頭上', headMid: '頭中', headLow: '頭下', 'headTop+headMid': '頭上＋頭中', 'headMid+headLow': '頭中＋頭下', 'headTop+headMid+headLow': '頭上＋中＋下',
    armor: '鎧甲', shield: '副手盾牌', garment: '披肩', shoes: '鞋子', accessory: '飾品',
    other: '其他'
  };

  const CAT_SUBS = {
    weapon: ['1hSword', '2hSword', 'dagger', 'katar', 'bow', 'staff', '2hStaff', 'mace', '1hSpear', '2hSpear', '1hAxe', '2hAxe', 'knuckle', 'book', 'instrument', 'whip'],
    armor: ['headTop', 'headMid', 'headLow', 'headTop+headMid', 'headMid+headLow', 'headTop+headMid+headLow', 'armor', 'shield', 'garment', 'shoes', 'accessory']
  };

  function classifyItem(id, name = '') {
    const numId = Number(id);
    if (name) ITEM_NAME_CACHE.set(numId, name);
    if ((numId >= 4001 && numId <= 4999) || name.endsWith('卡片')) return { cat: 'card' };
    if (numId === 1116 || numId === 1117 || (numId >= 1150 && numId <= 1199)) return { cat: 'weapon', sub: '2hSword' };
    if ((numId >= 1100 && numId <= 1149) || (numId >= 13400 && numId <= 13499)) return { cat: 'weapon', sub: '1hSword' };
    if ((numId >= 1200 && numId <= 1249) || (numId >= 13000 && numId <= 13099)) return { cat: 'weapon', sub: 'dagger' };
    if (numId >= 1250 && numId <= 1299) return { cat: 'weapon', sub: 'katar' };
    if (numId >= 1300 && numId <= 1349) return { cat: 'weapon', sub: '1hAxe' };
    if (numId >= 1350 && numId <= 1399) return { cat: 'weapon', sub: '2hAxe' };
    if (numId === 1410 || numId === 1411 || (numId >= 1450 && numId <= 1499 && numId !== 1472 && numId !== 1473)) return { cat: 'weapon', sub: '2hSpear' };
    if (numId >= 1400 && numId <= 1449) return { cat: 'weapon', sub: '1hSpear' };
    if (numId === 1472 || numId === 1473 || (numId >= 2000 && numId <= 2099)) return { cat: 'weapon', sub: '2hStaff' };
    if ((numId >= 1500 && numId <= 1549) || (numId >= 16000 && numId <= 16099)) return { cat: 'weapon', sub: 'mace' };
    if (numId >= 1550 && numId <= 1599) return { cat: 'weapon', sub: 'book' };
    if (numId >= 1600 && numId <= 1699) return { cat: 'weapon', sub: 'staff' };
    if (numId >= 1700 && numId <= 1749) return { cat: 'weapon', sub: 'bow' };
    if (numId >= 1750 && numId <= 1799) return { cat: 'consumable', sub: 'other' };
    if (numId >= 1800 && numId <= 1899) return { cat: 'weapon', sub: 'knuckle' };
    if (numId >= 1900 && numId <= 1949) return { cat: 'weapon', sub: 'instrument' };
    if (numId >= 1950 && numId <= 1999) return { cat: 'weapon', sub: 'whip' };
    if (numId >= 2100 && numId <= 2199) return { cat: 'armor', sub: 'shield' };
    if ((numId >= 2200 && numId <= 2299) || (numId >= 5000 && numId <= 5999) || (numId >= 18500 && numId <= 18999)) return { cat: 'armor', sub: HEAD_SUB_MAP.get(numId) || 'headTop' };
    if (numId >= 2300 && numId <= 2399) return { cat: 'armor', sub: 'armor' };
    if (numId >= 2400 && numId <= 2499) return { cat: 'armor', sub: 'shoes' };
    if (numId >= 2500 && numId <= 2599) return { cat: 'armor', sub: 'garment' };
    if (numId >= 2600 && numId <= 2999) return { cat: 'armor', sub: 'accessory' };
    if ((numId >= 501 && numId <= 699) || (numId >= 12000 && numId <= 12300)) return { cat: 'consumable', sub: 'other' };
    return { cat: 'material', sub: 'other' };
  }

  function isStallContext(el) {
    if (!el) return false;
    if (el.closest('[data-roi-market-browser], table.roi-market-table')) return true;
    const fs = el.closest('fieldset');
    if (fs) {
      const leg = [...fs.children].find((c) => c.tagName === 'LEGEND');
      if (leg && /的攤位|搜尋所有城鎮的攤位|我的攤位/.test(clean(roiPriceText(leg)))) return true;
    }
    return false;
  }

  function applyRefineLevelColor(el, plus) {
    if (!el) return;
    if (plus >= 4) {
      const tier = String(Math.min(plus, 10));
      if (el.dataset.roRefTier !== tier) el.dataset.roRefTier = tier;
    } else if (el.dataset.roRefTier) {
      delete el.dataset.roRefTier;
    }
  }

  let cachedFiberKey = null;
  function getReactFiber(node) {
    if (!node) return null;
    if (cachedFiberKey && node[cachedFiberKey]) return node[cachedFiberKey];
    const k = Object.keys(node).find((key) => key.startsWith('__reactFiber$'));
    if (k) cachedFiberKey = k;
    return k ? node[k] : null;
  }

  function currentFiberRoot(node) {
    let f = getReactFiber(node);
    if (!f) return null;
    while (f.return) f = f.return;
    return f.stateNode?.current;
  }

  let gameDictScanned = false;
  let lastDictScanAt = 0;
  function tryLearnFromReactTree(rootEl) {
    if (gameDictScanned) return;
    const now = Date.now();
    if (now - lastDictScanAt < 5000) return;
    lastDictScanAt = now;
    const root = currentFiberRoot(rootEl || document.body.firstElementChild);
    if (!root) return;
    const stack = [root];
    let guard = 0;
    while (stack.length && ++guard < 40000) {
      const f = stack.pop();
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        for (const val of Object.values(p)) {
          if (Array.isArray(val) && val.length > 50 && val[0]?.itemId && (val[0]?.name || val[0]?.atk != null || val[0]?.description)) {
            val.forEach((it) => {
              if (it?.itemId) {
                recordItemDetail(it.itemId, {
                  ...(it.name ? { name: clean(it.name) } : {}),
                  ...(it.atk != null ? { atk: Number(it.atk) } : {}),
                  ...(it.matk != null ? { matk: Number(it.matk) } : {}),
                  ...(it.def != null ? { def: Number(it.def) } : {}),
                  ...(it.weaponLevel != null ? { wLv: Number(it.weaponLevel) } : {}),
                  ...(it.weight != null ? { weight: Number(it.weight) } : {}),
                  ...(it.description || it.effect ? { desc: clean(it.description || it.effect) } : {})
                });
              }
            });
            gameDictScanned = true;
          }
        }
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  }

  function annotateAllRefinedEquipment() {
    tryLearnFromReactTree(document.querySelector('main, #root, table.xp-table, fieldset'));

    const bagRowMap = bagMemo?.val ? new Map(bagMemo.val.rows.map((x) => [x.row, x])) : null;
    for (const img of document.querySelectorAll('li img[src*="/client/item/"], table.xp-table tr img[src*="/client/item/"]')) {
      const row = img.closest('li, table.xp-table tr');
      if (!row || row.closest('#ro-helper-hud,#roi-helper-mvp-panel,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
      const itemId = Number(img.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
      if (!itemId) continue;

      const nameEl = row.querySelector('button[aria-label$="的物品資訊"], a') || row.querySelector('td:first-child, span');
      if (!nameEl) continue;
      const rawTxt = clean(roiPriceText(nameEl));
      const refM = rawTxt.match(/^\+\s*(\d+)\s+(.+)/);
      const baseName = (refM ? refM[2] : rawTxt).replace(/\s*\[\d+\].*$/, '').trim();
      if (baseName && !/^\d+$/.test(baseName)) ITEM_NAME_CACHE.set(itemId, baseName);

      let plus = refM ? Number(refM[1]) : 0;
      let cards = [];
      let cardsKnown = false;
      let extraStats = null;
      if (row.tagName === 'TR' && bagRowMap) {
        const bRow = bagRowMap.get(row);
        if (bRow?.st) {
          plus = bRow.st.refine || plus;
          cards = (bRow.st.cards || []).filter(Boolean);
          cardsKnown = true;
          extraStats = bRow.st;
        }
      }
      const inStall = isStallContext(row);
      if (!cardsKnown && (inStall || row.tagName === 'LI' || row.tagName === 'TR')) {
        const { cat } = classifyItem(itemId);
        if (cat === 'weapon' || cat === 'armor') {
          const stack = readNearbyItemStack(row, itemId, plus);
          if (stack) {
            cards = stack.cards.filter(Boolean);
            cardsKnown = true;
            if (!extraStats) extraStats = stack;
          }
        }
      }
      if (extraStats && (extraStats.atk || extraStats.def || extraStats.matk || extraStats.weaponLevel || extraStats.description)) {
        recordItemDetail(itemId, {
          ...(extraStats.atk ? { atk: Number(extraStats.atk) } : {}),
          ...(extraStats.matk ? { matk: Number(extraStats.matk) } : {}),
          ...(extraStats.def ? { def: Number(extraStats.def) } : {}),
          ...(extraStats.weaponLevel ? { wLv: Number(extraStats.weaponLevel) } : {}),
          ...(extraStats.description ? { desc: clean(extraStats.description) } : {})
        });
      }

      row.dataset.roHoverId = String(itemId);
      row.dataset.roHoverRefine = String(plus);
      row.dataset.roHoverName = rawTxt;
      if (cardsKnown) row.dataset.roHoverCards = cards.join(',');
      else delete row.dataset.roHoverCards;

      row.querySelector('[data-ro-ref-annotated]')?.remove();
      applyRefineLevelColor(nameEl, inStall ? 0 : plus);
    }

    for (const box of document.querySelectorAll('.xp-sunken')) {
      if (box.closest('#ro-helper-hud,#roi-helper-mvp-panel,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
      box.querySelector(':scope > [data-ro-detail-ref-badge]')?.remove();
      if (box.querySelector('table, ul, ol, input[type="number"], [data-roi-price-search]')) continue;
      const imgs = box.querySelectorAll('img[src*="/client/item/"]');
      const img = imgs[0];
      if (!img || imgs.length > 5 || img.closest('.xp-sunken') !== box) {
        applyRefineLevelColor(box.querySelector('[data-ro-ref-tier]'), 0);
        continue;
      }
      const itemId = Number(img.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
      if (!itemId) {
        applyRefineLevelColor(box.querySelector('[data-ro-ref-tier]'), 0);
        continue;
      }
      const rawBoxText = box.textContent || '';
      const boxSig = `${itemId}|${rawBoxText.length}|${rawBoxText.slice(0, 48)}`;
      let lines;
      if (box.dataset.roBoxSig !== boxSig) {
        box.dataset.roBoxSig = boxSig;
        lines = (box.innerText || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(?:裝備|卸下|鎖定|解鎖|存入倉庫|存倉|回城賣|請忽克連|一鍵精煉|武器精練|關閉|⚡|🔍|剩\s*\d+|購買)/.test(l) && !/\bZeny\b/i.test(l));
        const txt = clean(lines.join(' '));
        const atkM = txt.match(/(?:攻擊力?|ATK)\s*[:：]?\s*(\d+)/i);
        const matkM = txt.match(/(?:魔攻|MATK)\s*[:：]?\s*(\d+)/i);
        const defM = txt.match(/(?:防禦力?|DEF)\s*[:：]?\s*(\d+)/i);
        const wLvM = txt.match(/武器等級\s*[:：]?\s*(\d)/);
        const wtM = txt.match(/重量\s*[:：]?\s*(\d+(?:\.\d+)?)/);
        const desc = lines.slice(1, 14).join('\n').slice(0, 600);
        recordItemDetail(itemId, {
          ...(atkM ? { atk: Number(atkM[1]) } : {}),
          ...(matkM ? { matk: Number(matkM[1]) } : {}),
          ...(defM ? { def: Number(defM[1]) } : {}),
          ...(wLvM ? { wLv: Number(wLvM[1]) } : {}),
          ...(wtM ? { weight: Number(wtM[1]) } : {}),
          ...(desc && !/(?:Zeny|🔍|剩\s*\d+)/i.test(desc) ? { desc } : {})
        });
      } else {
        lines = rawBoxText.split('\n').map((l) => l.trim()).filter(Boolean);
      }

      const titleM = (lines[0] || '').match(/^\+\s*(\d+)/);
      const plus = titleM ? Number(titleM[1]) : 0;
      const inStall = isStallContext(box);
      const titleEl = !/[+＋]\s*[0-9０-９]/.test(rawBoxText) ? null : [...box.querySelectorAll('button, span, div, b, strong, p')].find(
        (el) => !el.children.length && !el.closest('button[data-ro-lock]') && /^\+\s*\d+/.test(clean(el.textContent))
      ) || [...box.querySelectorAll('button, span, div, b, strong, p')].find((el) =>
        !el.closest('button[data-ro-lock]') && [...el.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && /^\+\s*\d+/.test(clean(node.textContent))));
      applyRefineLevelColor(box, 0);
      applyRefineLevelColor(titleEl, inStall ? 0 : plus);
    }
  }

  function readNearbyItemStack(row, id, refine) {
    let fiber = getReactFiber(row);
    if (!fiber) return null;
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current !== root) fiber = fiber.alternate;
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      const stack = [props?.item, props?.stack, props].find((item) =>
        Number(item?.itemId) === id && Number(item.refine ?? 0) === refine && Array.isArray(item.cards));
      if (stack) return stack;
    }
    return null;
  }

  const fiberRouteMap = new WeakMap();
  class FiberTraversalTimeout extends Error {
    constructor() { super('介面讀取逾時，請稍後再試'); }
  }

  let fiberRetryScheduled = false;
  function createFiberScanBudget(host, attempts) {
    const deadline = performance.now() + 8;
    let visited = 0;
    return {
      step() {
        if ((++visited & 255) !== 0 || performance.now() < deadline) return;
        const retries = attempts.get(host) || 0;
        if (retries < 3) {
          attempts.set(host, retries + 1);
          if (!fiberRetryScheduled) {
            fiberRetryScheduled = true;
            requestAnimationFrame(() => {
              fiberRetryScheduled = false;
              runPageRouter();
            });
          }
        }
        throw new FiberTraversalTimeout();
      },
      complete() { attempts.delete(host); }
    };
  }
  const propsScanRetries = new WeakMap();
  const backpackScanRetries = new WeakMap();
  const detailScanRetries = new WeakMap();

  function readFiberForUi(read) {
    try { return read(); }
    catch (error) {
      if (!(error instanceof FiberTraversalTimeout)) throw error;
      return undefined;
    }
  }

  function getCommittedProps(el, matcher) {
    // 由 return 指標回推 child/sibling 路徑；任何一段對不上（樹正在變動）就不快取。
    const fiberRouteFrom = (top, node) => {
      const out = [];
      for (let guard = 0; node && node !== top; guard++) {
        const parent = node.return;
        if (!parent || guard > 80000) return null;
        let s = parent.child, k = 0;
        for (; s && s !== node; s = s.sibling) k++;
        if (!s) return null;
        for (let i = 0; i < k; i++) out.push('s');
        out.push('c');
        node = parent;
      }
      return node === top ? out.reverse() : null;
    };
    const root = currentFiberRoot(el);
    if (!root) return null;
    const cachedRoute = fiberRouteMap.get(el);
    if (cachedRoute) {
      let node = root, found = null;
      for (const step of cachedRoute) {
        if (!node) break;
        const p = node.memoizedProps;
        if (step === 'c' && p && matcher(p)) found = p;
        node = step === 'c' ? node.child : node.sibling;
      }
      if (node?.stateNode === el) {
        if (node.memoizedProps && matcher(node.memoizedProps)) return node.memoizedProps;
        if (found) return found;
      }
    }
    const nodes = [root], founds = [null];
    let guard = 0;
    const budget = createFiberScanBudget(el, propsScanRetries);
    while (nodes.length && ++guard < 80000) {
      budget.step();
      const node = nodes.pop(), found = founds.pop();
      const p = node.memoizedProps;
      const next = p && matcher(p) ? p : found;
      if (node.stateNode === el) {
        budget.complete();
        const route = next ? fiberRouteFrom(root, node) : null;
        if (route) fiberRouteMap.set(el, route);
        return next;
      }
      if (node.sibling) { nodes.push(node.sibling); founds.push(found); }
      if (node.child) { nodes.push(node.child); founds.push(next); }
    }
    budget.complete();
    return null;
  }

  const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  const state = {
    paused: false, accMs: 0, lastResumed: Date.now(),
    activeCharId: null, activeCharName: '讀取中...',
    initZenyMap: {}, curZeny: 0, chars: [], charZenyMap: {}, myCharIds: new Set(),
    kills: 0, bexp: 0, jexp: 0, dmgSum: 0, hits: 0, maxDmg: 0, damageTaken: 0, damageStartMs: 0, pickupQty: 0, hudMetrics: [...defaultHudMetrics],
    loot: Object.create(null), lootRev: 0, renderedLootRev: -1,
    rares: [], rareRev: 0,
    missed: 0,
    sound: false, notify: false, moneyColor: true, itemHover: true, marketHover: true,
    whProtectPins: true, mvpMergeRoster: false, charAlerts: {}, whProtect: true, whSaleReview: true, whAutoEquipCard: true,
    whMarks: {}, whAutoLocks: {}, customProtectWords: [],
    hudMin: false, hudPos: null, mktUpperFold: false,
    hudCompactMetrics: [...defaultCompactHudMetrics], hudNumberFormat: 'auto',
    charAttentionOnly: false, charAttentionFirst: false,
    processedLines: new WeakMap(), lastNotifyAt: 0
  };

  Object.assign(state, readValidatedSetting('ro_lean_prefs_v091', validatePrefs, {}));
  const loadedWh = readValidatedSetting('warehouse-helper-v1', validateWarehouse, { marks: {}, autoLocks: {} }, true);
  state.whMarks = loadedWh.marks;
  state.whAutoLocks = loadedWh.autoLocks;
  state.whPins = loadedWh.pins ?? {};
  state.customProtectWords = readValidatedSetting('ro_custom_protect_words_v091', validateWords, []);

  let applyingRemote = false;
  // 其他分頁寫入的值一律先通過與寫入前相同的驗證；無效即忽略，不改本頁狀態。
  function listenRemote(key, validate, apply, json = false) {
    if (typeof GM_addValueChangeListener !== 'function') return;
    GM_addValueChangeListener(key, (_key, _old, value, remote) => {
      if (remote !== true || value === undefined) return;
      let data;
      try { data = validateStoredValue(value, validate, json); }
      catch (error) { console.warn('便利助手忽略無效的跨分頁資料', key, error.message); return; }
      if (data == null) return;
      applyingRemote = true;
      try { apply(data); } catch (error) { console.warn('便利助手設定同步', key, error.message); }
      finally { applyingRemote = false; }
    });
  }
  function listenSharedSettings() {
    if (typeof GM_addValueChangeListener !== 'function') return;
    const listen = (key, apply, validate, json) => listenRemote(key, validate, apply, json);
    listen('warehouse-helper-v1', data => {
      applyWarehouseData(mergeWarehouseChanges(data));
      refreshWarehouse();
    }, validateWarehouse, true);
    listen('ro_custom_protect_words_v091', words => {
      state.customProtectWords = words;
      const input = document.querySelector('#i-words');
      if (input && document.activeElement !== input) input.value = state.customProtectWords.join(', ');
      refreshWarehouse(true);
    }, validateWords);
    listen('ro_lean_prefs_v091', value => {
      const { hudMin, hudPos, ...prefs } = value;
      Object.assign(state, prefs);
      for (const [key, v] of Object.entries(prefs)) prefsSynced.set(key, prefValueSig(v));
      document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);
      hideTooltip();
      refreshWarehouse();
      syncMktMount();
      mvpRadar?.refreshPreferences();
      syncHudSettings();
      if (Object.hasOwn(prefs, 'charAttentionOnly') || Object.hasOwn(prefs, 'charAttentionFirst')) renderChars();
    }, validatePrefs);
    listen(priceOptionKey, (options) => {
      priceOptions = options;
      refreshWarehouse();
      syncHudSettings();
    }, validatePriceOptions);
    listen('roi-favorites-v1', (favs) => {
      mktFavs = new Set(favs);
      renderMkt();
    }, validateFavorites);
    listen('roi-refine-material-batch-v1', (batch) => {
      if (refBusy) return;
      refMaterialBatch = batch;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    }, validateMaterialBatch);
    listen('roi-rare-auto-map-v1', (enabled) => applyRareAutoMap(enabled), validateRareAutoMap);
  }

  const prefKeys = ['sound', 'notify', 'moneyColor', 'itemHover', 'marketHover', 'whProtectPins', 'mvpMergeRoster', 'whProtect',
    'whSaleReview', 'whAutoEquipCard', 'hudMin', 'hudPos', 'mktUpperFold', 'hudMetrics', 'hudCompactMetrics',
    'hudNumberFormat', 'charAttentionOnly', 'charAttentionFirst'];
  const prefValueSig = (value) => JSON.stringify(value ?? null);
  // 本頁最後一次與已存值同步時的各欄位；儲存時只寫入與此不同（本頁改過）的欄位。
  const prefsSynced = new Map(prefKeys.map((key) => [key, prefValueSig(state[key])]));
  function savePrefs() {
    const changed = {};
    for (const key of prefKeys) if (prefValueSig(state[key]) !== prefsSynced.get(key)) changed[key] = state[key];
    if (!Object.keys(changed).length) return;
    try {
      updateStoredValue('ro_lean_prefs_v091', validatePrefs, {}, (latest) => ({ ...latest, ...changed }));
      for (const [key, value] of Object.entries(changed)) prefsSynced.set(key, prefValueSig(value));
    } catch (error) { console.warn('便利助手偏好設定儲存失敗', error); }
  }

  function setWarehouseSaleReview(enabled) {
    state.whSaleReview = enabled;
    savePrefs();
    for (const input of document.querySelectorAll('[data-roi-wh-sale-review]')) input.checked = enabled;
    syncHudSettings();
  }

  function findTownSearchUI(visibleOnly = false) {
    for (const f of document.querySelectorAll('fieldset')) {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      if (!leg || clean(roiPriceText(leg)) !== '搜尋所有城鎮的攤位') continue;
      for (const form of f.querySelectorAll('form')) {
        const inp = form.querySelector('input[type="text"],input[type="search"],input:not([type])');
        const btn = [...form.querySelectorAll('button')].find((b) => clean(b.textContent) === '搜尋');
        if (inp && btn && (!visibleOnly || visible(inp))) return { form, input: inp, button: btn };
      }
    }
    return null;
  }

  let townResultsTable = null;
  let townResultsRows = [];
  function sizeTownSearchResults() {
    const table = townResultsTable;
    const last = townResultsRows.at(-1);
    if (!table?.isConnected || !table.contains(last)) return;
    const height = last.getBoundingClientRect().bottom - table.getBoundingClientRect().top + table.scrollTop;
    const maxHeight = height > 0 ? `${Math.ceil(height)}px` : '';
    if (table.style.maxHeight !== maxHeight) table.style.maxHeight = maxHeight;
  }
  const townResultsObserver = new ResizeObserver(sizeTownSearchResults);

  function refreshTownSearchResults(ui) {
    const table = ui?.form.closest('fieldset')?.querySelector(':scope > table.xp-table');
    const rows = table?.tBodies[0]?.rows;
    const visibleRows = [];
    let offers = 0;
    for (const row of rows || []) {
      // The game inserts a full-width equipment details row beneath an expanded offer.
      if (row.cells.length > 1 && ++offers === 6) break;
      visibleRows.push(row);
    }
    const next = offers === 6 && visible(table) ? table : null;
    if (next === townResultsTable && (!next || (visibleRows.length === townResultsRows.length &&
        visibleRows.every((row, i) => row === townResultsRows[i])))) return;

    townResultsObserver.disconnect();
    if (townResultsTable && townResultsTable !== next) {
      townResultsTable.removeAttribute('data-roi-town-results');
      townResultsTable.removeAttribute('tabindex');
      townResultsTable.removeAttribute('role');
      townResultsTable.removeAttribute('aria-label');
      townResultsTable.style.maxHeight = '';
    }
    if (next && (next !== townResultsTable || visibleRows[0] !== townResultsRows[0])) next.scrollTop = 0;
    townResultsTable = next;
    townResultsRows = next ? visibleRows : [];
    if (!next) return;
    next.setAttribute('data-roi-town-results', '');
    next.setAttribute('tabindex', '0');
    next.setAttribute('role', 'table');
    next.setAttribute('aria-label', '跨城搜尋結果');
    sizeTownSearchResults();
    if (next.tHead) townResultsObserver.observe(next.tHead);
    for (const row of visibleRows) townResultsObserver.observe(row);
  }

  document.addEventListener('submit', (event) => {
    if (townResultsTable?.isConnected && event.target === findTownSearchUI()?.form) {
      // React can reuse the first row when successive searches share a result.
      townResultsTable.scrollTop = 0;
    }
  }, true);

  async function triggerNativeTownSearch(rawName, visibleOnly = false) {
    const baseName = clean(rawName).replace(/（.*?）|\(.*?\)/g, '').replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\]\s*$/, '').trim();
    if (!baseName) return;
    if (mktView) { mktView = false; syncMktMount(); await sleep(50); }

    const target = findTownSearchUI(visibleOnly);
    if (target && !target.input.disabled) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(target.input, baseName);
      target.input.dispatchEvent(new Event('input', { bubbles: true }));
      target.input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 15; i++) {
        await sleep(40);
        if (!target.button.disabled) {
          target.input.scrollIntoView({ block: 'nearest' });
          target.button.click();
          return;
        }
      }
    }
    const rows = [...document.querySelectorAll('table.xp-table tr')];
    const matchRow = rows.find((tr) => clean(tr.textContent).includes(baseName) && tr.querySelector('input[type="number"], button'));
    if (matchRow) {
      matchRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
      matchRow.style.outline = '2px solid #facc15';
      setTimeout(() => { matchRow.style.outline = ''; }, 3000);
    }
  }

  const amtRx = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\s*(Zeny|Z|澤尼))?$/i;
  const headRx = /^(?:單價|價格|售價|賣價|收購價|總價|總額|金額|實收|稅|稅金)(?:\s*[（(]\s*(?:Zeny|Z|澤尼)\s*[）)])?$|^(?:Zeny|澤尼)$/i;

  function alignAndColorizeNativeMarkets() {
    for (const table of document.querySelectorAll('table.xp-table')) {
      let scope = table.parentElement, hasPurchase = false;
      for (let d = 0; scope && d < 3 && scope !== document.body; d++, scope = scope.parentElement) {
        if ([...scope.querySelectorAll('button')].some((b) => /^購買(?:$|\s*[（(])/.test(clean(b.textContent)))) { hasPurchase = true; break; }
      }
      if (!hasPurchase) continue;
      const rs = [...table.rows].filter((r) => r.closest('table') === table && [...r.cells].some((c) => c.tagName === 'TD'));
      if (!rs.length) continue;
      let shape = null;
      const layout = [];
      for (const r of rs) {
        const cells = [...r.cells];
        if (cells.length < 3 || cells.length > 4 || cells.some((c) => c.colSpan !== 1 || c.rowSpan !== 1)) { shape = null; break; }
        const item = cells.findIndex((c) => c.querySelector('img[src*="/client/item/"],button[aria-label$="的物品資訊"]'));
        const input = cells.findIndex((c) => c.querySelector('input[type="number"]'));
        const prices = cells.flatMap((c, i) => {
          const m = clean(roiPriceText(c)).match(amtRx);
          return m?.[2] && !c.querySelector('input,button:not([data-roi-price-search]),a') ? [i] : [];
        });
        if (item < 0 || input < 0 || prices.length !== 1 || new Set([item, input, prices[0]]).size !== 3) { shape = null; break; }
        const roles = cells.map((c, i) => i === item ? 'item' : i === input ? (cells.length === 3 ? 'input-stock' : 'input') : i === prices[0] ? 'price' : 'stock');
        const sig = roles.join(',');
        if (shape && sig !== shape) { shape = null; break; }
        shape = sig;
        cells.forEach((cell, i) => layout.push([cell, roles[i]]));
      }
      if (!shape) continue;
      const headings = [...table.rows].filter((r) => r.closest('table') === table && [...r.cells].every((c) => c.tagName === 'TH'));
      const roles = shape.split(',');
      if (!headings.some((r) => r.cells.length !== roles.length)) {
        headings.forEach((r) => [...r.cells].forEach((cell, i) => layout.push([cell, roles[i]])));
      }
      if (!table.classList.contains('roi-market-table')) table.classList.add('roi-market-table');
      for (const [cell, role] of layout) {
        if (cell.dataset.roiMarketCol !== role) cell.dataset.roiMarketCol = role;
      }
    }

    const tables = [...document.querySelectorAll('table.xp-table')];
    const hasTownSearch = tables.length ? Boolean(findTownSearchUI()) : false;
    for (const tbl of tables) {
      const hdr = [...tbl.rows].find((r) => r.cells.length && [...r.cells].every((c) => c.tagName === 'TH'));
      const pCols = new Set(hdr ? [...hdr.cells].flatMap((c, i) => (headRx.test(clean(c.textContent)) ? [i] : [])) : []);

      for (const td of tbl.querySelectorAll('td')) {
        if (td.closest('table') !== tbl) continue;
        const plain = [...td.querySelectorAll('*')].every((el) => el.closest('[data-roi-price-search]') || el.tagName === 'SPAN');
        const val = plain ? clean(roiPriceText(td)).match(amtRx) : null;
        if (state.moneyColor && val && (val[2] || pCols.has(td.cellIndex))) {
          applyMoneyColor(td, val[1]);
        }
        if (hasTownSearch && td.dataset.roiMarketCol === 'price') {
          const row = td.closest('tr');
          const itemCell = [...row.cells].find((c) => c.dataset.roiMarketCol === 'item');
          const nameBtn = itemCell?.querySelector('button,a');
          const iName = clean(nameBtn?.textContent || '');
          if (iName) {
            let qBtn = td.querySelector('[data-roi-price-search]');
            if (!qBtn) {
              qBtn = document.createElement('button');
              qBtn.type = 'button'; qBtn.dataset.roiPriceSearch = ''; qBtn.textContent = '🔍';
              // React 重用同一列顯示其他商品時，點擊須搜尋目前的品名而非建立按鈕時的品名。
              qBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (qBtn.dataset.roiPriceSearch) triggerNativeTownSearch(qBtn.dataset.roiPriceSearch); };
              td.appendChild(qBtn);
            }
            if (qBtn.dataset.roiPriceSearch !== iName) qBtn.dataset.roiPriceSearch = iName;
            if (qBtn.title !== `跨城搜尋：${iName}`) qBtn.title = `跨城搜尋：${iName}`;
          }
        }
      }
    }
    if (state.moneyColor) {
      for (const leg of document.querySelectorAll('fieldset > legend')) {
        if (clean(roiPriceText(leg)) !== '搜尋所有城鎮的攤位') continue;
        for (const el of leg.parentElement.querySelectorAll('table.xp-table td :is(div,span,p,b,strong,small)')) {
          if (el.children.length || el.closest('button,a,input,select,[data-roi-price-search]')) continue;
          const v = clean(el.textContent).match(amtRx);
          if (v?.[2]) applyMoneyColor(el, v[1]);
        }
      }
    }
  }

  let sharedAudioCtx = null;
  const playTone = (freq, type, dur, delay = 0) => {
    if (!state.sound) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new AudioCtx();
      if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
      const ctx = sharedAudioCtx;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      g.gain.setValueAtTime(0.12, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + dur);
    } catch {}
  };
  const alertUser = (title, text, isDanger = false) => {
    if (isDanger) { playTone(220, 'sawtooth', 0.2, 0); playTone(165, 'sawtooth', 0.3, 0.2); }
    else { playTone(880, 'sine', 0.15, 0); playTone(1318, 'triangle', 0.25, 0.15); }
    if (state.notify && Date.now() - state.lastNotifyAt > TIMING.notifyCooldown && typeof GM_notification === 'function') {
      state.lastNotifyAt = Date.now();
      GM_notification({ title, text, timeout: TIMING.notifyDuration });
    }
  };

  let foregroundMvpSnapshot = null;

  function applyCharRoster(characters, notify, previous = state.chars) {
    const prevRun = new Set(previous.filter(c => c.running).map(c => Number(c.id)));
    if (previous.length > 0) {
      const stopped = characters.filter((c) => !c.running && prevRun.has(Number(c.id)));
      for (const c of stopped) recordCharAlert(c.id, '已停止掛機');
      if (notify && stopped.length) alertUser('🚨 分身停機警告', `${stopped.map((c) => c.name).join('、')} 已停止掛機`, true);
    }
    state.chars = characters;
    state.myCharIds = new Set(characters.map((c) => Number(c.id)));
    state.charRosterLoaded = true;
    for (const c of characters) {
      if (c.running && state.charAlerts[c.id]?.reason === '已停止掛機') delete state.charAlerts[c.id];
    }
    for (const cache of [state.charZenyMap, state.initZenyMap, state.charAlerts]) {
      for (const id of Object.keys(cache)) {
        if (!state.myCharIds.has(Number(id))) delete cache[id];
      }
    }
    if (!Object.keys(state.charAlerts).length) document.getElementById('ro-fab')?.classList.remove('roi-stop-alert');
    renderChars();
  }

  function onApiData(url, text, foreground = true) {
    try {
      if (!text || text[0] !== '{') return;
      const path = String(url).replace(location.origin, '').split('?')[0];
      if (path !== '/api/characters' && !/^\/api\/characters\/\d+$/.test(path)) return;
      const d = JSON.parse(text);
      if (path === '/api/characters' && Array.isArray(d.characters) && d.characters.length <= 12) {
        nativeRosterIds = new Set(d.characters.map(c => Number(c.id)));
        // 原生名單比既有共享快取新，之後只接受更晚寫入的共享資料。
        lastSharedCharPollAt = Math.max(lastSharedCharPollAt, Date.now());
        applyCharRoster(d.characters, !canShareCharPoll());
        if (canShareCharPoll()) applySharedCharPoll(readSharedCharPoll());
      } else if (d.characterId && d.snapshot?.character) {
        const cid = Number(d.characterId);
        if (state.charRosterLoaded && !state.myCharIds.has(cid)) return;
        const ch = d.snapshot.character;
        if (foreground) {
          if (state.activeCharId !== cid) {
            combatHitMeter.reset();
            if (state.activeCharId != null) {
              clearQueuedCharacterLogs();
              state.dmgSum = state.hits = state.maxDmg = state.damageTaken = 0;
              state.damageStartMs = state.accMs + (state.paused ? 0 : Date.now() - state.lastResumed);
            }
            refineIdentityEpoch++;
            pageNet.events.dispatchEvent(new Event('ui-abort'));
            refSelected.clear();
          }
          state.activeCharId = cid;
          state.activeCharName = ch.name || d.name;
          foregroundMvpSnapshot = Array.isArray(d.snapshot.mvpLastKill) ? d.snapshot : null;
        }
        if (typeof ch.zeny === 'number') {
          if (state.initZenyMap[cid] === undefined) state.initZenyMap[cid] = ch.zeny;
          if (foreground) {
            state.curZeny = ch.zeny;
            localZenyAt.set(cid, Date.now());
          }
          state.charZenyMap[cid] = ch.zeny;
        }
        if (foreground && canShareCharPoll()) applySharedCharPoll(readSharedCharPoll());
        updateHUD(); renderChars();
      }
    } catch {}
  }

  const pollFetch = page.fetch.bind(page);
  let detailRequest = 0;
  // 頁面（遊戲）發出的 fetch 進行中／已完成數；腳本自己的輪詢走 pollFetch，不計入。
  // events：每個遊戲請求完成時發 'settled'（detail: path/method/status），全隊移動等流程用來取代固定等待。
  const pageNet = { inFlight: 0, settled: 0, events: new EventTarget() };
  let refineCommandWatch = null;
  function matchRefineCommand(path, method, body, watch) {
    if (!watch || method !== 'POST' || path !== `/api/characters/${watch.characterId}/commands`
        || typeof body !== 'string') return false;
    try {
      const { commandId, command } = JSON.parse(body);
      if (typeof commandId !== 'string' || !commandId || command?.type !== 'refine'
          || command.skill !== true || command.uid !== watch.uid
          || (watch.commandId && watch.commandId !== commandId)) return false;
      watch.commandId = commandId;
      watch.pending++;
      return true;
    } catch { return false; }
  }

  try {
    const origFetch = page.fetch;
    if (origFetch) {
      page.fetch = async function (...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const path = u.replace(location.origin, '').split('?')[0];
        const isDetail = /^\/api\/characters\/\d+$/.test(path);
        const request = isDetail ? ++detailRequest : 0;
        const method = String(args[1]?.method || args[0]?.method || 'GET').toUpperCase();
        const watch = refineCommandWatch;
        const watched = matchRefineCommand(path, method, args[1]?.body, watch);
        pageNet.inFlight++;
        let res;
        try { res = await origFetch.apply(this, args); }
        finally {
          pageNet.inFlight--; pageNet.settled++;
          if (watched) {
            watch.pending--;
            watch.status = res?.status ?? 0;
            watch.settled++;
          }
          try { pageNet.events.dispatchEvent(new CustomEvent('settled', { detail: { path, method, status: res?.status ?? 0 } })); } catch {}
        }
        if (path === '/api/characters' || isDetail) {
          try { res.clone().text().then((t) => { if (!isDetail || request === detailRequest) onApiData(u, t); }).catch(() => {}); } catch {}
        }
        return res;
      };
    }
  } catch {}

  const charPollKey = 'roi-char-poll-v1';
  const canShareCharPoll = () => typeof navigator.locks?.request === 'function' &&
    typeof GM_addValueChangeListener === 'function';
  let nativeRosterIds = null;
  let lastSharedCharPollAt = 0;
  let polledRoster = false;
  let charPollBusy = false;
  const charPollInterval = TIMING.charPollInterval;
  // 重用門檻須小於輪詢間隔，否則計時器準時觸發時會跳過自己上一輪的結果，實際週期變成 90 秒。
  const charPollReuseMs = charPollInterval - TIMING.charPollReuseMargin;
  const localZenyAt = new Map();

  function validateCharPoll(data) {
    if (!data || !Number.isSafeInteger(data.at) || data.at <= 0 || data.at > Date.now() ||
        !Array.isArray(data.characters) || data.characters.length > 12 ||
        !data.characters.every(c => c && positiveId(c.id) && typeof c.name === 'string' &&
          typeof c.running === 'boolean') || !isPlainRecord(data.zeny)) return null;
    return data;
  }

  function readSharedCharPoll() {
    try { return validateCharPoll(GM_getValue(charPollKey, null)); }
    catch { return null; }
  }

  function matchesCharAccount(characters) {
    if (nativeRosterIds) return characters.some(c => nativeRosterIds.has(Number(c.id)));
    return state.activeCharId != null && characters.some(c => Number(c.id) === state.activeCharId);
  }

  function applySharedCharPoll(data) {
    if (!data || data.at <= lastSharedCharPollAt || Date.now() - data.at >= 45000 ||
        !matchesCharAccount(data.characters)) return;
    lastSharedCharPollAt = data.at;
    applyCharRoster(data.characters, false);
    applyPollZeny(data);
  }

  function applyPollZeny({ at, characters, zeny }) {
    for (const { id } of characters) {
      const balance = zeny[id];
      if (!Number.isSafeInteger(balance) || balance < 0 || (localZenyAt.get(Number(id)) ?? 0) >= at) continue;
      // 本頁目前角色由前景 API／攤位快照維護 curZeny；輪詢值（deferCatchup）只寫清單會讓清單與儀表盤餘額互相跳動。
      if (Number(id) === state.activeCharId && localZenyAt.has(Number(id))) continue;
      state.charZenyMap[id] = balance;
      state.initZenyMap[id] ??= balance;
    }
    renderChars();
  }

  async function fetchCharPoll(allBalances = true) {
    const at = Date.now();
    const signal = globalThis.AbortSignal?.timeout?.(15000);
    const response = await pollFetch('/api/characters', { signal });
    if (!response.ok) return null;
    const { characters } = await response.json();
    const data = validateCharPoll({ at, characters, zeny: {} });
    if (!data) return null;
    const queue = characters.filter(c => allBalances || state.charZenyMap[c.id] === undefined);
    async function readBalances() {
      while (queue.length) {
        const id = Number(queue.shift().id);
        try {
          const response = await pollFetch(`/api/characters/${id}?deferCatchup=1`, { signal });
          if (!response.ok) continue;
          const detail = await response.json();
          const balance = detail.snapshot?.character?.zeny;
          if (Number(detail.characterId) === id && Number.isSafeInteger(balance) && balance >= 0) data.zeny[id] = balance;
        } catch {}
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, readBalances));
    return data;
  }

  async function pollChars() {
    if (document.hidden || charPollBusy) return;
    charPollBusy = true;
    try {
      if (canShareCharPoll()) {
        await navigator.locks.request('roi-leader', { ifAvailable: true }, async lock => {
          if (!lock || document.hidden) return;
          const previous = readSharedCharPoll();
          if (previous && Date.now() - previous.at < charPollReuseMs && matchesCharAccount(previous.characters)) {
            applySharedCharPoll(previous);
            return;
          }
          // 已驗證的名單和快取同帳號時才可跳過請求；未辨識角色讓原生 API 建立身分。
          if (previous && Date.now() - previous.at < charPollReuseMs && !nativeRosterIds && state.activeCharId == null) return;
          const data = await fetchCharPoll();
          if (!data) return;
          nativeRosterIds = new Set(data.characters.map(c => Number(c.id)));
          const sameAccount = previous?.characters.some(c => nativeRosterIds.has(Number(c.id)));
          // 只有最近兩輪內的共享名單可作為停機比較基準，避免重開頁面時把數小時前的狀態當成剛停機。
          const baseline = sameAccount && Date.now() - previous.at < charPollInterval * 2 ? previous.characters : state.chars;
          GM_setValue(charPollKey, data);
          lastSharedCharPollAt = data.at;
          applyCharRoster(data.characters, true, baseline);
          applyPollZeny(data);
        });
        return;
      }
      if (polledRoster && !document.hasFocus()) {
        let elapsed = Infinity;
        try { elapsed = Date.now() - Number(localStorage.getItem('roi-last-chars-poll-at')); } catch {}
        if (elapsed >= 0 && elapsed < 12000) return;
      }
      const data = await fetchCharPoll(false);
      if (!data) return;
      polledRoster = true;
      try { localStorage.setItem('roi-last-chars-poll-at', String(Date.now())); } catch {}
      applyCharRoster(data.characters, true);
      applyPollZeny(data);
    } catch {}
    finally { charPollBusy = false; }
  }

  const rxRareDrop = /(?:卡片|稀有)!/;
  const rxDangerLog = /戰鬥不能|已經死亡|超過負重.*停止/;
  const rxDmgLog = /對\s+(.+?)\s+造成(?:\s+\d+\s*段)?\s+([\d,]+)\s*點傷害/;
  const rxTakenLog = /對你造成\s*([\d,]+)\s*點傷害/;
  const logBody = (text) => text.replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, '');
  const logNumber = (value) => {
    const number = Number(value?.replace(/,/g, ''));
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  };

  function readOutgoingDamage(body) {
    const hit = body.match(rxDmgLog);
    const target = hit?.[1].trim().replace(/^(?:\[反擊\]|\[範圍\])+/, '');
    if (!target || /^(?:生命體|寵物)/.test(body) || /^(?:你|生命體)$/.test(target)) return null;
    const damage = logNumber(hit[2]);
    return damage ? { target, damage } : null;
  }

  function createCombatHitMeter(startedAt = Date.now()) {
    const encounterStart = /^(?:發現\s+.+\s+Lv\.\d+|.+\s+Lv\.\d+\s+主動朝你衝過來)/;
    const encounterEnd = /^成功擊敗\s+/;
    const interrupted = /^(?:正在搜尋附近的怪物|已搜尋\s+\d+\s*秒仍找不到怪物|引怪中|略過\s+.+繼續尋找目標|瞬間移動|返回存檔點|前往|抵達|移動到|掛機開始|掛機停止)|已經死亡|戰鬥不能/;
    let active = null, lastId = -1, elapsed = 0, hits = 0;
    function interrupt(at) {
      active = null;
      startedAt = at;
    }
    return {
      record(body, event, dealtDamage) {
        if (!Number.isSafeInteger(event?.id) || event.id <= lastId ||
            !Number.isFinite(event.wall) || event.wall < startedAt) return;
        if (encounterStart.test(body)) {
          if (!active || body.startsWith('發現')) active = { at: event.wall, hits: 0 };
        } else if (interrupted.test(body)) {
          active = null;
        } else if (active && encounterEnd.test(body)) {
          const duration = event.wall - active.at;
          if (active.hits > 0 && duration > 0) {
            elapsed += duration;
            hits += active.hits;
          }
          active = null;
        } else if (active && dealtDamage && event.wall >= active.at) {
          active.hits++;
        } else return;
        lastId = event.id;
      },
      interrupt,
      reset(at = Date.now()) {
        interrupt(at);
        lastId = -1;
        elapsed = hits = 0;
      },
      get rate() { return elapsed ? hits * 1000 / elapsed : null; }
    };
  }
  const combatHitMeter = createCombatHitMeter();

  const mvpBattleHistory = new Map();
  const mvpHistoryLimit = 150;

  function classifyMvpLog(text, isKnownBoss) {
    const body = logBody(text);
    let match;
    if ((match = body.match(/^★\s*MVP!打倒了\s+(.+?):\s*MVP 經驗/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: body.includes('MVP 獎勵') };
    }
    if ((match = body.match(/^★?\s*(?:【MVP】|\[MVP\])你的隊伍在 .+? 搶到了 (.+?)!/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: /[,，]\s*獲得 /.test(body) };
    }
    if ((match = body.match(/^(?:【MVP】|\[MVP\]).+? 的 (.+?) 被別的隊伍搶走了/))) {
      return { boss: clean(match[1]), kind: 'battle', hasLoot: /[,，]\s*獲得 /.test(body) };
    }
    match = body.match(/^成功擊敗 (.+?)!$/);
    if (match && isKnownBoss(clean(match[1]))) return { boss: clean(match[1]), kind: 'battle', hasLoot: false };
    match = body.match(/^(?:\[隊伍分配\]\s*(?:.+? 擊敗的 )?)?(.+?) 掉落了(?:卡片[:：]|\s)/)
      || body.match(/^(?:◆◆ 撿到卡片:|◆ 稀有掉落!撿到).+?\(([^()]+)\)(?:\(必撿.*?\))?[。.!]*$/);
    if (match && isKnownBoss(clean(match[1]))) return { boss: clean(match[1]), kind: 'loot', hasLoot: true };
    return null;
  }

  function recordMvpLog(text, characterId, eventId) {
    if (!Number.isSafeInteger(characterId) || characterId <= 0) return;
    const known = name => mvpRadar?.isKnownBoss(name) ?? false;
    const body = logBody(text);
    const entry = classifyMvpLog(text, known);
    const hit = entry ? null : readOutgoingDamage(body);
    const taken = entry || hit ? null : body.match(/^(.+?)(?: 使用[^,，]+[,，])?\s*對你造成\s*([\d,]+)\s*點傷害/);
    const boss = entry?.boss ?? hit?.target ?? taken?.[1];
    if (!boss || boss.length > 80 || (!entry && !known(boss))) return;
    let history = mvpBattleHistory.get(characterId);
    if (!history) {
      if (mvpBattleHistory.size >= 12) mvpBattleHistory.delete(mvpBattleHistory.keys().next().value);
      history = { entries: [], seen: new Set(), combat: new Map(), rev: 0 };
      mvpBattleHistory.set(characterId, history);
    }
    if (eventId && history.seen.has(eventId)) return;
    if (eventId) {
      history.seen.add(eventId);
      if (history.seen.size > 600) history.seen.delete(history.seen.values().next().value);
    }
    if (entry) {
      history.entries.unshift({ ...entry, text: text.slice(0, 600) });
      if (history.entries.length > mvpHistoryLimit) history.entries.pop();
    } else {
      const summary = history.combat.get(boss) ?? { damage: 0, hits: 0, taken: 0 };
      if (hit) {
        summary.damage += hit.damage;
        summary.hits++;
      } else {
        summary.taken += logNumber(taken[2]);
      }
      history.combat.set(boss, summary);
    }
    history.rev++;
  }
  const rxExpLog = /獲得\s*Base EXP\s*([\d,]+)(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*\/\s*Job EXP\s*([\d,]+)/;
  const rxLootLog = /撿取物品\s*[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/;
  function parseLog(t, historical = false, combatEvent = null) {
    if (state.paused) return;
    if (!historical) {
      const body = logBody(t);
      const damage = readOutgoingDamage(body)?.damage ?? 0;
      combatHitMeter.record(body, combatEvent, damage > 0);
      if (damage) {
        state.dmgSum += damage;
        state.hits++;
        state.maxDmg = Math.max(state.maxDmg, damage);
      }
      state.damageTaken += logNumber(body.match(rxTakenLog)?.[1]);
    }
    if (t.includes('成功擊敗')) state.kills++;
    const em = t.match(rxExpLog);
    if (em) { state.bexp += parseInt(em[1].replace(/,/g, ''), 10) || 0; state.jexp += parseInt(em[2].replace(/,/g, ''), 10) || 0; }
    const lm = t.match(rxLootLog);
    if (lm) {
      const name = lm[1].trim(), q = parseInt(lm[2], 10) || 1;
      state.pickupQty += q;
      state.loot[name] = (state.loot[name] || 0) + q;
      state.lootRev++;
    }
    if (t.includes('沒有撿起的物品消失了')) state.missed++;
  }

  let whSaleApproval = null;

  const priceOptionKey = 'warehouse-auto-protect-v1';
  const savedPriceOptions = readValidatedSetting(priceOptionKey, validatePriceOptions, {});
  const validThreshold = (n) => Number.isSafeInteger(n) && n > 0 && n <= 1e12;
  let priceOptions = { enabled: savedPriceOptions?.enabled !== false,
    threshold: validThreshold(savedPriceOptions?.threshold) ? savedPriceOptions.threshold : 100000 };
  const priceEvidence = new Map();
  let evidenceExpires = Infinity;
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  const protectionSpec = (i) =>
    JSON.stringify(
      stable(
        Object.fromEntries(
          Object.entries(i).filter(([k]) => !['itemId', 'name', 'price', 'qty', 'cartUid'].includes(k)),
        ),
      ),
    );

  function rebuildPriceEvidence() {
    priceEvidence.clear();
    evidenceExpires = Infinity;
    const rows = new Map(mktListings.map((r) => [r.key, r]));
    for (const [key, row] of mktCrossMap) {
      if (!rows.has(key) || rows.get(key).seen < row.seen) rows.set(key, row);
    }
    const now = Date.now();
    for (const r of rows.values()) {
      if (r.seen + 90000 <= now || !r.protectionSpec || r.vendorId == null || !Number.isSafeInteger(r.price) || r.price <= 0) continue;
      evidenceExpires = Math.min(evidenceExpires, r.seen + 90000);
      const id = String(r.id);
      if (!priceEvidence.has(id)) priceEvidence.set(id, { minimum: Infinity, groups: new Map(), sellers: 0 });
      const stats = priceEvidence.get(id);
      stats.minimum = Math.min(stats.minimum, r.price);
      if (!stats.groups.has(r.protectionSpec)) stats.groups.set(r.protectionSpec, new Set());
      const sellers = stats.groups.get(r.protectionSpec);
      sellers.add(String(r.vendorId));
      stats.sellers = Math.max(stats.sellers, sellers.size);
    }
  }
  // 只合併本次變更的欄位（enabled 或 threshold），不以本頁舊值覆寫其他分頁剛改的另一欄。
  // 原 Tampermonkey 選單的兩個指令已由儀表盤「設定」分頁的同一組控制項取代（同鍵、同驗證、即時生效）。
  function savePriceOptions(patch) {
    priceOptions = updateStoredValue(priceOptionKey, validatePriceOptions, priceOptions, (latest) => ({ ...latest, ...patch }));
    refreshWarehouse();
    syncHudSettings();
  }
  const instanceLockReasons = new Set(['自動保護：精煉裝備', '自動保護：有洞裝備', '自動保護：特殊/插卡']);
  const isStarProtected = (id) => Boolean(state.whProtectPins && Object.hasOwn(state.whPins, id));
  function getLockReason(id, name, text) {
    if (state.whMarks[id] === 'lock') return '手動上鎖';
    // ★ 優先於手動解除（neutral）：開啟「清倉排除自選」時，有 ★ 一律保護。
    if (isStarProtected(id)) return '自選保護（★）';
    if (state.whMarks[id] === 'neutral') return '';
    if (state.whAutoLocks[id] && !instanceLockReasons.has(state.whAutoLocks[id])) return state.whAutoLocks[id];
    if (state.whAutoEquipCard) {
      if (/卡片$/.test(name)) return '自動保護：卡片';
      if (Number(name.match(/^\+\s*(\d+)/)?.[1]) > 0) return '自動保護：精煉裝備';
      if (/\[[1-9]\d*\]/.test(name)) return '自動保護：有洞裝備';
      if (/(?:已插卡|鍛造|寵物蛋|神秘紫箱|老舊收集冊)/.test(text)) return '自動保護：特殊/插卡';
    }
    const kw = state.customProtectWords.find((w) => w && name.includes(w));
    if (kw) return `自訂貴重詞：「${kw}」`;
    if (!priceOptions.enabled) return '';
    if (Date.now() >= evidenceExpires) rebuildPriceEvidence();
    const stats = priceEvidence.get(String(id));
    return stats?.sellers >= 3 && stats.minimum >= priceOptions.threshold
      ? `已載入攤位普通同規格掛牌：${stats.sellers} 位賣家，最低 ${stats.minimum.toLocaleString('zh-TW')} Zeny；不代表成交價` : '';
  }

  let whSaveTimer = null;
  let whRetryUsed = false;
  const warehouseFields = { marks: 'whMarks', autoLocks: 'whAutoLocks', pins: 'whPins' };
  const pendingWhChanges = Object.fromEntries(Object.keys(warehouseFields).map(key => [key, new Map()]));

  function setWarehouseEntry(field, id, value) {
    const entries = state[warehouseFields[field]];
    if (value === null ? !Object.hasOwn(entries, id) : entries[id] === value) return;
    if (value === null) delete entries[id];
    else entries[id] = value;
    // 遠端刷新衍生的 autoLocks 只影響這次畫面。儲存時只合併本地差異。
    if (!applyingRemote) {
      whRetryUsed = false;
      pendingWhChanges[field].set(id, value);
      saveWarehouseSoon();
    }
  }

  function mergeWarehouseChanges(data) {
    for (const [field, changes] of Object.entries(pendingWhChanges)) {
      const entries = data[field] ??= {};
      for (const [id, value] of changes) {
        if (value === null) delete entries[id];
        else entries[id] = value;
      }
    }
    return data;
  }

  function applyWarehouseData(data) {
    for (const [field, key] of Object.entries(warehouseFields)) state[key] = data[field] || {};
  }

  function flushWarehouseSave({ sync = false } = {}) {
    if (whSaveTimer) { clearTimeout(whSaveTimer); whSaveTimer = null; }
    if (!Object.values(pendingWhChanges).some(changes => changes.size)) return;
    function persist() {
      // 等候鎖期間，卸載事件可能已經同步寫入。
      if (!Object.values(pendingWhChanges).some(changes => changes.size)) return;
      const raw = GM_getValue('warehouse-helper-v1', { marks: {}, autoLocks: {} });
      let latest;
      try { latest = validateWarehouse(typeof raw === 'string' ? JSON.parse(raw) : raw); }
      catch (error) {
        // 已存資料損毀時改以本頁已驗證的狀態為基底，避免待寫差異永遠無法落盤。
        console.warn('便利助手倉庫已存資料無效，改以本頁狀態覆寫', error);
        latest = { marks: { ...state.whMarks }, autoLocks: { ...state.whAutoLocks }, pins: { ...state.whPins } };
      }
      const merged = validateWarehouse(mergeWarehouseChanges(latest));
      GM_setValue('warehouse-helper-v1', JSON.stringify(merged));
      for (const changes of Object.values(pendingWhChanges)) changes.clear();
      applyWarehouseData(merged);
    }
    function failed(error) {
      console.warn('便利助手倉庫設定儲存失敗', error);
      if (whRetryUsed || whSaveTimer || !Object.values(pendingWhChanges).some(changes => changes.size)) return;
      whRetryUsed = true;
      whSaveTimer = setTimeout(flushWarehouseSave, 2000);
    }
    try {
      if (!sync && typeof navigator.locks?.request === 'function') {
        return navigator.locks.request('roi-wh-save-lock', persist).catch(failed);
      }
      persist();
    } catch (error) {
      failed(error);
    }
  }
  function saveWarehouseSoon() {
    if (!applyingRemote && !whSaveTimer) whSaveTimer = setTimeout(flushWarehouseSave, 400);
  }
  window.addEventListener('pagehide', () => flushWarehouseSave({ sync: true }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushWarehouseSave({ sync: true }); });

  function warehouseItemId(li) {
    const iconId = li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/client\/item\/(\d+)\.png(?:[?#]|$)/)?.[1];
    if (iconId || !li) return iconId;

    // 舊版介面不渲染物品圖示。從已提交的倉庫列取得道具 ID。
    let row = getReactFiber(li);
    if (!row) return undefined;
    let root = row;
    while (root.return) root = root.return;
    if (!root.stateNode?.current) return undefined;
    if (root.stateNode.current !== root) row = row.alternate;
    const item = row?.child?.memoizedProps?.it;
    if (row?.stateNode !== li || row.key == null || item?.sid == null ||
        String(item.sid) !== row.key || !Number.isSafeInteger(item.itemId) || item.itemId < 1) return undefined;
    return String(item.itemId);
  }

  const warehouseCustomViews = new WeakMap();
  const warehouseBulkLabel = /^(?:全選(?:目前顯示的)?|勾選這頁可以賣的\s*\(整疊\))$/;
  let refineWarehouseSubmitButton = null;

  function setWarehouseQuery(input, value) {
    if (!input?.isConnected || input.value === value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function syncWarehouseCustomView(field, list) {
    // The category bar and the two inventory columns share the same native panel.
    const tabs = field.parentElement?.parentElement?.querySelector(':scope > [role="tablist"][aria-label="物品分類"]');
    if (!tabs || !list) return;
    let view = warehouseCustomViews.get(tabs);
    if (!view) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'xp-btn small';
      tab.dataset.roiWhCustomTab = '';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.textContent = '★ 自選';
      view = { tab, active: false, selectingAll: false, query: '' };
      warehouseCustomViews.set(tabs, view);
      tabs.append(tab);

      const search = () => tabs.querySelector('input[aria-label="搜尋背包與倉庫的物品"]');
      tab.onclick = () => {
        if (view.active) return;
        const all = [...tabs.querySelectorAll('button[role="tab"]')].find((button) => clean(button.textContent) === '全部');
        const input = search();
        if (!all || all.disabled || !input) return;
        view.query = input.value;
        view.active = true;
        view.selectingAll = true;
        try { if (all.getAttribute('aria-selected') !== 'true') all.click(); }
        finally { view.selectingAll = false; }
        setWarehouseQuery(search(), '');
        refreshWarehouse();
      };
      tabs.addEventListener('click', (event) => {
        const target = event.target.closest('button[role="tab"]');
        if (!target || target === tab || !view.active || view.selectingAll) return;
        view.active = false;
        setWarehouseQuery(search(), view.query);
        refreshWarehouse();
      });
    }

    tabs.toggleAttribute('data-roi-wh-custom-tabs', view.active);
    if (field.hasAttribute('data-roi-wh-custom-view') !== view.active) {
      field.toggleAttribute('data-roi-wh-custom-view', view.active);
      list.scrollTop = 0;
    }
    view.tab.setAttribute('aria-selected', String(view.active));
    for (const button of field.querySelectorAll('button')) {
      if (warehouseBulkLabel.test(clean(button.textContent))) button.toggleAttribute('data-roi-wh-native-bulk', view.active);
    }
    let empty = field.querySelector('[data-roi-wh-custom-empty]');
    if (view.active && !empty) {
      empty = element('p', '目前沒有自選物品。可回到其他分類，點物品旁的 ☆ 加入。');
      empty.dataset.roiWhCustomEmpty = '';
      list.after(empty);
    }
    if (empty) empty.hidden = !view.active || Boolean(list.querySelector(':scope > [data-roi-wh-pinned]'));
  }

  function warehouseTotal(field, action) {
    const buttons = [...field.querySelectorAll('button')].filter(b => b.closest('fieldset') === field);
    const counts = buttons.map(b => clean(b.textContent).match(/^(直接賣掉|取出|領出|存入)\s*(\d+)\s*項/))
      .filter(m => m && m[1] === action);
    return counts.length === 1 ? Number(counts[0][2]) : null;
  }

  function readSaleItems(field, btn) {
    const items = [];
    for (const cb of field.querySelectorAll('li input[type="checkbox"]:checked')) {
      const li = cb.closest('li'), id = warehouseItemId(li);
      const name = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
      const num = li.querySelector('input[type="number"]');
      const qty = num ? Number(num.value) : Number(clean(li.textContent).match(/×\s*([\d,]+)/)?.[1]?.replace(/,/g,''));
      if (!id || !name || !visible(li) || cb.disabled || !Number.isSafeInteger(qty) || qty < 1) throw Error('待售物品或數量無法核對。');
      if (getLockReason(id, name, clean(li.textContent))) throw Error(name + ' 已上鎖，請先取消勾選。');
      items.push({id, name, qty});
    }
    if (!items.length || items.length !== warehouseTotal(field, '直接賣掉')) throw Error('待售清單與遊戲總項數不同，請清除其他分類的勾選，再分批出售。');
    return {items, sig:JSON.stringify([clean(btn.textContent),items])};
  }

  function showWarehouseSaleReview(f, saleBtn, items, sig) {
    const dlg = document.createElement('dialog');
    dlg.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #f59e0b;border-radius:12px;box-shadow:0 16px 48px var(--roi-shadow);font-size:13px;backdrop-filter:blur(10px);';
    dlg.innerHTML = `
      <div style="font-weight:bold;font-size:15px;color:var(--roi-warning);border-bottom:1px solid var(--roi-edge);padding-bottom:8px;margin-bottom:8px;">🛡️ 倉庫待售清單核對（共 ${items.length} 項）</div>
      <div style="max-height:48vh;overflow:auto;margin-bottom:10px;border:1px solid var(--roi-edge);border-radius:6px;padding:6px 10px;background:var(--roi-inset);"></div>
      <div style="font-size:12px;color:var(--roi-text);margin-bottom:10px;"><span data-sale-caption></span>｜核對無誤後按「確認出售」，遊戲仍會顯示原生販售確認。</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="xp-btn small" id="wh-rev-cancel">取消</button>
        <button type="button" class="xp-btn small" id="wh-rev-ok" style="background:linear-gradient(135deg,#16763a,#136039);color:#fff;font-weight:bold;border:none;">確認出售</button>
      </div>
    `;
    const itemsBox = dlg.children[1];
    for (const item of items) {
      const row = element('div', null, 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--roi-edge)');
      row.append(element('span', item.name), element('b', '×' + item.qty.toLocaleString(), 'color:var(--roi-success)'));
      itemsBox.append(row);
    }
    dlg.querySelector('[data-sale-caption]').textContent = clean(saleBtn.textContent);
    document.body.appendChild(dlg);
    // Esc 關閉時也要移除對話框，避免殘留節點與重複 id。
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelector('#wh-rev-cancel').onclick = () => { whSaleApproval = null; dlg.close(); dlg.remove(); };
    dlg.querySelector('#wh-rev-ok').onclick = () => {
      whSaleApproval = { sig, field: f, saleBtn, until: Date.now() + 15000 };
      saleBtn.click();
      dlg.close(); dlg.remove();
      const st = f.querySelector('[data-ro-wh-status]');
      if (st) st.textContent = '已送出遊戲原生販售確認';
    };
    dlg.showModal();
  }

  let whSearchBusy = false;
  const warehouseRowSignatures = new WeakMap();
  function refreshWarehouse(rescanCustom = false) {
    if (!state.whProtect) return;
    const fields = [...document.querySelectorAll('fieldset')].filter((f) => {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      return leg && /^倉庫(?:\s*[（(]|$)/.test(clean(leg.textContent)) && visible(f);
    });
    for (const f of fields) {
      let bar = f.querySelector('[data-ro-wh-bar]');
      if (!bar) {
        bar = document.createElement('div');
        bar.dataset.roWhBar = '';
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 6px;padding:6px 10px;background:var(--roi-panel);border-left:3px solid #f59e0b;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const mkBtn = (txt, fn, bg = '') => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'xp-btn small'; b.textContent = txt;
          if (bg) b.style.cssText = `background:${bg};color:#fff;font-weight:bold;border:none;`;
          b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
          return b;
        };
        const stSpan = document.createElement('span');
        stSpan.dataset.roWhStatus = ''; stSpan.style.color = 'var(--roi-warning)';
        const review = document.createElement('input');
        review.type = 'checkbox';
        review.dataset.roiWhSaleReview = '';
        review.checked = state.whSaleReview;
        review.onchange = () => setWarehouseSaleReview(review.checked);
        const reviewLabel = document.createElement('label');
        reviewLabel.append(review, ' 出售前清單核對');
        const pinsLabel = document.createElement('label');
        const pinsSwitch = document.createElement('input');
        pinsSwitch.type = 'checkbox';
        pinsSwitch.dataset.roiProtectPins = '';
        pinsSwitch.onchange = () => {
          state.whProtectPins = pinsSwitch.checked;
          savePrefs();
          refreshWarehouse();
          syncHudSettings();
        };
        pinsLabel.append(pinsSwitch, ' 清倉排除自選（★）');
        bar.append(
          mkBtn('💰 勾選本頁未鎖定項目 (上限100)', async () => {
            const lis = [...f.querySelectorAll('li')].filter(visible);
            const verb = clean(lis[0]?.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).split(' ')[0];
            let cnt = warehouseTotal(f, verb === '賣掉' ? '直接賣掉' : verb);
            if (cnt == null) return;
            for (const li of lis) {
              const cb = li.querySelector('input[type="checkbox"]');
              if (!cb || cb.disabled) continue;
              if (li.dataset.roiWhLocked !== undefined) { if (cb.checked) { cb.click(); cnt--; } continue; }
              if (!cb.checked && cnt < 100) { cb.click(); if (++cnt % 15 === 0) await sleep(10); }
            }
          }, 'linear-gradient(135deg,#a34f05,#854009)'),
          mkBtn('🔒 本頁全鎖', () => bulkWhLock(f, true)),
          mkBtn('🔓 本頁全解', () => bulkWhLock(f, false)),
          pinsLabel, reviewLabel,
          stSpan
        );
        f.insertBefore(bar, [...f.children].find((c) => c.tagName === 'UL') || null);
      }

      bar.querySelector('[data-roi-protect-pins]').checked = state.whProtectPins;
      bar.querySelector('[data-roi-wh-sale-review]').checked = state.whSaleReview;
      const list = f.querySelector(':scope > ul');
      if (!list) continue;
      for (const li of list.children) {
        const cb = li.querySelector('input[type="checkbox"]'), nameBtn = li.querySelector('button[aria-label$="的物品資訊"]');
        if (!cb || !nameBtn) continue;
        const id = warehouseItemId(li);
        if (!id) continue;
        const name = clean(nameBtn.textContent), txt = clean(li.textContent);
        const pinned = Object.hasOwn(state.whPins, id);
        if (rescanCustom && !String(state.whAutoLocks[id] || '').startsWith('已載入攤位普通同規格掛牌') && state.whMarks[id] !== 'lock') setWarehouseEntry('autoLocks', id, null);
        if (instanceLockReasons.has(state.whAutoLocks[id])) { setWarehouseEntry('autoLocks', id, null); }
        const reason = getLockReason(id, name, txt);
        if (reason && reason !== '自選保護（★）' && !instanceLockReasons.has(reason) && !state.whMarks[id] && !state.whAutoLocks[id]) { setWarehouseEntry('autoLocks', id, reason); }
        const saleChecked = reason && cb.checked && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ');
        const signature = text => JSON.stringify([id, name, text, reason, pinned]);
        if (!saleChecked && warehouseRowSignatures.get(li) === signature(txt) &&
            li.hasAttribute('data-roi-wh-pinned') === pinned &&
            (li.dataset.roiWhLocked !== undefined) === Boolean(reason) &&
            li.querySelector('[data-roi-wh-pin]') && li.querySelector('[data-roi-wh-pin-search]') &&
            li.querySelector('[data-ro-lock]')) continue;
        li.toggleAttribute('data-roi-wh-pinned', pinned);
        let pin = li.querySelector('[data-roi-wh-pin]');
        if (!pin) {
          pin = document.createElement('button');
          pin.type = 'button';
          pin.dataset.roiWhPin = '';
          pin.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const itemId = warehouseItemId(li);
            if (!itemId) return;
            // 加入或移除 ★ 都清除該物品的 neutral：★ 與手動解除不並存；移除 ★ 後回到一般自動保護規則。
            if (state.whMarks[itemId] === 'neutral') setWarehouseEntry('marks', itemId, null);
            if (Object.hasOwn(state.whPins, itemId)) setWarehouseEntry('pins', itemId, null);
            else if (Object.keys(state.whPins).length < 5000) {
              const label = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent)
                .replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\].*$/, '').trim();
              if (!label || label.length > 160) return;
              setWarehouseEntry('pins', itemId, label);
            }
            refreshWarehouse();
          };
          li.insertBefore(pin, cb.nextSibling);
        }
        if (!li.querySelector('[data-roi-wh-pin-search]')) {
          const search = document.createElement('button');
          search.type = 'button';
          search.textContent = '🔍';
          search.title = '跨城查價';
          search.dataset.roiWhPinSearch = '';
          search.onclick = async event => {
            event.preventDefault();
            event.stopPropagation();
            if (whSearchBusy) return;
            whSearchBusy = true;
            try {
              const baseName = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
              if (!findTownSearchUI(true)) {
                const tab = [...document.querySelectorAll('nav[aria-label="主選單"] button')].find(b => clean(b.textContent) === '攤位');
                if (!tab) return;
                tab.click();
                for (let i = 0; i < 30 && !findTownSearchUI(true); i++) await sleep(50);
              }
              if (findTownSearchUI(true)) {
                syncMktMount();
                await triggerNativeTownSearch(baseName, true);
              }
            } finally { whSearchBusy = false; }
          };
          pin.after(search);
        }
        const icon = pinned ? '★' : '☆';
        if (pin.textContent !== icon) pin.textContent = icon;
        pin.title = pinned ? '移出自選' : '加入自選';
        pin.setAttribute('aria-label', pin.title + '：' + name);
        pin.setAttribute('aria-pressed', String(pinned));
        ITEM_NAME_CACHE.set(Number(id), name.replace(/^\+\d+\s*/, ''));
        const locked = Boolean(reason);
        if (saleChecked) cb.click();
        li.toggleAttribute('data-roi-wh-locked', locked);

        let lBtn = li.querySelector('[data-ro-lock]');
        if (!lBtn) {
          lBtn = document.createElement('button');
          lBtn.type = 'button'; lBtn.dataset.roLock = id;
          lBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const id = warehouseItemId(li);
            if (!id) return;
            const nowLocked = Boolean(getLockReason(id, clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent), clean(li.textContent)));
            if (nowLocked && state.whMarks[id] !== 'lock' && isStarProtected(id)) {
              const status = li.closest('fieldset')?.querySelector('[data-ro-wh-status]');
              if (status) status.textContent = '★ 自選物品一律保護，請先取消 ★ 再解鎖';
              return;
            }
            setWarehouseEntry('marks', id, nowLocked ? (isStarProtected(id) ? null : 'neutral') : 'lock');
            if (nowLocked) setWarehouseEntry('autoLocks', id, null);
            refreshWarehouse();
          };
          li.insertBefore(lBtn, cb.nextSibling);
        }
        lBtn.dataset.roLock = id;
        lBtn.dataset.roiWhBadge = locked ? 'lock' : 'unlock';
        const lbl = locked ? '🔒 已鎖' : '🔓';
        if (lBtn.textContent !== lbl) lBtn.textContent = lbl;
        lBtn.title = locked ? `${name} (#${id})｜${reason}\n${reason === '自選保護（★）' ? '請先取消 ★ 再解鎖' : '點擊解鎖'}` : `點擊鎖定 ${name}`;
        warehouseRowSignatures.set(li, signature(clean(li.textContent)));
      }
      syncWarehouseCustomView(f, list);
    }
  }

  function bulkWhLock(f, lock) {
    const visibleIds = [...new Set([...f.querySelectorAll('li')].filter(visible).map((li) => warehouseItemId(li)).filter(Boolean))];
    // 本頁全解略過 ★ 自選物品（★ 一律保護）；全鎖照常包含。
    const ids = lock ? visibleIds : visibleIds.filter((id) => !isStarProtected(id));
    const skippedStars = visibleIds.length - ids.length;
    const status = f.querySelector('[data-ro-wh-status]');
    if (!ids.length) { if (status && skippedStars) status.textContent = `本頁只有 ★ 自選物品，已略過 ${skippedStars} 種`; return; }
    if (!confirm(`確定將目前可見的 ${ids.length} 種物品全部${lock ? '上鎖' : '解鎖'}？${skippedStars ? `（略過 ${skippedStars} 種 ★ 自選物品）` : ''}`)) return;
    ids.forEach((id) => { setWarehouseEntry('marks', id, lock ? 'lock' : 'neutral'); if (!lock) setWarehouseEntry('autoLocks', id, null); });
    if (status && skippedStars) status.textContent = `已略過 ${skippedStars} 種 ★ 自選物品`;
    refreshWarehouse();
  }

  window.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const caption = clean(e.target.closest('button,a')?.textContent);
    if (/^(?:換角色|切換角色|登出|登入)$/.test(caption)) {
      refineIdentityEpoch++;
      pageNet.events.dispatchEvent(new Event('ui-abort'));
      refSelected.clear();
    }
    const f = e.target.closest('fieldset');
    if (!f) return;
    const btn = e.target.closest('button');
    if (btn) {
      const cap = clean(btn.textContent);
      if (f.hasAttribute('data-roi-wh-custom-view') && btn !== refineWarehouseSubmitButton) {
        const action = cap.match(/^(直接賣掉|取出|領出)\s*\d+\s*項/)?.[1];
        const selected = [...f.querySelectorAll(':scope > ul > li input[type="checkbox"]:checked')];
        const hiddenSelection = action && (selected.length !== warehouseTotal(f, action) ||
          selected.some((input) => !input.closest('li')?.hasAttribute('data-roi-wh-pinned')));
        if (warehouseBulkLabel.test(cap) || hiddenSelection) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const status = f.querySelector('[data-ro-wh-status]');
          if (status) status.textContent = hiddenSelection
            ? '還有自選以外的物品已勾選。請先全部取消，或切回原分類確認。'
            : '請用上方按鈕勾選自選分頁顯示的物品。';
          return;
        }
      }
      if (/^勾選這頁可以賣的/.test(cap)) {
        refreshWarehouse();
        requestAnimationFrame(() => requestAnimationFrame(() => refreshWarehouse()));
        return;
      }
      if (/^直接賣掉\s*\d+\s*項/.test(cap) && state.whProtect) {
        refreshWarehouse();
        let review;
        try { review = readSaleItems(f, btn); }
        catch (err) {
          e.preventDefault(); e.stopImmediatePropagation(); whSaleApproval = null;
          const status = f.querySelector('[data-ro-wh-status]');
          if (status) status.textContent = err.message;
          return;
        }
        const approval = whSaleApproval;
        whSaleApproval = null;
        if (approval?.field === f && approval.saleBtn === btn && Date.now() <= approval.until && approval.sig === review.sig) return;
        if (!state.whSaleReview) return;
        e.preventDefault(); e.stopImmediatePropagation();
        showWarehouseSaleReview(f, btn, review.items, review.sig);
        return;
      }
    }
    if (e.target instanceof HTMLInputElement && e.target.type === 'checkbox') {
      const li = e.target.closest('li');
      const itemId = warehouseItemId(li);
      const itemName = clean(li?.querySelector('button[aria-label$="的物品資訊"]')?.textContent);
      if (e.target.checked && itemId && state.whProtect && clean(e.target.getAttribute('aria-label')).startsWith('賣掉 ') &&
          getLockReason(itemId, itemName, clean(li.textContent))) {
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const verb = clean(e.target.getAttribute('aria-label')).match(/^(賣掉|存入|取出|領出)\s/)?.[1];
      if (!verb) return;
      const action = verb === '賣掉' ? '直接賣掉' : verb;
      const initialTotal = warehouseTotal(f, action);
      if (initialTotal == null) return;
      if (e.target.checked && initialTotal >= 100) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      const src = li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src');
      if (!src) return;
      const source = e.target;
      const next = source.checked;
      setTimeout(() => {
        if (e.defaultPrevented || !f.isConnected || !f.contains(source) || source.checked !== next) return;
        if (source.closest('li')?.querySelector('img[src*="/client/item/"]')?.getAttribute('src') !== src) return;
        const rows = [...f.querySelectorAll('li')];
        const total = warehouseTotal(f, action);
        if (total == null) return;
        let count = Math.max(total, initialTotal + (next ? 1 : -1));
        for (const row of rows) {
          if (next && count >= 100) break;
          const cb = row.querySelector('input[type="checkbox"]');
          if (!cb || !f.contains(cb) || cb === source || cb.disabled || cb.checked === next) continue;
          if (row.querySelector('img[src*="/client/item/"]')?.getAttribute('src') !== src) continue;
          if (next && row.dataset.roiWhLocked !== undefined && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ')) continue;
          cb.click();
          if (cb.checked === next) count += next ? 1 : -1;
        }
      }, 0);
    }
  }, true);

  // Match by inventory item ID so this works with classic icons hidden and unidentified items.
  document.addEventListener('click', (event) => {
    const source = event.target;
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.defaultPrevented
        || !(source instanceof HTMLInputElement) || source.disabled
        || !source.matches('input[type="checkbox"][aria-label^="放入 "]')) return;

    const field = source.closest('fieldset');
    const legend = clean(field?.querySelector(':scope > legend')?.textContent);
    if (!/^手推車(?:[ (]|$)/.test(legend)) return;
    const list = source.closest('ul');
    if (!list || !field.contains(list)) return;
    const selector = 'input[type="checkbox"][aria-label^="放入 "]';
    const snapshot = readFiberForUi(() => getCommittedProps(source, (props) => props.snap?.cart && Array.isArray(props.snap.inventory)))?.snap;
    if (!snapshot || snapshot.vend) return;

    const items = new Map(snapshot.inventory.map((item) => [String(item.uid), item.itemId]));
    const itemIdFor = (box) => items.get(getReactFiber(box.closest('li'))?.key);
    const itemId = itemIdFor(source);
    if (!itemId) return;
    const next = source.checked;
    const countSelected = () => list.querySelectorAll(selector + ':checked').length;
    if (next && countSelected() > 100) {
      event.preventDefault();
      return;
    }

    setTimeout(() => {
      if (event.defaultPrevented || !visible(list) || !list.contains(source) || source.disabled
          || source.checked !== next || itemIdFor(source) !== itemId) return;
      for (const box of list.querySelectorAll(selector)) {
        if (next && countSelected() >= 100) break;
        if (box === source || box.disabled || box.checked === next || !visible(box) || itemIdFor(box) !== itemId) continue;
        box.click();
      }
    }, 0);
  }, true);

  const rarePanels = new WeakMap(), rareKnownRoots = new Set(), rareLastMap = new WeakMap();
  // 同步造成的草稿淨變動：itemId → true（勾）／false（取消）。面板回到乾淨（套用鈕停用）或換角色時清空。
  const rareSyncDelta = { charId: null, lockMap: null, net: new Map(), tainted: false };
  function resetRareSyncDelta() { rareSyncDelta.charId = null; rareSyncDelta.lockMap = null; rareSyncDelta.net.clear(); rareSyncDelta.tainted = false; }
  function noteRareSync(lockMap, id, checked) {
    const charId = Number(state.activeCharId) || null;
    if (rareSyncDelta.charId !== charId) { resetRareSyncDelta(); rareSyncDelta.charId = charId; }
    rareSyncDelta.lockMap = typeof lockMap === 'string' ? lockMap : null;
    if (!Number.isSafeInteger(id)) { rareSyncDelta.tainted = true; return; }
    if (rareSyncDelta.net.has(id) && rareSyncDelta.net.get(id) !== checked) rareSyncDelta.net.delete(id);
    else rareSyncDelta.net.set(id, checked);
  }
  const settingsApplyDirty = () => [...document.querySelectorAll('button')].some((b) => !b.disabled && clean(b.textContent) === '套用設定' && visible(b));
  function validateRareAutoMap(value) {
    if (typeof value !== 'boolean') throw Error('稀有掉落開關格式不符');
    return value;
  }
  let rareAutoMap = readValidatedSetting('roi-rare-auto-map-v1', validateRareAutoMap, true);
  function setRareAutoMap(enabled) {
    try { GM_setValue('roi-rare-auto-map-v1', validateRareAutoMap(enabled)); } catch { log("rare", "無法保存或讀取稀有掉落設定"); }
    applyRareAutoMap(enabled);
  }
  function applyRareAutoMap(enabled) {
    rareAutoMap = enabled;
    for (const root of rareKnownRoots) {
      rareLastMap.delete(root);
      if (!enabled) {
        const status = rarePanels.get(root)?.querySelector('[data-ro-rare-status]');
        if (status) status.textContent = '稀有掉落自動同步已關閉';
      }
    }
    refreshRareHelper();
    syncHudSettings();
  }
  const isRareHeading = (s) => /^必撿稀有掉落\s*\(\s*\d+\s*項\s*\)$/.test(clean(s));
  const isRareBoundary = (s) => /^不在這張地圖(?:的)?\s*[:：]?$/.test(clean(s));

  function findRareBoundary(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; const matches = [];
    while ((n = walker.nextNode())) {
      if (isRareBoundary(n.textContent) && !n.parentElement?.closest('[data-ro-rare-helper]')) matches.push(n);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function findRareRoots() {
    const found = new Set();
    for (const h of document.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')) {
      if (h.childElementCount > 3 || !visible(h) || h.closest('[data-ro-rare-helper]') || !isRareHeading(h.textContent) || h.querySelector('input')) continue;
      const field = h.closest('fieldset');
      let matched = false, parent = h.parentElement;
      for (let i = 0; parent && parent !== document.body && i < 6; i++, parent = parent.parentElement) {
        if (parent.querySelector('input[type="checkbox"]') && (findRareBoundary(parent) || parent.querySelectorAll('input[type="checkbox"]').length >= 2)) {
          found.add(parent); matched = true; break;
        }
      }
      if (!matched && field && field.querySelector('input[type="checkbox"]')) found.add(field);
    }
    for (const r of rareKnownRoots) {
      if (!r.isConnected) { rareKnownRoots.delete(r); continue; }
      if (visible(r) && [...r.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].some((h) => h.childElementCount <= 3 && isRareHeading(h.textContent))) found.add(r);
    }
    const res = [...found].filter((r) => ![...found].some((o) => o !== r && r.contains(o)));
    res.forEach((r) => rareKnownRoots.add(r));
    return res;
  }

  function scanRareItems(root) {
    const marker = findRareBoundary(root), items = [];
    if (!marker && clean(root.textContent).includes('不在這張地圖')) return null;
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      if (box.closest('[data-ro-rare-helper]')) continue;
      const nativeLabel = box.closest('label') || [...(box.labels || [])][0];
      const name = clean(box.getAttribute('aria-label') || nativeLabel?.textContent || '');
      if (!name || name.length > 240 || /^(?:全選|全取消|必撿稀有掉落|自動撿取|優先撿取|沒有怪物攻擊)/.test(name)) continue;
      const pos = marker ? marker.compareDocumentPosition(box) : Node.DOCUMENT_POSITION_PRECEDING;
      const group = pos & Node.DOCUMENT_POSITION_FOLLOWING ? 'away' : pos & Node.DOCUMENT_POSITION_PRECEDING ? 'here' : null;
      if (!group) return null;
      items.push({ box, group });
    }
    return items;
  }

  function getRareContext(root) {
    const tree = currentFiberRoot(root);
    if (!tree) return null;
    const stack = [{ f: tree, p: null }];
    let guard = 0;
    while (stack.length && ++guard < 80000) {
      const { f: node, p } = stack.pop();
      if (!node) continue;
      const props = node.memoizedProps;
      const context = props?.draft && typeof props.update === 'function' && Array.isArray(props.monsterIds) ? props : p;
      if (node.stateNode === root) {
        if (!context) return null;
        const entries = [], todo = [{ f: node, id: null }];
        while (todo.length) {
          const x = todo.pop();
          const id = x.f.type === 'label' && /^\d+$/.test(x.f.key || '') ? Number(x.f.key) : x.id;
          if (x.f.stateNode?.matches?.('input[type="checkbox"]')) entries.push({ box: x.f.stateNode, id });
          for (let c = x.f.child; c; c = c.sibling) todo.push({ f: c, id });
        }
        return { p: context, entries };
      }
      if (node.sibling) stack.push({ f: node.sibling, p });
      if (node.child) stack.push({ f: node.child, p: context });
    }
    return null;
  }

  function fastSelectRare(root, group, next, sync = null) {
    const rs = scanRareItems(root);
    const statusSpan = rarePanels.get(root)?.querySelector('[data-ro-rare-status]');
    if (!rs) { if (statusSpan) statusSpan.textContent = '⚠️ 無法辨識本圖與其他地圖的掉落'; return false; }
    let changed = 0;
    let rows = rs;
    while (rows) {
      const current = group === 'sync'
        ? rows.find((r) => r.group !== 'here' && r.box.checked) ?? rows.find((r) => r.group === 'here' && !r.box.checked)
        : rows.find((r) => r.group === group && r.box.checked !== next);
      if (!current) break;
      const desired = group === 'sync' ? current.group === 'here' : next;
      if (changed >= rs.length + 5 || !current.box.isConnected) {
        if (statusSpan) statusSpan.textContent = '⚠️ 遊戲清單已變動，請重試';
        return false;
      }
      if (current.box.disabled) {
        if (statusSpan) statusSpan.textContent = '⚠️ 有無法勾選的道具，請檢查清單';
        return false;
      }
      let syncId = null;
      if (sync) {
        syncId = sync.ids.get(current.box);
        if (syncId == null) { for (const e of getRareContext(root)?.entries || []) sync.ids.set(e.box, e.id); syncId = sync.ids.get(current.box); }
      }
      current.box.click();
      if (sync) noteRareSync(sync.lockMap, syncId, desired);
      if (current.box.isConnected && current.box.checked !== desired) {
        if (statusSpan) statusSpan.textContent = '⚠️ 遊戲未接受勾選，請檢查清單';
        return false;
      }
      changed++;
      rows = scanRareItems(root);
    }
    if (!rows) {
      if (statusSpan) statusSpan.textContent = '⚠️ 無法辨識更新後的掉落清單';
      return false;
    }
    const selected = rows.filter((r) => r.box.checked).length;
    if (statusSpan) statusSpan.textContent = `✅ 已調整 ${changed} 項，目前勾選 ${selected} 項；請按「套用設定」`;
    return true;
  }

  const rareHeadingXPath = '//text()[starts-with(normalize-space(.), "必撿稀有掉落") and not(ancestor::*[@id="ro-helper-hud"])]';
  function refreshRareHelper() {
    // 頁面沒有「必撿稀有掉落」文字時，略過整頁 div/span 掃描（原生 XPath 單次比對）。
    try {
      if (![...document.body.children].some((c) => !c.matches('#ro-helper-hud,#roi-helper-mvp-panel,#roi-item-hover-tooltip,script,style') && c.textContent.includes('必撿稀有掉落'))) return;
    } catch { log("rare", "無法保存或讀取稀有掉落設定"); }
    for (const root of findRareRoots()) {
      let panel = rarePanels.get(root);
      if (!panel?.isConnected || !root.contains(panel)) {
        panel = document.createElement('div');
        panel.dataset.roRareHelper = '';
        panel.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0;padding:6px 10px;background:var(--roi-panel);border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const statusSpan = document.createElement('span');
        statusSpan.dataset.roRareStatus = ''; statusSpan.style.color = 'var(--roi-success)';
        statusSpan.textContent = rareAutoMap ? '稀有掉落自動同步已開啟' : '稀有掉落自動同步已關閉';
        panel.append(statusSpan);
        const h = [...root.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].find((e) => e.childElementCount <= 3 && isRareHeading(e.textContent));
        if (h?.parentElement === root) h.after(panel);
        else root.prepend(panel);
        rarePanels.set(root, panel);
      }
      if (rareSyncDelta.net.size && !settingsApplyDirty()) resetRareSyncDelta();
      if (rareAutoMap) {
        const context = getRareContext(root);
        if (context) {
          const mapSig = JSON.stringify([context.p.draft.lockMap, context.p.monsterIds]);
          if (rareLastMap.get(root) !== mapSig) {
            const sync = { lockMap: context.p.draft.lockMap, ids: new Map(context.entries.map((e) => [e.box, e.id])) };
            if (fastSelectRare(root, 'sync', true, sync)) rareLastMap.set(root, mapSig);
          }
        }
      }
    }
  }

  function readMonsterRules(draft) {
    const { monsterRules = [], targets, escape } = draft;
    const rules = monsterRules.map((rule) => ({ ...rule }));
    const ids = new Set(rules.map((rule) => rule.monsterId));
    for (const [list, action] of [[targets.blacklist, 'defend'], [escape.dangerMonsters, 'attack']]) {
      for (const monsterId of list) {
        if (ids.has(monsterId)) continue;
        ids.add(monsterId);
        rules.push(action === 'defend' ? { monsterId, action } : { monsterId, action, escape: 'sight' });
      }
    }
    return rules;
  }

  const itemIds = (list) => Array.isArray(list)
    ? [...new Set(list.map((item) => Number(item?.itemId ?? item?.id ?? item)).filter((id) => Number.isSafeInteger(id) && id > 0))]
    : [];
  const listItems = (rule) => itemIds(Array.isArray(rule) ? rule : rule?.items);
  const storageRule = (rule) => ({
    enabled: false, abovePercent: 70, ...(Array.isArray(rule) ? {} : rule), items: listItems(rule)
  });

  function lootSupplyIds(draft) {
    return new Set([
      ...itemIds(draft.restock), ...itemIds(draft.townBuy), ...itemIds(draft.cureItems),
      ...itemIds(draft.autoBuy?.potions), ...itemIds(draft.autoBuy?.gems), ...itemIds([draft.autoBuy?.arrows?.itemId]),
      ...[draft.hpPotion, draft.spPotion, draft.buffPotion].flatMap((rule) => [...listItems(rule), ...itemIds([rule?.itemId])])
    ]);
  }

  let lootPack;
  let PACK_ITEMS_MAP = null;
  function ensurePackItemsLoaded() {
    if (PACK_ITEMS_MAP) return;
    try { void loadLootPack().catch(() => log("loot", "無法預載掉落資料")); } catch { log("loot", "無法開始預載掉落資料"); }
  }
  function loadLootPack() {
    const link = document.querySelector('link[rel="modulepreload"][href^="/assets/pack-"]');
    if (!link) throw Error('找不到遊戲的地圖資料');
    lootPack ??= import(link.href).then((module) => {
      const pack = Object.values(module).find((value) => Array.isArray(value?.maps) && Array.isArray(value.monsters) && Array.isArray(value.items));
      if (!pack) throw Error('無法辨識遊戲的地圖資料');
      const itemsMap = new Map(pack.items.map((item) => [item.id, item]));
      PACK_ITEMS_MAP = itemsMap;
      for (const it of pack.items) {
        if (it?.id && it.name && !ITEM_NAME_CACHE.has(it.id)) ITEM_NAME_CACHE.set(it.id, clean(it.name));
      }
      return {
        maps: new Map(pack.maps.map((map) => [map.id, map])),
        monsters: new Map([...(pack.summons ?? []), ...pack.monsters].map((monster) => [monster.id, monster])),
        items: itemsMap,
        refine: pack.refine
      };
    }).catch((error) => { lootPack = null; throw error; });
    return lootPack;
  }

  function getMapLoot(pack, mapId) {
    const map = pack.maps.get(mapId);
    if (!map || !Array.isArray(map.spawns)) throw Error('找不到目前掛機地圖的掉落資料');
    const pending = [...map.spawns, ...(map.timed ?? [])].map((spawn) => spawn.monsterId);
    const seen = new Set(), loot = new Map();
    for (const id of pending) {
      if (seen.has(id)) continue;
      seen.add(id);
      const monster = pack.monsters.get(id);
      if (!monster) continue;
      for (const skill of monster.skills ?? []) {
        if (skill.skill === 'NPC_METAMORPHOSIS') pending.push(...(skill.vals ?? []));
      }
      // 道具設定的「本圖掉落」使用怪物的一般掉落清單。
      for (const drop of monster.drops ?? []) {
        const item = pack.items.get(drop?.itemId);
        if (item) loot.set(item.id, item.name);
      }
    }
    return loot;
  }

  const lootSyncPanels = new WeakMap();
  const lootItemGroupSelector = '[role="group"][aria-label="道具設定的複製與匯出匯入"]';
  const lootOpenKoreSelector = '[role="tablist"][aria-label="OpenKore 設定檔"]';
  const monsterSyncPanels = new WeakMap();
  const monsterSelectSelector = 'select[aria-label="怪物控制：加入怪物"]';
  const monsterSyncModes = {
    off: '關閉自動同步',
    add: '自動新增本地圖怪物',
    replace: '自動換成只有本地圖怪物'
  };
  const lootModes = ['off', 'store', 'valuable'];
  const lootOres = new Set([984, 985, 756, 757, 1010, 1011]);
  const isValuableLoot = (id, name = '') => classifyItem(id, name).cat === 'card' || lootOres.has(id)
    || state.whMarks[id] === 'lock' || state.customProtectWords.some((word) => word && name.includes(word));

  const lootCategoryLabels = { consumable: '消耗品', equipment: '裝備', card: '卡片', other: '其他' };
  const lootCategoryModes = {
    off: '保留原設定', store: '全部存倉', priority: '優先撿取＋存倉', valuable: '僅貴重物優先撿取＋存倉'
  };

  function lootCategory(id, name, pack) {
    const item = pack.items.get(id);
    if (item?.category === 'card') return 'card';
    if (item?.category === 'equipment') return 'equipment';
    if (item?.category === 'consumable') return 'consumable';
    const cat = classifyItem(id, name).cat;
    return cat === 'weapon' || cat === 'armor' ? 'equipment'
      : cat === 'card' || cat === 'consumable' ? cat : 'other';
  }

  function buildCategoryLootPatch(draft, loot, pack, modes) {
    const storage = storageRule(draft.autoStorage);
    const priority = listItems(draft.lootPriority);
    const configured = new Set([
      ...storage.items, ...priority, ...listItems(draft.autoSell), ...listItems(draft.lootFilter),
      ...lootSupplyIds(draft)
    ]);
    const stored = [], prioritized = [];
    const counts = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [cat, 0]));
    let preserved = 0;
    for (const [id, name] of loot) {
      const category = lootCategory(id, name, pack);
      const mode = modes[category];
      if (mode === 'off' || !Object.hasOwn(lootCategoryModes, mode)) continue;
      if (mode === 'valuable' && !isValuableLoot(id, name)) continue;
      if (configured.has(id)) {
        preserved++;
        continue;
      }
      counts[category]++;
      stored.push(id);
      if (mode === 'priority' || mode === 'valuable') prioritized.push(id);
    }
    if ((stored.length && storage.items.length + stored.length > 2000)
      || (prioritized.length && priority.length + prioritized.length > 500)) {
      throw Error('分類設定會超過存倉或優先撿取上限，請縮小範圍');
    }
    const patch = {};
    if (stored.length) {
      patch.autoStorage = { ...storage, items: [...storage.items, ...stored] };
    }
    if (prioritized.length) {
      const rule = draft.lootPriority;
      patch.lootPriority = { ...(Array.isArray(rule) ? {} : rule), items: [...priority, ...prioritized] };
    }
    return { patch, counts, added: stored.length, preserved };
  }

  function readOpenKoreSection(anchor, title, match) {
    if (!anchor) return null;
    const section = (props) => Array.isArray(props?.children) && props.children
      .find((child) => child?.props?.title === title)?.props.children?.props;
    return section(getCommittedProps(anchor, (props) => match(section(props))));
  }

  const isMonsterDraft = (props) => typeof props?.update === 'function' && props.draft?.targets && props.draft?.escape;

  function buildMonsterSyncPatch(draft, ids, mode) {
    if (!ids.length) return { message: '目前地圖沒有可同步的怪物，草稿未變更' };
    const rules = readMonsterRules(draft);
    const mapIds = new Set(ids);
    const retained = mode === 'replace' ? rules.filter((rule) => mapIds.has(Number(rule.monsterId))) : rules;
    const existing = new Set(retained.map((rule) => Number(rule.monsterId)));
    const missing = ids.filter((id) => !existing.has(id));
    const removed = rules.length - retained.length;
    if (!missing.length && !removed) return { message: '本圖怪物都已設定，草稿未變更' };
    if (retained.length + missing.length > 200) {
      return { message: '同步會超過 200 隻上限，草稿未變更' };
    }
    return {
      patch: {
        monsterRules: [...retained, ...missing.map((monsterId) => ({ monsterId, action: 'attack' }))],
        targets: { ...draft.targets, blacklist: [] },
        escape: { ...draft.escape, dangerMonsters: [] }
      },
      message: `新增 ${missing.length} 隻，保留 ${retained.length} 隻${removed ? `，移除 ${removed} 隻非本圖怪物` : ''}，請按「套用設定」`
    };
  }

  function createMonsterSyncPanel(anchor, openKore) {
    const select = element('select');
    select.className = 'xp-input';
    select.dataset.roiMonMode = '';
    select.disabled = true;
    for (const [value, text] of Object.entries(monsterSyncModes)) {
      const option = element('option', text);
      option.value = value;
      select.append(option);
    }
    const label = element('label', '同步本圖怪物 ');
    label.append(select);
    const status = element('span');
    status.dataset.roiMonStatus = '';
    status.setAttribute('role', 'status');
    const validateMode = (value) => {
      if (typeof value === 'boolean') return value ? 'add' : 'off';
      if (typeof value !== 'string' || !Object.hasOwn(monsterSyncModes, value)) throw Error('怪物同步模式格式不符');
      return value;
    };
    const settingKey = (id) => 'roi-monster-auto-map-v1:' + id;
    const target = () => openKore ?? anchor.querySelector(monsterSelectSelector);
    const readActor = (node) => {
      const context = node && getCommittedProps(node, (props) => props.snap?.character &&
        (positiveId(props.characterId) || snapshotCharacterId(props.snap)));
      return positiveId(context?.characterId) || snapshotCharacterId(context?.snap);
    };
    let boundId = null, mode = 'off', lastMap = null;
    const sync = (node) => {
      if (!node || mode === 'off' || document.hidden) return;
      const props = readOpenKoreSection(openKore, '怪物控制', isMonsterDraft) ||
        getCommittedProps(node, isMonsterDraft);
      const map = props?.draft.lockMap;
      if (!map || map === lastMap) return;
      const raw = props.mapMonsters;
      const ids = Array.isArray(raw) && raw.map((entry) => positiveId(entry?.id ?? entry?.monsterId ?? entry));
      if (!ids || ids.includes(null)) {
        if (status.textContent !== '無法確認本圖怪物清單，草稿未變更') status.textContent = '無法確認本圖怪物清單，草稿未變更';
        return;
      }
      const { message, patch } = buildMonsterSyncPatch(props.draft, [...new Set(ids)], mode);
      if (patch) props.update(patch);
      lastMap = map;
      status.textContent = message;
      return patch ? 'updated' : undefined;
    };
    const tick = (host) => {
      if (host && label.parentElement !== host) host.prepend(label, status);
      try {
        const node = target();
        const id = readActor(node);
        select.disabled = id === null;
        if (id !== boundId) {
          boundId = id;
          mode = id === null ? 'off' : readValidatedSetting(settingKey(id), validateMode, 'off');
          select.value = mode;
          lastMap = null;
          status.textContent = '';
        }
        if (id === null && host && !status.textContent) status.textContent = '尚未讀到正在編輯的角色';
        return sync(node);
      } catch (error) {
        if (!(error instanceof FiberTraversalTimeout)) log('monster', error);
      }
    };
    select.onchange = () => {
      try {
        const node = target();
        const id = readActor(node);
        if (id === null || id !== boundId) { tick(); return; }
        const next = validateMode(select.value);
        GM_setValue(settingKey(id), next);
        mode = next;
        lastMap = null;
        if (mode === 'off') status.textContent = '已關閉怪物自動同步';
        else sync(node);
      } catch (error) {
        select.value = mode;
        status.textContent = error.message;
      }
    };
    return tick;
  }

  function mountSettingsTools() {
    const itemGroup = document.querySelector(lootItemGroupSelector);
    const openKore = document.querySelector(lootOpenKoreSelector);
    const lootAnchor = openKore ?? itemGroup;
    if (lootAnchor && !lootSyncPanels.has(lootAnchor)) {
      const box = document.createElement('div');
      box.dataset.roiSettingsTools = '';
      box.style.cssText = 'flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 10px;background:var(--roi-panel);border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      const status = document.createElement('span'); status.style.color = 'var(--roi-success)';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'minmax(56px,auto) minmax(0,1fr) auto';
      box.style.width = '100%';
      box.style.boxSizing = 'border-box';
      const isDraft = (x) => typeof x?.update === 'function' && x.draft && x.snap?.character;
      const getProps = () => {
        // OpenKore 切離道具頁時會卸載面板，設定容器仍持有這一版草稿的道具區 props。
        const section = readOpenKoreSection(openKore, '道具設定', isDraft);
        const group = openKore ? document.querySelector(lootItemGroupSelector) : lootAnchor;
        const p = section || (group && getCommittedProps(group, isDraft));
        if (!p) throw Error('無法讀取設定草稿');
        return p;
      };
      const settingsKey = 'roi-loot-category-map-v1';
      const selects = new Map(), counters = new Map();
      const auto = element('input');
      auto.type = 'checkbox';
      auto.dataset.roiLootAuto = '';
      auto.disabled = true;
      const autoLabel = element('label', '隨地圖自動設定 ');
      autoLabel.style.gridColumn = '1 / -1';
      autoLabel.prepend(auto);
      box.append(autoLabel);
      let boundCharacter = null, preferences = null, lastAutoKey = null, request = 0;
      const characterKey = (p) => String(p.snap.character.id ?? p.snap.character.name);
      const getPreferences = (key) => {
        const all = readValidatedSetting(settingsKey, validateCategoryProfiles, {});
        const saved = plainObject(all) && plainObject(all[key]) ? all[key] : null;
        const legacy = GM_getValue('roi-loot-auto-map', 'off');
        const legacyMode = lootModes.includes(legacy) ? legacy : 'off';
        const modes = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [
          cat, saved && Object.hasOwn(lootCategoryModes, saved.modes?.[cat]) ? saved.modes[cat] : legacyMode
        ]));
        return { enabled: saved ? saved.enabled === true : legacyMode !== 'off', modes };
      };
      const bindCharacter = (p) => {
        const key = characterKey(p);
        auto.disabled = false;
        if (boundCharacter === key) return;
        boundCharacter = key;
        preferences = getPreferences(key);
        auto.checked = preferences.enabled;
        for (const [cat, select] of selects) select.value = preferences.modes[cat];
        for (const counter of counters.values()) counter.textContent = '—';
        lastAutoKey = null;
        request++;
      };
      const saveSettings = (prefs) => {
        const all = readValidatedSetting(settingsKey, salvageCategoryProfiles, {});
        const next = plainObject(all) ? { ...all } : {};
        next[boundCharacter] = prefs;
        GM_setValue(settingsKey, validateCategoryProfiles(next));
        preferences = prefs;
        lastAutoKey = null;
        request++;
      };
      const sync = async (before) => {
        let pendingKey = null, token = null;
        try {
          const id = boundCharacter, mapId = before.draft.lockMap;
          const modes = { ...preferences.modes };
          pendingKey = JSON.stringify([id, mapId, modes]);
          if (!preferences.enabled || !mapId || pendingKey === lastAutoKey) return;
          token = ++request;
          lastAutoKey = pendingKey;
          status.textContent = '讀取本圖掉落…';
          const pack = await loadLootPack();
          if (token !== request || !lootAnchor.isConnected) return;
          const current = getProps();
          if (characterKey(current) !== id || current.draft.lockMap !== mapId) {
            lastAutoKey = null;
            return;
          }
          const loot = getMapLoot(pack, mapId);
          const result = buildCategoryLootPatch(current.draft, loot, pack, modes);
          if (result.added) current.update(result.patch);
          for (const [cat, count] of Object.entries(result.counts)) counters.get(cat).textContent = count + ' 種';
          const summary = `新增 ${result.added} 種，保留既有設定 ${result.preserved} 種`;
          const storageNote = result.patch.autoStorage?.enabled === false ? '（回城存倉目前關閉）' : '';
          status.textContent = result.added ? summary + '，請按「套用設定」' + storageNote : summary;
        } catch (error) {
          if (token !== null && (token !== request || !lootAnchor.isConnected)) return;
          if (error instanceof FiberTraversalTimeout && pendingKey === lastAutoKey) lastAutoKey = null;
          status.textContent = '⚠️ ' + error.message;
        }
      };
      for (const [cat, label] of Object.entries(lootCategoryLabels)) {
        const select = element('select');
        select.className = 'xp-input';
        select.style.cssText = 'width:100%;min-width:0;max-width:100%';
        select.setAttribute('aria-label', label + '自動設定');
        for (const [value, text] of Object.entries(lootCategoryModes)) {
          const option = element('option', text); option.value = value; select.append(option);
        }
        const counter = element('span', '—', 'white-space:nowrap;color:var(--text-dim)');
        counters.set(cat, counter); selects.set(cat, select);
        const categoryLabel = element('label', label);
        select.id = 'roi-loot-category-' + cat;
        categoryLabel.htmlFor = select.id;
        box.append(categoryLabel, select, counter);
        select.onchange = () => {
          try {
            const p = getProps();
            if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
            saveSettings({ ...preferences, modes: { ...preferences.modes, [cat]: select.value } });
            if (preferences.enabled) void sync(p);
          } catch (error) {
            select.value = preferences.modes[cat];
            status.textContent = '⚠️ ' + error.message;
          }
        };
      }
      auto.onchange = () => {
        try {
          const p = getProps();
          if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
          saveSettings({ ...preferences, enabled: auto.checked });
          if (preferences.enabled) void sync(p);
          else status.textContent = '已關閉自動設定';
        } catch (error) {
          auto.checked = preferences?.enabled === true;
          status.textContent = '⚠️ ' + error.message;
        }
      };
      const note = element('span', '只設定本圖掉落中尚未設定的道具。', 'grid-column:1 / -1;color:var(--text-dim)');
      status.style.gridColumn = '1 / -1';
      box.append(note, status);
      const tick = (group) => {
        if (group && box.parentElement !== group) group.append(box);
        try {
          const p = getProps();
          bindCharacter(p);
          if (preferences.enabled) void sync(p);
        } catch (error) {
          if (!(error instanceof FiberTraversalTimeout)) auto.disabled = true;
        }
      };
      lootSyncPanels.set(lootAnchor, tick);
    }

    const monSel = document.querySelector(monsterSelectSelector);
    const monHost = monSel?.parentElement;
    const monAnchor = openKore ?? monHost;
    const monsterDraft = () => getCommittedProps(monHost?.querySelector(monsterSelectSelector), isMonsterDraft);
    if (monHost) {
      const addBtn = (txt, fn) => {
        let b = [...monHost.querySelectorAll('[data-roi-mon-btn]')].find((button) => button.textContent === txt);
        if (!b) {
          b = document.createElement('button'); b.type = 'button'; b.className = 'xp-btn small';
          b.dataset.roiMonBtn = ''; b.textContent = txt; monHost.append(b);
        }
        b.onclick = () => {
          try { fn(); }
          catch (error) {
            if (!(error instanceof FiberTraversalTimeout)) throw error;
            const status = monHost.querySelector('[data-roi-mon-status]') || element('span');
            status.dataset.roiMonStatus = '';
            status.textContent = error.message;
            if (!status.isConnected) monHost.append(status);
          }
        };
      };
      addBtn('不逃 ⇄ 看到就逃', () => {
        const p = monsterDraft();
        if (!p) { const status = monHost.querySelector('[data-roi-mon-status]'); if (status) status.textContent = '⚠️ 無法讀取怪物設定草稿'; return; }
        const { targets, escape } = p.draft;
        const rules = readMonsterRules(p.draft);
        if (!rules.length) return;
        const turnOff = rules.every((rule) => rule.escape === 'sight');
        for (const rule of rules) {
          if (turnOff) delete rule.escape;
          else rule.escape = 'sight';
        }
        p.update({ monsterRules: rules, targets: { ...targets, blacklist: [] }, escape: { ...escape, dangerMonsters: [] } });
      });
      addBtn('⚡ 引怪 ⇄ 主動打', () => {
        const p = monsterDraft();
        if (!p?.draft.monsterRules?.length) { const status = monHost.querySelector('[data-roi-mon-status]'); if (status) status.textContent = '⚠️ 請先加入怪物'; return; }
        const allLure = p.draft.monsterRules.every((r) => r.action === 'lure');
        p.update({ monsterRules: p.draft.monsterRules.map((r) => ({ ...r, action: allLure ? 'attack' : 'lure' })) });
      });
    }
    if (monAnchor && !monsterSyncPanels.has(monAnchor)) {
      monsterSyncPanels.set(monAnchor, createMonsterSyncPanel(monAnchor, openKore));
    }
    // 怪物自動同步也會更新同一份草稿，等原生提交這次變動後再補道具。
    if (monsterSyncPanels.get(monAnchor)?.(monHost) !== 'updated') lootSyncPanels.get(lootAnchor)?.(itemGroup);
  }

  const refSelected = new Set();
  const refineCategories = {
    all: '全部', weapon: '武器', armor: '鎧甲', shield: '盾牌',
    head: '頭飾', garment: '披肩', shoes: '鞋子'
  };
  let refCategory = 'all';
  let refinePack;

  function refineCategory(item) {
    const slots = item?.slots ?? [];
    return ['weapon', 'armor', 'shield', 'head', 'garment', 'shoes'].find((category) =>
      category === 'head' ? slots.some((slot) => slot.startsWith('head')) : slots.includes(category));
  }

  function canRefine(stack) {
    if (!stack || stack.locked || stack.broken || stack.unidentified) return false;
    const item = refinePack?.items.get(stack.itemId);
    if (item?.category !== 'equipment' || !item.refineable) return false;
    const category = refineCategory(item);
    const level = Math.min(4, Math.max(1, item.weaponLevel ?? 1));
    const steps = category === 'weapon' ? refinePack.refine?.weapon?.[level] : refinePack.refine?.armor;
    const plus = stack.refine ?? 0;
    return Boolean(category && plus < 10 && steps?.[plus]);
  }
  let refPanel = null, refOpen = false, refBusy = false, refStop = false, refTargetPlus = 6, refMode = 'round_robin', refSkipConfirm = true, refAutoWh = true;
  let refMaterialBatch = readValidatedSetting('roi-refine-material-batch-v1', validateMaterialBatch, 20);

  function materialWithdrawalAmount(requested, stock, nativeMax = '') {
    if (!validMaterialBatch(requested) || !Number.isSafeInteger(stock) || stock < 1) throw Error('無法確認材料庫存或領取數量');
    let count = Math.min(requested, stock);
    if (nativeMax !== '') {
      const max = Number(nativeMax);
      if (!Number.isSafeInteger(max) || max < 1) throw Error('原生領料數量上限不可用');
      count = Math.min(count, max);
    }
    return count;
  }
  let bagMemo = null;
  const bagFastMiss = new WeakMap();
  let visitingWarehouse = false;

  function findModernBackpack(input) {
    const panel = input.closest('[role="tabpanel"][aria-label="道具"]');
    if (!panel || panel.querySelector('[role="region"][aria-label="多選販售"]')) return null;
    const list = uniqueVisible(panel, '[role="listbox"][aria-label="道具"], [role="group"][aria-label="道具"]');
    const detail = uniqueVisible(panel, '[role="region"][aria-label="道具詳情"]');
    const anchor = list?.parentElement?.parentElement;
    const host = anchor?.parentElement;
    return list && detail && host && list.parentElement === detail.parentElement ? { list, detail, anchor, host } : null;
  }

  function readModernBackpack(view) {
    const { list, detail, anchor, host } = view;
    const tree = currentFiberRoot(list);
    const props = tree && getCommittedProps(list, (p) => p.label === '道具' && Array.isArray(p.items));
    if (!props || !props.items.every((item) => Number.isSafeInteger(item?.st?.uid))) return null;
    let fiber = getReactFiber(list);
    let top = fiber;
    while (top?.return) top = top.return;
    if (top !== tree) fiber = fiber?.alternate;

    // 道具列來自同一份原生背包快照。只讀取清單祖先的已提交 Hook，
    // 避免從其他浮動面板或未提交的 React 更新取得另一個角色。
    let s;
    for (let depth = 0; !s && fiber && depth < 40; depth++, fiber = fiber.return) {
      if (typeof fiber.type !== 'function') continue;
      for (let hook = fiber.memoizedState, count = 0; hook && count < 100; hook = hook.next, count++) {
        const snap = hook.memoizedState;
        if (!snap?.character || !Array.isArray(snap.inventory) || typeof snap.mapId !== 'string') continue;
        const inventory = new Set(snap.inventory);
        if (props.items.every(({ st }) => inventory.has(st))) { s = snap; break; }
      }
    }
    if (!s) return null;
    const entries = new Map(props.items.map(({ st, def }) => [st.uid, { st, def }]));
    const rows = [];
    for (const row of list.querySelectorAll(':scope > [role="option"], :scope > button[aria-selected]')) {
      const rowFiber = getReactFiber(row);
      if (!/^\d+$/.test(rowFiber?.key || '')) continue;
      const uid = Number(rowFiber.key);
      const entry = entries.get(uid);
      if (!entry || !visible(row)) continue;
      const name = clean(entry.def?.name || row.textContent).replace(/^\+\d+\s*/, '');
      rows.push({ uid, row, button: row, st: entry.st, name, ...classifyItem(entry.st.itemId, name) });
    }
    const val = { host, anchor, table: list, detail, modern: true, s, rows };
    bagMemo = { tree, table: list, val };
    return val;
  }

  function readBackpackContext(force = false) {
    const inputs = [...document.querySelectorAll('input[aria-label="搜尋物品"]')].filter(visible);
    if (inputs.length !== 1) return null;
    const modern = findModernBackpack(inputs[0]);
    if (modern) return readModernBackpack(modern);
    if (inputs[0].closest('[role="tabpanel"][aria-label="道具"]')) return null;
    let host = inputs[0].parentElement;
    while (host && host !== document.body && !host.querySelector('table.xp-table')) host = host.parentElement;
    const table = host?.querySelector('table.xp-table');
    const tableText = table?.textContent || '';
    if (!tableText.includes('回城賣') || !tableText.includes('存倉')) return null;
    const tree = currentFiberRoot(table);
    if (!tree) return null;
    if (!force && bagMemo?.tree === tree && bagMemo.table === table && bagMemo.val.host.isConnected) return bagMemo.val;

    const rowNodes = new Set(table.querySelectorAll('tbody > tr')), rows = [], snaps = [];
    const validSnap = (s) => s?.character && Array.isArray(s.inventory) && typeof s.mapId === 'string';
    const props = bagFastMiss.get(table) === tree ? null : getCommittedProps(table, (p) => validSnap(p?.s) || validSnap(p?.snap));
    const localSnap = props?.s || props?.snap;
    if (validSnap(localSnap)) {
      const localRows = [...rowNodes].map((row) => {
        const fiber = getReactFiber(row);
        return /^\d+$/.test(fiber?.key || '') ? { uid: Number(fiber.key), row } : null;
      });
      if (localRows.every(Boolean)) { snaps.push(localSnap); rows.push(...localRows); }
    }
    if (!snaps.length) {
      const stack = [tree];
      let guard = 0;
      const budget = createFiberScanBudget(table, backpackScanRetries);
      while (stack.length && ++guard < 80000) {
        budget.step();
        const f = stack.pop(); if (!f) continue;
        if (rowNodes.has(f.stateNode) && /^\d+$/.test(f.key || '')) rows.push({ uid: Number(f.key), row: f.stateNode });
        const p = f.memoizedProps;
        for (const s of [p?.s, p?.snap]) if (validSnap(s) && !snaps.includes(s)) snaps.push(s);
        if (typeof f.type === 'function') {
          for (let h = f.memoizedState; h && typeof h === 'object'; h = h.next) {
            if (validSnap(h.memoizedState) && !snaps.includes(h.memoizedState)) snaps.push(h.memoizedState);
          }
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      budget.complete();
      if (!stack.length && snaps.length) bagFastMiss.set(table, tree);
    }
    const s = snaps[0];
    if (!s) return null;
    rows.sort((a, b) => a.row.rowIndex - b.row.rowIndex);
    const invMap = new Map(s.inventory.map((st) => [st.uid, st]));
    const val = {
      host, table, s,
      rows: rows.map((r) => {
        const st = invMap.get(r.uid);
        const nameBtn = r.row.querySelector('td button');
        const cleanName = clean(nameBtn?.textContent || '').replace(/^\+\d+\s*/, '');
        const cInfo = st ? classifyItem(st.itemId, cleanName) : { cat: 'other', sub: 'other' };
        return { ...r, st, name: cleanName || `裝備#${st?.itemId}`, cat: cInfo.cat, sub: cInfo.sub };
      })
    };
    bagMemo = { tree, table, val };
    return val;
  }

  const uniqueVisible = (root, selector, match = () => true) => {
    const candidates = [...root.querySelectorAll(selector)].filter((el) => visible(el) && match(el));
    return candidates.length === 1 ? candidates[0] : null;
  };

  function waitForUi(check, options = {}) {
    const { root = document.body, timeout = 2400, shouldAbort = () => false } = options;
    return new Promise((resolve, reject) => {
      let observer, timer, queued = false, done = false;
      function finish(error, value) {
        done = true;
        observer?.disconnect();
        clearTimeout(timer);
        pageNet.events.removeEventListener('settled', schedule);
        pageNet.events.removeEventListener('ui-abort', schedule);
        document.removeEventListener('visibilitychange', schedule);
        if (error) reject(error);
        else resolve(value);
      }
      function inspect(expired = false) {
        if (done) return;
        try {
          if (document.hidden || shouldAbort()) throw Error('角色已變更或流程已停止');
          const result = check(expired);
          if (result || expired) finish(null, result || null);
        } catch (error) { finish(error); }
      }
      function schedule() {
        if (queued || done) return;
        queued = true;
        queueMicrotask(() => { queued = false; inspect(); });
      }
      inspect();
      if (done) return;
      try {
        if (root) {
          observer = new MutationObserver(schedule);
          observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
        }
        pageNet.events.addEventListener('settled', schedule);
        pageNet.events.addEventListener('ui-abort', schedule);
        document.addEventListener('visibilitychange', schedule);
        timer = setTimeout(() => inspect(true), timeout);
      } catch (error) { finish(error); }
    });
  }

  function waitForCartView(read, root, shouldAbort) {
    return waitForUi(read, { root, shouldAbort });
  }

  let cartShortcutBusy = false;
  async function putStackInCart(root, inventoryTab, cartTab, stack) {
    const cartField = () => uniqueVisible(root, 'fieldset', (field) =>
      /^手推車(?:[ (]|$)/.test(clean(field.querySelector(':scope > legend')?.textContent)));
    const actor = state.activeCharId, epoch = refineIdentityEpoch;
    const shouldAbort = () => state.activeCharId !== actor || refineIdentityEpoch !== epoch;
    const viewRoot = root === document ? document.body : root;
    let box, submitted = false;
    cartShortcutBusy = true;
    try {
      cartTab.click();
      const section = root !== document && await waitForCartView(() => uniqueVisible(root, 'nav[aria-label="設定分類"] button',
        (button) => clean(button.textContent) === '手推車'), viewRoot, shouldAbort);
      if (document.hidden || shouldAbort()) throw Error('角色已變更或流程已停止');
      if (section && section.getAttribute('aria-current') !== 'page') section.click();

      const field = await waitForCartView(cartField, viewRoot, shouldAbort);
      if (!field || document.hidden || shouldAbort()) throw Error('找不到原版手推車介面');
      const selected = () => [...field.querySelectorAll('input[type="checkbox"][aria-label^="放入 "]:checked')];
      if (selected().length) throw Error('手推車已有勾選項目，請先完成原本的操作');
      box = uniqueVisible(field, 'input[type="checkbox"][aria-label^="放入 "]',
        (input) => getReactFiber(input.closest('li'))?.key === String(stack.uid));
      const props = box && getCommittedProps(box, (p) => p.snap?.cart && Array.isArray(p.snap.inventory));
      const item = props?.snap.inventory.find((item) => item.uid === stack.uid);
      if (!box || box.disabled || item?.itemId !== stack.itemId || item.qty !== stack.qty || item.locked
          || props.snap.activity === 'dead') throw Error('目前無法將這疊物品放入手推車');

      box.click();
      const submit = await waitForCartView(() => field.isConnected && selected().length === 1 && selected()[0] === box
        && (stack.qty === 1 || Number(box.closest('li')?.querySelector('input[type="number"]')?.value) === stack.qty)
        && uniqueVisible(field, 'button', (button) => !button.disabled && /^放入\s+1\s+項$/.test(clean(button.textContent))), field, shouldAbort);
      if (!submit?.isConnected || submit.disabled || document.hidden || shouldAbort()) throw Error('找不到原版「放入 1 項」按鈕');
      submitted = true;
      submit.click();
      // Return only after the backpack stack disappeared. The native cart shows errors.
      const moved = await waitForCartView(() => field.isConnected && !box.isConnected, viewRoot, shouldAbort);
      if (moved && !document.hidden && !shouldAbort() && inventoryTab.isConnected && visible(inventoryTab)) inventoryTab.click();
    } catch (error) {
      if (!submitted && !document.hidden && !shouldAbort() && box?.isConnected && box.checked && !box.disabled) box.click();
      if (!submitted && !document.hidden && !shouldAbort() && inventoryTab.isConnected && visible(inventoryTab) && cartField()) inventoryTab.click();
      alert(error.message);
    } finally {
      cartShortcutBusy = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || refBusy) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const modern = target.closest('[role="listbox"][aria-label="道具"] [role="option"], [role="group"][aria-label="道具"] button[aria-selected]');
    const tabPanel = modern?.closest('[role="tabpanel"][aria-label="道具"]');
    const classic = target.closest('table.xp-table tbody tr');
    const backpack = !modern && classic ? readFiberForUi(() => readBackpackContext()) : null;
    const row = backpack?.rows.find((entry) => entry.row === classic && target.closest('button') === classic.querySelector('td button'));
    if ((!tabPanel || !modern) && !row) return;
    const uid = Number(getReactFiber(modern)?.key);
    const itemList = modern && readFiberForUi(() => getCommittedProps(modern, (props) =>
      props.label === '道具' && Array.isArray(props.items)));
    const stack = row?.st ?? itemList?.items.find((entry) => entry.st?.uid === uid)?.st;
    if (!stack) return;

    const root = tabPanel?.parentElement ?? document;
    const buttons = tabPanel ? '[role="tablist"][aria-label="背包"] button[role="tab"]' : '.xp-menu-item';
    const cartTab = uniqueVisible(root, buttons, (button) => clean(button.textContent) === (tabPanel ? '手推車與攤位' : '攤位'));
    const inventoryTab = uniqueVisible(root, buttons, (button) => clean(button.textContent) === (tabPanel ? '道具' : '背包'));
    if (!cartTab || !inventoryTab || cartTab.disabled || stack.locked
        || (backpack && (!backpack.s.cart || backpack.s.vend || Object.values(backpack.s.equipment ?? {}).includes(stack.uid)))) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (!cartShortcutBusy) void putStackInCart(root, inventoryTab, cartTab, stack);
  }, true);

  const isEligibleEquip = (r) => canRefine(r.st);

  const refineRowsForPage = (rows) => rows.filter((row) =>
    isEligibleEquip(row) && (refCategory === 'all' || refineCategory(refinePack.items.get(row.st.itemId)) === refCategory));

  function findNativeDetailBtn(table, uid, matcher) {
    if (table.matches('[aria-label="道具"]')) {
      const detail = table.parentElement?.querySelector(':scope > [role="region"][aria-label="道具詳情"]');
      const close = detail && uniqueVisible(detail, 'button[aria-label="關閉物品資訊"]');
      const props = close && getCommittedProps(close, (p) => p.uid === uid && typeof p.onClose === 'function');
      if (!props) return null;
      if (!matcher) return close;
      const buttons = [...detail.querySelectorAll('button')].filter((el) => visible(el) && matcher(clean(el.textContent)));
      return buttons.length === 1 ? buttons[0] : null;
    }
    const tree = currentFiberRoot(table);
    if (!tree) return null;
    const budget = createFiberScanBudget(table, detailScanRetries);
    const search = (root, limit) => {
      const stack = [{ fiber: root, matching: false }];
      while (stack.length && limit-- > 0) {
        budget.step();
        const { fiber, matching } = stack.pop();
        const props = fiber.memoizedProps;
        const inDetail = matching || (props?.uid === uid &&
          (props.s?.inventory || typeof props.onClose === 'function'));
        const el = fiber.stateNode;
        if (inDetail && el?.tagName === 'BUTTON' && visible(el) && (!matcher || matcher(clean(el.textContent)))) return el;
        if (fiber.child) stack.push({ fiber: fiber.child, matching: inDetail });
        if (fiber !== root && fiber.sibling) stack.push({ fiber: fiber.sibling, matching });
      }
      return null;
    };
    const host = bagMemo?.table === table ? bagMemo.val.host : table;
    let local = getReactFiber(host);
    if (local) {
      let root = local;
      while (root.return) root = root.return;
      if (root !== tree) local = local.alternate;
    }
    const result = (local && search(local, 10000)) || search(tree, 80000);
    budget.complete();
    return result;
  }

  let refineIdentityEpoch = 0;
  async function readRefineDetail(table, uid, matcher, session) {
    for (let attempt = 0; ; attempt++) {
      try { return findNativeDetailBtn(table, uid, matcher); }
      catch (error) {
        if (!(error instanceof FiberTraversalTimeout) || attempt >= 3) throw error;
      }
      await new Promise(resolve => {
        const frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
        const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 100);
      });
      assertRefineTarget(session, uid);
      if (!table.isConnected) throw Error('原生操作按鈕已變動，已停止');
    }
  }

  const positiveId = (value) => (typeof value === 'number' || (typeof value === 'string' && /^[1-9]\d*$/.test(value))) &&
    Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
  const snapshotCharacterId = (s) => positiveId(s?.character?.id ?? s?.characterId ?? s?.character?.characterId);
  let refineNativeStore = null;

  function nativeStoreActor(store, snapshot) {
    if (!store || typeof store.getState !== 'function' || typeof store.subscribe !== 'function' ||
        typeof store.getInitialState !== 'function' || typeof store.setState !== 'function') return null;
    try {
      const state = store.getState();
      if (!state?.snapshot?.character || !Array.isArray(state.snapshot.inventory) ||
          (snapshot && state.snapshot !== snapshot)) return null;
      return positiveId(state.characterId);
    } catch { return null; }
  }

  function findRefineNativeStore(host, snapshot) {
    const root = currentFiberRoot(host);
    if (!root) return null;
    let route = fiberRouteMap.get(host);
    let fiber = root;
    for (const step of route ?? []) fiber = step === 'c' ? fiber?.child : fiber?.sibling;
    if (fiber?.stateNode !== host) {
      // 背包的 snapshot 可來自 Hook，未必存在符合條件的祖先 props，
      // 因此不能假設 readBackpackContext 已建立這條 DOM 路徑快取。
      getCommittedProps(host, () => true);
      route = fiberRouteMap.get(host);
      if (!route) return null;
      fiber = root;
      for (const step of route) fiber = step === 'c' ? fiber?.child : fiber?.sibling;
    }
    if (fiber?.stateNode !== host) return null;
    // 遊戲以 Zustand 分開保存 characterId 與 snapshot。
    // 只讀目前背包／倉庫祖先的 Hook 依賴，並核對同一份 snapshot。
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (typeof fiber.type !== 'function') continue;
      let hook = fiber.memoizedState;
      for (let count = 0; hook && count < 200; count++, hook = hook.next) {
        const memo = hook.memoizedState;
        const deps = Array.isArray(memo) && Array.isArray(memo[1]) ? memo[1] : [];
        for (const candidate of deps) {
          if (nativeStoreActor(candidate, snapshot)) return candidate;
        }
      }
    }
    return null;
  }

  function refineActor(context) {
    const direct = snapshotCharacterId(context?.s);
    if (direct) return direct;
    const cached = nativeStoreActor(refineNativeStore, context?.s);
    if (cached) return cached;
    const host = context?.table || [...document.querySelectorAll('fieldset')].find((field) =>
      visible(field) && /^倉庫(?:\s*[（(]|$)/.test(clean(field.querySelector('legend')?.textContent)));
    const props = host && getCommittedProps(host, (p) => Boolean((p?.s ?? p?.snap)?.character));
    const snapshot = context?.s ?? props?.s ?? props?.snap;
    const actor = snapshotCharacterId(snapshot) || positiveId(props?.characterId ?? props?.charId);
    if (actor) return actor;
    refineNativeStore = host && findRefineNativeStore(host, snapshot);
    return nativeStoreActor(refineNativeStore, snapshot);
  }

  const refineItemSignature = (item) => JSON.stringify([item.itemId, item.cards ?? [], item.forged ?? null]);
  function assertRefineSession(session, allowStopped = false) {
    if (!session || session.epoch !== refineIdentityEpoch || document.hidden || (!allowStopped && refStop)) {
      throw Error('角色已變更或流程已停止');
    }
    const context = readBackpackContext(true);
    if ((session.modern && !context) || (context && session.modern !== undefined && Boolean(context.modern) !== session.modern)) {
      throw Error('背包介面已切換，已停止');
    }
    const actor = refineActor(context);
    if (actor !== session.characterId || (state.activeCharId != null && Number(state.activeCharId) !== actor)) {
      throw Error('無法確認仍是起始角色，已停止');
    }
  }

  function assertRefineTarget(session, uid, allowMissing = false) {
    assertRefineSession(session, session.restoring === true);
    const b = readBackpackContext(true);
    const item = b?.s.inventory.find((stack) => stack.uid === uid);
    if (!item && allowMissing) return b;
    if (!item || session.items.get(uid) !== refineItemSignature(item)) throw Error('目標裝備已變動，已停止');
    return b;
  }

  async function refineAwait(session, promise, allowStopped = false) {
    const value = await promise;
    assertRefineSession(session, allowStopped || session.restoring === true);
    if (session.targetUid != null) assertRefineTarget(session, session.targetUid, true);
    return value;
  }

  function clickRefineControl(session, button, uid) {
    assertRefineSession(session, session.restoring === true);
    if (uid != null) assertRefineTarget(session, uid);
    if (!button?.isConnected || button.disabled) throw Error('原生操作按鈕已變動，已停止');
    button.click();
  }

  let lastRefineCommandAt = -Infinity;
  async function waitForRefineCommandSlot(session) {
    let remaining = TIMING.refineCommandGap - (performance.now() - lastRefineCommandAt);
    while (remaining > 0) {
      await refineAwait(session, sleep(remaining));
      remaining = TIMING.refineCommandGap - (performance.now() - lastRefineCommandAt);
    }
    assertRefineSession(session, session.restoring === true);
  }

  function clickRefineCommand(session, button, uid) {
    // Reserve the slot before dispatching the native click, including synchronous responses.
    lastRefineCommandAt = performance.now();
    clickRefineControl(session, button, uid);
  }

  function stopRefine() {
    refStop = true;
    pageNet.events.dispatchEvent(new Event('ui-abort'));
  }

  function waitForRefineUi(session, check, options = {}) {
    const { root, timeout, allowStopped = false } = options;
    return waitForUi(expired => {
      assertRefineSession(session, allowStopped || session.restoring === true);
      return check(expired);
    }, {
      root, timeout,
      shouldAbort: () => session.epoch !== refineIdentityEpoch ||
        (state.activeCharId != null && Number(state.activeCharId) !== session.characterId) ||
        (refStop && !allowStopped && !session.restoring)
    });
  }

  async function selectBagItemRow(uid, session) {
    assertRefineTarget(session, uid);
    const b = readBackpackContext(true);
    const row = b?.rows.find((r) => r.uid === uid);
    const btn = row?.button || (row && [...row.row.querySelectorAll('td button')].find((x) => !x.disabled && !x.closest('[data-roi-refine-helper]')));
    if (!btn) throw Error('找不到該裝備列');
    if (!findNativeDetailBtn(b.table, uid)) clickRefineControl(session, btn, uid);
    const detail = await waitForRefineUi(session, () => {
      const live = assertRefineTarget(session, uid);
      return live && findNativeDetailBtn(live.table, uid) && live;
    }, { timeout: 2400 });
    if (!detail) throw Error('找不到該裝備明細');
    return detail;
  }

  async function equipItemByUid(uid, session) {
    let b = await refineAwait(session, selectBagItemRow(uid, session));
    b = assertRefineTarget(session, uid);
    if (Object.values(b.s.equipment || {}).includes(uid)) return b;
    const eqBtn = await readRefineDetail(b.table, uid, (t) => t === '裝備', session);
    if (!eqBtn || eqBtn.disabled) throw Error('此職業無法穿戴該裝備進行忽克連精煉');
    await waitForRefineCommandSlot(session);
    clickRefineCommand(session, findNativeDetailBtn(b.table, uid, t => t === '裝備'), uid);
    const equipped = await waitForRefineUi(session, () => {
      const live = assertRefineTarget(session, uid);
      return live && Object.values(live.s.equipment || {}).includes(uid) && live;
    }, { root: b.host?.parentElement, timeout: 4000 });
    if (!equipped) throw Error('穿戴裝備逾時');
    return equipped;
  }

  async function tryWithdrawFromWarehouse(wantedItemIds, targetPlusLimit, setStatus, limitsById, maxItems = 15, session, materialQuantity = null) {
    assertRefineSession(session);
    const findWhField = () => [...document.querySelectorAll('fieldset')].find((f) => /^倉庫(?:\s*[（(]|$)/.test(clean([...f.children].find((c) => c.tagName === 'LEGEND')?.textContent)) && visible(f));
    let switchedTab = null;
    let field = null;
    const selected = new Map();
    let submitted = false;
    visitingWarehouse = true;
    try {
      field = findWhField();
      if (!field) {
        const tabs = [...document.querySelectorAll('.xp-menu-item, button, a')].filter(visible);
        const whTab = tabs.find((el) => clean(el.textContent) === '倉庫');
        switchedTab = tabs.find((el) => clean(el.textContent) === '背包');
        if (!whTab || !switchedTab) return [];
        clickRefineControl(session, whTab);
        field = await waitForRefineUi(session, findWhField, { timeout: 2500 });
        if (!field) throw Error('開啟倉庫逾時');
      }
      const checked = () => [...field.querySelectorAll(':scope > ul > li input[type="checkbox"]:checked')];
      if (checked().length || [...field.querySelectorAll('button')].some((b) => clean(b.textContent) === '結束賣出')) {
        throw Error('倉庫已有勾選或正在賣出，請先完成原本的操作');
      }
      for (const li of field.querySelectorAll('li')) {
        const cb = li.querySelector('input[type="checkbox"]');
        const id = Number(li.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/(\d+)\.png/)?.[1]);
        if (!wantedItemIds.has(id) || !cb || cb.disabled || cb.checked || !/^(取出|領出)/.test(clean(cb.getAttribute('aria-label')))) continue;
        const name = clean(li.querySelector('button[aria-label$="的物品資訊"]')?.textContent || '');
        const refine = Number(name.match(/^\+\s*(\d+)/)?.[1] || 0);
        if (!name || refine >= (limitsById ? limitsById.get(id) || 0 : targetPlusLimit)) continue;
        if (refStop || document.hidden) throw Error('已中止領倉');
        clickRefineControl(session, cb);
        selected.set(cb, { id, refine, name });
        const confirmed = await waitForRefineUi(session, () => {
          if (!field.contains(cb) || !cb.checked) return false;
          return [...field.querySelectorAll('button')].some(b =>
            !b.disabled && Number(clean(b.textContent).match(/^(?:領出|取出)\s*(\d+)\s*項/)?.[1]) === selected.size);
        }, { root: field });
        if (!confirmed) throw Error('倉庫勾選已變動或無法領取，已中止領倉');
        if (materialQuantity !== null) {
          const amount = li.querySelector('input[type="number"]');
          const stackText = clean(li.textContent).match(/×\s*([\d,]+)/)?.[1];
          const stack = stackText ? Number(stackText.replace(/,/g, '')) : amount ? NaN : 1;
          const quantity = materialWithdrawalAmount(materialQuantity, stack, amount?.max ?? '');
          if (amount && Number(amount.value) !== quantity) {
            assertRefineSession(session);
            if (!li.contains(amount) || Number(warehouseItemId(li)) !== id) throw Error('領料項目已變動');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw Error('無法設定領料數量，已停止');
            setter.call(amount, String(quantity));
            amount.dispatchEvent(new Event('input', { bubbles: true }));
            amount.dispatchEvent(new Event('change', { bubbles: true }));
            const accepted = await waitForRefineUi(session, () => {
              const current = cb.closest('li')?.querySelector('input[type="number"]');
              if (!current?.isConnected || Number(current.value) !== quantity) return false;
              // The manual setter changes the DOM immediately; React must also accept the controlled value.
              return Boolean(getCommittedProps(current, props => props.value != null && Number(props.value) === quantity));
            }, { root: li });
            if (!accepted) throw Error('遊戲未接受領料數量，已停止');
          } else if (!amount && (stack !== 1 || quantity !== 1)) {
            throw Error('無法確認領料數量，已停止以避免取出整疊');
          }
          selected.get(cb).quantity = quantity;
        }
        if (selected.size >= maxItems) break;
      }
      if (!selected.size) return [];
      await waitForRefineCommandSlot(session);
      const boxes = checked();
      for (const [cb, expected] of selected) {
        const row = cb.closest('li');
        if (!field.contains(cb) || Number(warehouseItemId(row)) !== expected.id ||
            clean(row?.querySelector('button[aria-label$="的物品資訊"]')?.textContent) !== expected.name) {
          throw Error('領取物品已變動，已停止');
        }
        if (expected.quantity !== undefined) {
          const amount = row.querySelector('input[type="number"]');
          if (amount ? Number(amount.value) !== expected.quantity : expected.quantity !== 1) throw Error('領料數量已變動，已停止');
        }
      }
      const btn = [...field.querySelectorAll('button')].find((b) => Number(clean(b.textContent).match(/^(?:領出|取出)\s*(\d+)\s*項/)?.[1]) === selected.size);
      if (refStop || document.hidden || !field.isConnected || boxes.length !== selected.size || boxes.some((cb) => !selected.has(cb)) || !btn || btn.disabled) {
        throw Error('倉庫勾選已變動或無法領取，已中止領倉');
      }
      setStatus(`📦 領取 ${selected.size} 項` + (materialQuantity !== null ? `（${[...selected.values()].reduce((sum, item) => sum + item.quantity, 0)} 個材料）` : ''));
      // The batch above is verified against the native selection, including rows hidden by the custom tab.
      refineWarehouseSubmitButton = btn;
      try { clickRefineCommand(session, btn); }
      finally { refineWarehouseSubmitButton = null; }
      submitted = true;
      const acknowledged = await waitForRefineUi(session, () =>
        [...selected.keys()].every(cb => !cb.isConnected || !cb.checked),
      { root: field.parentElement, timeout: 4000 });
      if (!acknowledged) throw Error('已送出領倉，但未確認提交結果。請確認背包與倉庫。');
      return [...selected.values()];
    } finally {
      try {
        const canClean = () => session.epoch === refineIdentityEpoch && !document.hidden &&
          (state.activeCharId == null || Number(state.activeCharId) === session.characterId) &&
          refineActor(null) === session.characterId && field?.isConnected && findWhField() === field;
        if (!submitted) {
          for (const cb of selected.keys()) {
            if (canClean() && field.contains(cb) && cb.isConnected && cb.checked && !cb.disabled) cb.click();
          }
        }
        if (canClean() && switchedTab?.isConnected && !switchedTab.disabled) {
          switchedTab.click();
          await waitForRefineUi(session, () => readBackpackContext(true), { timeout: 2500, allowStopped: true });
        }
      } catch {
        // 清理中斷時，保留原始領倉錯誤，不再點擊。
      } finally { visitingWarehouse = false; }
    }
  }

  const isWeaponRefineButton = (text) => /^武器精[練煉]\s*\(\s*技能(?:[,\s)]|$)/.test(text);
  const isNpcRefineButton = (text) => /^請.+精[煉練]$/.test(text);
  const weaponRefineLevel = (snapshot) => snapshot.character.skills?.WS_WEAPONREFINE ?? 0;
  const materialCount = (inventory, id) => inventory.reduce((sum, item) =>
    item.itemId === id && Number.isSafeInteger(item.qty) && item.qty > 0 ? sum + item.qty : sum, 0);

  function safeRefineCost(steps, from, to) {
    if (!steps || !Number.isSafeInteger(to) || to <= from || to > steps.length) return null;
    const materials = new Map();
    let zeny = 0;
    for (const step of steps.slice(from, to)) {
      if (!step || step.rate !== 100 || !positiveId(step.material) || !Number.isSafeInteger(step.price) || step.price < 0) return null;
      zeny += step.price;
      materials.set(step.material, (materials.get(step.material) ?? 0) + 1);
    }
    return { materials, zeny };
  }

  // 已付費、材料已扣、等級未升，且點擊後遊戲送出的請求都已回應（且之後沒有新的回應）時，
  // 不同事件喚醒的連續兩讀一致才提前判定；8 秒上限會再做一次最終確認。
  function refineNoUpgradeSettled(gate, confirmed, net) {
    if (!confirmed || net.inFlight > 0 || net.settled <= gate.since) { gate.candidate = null; return false; }
    if (gate.candidate === net.settled) return true;
    gate.candidate = net.settled;
    return false;
  }

  async function waitForRefineMaterial(session, id, expectedQty) {
    let backpackReady = false;
    try {
      const received = await waitForRefineUi(session, () => {
        const b = readBackpackContext(true);
        backpackReady = Boolean(b);
        return b && materialCount(b.s.inventory, id) >= expectedQty;
      }, { timeout: 4000 });
      if (received) return;
    } catch (error) {
      throw Error(`已送出領倉，確認入帳時停止（${error.message}）。請確認背包與倉庫。`);
    }
    throw Error(backpackReady
      ? '已送出領倉，但材料入帳逾時。請確認背包與倉庫。'
      : '已送出領倉，但等待入帳逾時時背包介面仍未就緒。請確認背包與倉庫。');
  }

  async function replenishRefineMaterials(session, uid, refine, materials, setStatus) {
    const readInventory = () => {
      const { inventory } = assertRefineTarget(session, uid).s;
      if ((inventory.find((item) => item.uid === uid).refine ?? 0) !== refine) throw Error('補料期間裝備精煉值已變動');
      return inventory;
    };
    for (const [id, required] of materials) {
      let quantity = materialCount(readInventory(), id);
      while (quantity < required) {
        session.targetUid = null;
        const picked = await tryWithdrawFromWarehouse(new Set([id]), 10, setStatus, null, 1, session, refMaterialBatch);
        const expected = quantity + (picked[0]?.quantity ?? 0);
        if (picked.length) await waitForRefineMaterial(session, id, expected);
        session.targetUid = uid;
        const received = materialCount(readInventory(), id);
        if (!picked.length) return id;
        if (expected <= quantity || received < expected) throw Error('補料後無法確認背包材料增加，已停止');
        quantity = received;
      }
    }
    return null;
  }

  function waitForRefineResult(session, uid, options) {
    const { root, curPlus, material, beforeMatQty, beforeZeny, beforeSp, useSkill, settleGate, commandWatch } = options;
    let previouslyConfirmed = false;
    const skillMaterialGate = { since: settleGate.since, candidate: null };
    let previousMaterialOutcome = null;
    return waitForRefineUi(session, expired => {
      const b = assertRefineTarget(session, uid, true);
      const nowSt = b?.s.inventory.find(x => x.uid === uid);
      if (!b) {
        previouslyConfirmed = false;
        settleGate.candidate = skillMaterialGate.candidate = null;
        previousMaterialOutcome = null;
        return null;
      }
      const tracked = Boolean(commandWatch?.commandId);
      const net = tracked
        ? { inFlight: commandWatch.pending, settled: settleGate.since + commandWatch.settled }
        : pageNet;
      const acknowledged = !tracked || (commandWatch.status >= 200 && commandWatch.status < 300 && net.inFlight === 0);
      if (tracked && (commandWatch.status === 429 || (expired && commandWatch.status >= 400 && commandWatch.status < 500))
          && net.inFlight === 0) {
        throw Error(`神工匠精練請求被拒絕（HTTP ${commandWatch.status}），請查看遊戲提示`);
      }
      const paid = useSkill ? b.s.character.sp <= beforeSp - 5 : b.s.character.zeny < beforeZeny;
      if (nowSt && (nowSt.refine || 0) === curPlus + 1) return { kind: 'success', b, nowSt };
      if (!nowSt && paid && acknowledged) return { kind: 'broken', b };
      const materialUsed = Boolean(material && materialCount(b.s.inventory, material) < beforeMatQty);
      const atOrBelow = nowSt && (nowSt.refine || 0) <= curPlus;
      // A recovered SP value can hide the skill cost. Confirm the same equipment
      // outcome twice against the depleted ore and a settled request.
      const materialOutcome = useSkill && acknowledged && materialUsed ?
        (!nowSt ? 'broken' : atOrBelow ? 'failed' : null) : null;
      if (materialOutcome !== previousMaterialOutcome) skillMaterialGate.candidate = null;
      previousMaterialOutcome = materialOutcome;
      if (refineNoUpgradeSettled(skillMaterialGate, Boolean(materialOutcome), net)
          || (expired && tracked && materialOutcome && acknowledged)) return { kind: materialOutcome, b };
      const confirmedNoUpgrade = Boolean(acknowledged && atOrBelow && paid && (!material || materialUsed));
      if (refineNoUpgradeSettled(settleGate, confirmedNoUpgrade, net) ||
          (expired && previouslyConfirmed && confirmedNoUpgrade && net.inFlight === 0)) return { kind: 'failed', b };
      previouslyConfirmed = confirmedNoUpgrade;
      return null;
    }, { root, timeout: 8000 });
  }

  async function runHybridRefine(modeType) {
    if (refBusy) return;
    refStop = false;
    const setStatus = (msg) => { if (!refPanel?.isConnected) refreshRefinePanel(); const el = refPanel?.querySelector('[data-ref-status]'); if (el) el.textContent = msg; };
    let b, characterId;
    try {
      b = readBackpackContext(true);
      if (!b) return;
      characterId = refineActor(b);
    } catch (error) {
      if (!(error instanceof FiberTraversalTimeout)) throw error;
      return setStatus('⚠️ ' + error.message);
    }
    if (!characterId) return setStatus('⚠️ 無法確認目前角色 ID，已停止');
    const session = {
      characterId, epoch: refineIdentityEpoch, targetUid: null, modern: Boolean(b.modern),
      items: new Map(b.s.inventory.map((item) => [item.uid, refineItemSignature(item)]))
    };
    try { assertRefineSession(session); }
    catch (error) { setStatus('⚠️ ' + error.message); return; }

    if (!refinePack) {
      refBusy = true;
      try { refinePack = await refineAwait(session, loadLootPack()); }
      catch (e) { setStatus('⚠️ 無法載入精煉資料：' + e.message); return; }
      finally { refBusy = false; }
    }
    b = readFiberForUi(() => readBackpackContext(true));
    if (b === undefined) return setStatus('⚠️ 介面讀取逾時，請稍後再試');
    if (!b) return setStatus('⚠️ 背包已關閉');

    const autoWarehouse = refAutoWh && !b.modern;
    const skillOnly = modeType === 'skill_only';
    const limitPlus = modeType === 'safe_only' ? 10
      : skillOnly ? Math.min(refTargetPlus, weaponRefineLevel(b.s)) : refTargetPlus;
    const canUseSkill = (row) => {
      const item = refinePack?.items.get(row.st.itemId);
      return item?.weaponType !== undefined && (row.st.refine ?? 0) < limitPlus;
    };
    const initJobs = b.rows.filter((r) => isEligibleEquip(r) && refSelected.has(r.uid) && (!skillOnly || canUseSkill(r)));
    if (!initJobs.length) return setStatus(skillOnly
      ? '⚠️ 請勾選低於目標與武器精練技能上限的武器'
      : '⚠️ 請先在下方清單勾選要精煉的裝備！');
    const runUids = new Set(initJobs.map((r) => r.uid));
    const trackedItemIds = new Set(initJobs.map((r) => r.st.itemId));

    const origEquip = { ...(b.s.equipment || {}) };
    const safeLimits = new Map(), skipped = new Set();
    let changedEquip = false, successCnt = 0, brokenCnt = 0, failedCnt = 0;
    refBusy = true; refStop = false; refreshRefinePanel();

    try {
      while (!refStop) {
        assertRefineSession(session);
        b = readBackpackContext(true);
        if (!b || document.hidden) throw Error('已離開背包頁面');

        let pool = b.rows.filter((r) => isEligibleEquip(r) && runUids.has(r.uid) && refSelected.has(r.uid));
        pool = pool.filter((r) => !skipped.has(r.uid) && (r.st.refine || 0) < limitPlus);

        if (!pool.length && autoWarehouse) {
          session.targetUid = null;
          const before = new Set(b.s.inventory.map((x) => x.uid));
          const picked = await tryWithdrawFromWarehouse(trackedItemIds, limitPlus, setStatus, modeType === 'safe_only' ? safeLimits : null, 15, session);
          assertRefineSession(session);
          if (picked.length) {
            const expected = picked.map((x) => `${x.id}:${x.refine}`).sort().join(',');
            const received = await waitForRefineUi(session, () => {
              b = readBackpackContext(true);
              const added = b?.s.inventory.filter(x => !before.has(x.uid) && trackedItemIds.has(x.itemId)) || [];
              return added.map(x => `${x.itemId}:${x.refine || 0}`).sort().join(',') === expected ? added : null;
            }, { timeout: 4000 });
            if (!received) throw Error('領取後背包新增的裝備與本批不符，請確認背包');
            for (const x of received.filter(item => canRefine(item) && (item.refine || 0) < limitPlus)) {
              session.items.set(x.uid, refineItemSignature(x));
              runUids.add(x.uid); refSelected.add(x.uid);
            }
            if (!b.rows.some((r) => runUids.has(r.uid) && refSelected.has(r.uid) && isEligibleEquip(r) && (r.st.refine || 0) < limitPlus)) {
              throw Error('領出的裝備未出現在可精煉清單');
            }
            continue;
          }
        }
        if (!pool.length) break;

        if (refMode === 'single_focus') pool.sort((a, b) => (b.st.refine || 0) - (a.st.refine || 0));
        else pool.sort((a, b) => (a.st.refine || 0) - (b.st.refine || 0));

        const target = pool[0], uid = target.uid, curPlus = target.st.refine || 0;
        session.targetUid = uid;
        b = await refineAwait(session, selectBagItemRow(uid, session));
        if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');

        const recipeItem = refinePack?.items?.get(target.st.itemId);
        const weaponLevel = Math.min(4, Math.max(1, recipeItem?.weaponLevel ?? 1));
        const steps = recipeItem?.slots?.includes('weapon') ? refinePack?.refine?.weapon?.[weaponLevel] : refinePack?.refine?.armor;
        const step = steps?.[curPlus];
        const material = step?.material;
        const isSafeButton = (t) => /^一鍵精煉到安全值\s*\+\d+/.test(t);
        let safeBtn = !skillOnly && await readRefineDetail(b.table, uid, isSafeButton, session);
        const nativeLimit = Number(clean(safeBtn?.textContent).match(/\+(\d+)/)?.[1]);
        if (modeType === 'safe_only' && nativeLimit > 0) safeLimits.set(target.st.itemId, nativeLimit);
        let unavailableMaterial = null;
        if (autoWarehouse && safeBtn?.disabled && curPlus < nativeLimit && (modeType === 'safe_only' || nativeLimit <= limitPlus)) {
          const cost = safeRefineCost(steps, curPlus, nativeLimit);
          if (cost && b.s.character.zeny >= cost.zeny &&
              [...cost.materials].some(([id, count]) => materialCount(b.s.inventory, id) < count)) {
            unavailableMaterial = await replenishRefineMaterials(session, uid, curPlus, cost.materials, setStatus);
            b = await refineAwait(session, selectBagItemRow(uid, session));
            safeBtn = await readRefineDetail(b.table, uid, isSafeButton, session);
          }
        }
        if (safeBtn && !safeBtn.disabled) {
          const safeTarget = Number(safeBtn.textContent.match(/\+(\d+)/)?.[1]) || 4;
          if (curPlus < safeTarget && (modeType === 'safe_only' || safeTarget <= refTargetPlus)) {
            setStatus(`⚡ 一鍵安全值：【${target.name}】+${curPlus} ➔ +${safeTarget}...`);
            if (refStop || document.hidden) throw Error('已中止精煉');
            await waitForRefineCommandSlot(session);
            const originalConfirm = page.confirm;
            let accepted = true;
            try {
              page.confirm = (message) => {
                if (refSkipConfirm) return true;
                accepted = originalConfirm.call(page, message);
                return accepted;
              };
              if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
              const liveSafeBtn = findNativeDetailBtn(b.table, uid, t => Number(t.match(/^一鍵精煉到安全值\s*\+(\d+)/)?.[1]) === safeTarget);
              clickRefineCommand(session, liveSafeBtn, uid);
            } finally {
              page.confirm = originalConfirm;
            }
            if (!accepted) throw Error('已取消原生安全精煉');
            const confirmed = await waitForRefineUi(session, () => {
              const live = assertRefineTarget(session, uid, true);
              const nowSt = live?.s.inventory.find(x => x.uid === uid);
              return nowSt && (nowSt.refine || 0) >= safeTarget;
            }, { root: b.host?.parentElement, timeout: 6000 });
            if (!confirmed) throw Error(`【${target.name}】安全精煉結果逾時，請確認裝備`);
            successCnt++;
            if (modeType === 'safe_only' || safeTarget === refTargetPlus) refSelected.delete(uid);
            continue;
          }
        }
        if (modeType === 'safe_only') {
          skipped.add(uid);
          if (!safeBtn || (safeBtn.disabled && curPlus < nativeLimit)) safeLimits.delete(target.st.itemId);
          continue;
        }

        let skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
        let npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);

        if (skillOnly && !skillBtn) {
          changedEquip = true;
          b = await refineAwait(session, equipItemByUid(uid, session));
          skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
        }
        if (!skillOnly && !skillBtn && !npcBtn) {
          changedEquip = true;
          b = await refineAwait(session, equipItemByUid(uid, session));
          npcBtn = await readRefineDetail(b.table, uid, isNpcRefineButton, session);
        }

        let activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
        if ((!activeBtn || activeBtn.disabled) && autoWarehouse && material && material !== unavailableMaterial &&
            materialCount(b.s.inventory, material) === 0 &&
            ((skillBtn && b.s.character.sp >= 5) || (npcBtn && b.s.character.zeny >= step.price))) {
          unavailableMaterial = await replenishRefineMaterials(session, uid, curPlus, new Map([[material, 1]]), setStatus);
          b = await refineAwait(session, selectBagItemRow(uid, session));
          skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
          npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);
          activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
        }
        if (!activeBtn || activeBtn.disabled) throw Error(unavailableMaterial && unavailableMaterial === material
          ? `【${target.name}】倉庫沒有可領取的精煉材料` : skillOnly
          ? `【${target.name}】武器精練不可用，請確認技能等級、材料與 SP（至少 5）`
          : `【${target.name}】精煉按鈕不可用（礦石已用盡、Zeny/SP不足或不在主城）`);

        if (refStop || document.hidden) throw Error('已中止精煉');
        const useSkill = activeBtn === skillBtn;
        await waitForRefineCommandSlot(session);
        b = assertRefineTarget(session, uid);
        activeBtn = findNativeDetailBtn(b.table, uid, useSkill ? isWeaponRefineButton : isNpcRefineButton);
        const beforeMatQty = material ? materialCount(b.s.inventory, material) : 0;
        const beforeZeny = b.s.character.zeny, beforeSp = b.s.character.sp;
        setStatus(`🔨 衝裝中：【${target.name}】+${curPlus} ➔ +${curPlus + 1} (成功:${successCnt} 爆:${brokenCnt})`);

        const commandWatch = useSkill ? { characterId: session.characterId, uid, pending: 0, settled: 0, status: 0 } : null;
        let result;
        refineCommandWatch = commandWatch;
        try {
          const origConfirm = page.confirm;
          let userAccepted = true;
          const settleGate = { since: pageNet.settled, candidate: null };
          try {
            page.confirm = (msg) => {
              if (refSkipConfirm || /成功率 100%|一定成功/.test(String(msg))) return true;
              userAccepted = origConfirm.call(page, msg);
              return userAccepted;
            };
            if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
            clickRefineCommand(session, activeBtn, uid);
          } finally {
            page.confirm = origConfirm;
          }
          if (!userAccepted) throw Error('玩家手動取消精煉');

          result = await waitForRefineResult(session, uid, {
            root: b.host?.parentElement, curPlus, material, beforeMatQty, beforeZeny, beforeSp,
            useSkill, settleGate, commandWatch
          });
        } finally {
          refineCommandWatch = null;
        }
        if (!result) throw Error('精煉結果不明，請核對裝備與消耗');
        b = result.b;
        if (result.kind === 'success') {
          successCnt++;
          if (result.nowSt.refine >= limitPlus) {
            refSelected.delete(uid);
            if (autoWarehouse && result.nowSt.refine >= refTargetPlus && !refStop && !document.hidden) {
              const stBtn = await readRefineDetail(b.table, uid, (t) => /^存入倉庫|^存倉$/.test(t), session);
              if (stBtn && !stBtn.disabled) {
                await waitForRefineCommandSlot(session);
                clickRefineCommand(session, findNativeDetailBtn(b.table, uid, t => /^存入倉庫|^存倉$/.test(t)), uid);
                const stored = await waitForRefineUi(session, () => {
                  const live = assertRefineTarget(session, uid, true);
                  return live && !live.s.inventory.some(x => x.uid === uid);
                }, { root: b.host?.parentElement, timeout: 4000 });
                if (!stored) throw Error('存倉結果不明，請核對裝備');
              }
            }
          }
        } else {
          refSelected.delete(uid);
          if (result.kind === 'broken') brokenCnt++;
          else {
            failedCnt++;
            skipped.add(uid);
            setStatus(`⚠️ 【${target.name}】已確認消耗，精煉未升階，繼續下一件`);
          }
        }
        // A committed result (or the settled failure confirmation) is the boundary before the next item.

      }
      if (refStop) throw Error('已中止精煉');
      setStatus(`🎉 精煉完成！累計成功升階 ${successCnt} 次，損壞 ${brokenCnt} 件，未升階 ${failedCnt} 件，略過 ${skipped.size - failedCnt} 件。`);
      alertUser('🎉 背包精煉完成', `成功 ${successCnt} 次 / 損壞 ${brokenCnt} 件 / 未升階 ${failedCnt} 件`, false);
    } catch (e) {
      setStatus(`🛑 已停止：${e.message} (成功:${successCnt} 爆:${brokenCnt})`);
    } finally {
      if (changedEquip) {
        session.targetUid = null;
        session.restoring = true;
        const restoreOrder = [origEquip.weapon, ...Object.values(origEquip)];
        const failed = [];
        for (const uid of new Set(restoreOrder.filter(Boolean))) {
          try {
            assertRefineSession(session, true);
            b = readBackpackContext(true);
            if (b?.s.inventory.some((x) => x.uid === uid) && !Object.values(b.s.equipment || {}).includes(uid)) {
              await refineAwait(session, equipItemByUid(uid, session));
            }
          } catch {
            failed.push(uid);
            if (session.epoch !== refineIdentityEpoch ||
                readFiberForUi(() => refineActor(readBackpackContext(true))) !== session.characterId) break;
          }
        }
        if (failed.length) setStatus('⚠️ 有裝備未能穿回，請檢查人物裝備欄');
      }
      refBusy = false;
      refreshRefinePanel();
    }
  }

  function syncRefineSettings(container) {
    if (!container) return;
    const confirm = container.querySelector('[data-roi-ref-confirm]');
    const warehouse = container.querySelector('[data-roi-ref-warehouse]');
    const batch = container.querySelector('[data-roi-ref-batch]');
    confirm.checked = refSkipConfirm;
    const manualWarehouse = Boolean(refPanel?.hasAttribute('data-roi-ref-modern'));
    warehouse.checked = refAutoWh && !manualWarehouse;
    const warehouseHint = manualWarehouse ? '遊戲測試版介面請手動領料與存倉' : '';
    warehouse.title = batch.title = warehouseHint;
    if (batch !== document.activeElement) batch.value = refMaterialBatch;
    confirm.disabled = refBusy;
    warehouse.disabled = batch.disabled = refBusy || manualWarehouse;
  }

  function bindRefineSettings(container, status) {
    const confirm = container.querySelector('[data-roi-ref-confirm]');
    const warehouse = container.querySelector('[data-roi-ref-warehouse]');
    const batch = container.querySelector('[data-roi-ref-batch]');
    confirm.onchange = () => {
      if (!refBusy) refSkipConfirm = confirm.checked;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    };
    warehouse.onchange = () => {
      if (!refBusy) refAutoWh = warehouse.checked;
      syncRefineSettings(refPanel);
      syncRefineSettings(document.getElementById('pane-cfg'));
    };
    batch.onchange = () => {
      status.textContent = '';
      try {
        if (!refBusy) {
          const value = validateMaterialBatch(Number(batch.value));
          GM_setValue('roi-refine-material-batch-v1', value);
          refMaterialBatch = value;
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        batch.value = refMaterialBatch;
        syncRefineSettings(refPanel);
        syncRefineSettings(document.getElementById('pane-cfg'));
      }
    };
  }

  function refreshRefinePanel() {
    syncRefineSettings(document.getElementById('pane-cfg'));
    const b = readFiberForUi(() => readBackpackContext());
    if (b === undefined) return;
    if (!b) {
      if (refBusy && !visitingWarehouse) stopRefine();
      refPanel?.remove(); refPanel = null; return;
    }
    if (refPanel?.isConnected && refPanel.parentElement !== b.host) refPanel.remove();
    if (!refPanel?.isConnected) {
      refPanel = document.createElement('div');
      refPanel.dataset.roiRefineHelper = '';
      refPanel.toggleAttribute('data-roi-ref-modern', Boolean(b.modern));
      refPanel.className = 'xp-sunken p-2';
      refPanel.style.cssText = 'display:grid;gap:6px;margin-bottom:8px;border-left:3px solid #f59e0b;background:var(--roi-panel);border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      refPanel.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="xp-btn small" id="ref-toggle" style="font-weight:bold;color:var(--roi-warning);">🔨 展開精煉清單</button>
          <button type="button" class="xp-btn small" id="ref-sel-all">全選本頁裝備</button>
          <button type="button" class="xp-btn small" id="ref-sel-clr">取消全選</button>
          <label style="color:var(--roi-info);">模式：<select id="ref-mode" class="xp-input">
            <option value="round_robin">🔄 輪流齊頭衝 (+1輪流)</option>
            <option value="single_focus">🎯 單件直衝到底</option>
          </select></label>
          <label style="color:var(--roi-warning);font-weight:bold;">目標 +<input type="number" id="ref-target" class="xp-input" value="${refTargetPlus}" min="1" max="10" style="width:48px;"></label>
          <button type="button" class="xp-btn small" id="ref-run-safe" style="background:linear-gradient(135deg,#0369a1,#075581);color:#fff;border:none;">🛡️ 所選衝到安全值</button>
          <button type="button" class="xp-btn small" id="ref-run-target" style="background:linear-gradient(135deg,#a34f05,#854009);color:#fff;font-weight:bold;border:none;">🚀 啟動衝到目標 +N</button>
          <button type="button" class="xp-btn small" id="ref-run-skill" hidden>神工匠武器精練</button>
          <button type="button" class="xp-btn small" id="ref-stop" style="background:#dc2626;color:#fff;display:none;border:none;">⏹ 停止</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label><input type="checkbox" data-roi-ref-confirm> 精煉時略過確認窗</label>
          <label><input type="checkbox" data-roi-ref-warehouse> 自動領料及存倉</label>
          <label>每次領料 <input type="number" data-roi-ref-batch class="xp-input" min="1" max="1000" step="1" style="width:64px;"> 個</label>
        </div>
        <span data-roi-ref-settings-status role="status" style="color:var(--roi-warning);"></span>
        <div data-ref-categories role="group" aria-label="精煉裝備分類" style="display:none;gap:6px;flex-wrap:wrap;"></div>
        <div data-ref-list style="display:none;max-height:210px;overflow:auto;gap:4px;padding:6px;background:var(--roi-inset);border-radius:6px;border:1px solid var(--roi-edge);"></div>
        <div data-ref-status style="font-size:11.5px;color:var(--roi-success);">💡 支援 Ctrl / ⌘ 點擊勾選全部同名裝備；安全值後神工匠用技能，一般職業自動穿戴找忽克連並在結束後穿回原裝。</div>
      `;
      b.host.insertBefore(refPanel, b.anchor ?? b.table.closest('.xp-sunken') ?? b.table);
      if (b.modern) refPanel.insertBefore(element('small', '遊戲測試版介面請先手動領料，完成後也可手動存倉。', 'color:var(--roi-muted)'), refPanel.querySelector('[data-ref-list]'));
      bindRefineSettings(refPanel, refPanel.querySelector('[data-roi-ref-settings-status]'));

      const panel = refPanel;
      const loadRefineData = async () => {
        if (refinePack) return;
        const status = panel.querySelector('[data-ref-status]');
        status.textContent = '正在讀取遊戲精煉資料…';
        try {
          const pack = await loadLootPack();
          if (!pack.refine) throw Error('找不到精煉規則');
          refinePack = pack;
          status.textContent = '支援 Ctrl / ⌘ 點擊勾選全部同名裝備。';
          refreshRefinePanel();
        } catch {
          status.textContent = '無法讀取遊戲精煉資料，請重新展開清單重試。';
        }
      };
      void loadRefineData();
      refPanel.querySelector('#ref-toggle').onclick = () => {
        refOpen = !refOpen;
        if (refOpen) void loadRefineData();
        refreshRefinePanel();
      };
      const categories = refPanel.querySelector('[data-ref-categories]');
      for (const [category, label] of Object.entries(refineCategories)) {
        const button = element('button', label, '');
        button.type = 'button';
        button.className = 'xp-btn small';
        button.dataset.refCategory = category;
        button.onclick = () => { refCategory = category; refreshRefinePanel(); };
        categories.append(button);
      }
      refPanel.querySelector('#ref-sel-all').onclick = () => {
        if (refBusy) return;
        const backpack = readFiberForUi(() => readBackpackContext(true));
        if (backpack === undefined) return;
        if (backpack) refineRowsForPage(backpack.rows).forEach((r) => refSelected.add(r.uid));
        refOpen = true;
        refreshRefinePanel();
      };
      refPanel.querySelector('#ref-sel-clr').onclick = () => { if (!refBusy) { refSelected.clear(); refreshRefinePanel(); } };
      refPanel.querySelector('#ref-mode').value = refMode;
      refPanel.querySelector('#ref-mode').onchange = (e) => { refMode = e.target.value; };
      refPanel.querySelector('#ref-target').onchange = (e) => { refTargetPlus = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 6)); e.target.value = refTargetPlus; };
      refPanel.querySelector('#ref-run-safe').onclick = () => runHybridRefine('safe_only');
      refPanel.querySelector('#ref-run-target').onclick = () => runHybridRefine('to_target');
      refPanel.querySelector('#ref-run-skill').onclick = () => runHybridRefine('skill_only');
      refPanel.querySelector('#ref-stop').onclick = stopRefine;
    }

    if (refinePack && refSelected.size) {
      const eligible = new Set(b.s.inventory.filter(canRefine).map((stack) => stack.uid));
      for (const uid of refSelected) if (!eligible.has(uid)) refSelected.delete(uid);
    }
    refPanel.querySelector('#ref-toggle').textContent =
      `${refOpen ? '🔼 收合精煉清單' : '🔨 展開精煉清單'} (共選 ${refSelected.size} 件)`;
    for (const el of refPanel.querySelectorAll('#ref-mode,#ref-target')) el.disabled = refBusy;
    syncRefineSettings(refPanel);
    const skillButton = refPanel.querySelector('#ref-run-skill');
    const skillLevel = weaponRefineLevel(b.s);
    skillButton.hidden = skillLevel <= 0;
    skillButton.disabled = refBusy || !refinePack;
    skillButton.title = `使用武器精練技能，至多 +${skillLevel}`;
    refPanel.querySelector('#ref-stop').style.display = refBusy ? 'inline-block' : 'none';
    const listEl = refPanel.querySelector('[data-ref-list]');
    listEl.style.display = refOpen ? 'grid' : 'none';
    refPanel.querySelector('[data-ref-categories]').style.display = refOpen ? 'flex' : 'none';
    if (!refOpen) return;

    const available = new Set(b.rows.filter(isEligibleEquip).map((row) => refineCategory(refinePack.items.get(row.st.itemId))));
    if (!available.has(refCategory)) refCategory = 'all';
    for (const button of refPanel.querySelectorAll('[data-ref-category]')) {
      button.hidden = button.dataset.refCategory !== 'all' && !available.has(button.dataset.refCategory);
      const active = button.dataset.refCategory === refCategory;
      button.setAttribute('aria-pressed', String(active));
      button.style.color = active ? 'var(--roi-warning)' : '';
      button.style.borderColor = active ? 'var(--roi-warning)' : '';
    }
    const eqRows = refineRowsForPage(b.rows);
    const sig = JSON.stringify([!!refinePack, refCategory, refBusy, [...refSelected], eqRows.map((r) => [r.uid, r.st.refine])]);
    if (listEl.dataset.sig === sig) return;
    listEl.dataset.sig = sig;
    listEl.replaceChildren();
    if (refinePack && !eqRows.length) listEl.append(element('span', '沒有可精煉的裝備', 'color:var(--roi-muted)'));
    eqRows.forEach((r) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;border-bottom:1px dashed var(--roi-edge);';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.disabled = refBusy; cb.checked = refSelected.has(r.uid);
      cb.onclick = (e) => {
        const next = cb.checked;
        const targets = (e.ctrlKey || e.metaKey) ? eqRows.filter((x) => x.st.itemId === r.st.itemId) : [r];
        targets.forEach((x) => (next ? refSelected.add(x.uid) : refSelected.delete(x.uid)));
        refreshRefinePanel();
      };
      const slots = SLOTS_MAP.get(r.st.itemId) || 0;
      const img = element('img');
      img.src = `/client/item/${r.st.itemId}.png`; img.width = img.height = 20;
      const name = element('span', `+${r.st.refine || 0} ${r.name}${slots ? ` [${slots}]` : ''} `, `color:${r.st.refine ? 'var(--roi-info)' : 'var(--roi-text)'}`);
      applyRefineLevelColor(name, r.st.refine || 0);
      name.append(element('small', `(${SUB_LABELS[r.sub] || r.cat})`, 'color:var(--roi-muted)'));
      lbl.append(img, name);
      lbl.prepend(cb);
      listEl.appendChild(lbl);
    });
  }

  let mktView = false, mktAuto15s = false, mktAutoTimer = null;
  let mktListings = [], mktCrossMap = new Map(), mktPrevPrices = new Map(), mktKeyMap = new Map(), mktFilter = 'all', mktSub = 'all';
  let mktFavs = new Set(readValidatedSetting('roi-favorites-v1', validateFavorites, []));
  const mktPanel = document.createElement('fieldset');
  mktPanel.className = 'xp-group'; mktPanel.dataset.roiMarketBrowser = ''; mktPanel.style.cssText = 'grid-column:1/-1;min-width:0;'; mktPanel.hidden = true;

  const upperFoldBtn = document.createElement('button');
  upperFoldBtn.type = 'button'; upperFoldBtn.className = 'xp-btn small'; upperFoldBtn.dataset.roiUpperFold = ''; upperFoldBtn.style.marginLeft = '8px';
  upperFoldBtn.onclick = () => { state.mktUpperFold = !state.mktUpperFold; savePrefs(); syncMktMount(); };

  const tooltip = document.createElement('div');
  tooltip.id = 'roi-item-hover-tooltip';
  tooltip.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;width:320px;box-sizing:border-box;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #38bdf8;border-radius:10px;padding:11px 13px;box-shadow:0 12px 28px var(--roi-shadow);font-size:12px;line-height:1.45;contain:layout style;will-change:transform;';
  document.body.appendChild(tooltip);
  let hoverPoint = null;
  let tooltipVisible = false;
  let tooltipSize = null;
  let tooltipScrollable = false;
  let isScrollingPage = false;
  let scrollIdleTimer = null;
  let hoverRafId = 0;
  let pendingHoverEvent = null;

  function hideTooltip() {
    if (!tooltipVisible) return;
    tooltipVisible = false;
    tooltip.style.display = 'none';
    lastHoveredTarget = null;
  }

  function positionTooltip(recalcSize = false) {
    if (!hoverPoint || !tooltipVisible) return;
    if (recalcSize || !tooltipSize) {
      const rect = tooltip.getBoundingClientRect();
      tooltipSize = { width: rect.width, height: rect.height };
      tooltipScrollable = tooltip.scrollHeight > tooltip.clientHeight + 1;
      tooltip.style.pointerEvents = tooltipScrollable ? 'auto' : 'none';
    }
    const { x, y } = hoverPoint;
    const { width, height } = tooltipSize;
    const edge = 6;
    const place = (point, size, space) => {
      const after = point + 12;
      const preferred = after + size <= space - edge ? after : point - 12 - size;
      return Math.max(edge, Math.min(space - edge - size, preferred));
    };
    const left = Math.round(place(x, width, innerWidth));
    const top = Math.round(place(y, height, innerHeight));
    tooltip.style.transform = `translate3d(${left}px,${top}px,0)`;
  }

  function showTooltip(e) {
    hoverPoint = { x: e.clientX, y: e.clientY };
    if (!tooltipVisible) {
      tooltipVisible = true;
      tooltip.style.display = 'block';
    }
    if (tooltipScrollable) tooltip.scrollTop = 0;
    positionTooltip(true);
  }

  window.addEventListener('resize', () => {
    tooltipSize = null;
    positionTooltip(true);
  }, { passive: true });
  window.addEventListener('scroll', (e) => {
    if (tooltip.contains(e.target instanceof Node ? e.target : null)) return;
    isScrollingPage = true;
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => { isScrollingPage = false; }, 110);
    if (hoverRafId) { cancelAnimationFrame(hoverRafId); hoverRafId = 0; pendingHoverEvent = null; }
    hideTooltip();
  }, { capture: true, passive: true });

  const CAT_TABS = { all: '全部', favorites: '★ 收藏', card: '🃏 卡片', weapon: '🗡️ 武器', armor: '🛡️ 防具/飾品', consumable: '🧪 消耗品', material: '🪨 材料' };

  const descLinesCache = new Map();
  function formatItemDescLines(rawDesc, currentRefine = 0) {
    if (!rawDesc) return [];
    const cacheKey = `${currentRefine}|${Array.isArray(rawDesc) ? rawDesc.join('\n') : rawDesc}`;
    const cached = descLinesCache.get(cacheKey);
    if (cached) return cached;
    const chunks = Array.isArray(rawDesc)
      ? rawDesc.map((x) => clean(x))
      : String(rawDesc).split(/\r?\n|\s*｜\s*/).map((x) => clean(x));
    const lines = [];
    for (const chunk of chunks) {
      if (!chunk) continue;
      const parts = chunk.split(/(?=精煉\s*\+\s*\d+\s*[:：])/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const metaMatch = part.match(/^([^:：]+?,(?:武器等級|防禦力?|攻擊力?)[^:：]*?)(?:\s+((?:STR|AGI|VIT|INT|DEX|LUK|ATK|MATK|DEF|MDEF|HIT|FLEE|CRI|ASPD|HP|SP|MaxHP|MaxSP|精煉|對|受到|物理|魔法|技能|攻擊|施法|詠唱|移動|無視|不會|可使用|裝備).*))?$/i);
        if (metaMatch && !/^精煉\s*\+/.test(part)) {
          const baseSpec = metaMatch[1].split(',').map((s) => s.trim()).filter(Boolean).join(' ｜ ');
          if (baseSpec) lines.push({ text: baseSpec, type: 'meta' });
          if (metaMatch[2]) {
            const subEffects = metaMatch[2].split(/(?=(?:STR|AGI|VIT|INT|DEX|LUK|MaxHP|MaxSP|ATK|MATK|DEF|MDEF|HIT|FLEE|CRI|ASPD)\s*[+-]\s*\d+%?)/g).map((s) => s.trim()).filter(Boolean);
            for (const eff of subEffects) lines.push({ text: eff, type: 'effect' });
          }
          continue;
        }
        const refMatch = part.match(/^精煉\s*\+\s*(\d+)\s*[:：]\s*(.+)$/);
        if (refMatch) {
          const lvl = Number(refMatch[1]);
          const body = refMatch[2].trim();
          lines.push({
            text: `精煉 +${lvl}：${body}`,
            type: 'refine',
            refineLv: lvl,
            active: currentRefine > 0 && currentRefine >= lvl
          });
          continue;
        }
        lines.push({ text: part, type: 'effect' });
      }
    }
    if (descLinesCache.size > 600) descLinesCache.clear();
    descLinesCache.set(cacheKey, lines);
    return lines;
  }

  function renderDescBlock(container, rawDesc, currentRefine = 0, baseColor = 'var(--roi-text)', fontSize = '11px') {
    const items = formatItemDescLines(rawDesc, currentRefine);
    if (!items.length) return;
    const list = element('div', null, `display:flex;flex-direction:column;gap:3px;font-size:${fontSize};line-height:1.45;`);
    for (const item of items) {
      if (item.type === 'meta') {
        const metaEl = element('div', `📋 ${item.text}`, 'color:var(--roi-info);font-size:10.5px;padding-bottom:3px;margin-bottom:1px;border-bottom:1px dashed rgba(148,163,184,0.2);');
        list.append(metaEl);
      } else if (item.type === 'refine') {
        const isCur = currentRefine > 0 && currentRefine === item.refineLv;
        const row = element(
          'div',
          `${isCur ? '▶ ' : '• '}${item.text}`,
          isCur
            ? 'color:var(--roi-warning);font-weight:bold;background:rgba(250,204,21,0.14);padding:2px 6px;border-radius:4px;border-left:2px solid #facc15;'
            : item.active
              ? 'color:var(--roi-success);padding-left:4px;'
              : 'color:var(--roi-muted);padding-left:4px;'
        );
        list.append(row);
      } else {
        list.append(element('div', `• ${item.text}`, `color:${baseColor};padding-left:2px;`));
      }
    }
    container.append(list);
  }

  function resolveItemMeta(numId) {
    const dbInfo = ITEM_DETAIL_DB.get(numId) || {};
    const packItem = PACK_ITEMS_MAP?.get(numId);
    if (!packItem) return dbInfo;
    const rawDesc = packItem.description ?? packItem.effect ?? packItem.desc ?? '';
    const descText = Array.isArray(rawDesc) ? rawDesc.map(clean).filter(Boolean).join('\n') : clean(rawDesc);
    const slotCount = Array.isArray(packItem.slots)
      ? (typeof packItem.cardSlots === 'number' ? packItem.cardSlots : undefined)
      : (typeof packItem.slots === 'number' ? packItem.slots : packItem.cardSlots);
    return {
      name: dbInfo.name || (packItem.name ? clean(packItem.name) : undefined),
      atk: dbInfo.atk ?? (packItem.atk != null ? Number(packItem.atk) : undefined),
      matk: dbInfo.matk ?? (packItem.matk != null ? Number(packItem.matk) : undefined),
      def: dbInfo.def ?? (packItem.def != null ? Number(packItem.def) : undefined),
      mdef: dbInfo.mdef ?? (packItem.mdef != null ? Number(packItem.mdef) : undefined),
      wLv: dbInfo.wLv ?? (packItem.weaponLevel != null ? Number(packItem.weaponLevel) : undefined),
      weight: dbInfo.weight ?? (packItem.weight != null ? Number(packItem.weight) : undefined),
      reqLv: dbInfo.reqLv ?? (packItem.equipLevel ?? packItem.requiredLevel),
      cardSlots: slotCount,
      desc: descText || (!isPollutedDesc(dbInfo.desc) ? dbInfo.desc : undefined)
    };
  }

  function populateRichTooltip(data) {
    ensurePackItemsLoaded();
    const numId = Number(data.id);
    const { cat, sub } = classifyItem(numId, data.base || '');
    const dbInfo = resolveItemMeta(numId);
    const slots = data.slots ?? dbInfo.cardSlots ?? SLOTS_MAP.get(numId) ?? 0;
    const cards = (data.cards || []).filter(Boolean);
    const nodes = [];

    const hasCards = cards.length > 0;
    const isRefined = (data.refine || 0) > 0;
    tooltip.style.borderColor = hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : 'rgba(56,189,248,0.75)';
    const header = element('div', null, 'display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(148,163,184,0.28);padding-bottom:8px;margin-bottom:8px;');
    const iconWrap = element('div', null, `position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--roi-panel);border-radius:8px;border:1px solid ${hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : '#334155'};flex-shrink:0;`);
    const icon = element('img', null, 'width:26px;height:26px;object-fit:contain;');
    icon.src = `/client/item/${numId}.png`;
    iconWrap.append(icon);
    const titleBox = element('div', null, 'min-width:0;flex:1;');
    const titleLine = element('div', data.name || data.base || dbInfo.name || `道具 #${numId}`, `font-weight:bold;font-size:13.5px;color:${hasCards ? 'var(--roi-warning)' : isRefined ? 'var(--roi-info)' : 'var(--roi-text)'};line-height:1.3;`);
    titleLine.append(element('small', ` #${numId}`, 'color:var(--roi-muted);font-weight:normal;'));
    const subLine = element('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11px;color:var(--roi-muted);margin-top:2px;');
    const typePill = element('span', SUB_LABELS[sub] || CAT_TABS[cat] || cat, 'background:rgba(245,158,11,0.16);color:var(--roi-warning);border:1px solid rgba(245,158,11,0.35);padding:0 5px;border-radius:4px;font-weight:bold;');
    subLine.append(typePill);
    const wLv = dbInfo.wLv || (cat === 'weapon' ? WLV_MAP.get(numId) : null);
    if (wLv) subLine.append(element('span', `Lv.${wLv}武器`, 'color:var(--roi-text);'));
    if (dbInfo.reqLv) subLine.append(element('span', `需求Lv.${dbInfo.reqLv}`, 'color:var(--roi-muted);'));
    if (dbInfo.weight != null) subLine.append(element('span', `重量 ${dbInfo.weight}`, 'color:var(--roi-muted);'));
    titleBox.append(titleLine, subLine);
    header.append(iconWrap, titleBox);
    nodes.push(header);

    if (dbInfo.atk || dbInfo.matk || dbInfo.def || dbInfo.mdef || dbInfo.desc || data.rawSpecText) {
      const statBox = element('div', null, 'background:var(--roi-panel);padding:7px 9px;border-radius:7px;margin-bottom:7px;border:1px solid var(--roi-edge);font-size:11.5px;');
      const statParts = [
        dbInfo.atk ? `⚔️ ATK ${dbInfo.atk}` : '',
        dbInfo.matk ? `🔮 MATK ${dbInfo.matk}` : '',
        dbInfo.def ? `🛡️ DEF ${dbInfo.def}` : '',
        dbInfo.mdef ? `✨ MDEF ${dbInfo.mdef}` : ''
      ].filter(Boolean);
      if (statParts.length) statBox.append(element('div', statParts.join(' ｜ '), 'color:var(--roi-text);font-weight:bold;margin-bottom:5px;'));
      if (dbInfo.desc) renderDescBlock(statBox, dbInfo.desc, Number(data.refine) || 0, 'var(--roi-text)', '11px');
      if (data.rawSpecText) statBox.append(element('div', `✨ ${data.rawSpecText}`, 'color:var(--roi-success);font-size:11px;margin-top:4px;padding-top:3px;border-top:1px dashed rgba(148,163,184,0.2);'));
      nodes.push(statBox);
    }

    const maxSlots = Math.max(slots, cards.length);
    if (maxSlots > 0 && data.cardsKnown === false) {
      nodes.push(element('div', `💎 插槽 ${maxSlots} 洞（目前清單未提供插卡明細）`, 'font-size:11px;color:var(--roi-info);margin-bottom:6px;'));
    }
    if (maxSlots > 0 && data.cardsKnown !== false) {
      const cardBox = element('div', null, 'background:var(--roi-panel);padding:7px 9px;border-radius:7px;border:1px solid rgba(250,204,21,0.35);margin-bottom:7px;');
      const cardHeader = element('div', null, 'display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--roi-warning);margin-bottom:5px;font-weight:bold;');
      cardHeader.append(
        element('span', `💎 卡片插槽 (${cards.length} / ${maxSlots})`),
        element('span', cards.length ? '已插卡強化' : '尚未插卡', `font-size:10px;padding:1px 5px;border-radius:4px;background:${cards.length ? 'rgba(250,204,21,0.18)' : 'rgba(100,116,139,0.2)'};color:${cards.length ? 'var(--roi-warning)' : 'var(--roi-muted)'};`)
      );
      cardBox.append(cardHeader);
      for (let idx = 0; idx < maxSlots; idx++) {
        const cid = cards[idx];
        if (cid) {
          const cInfo = resolveItemMeta(cid);
          const cName = cInfo.name || ITEM_NAME_CACHE.get(cid) || `卡片 #${cid}`;
          const cRow = element('div', null, `display:flex;align-items:flex-start;gap:6px;padding:4px 0;${idx ? 'border-top:1px dashed #334155;' : ''}`);
          const cIcon = element('img', null, 'width:18px;height:18px;object-fit:contain;margin-top:1px;flex-shrink:0;');
          cIcon.src = `/client/item/${cid}.png`;
          const cDetail = element('div', null, 'flex:1;min-width:0;');
          const cTitle = element('div', cName, 'font-weight:bold;color:var(--roi-warning);font-size:11.5px;');
          cDetail.append(cTitle);
          if (cInfo.desc) {
            const cDescWrap = element('div', null, 'margin-top:2px;');
            renderDescBlock(cDescWrap, cInfo.desc, 0, 'var(--roi-success)', '10.5px');
            cDetail.append(cDescWrap);
          } else {
            cDetail.append(element('div', '（卡片效果說明尚未載入）', 'color:var(--roi-muted);font-size:10px;margin-top:1px;'));
          }
          cRow.append(cIcon, cDetail);
          cardBox.append(cRow);
        } else {
          const emptyRow = element('div', null, `display:flex;align-items:center;gap:6px;padding:3px 0;color:var(--roi-muted);font-size:11px;${idx ? 'border-top:1px dashed var(--roi-edge);' : ''}`);
          emptyRow.append(element('span', '◇', 'color:var(--roi-muted);'), element('span', `空插槽 [${idx + 1}]（未插卡）`));
          cardBox.append(emptyRow);
        }
      }
      nodes.push(cardBox);
    }

    if (data.price) {
      const foot = element('div', null, 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);font-size:11px;color:var(--roi-muted);');
      const sellerText = `🏪 ${data.seller || '露天攤位'}${data.city ? ` (${TOWN_NAMES[data.city] || data.city})` : ''}`;
      const priceText = data.qty && data.qty > 1
        ? `單價 ${data.price.toLocaleString()} Z × ${data.qty} = ${(data.price * data.qty).toLocaleString()} Z`
        : `售價 ${data.price.toLocaleString()} Z`;
      foot.append(
        element('span', sellerText, 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
        element('b', priceText, 'color:var(--roi-success);white-space:nowrap;')
      );
      nodes.push(foot);
    }

    tooltip.replaceChildren(...nodes);
  }

  mktPanel.innerHTML = `
    <legend class="legend" id="roi-mkt-leg">🏪 攤位分類檢視 </legend>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
      <button type="button" id="roi-mkt-auto" class="xp-btn small" style="background:linear-gradient(135deg,#16763a,#136039);color:#fff;font-weight:bold;border:none;">▶️ 啟動 15s 自動整理</button>
      <input type="text" id="roi-mkt-q" class="xp-input" placeholder="篩選商品/插卡 (或跨城補查字)..." style="min-width:175px;">
      <select id="roi-mkt-sort" class="xp-input"><option value="asc">價低➔高</option><option value="desc">價高➔低</option><option value="name">名稱</option></select>
      <label><input type="checkbox" id="roi-mkt-min" checked> 同規格最低</label>
      <button type="button" id="roi-mkt-cross" class="xp-btn small" style="background:linear-gradient(135deg,#0369a1,#075581);color:#fff;font-weight:bold;border:none;">🛰️ 立即跨城補查</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px;">
      <div id="roi-mkt-tabs" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      <label id="roi-mkt-sub-wrap" style="display:none;color:var(--roi-warning);font-weight:bold;">細分類：<select id="roi-mkt-sub" class="xp-input"></select></label>
    </div>
    <div id="roi-mkt-status" style="font-size:11px;color:var(--roi-info);margin-bottom:5px;">目前城鎮攤位快照｜指到裝備可看精煉加成與插卡詳情，點 🔍 可切回原生購買</div>
    <div id="roi-mkt-rows" style="max-height:60vh;overflow:auto;border:1px solid var(--roi-edge);border-radius:6px;background:var(--roi-surface);color:var(--roi-text);"></div>
  `;

  const mktTabsBox = mktPanel.querySelector('#roi-mkt-tabs'), mktSubWrap = mktPanel.querySelector('#roi-mkt-sub-wrap'), mktSubSel = mktPanel.querySelector('#roi-mkt-sub'), mktRowsBox = mktPanel.querySelector('#roi-mkt-rows'), mktAutoBtn = mktPanel.querySelector('#roi-mkt-auto');
  for (const [cid, cname] of Object.entries(CAT_TABS)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'xp-btn small'; b.dataset.cid = cid; b.textContent = cname;
    b.onclick = () => { mktFilter = cid; mktSub = 'all'; renderMkt(); };
    mktTabsBox.appendChild(b);
  }
  mktSubSel.onchange = () => { mktSub = mktSubSel.value; renderMkt(); };
  mktPanel.querySelector('#roi-mkt-q').oninput = () => renderMkt();
  mktPanel.querySelector('#roi-mkt-sort').onchange = () => renderMkt();
  mktPanel.querySelector('#roi-mkt-min').onchange = () => renderMkt();

  const DEFAULT_429_COOLDOWN_MS = 30000;
  let crossRequest = 0;
  let crossBusy = false;
  let crossAbortCtrl = null;
  let crossCooldownUntil = 0;
  let mktAutoGeneration = 0;

  function parseRetryAfterMs(headerVal, now = Date.now()) {
    if (!headerVal) return DEFAULT_429_COOLDOWN_MS;
    const raw = String(headerVal).trim();
    if (!raw) return DEFAULT_429_COOLDOWN_MS;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
      const sec = Number(raw);
      if (Number.isFinite(sec) && sec > 0) return Math.min(3600000, Math.max(1000, Math.round(sec * 1000)));
    }
    const parsedDate = Date.parse(raw);
    if (Number.isFinite(parsedDate) && parsedDate > now) {
      return Math.min(3600000, Math.max(1000, parsedDate - now));
    }
    return DEFAULT_429_COOLDOWN_MS;
  }

  function isCrossRequestCurrent(request, controller) {
    return request === crossRequest && crossAbortCtrl === controller && !controller.signal.aborted && mktPanel.isConnected && !mktPanel.hidden;
  }

  async function doCrossSearch(kw, automatic = false) {
    const st = mktPanel.querySelector('#roi-mkt-status');
    if (!kw || (automatic && crossBusy)) return false;
    const nowBefore = Date.now();
    if (nowBefore < crossCooldownUntil) {
      const remSec = Math.max(1, Math.ceil((crossCooldownUntil - nowBefore) / 1000));
      if (!automatic && st) st.textContent = `⏳ 跨城查價冷卻中（剩餘約 ${remSec} 秒），請稍後再試`;
      return false;
    }
    crossAbortCtrl?.abort();
    const controller = new AbortController();
    crossAbortCtrl = controller;
    const request = ++crossRequest;
    crossBusy = true;
    if (st) st.textContent = `🛰️ 正在跨城補查「${kw}」...`;
    try {
      const r = await fetch('/api/vending?q=' + encodeURIComponent(kw), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!isCrossRequestCurrent(request, controller)) return false;
      if (r.status === 429) {
        const retryMs = parseRetryAfterMs(r.headers?.get?.('Retry-After'));
        crossCooldownUntil = Date.now() + retryMs;
        const sec = Math.max(1, Math.round(retryMs / 1000));
        stopMktAuto(`HTTP 429：冷卻 ${sec} 秒，自動整理已停止`);
        if (st) st.textContent = `🔴 HTTP 429：冷卻 ${sec} 秒，自動整理已停止`;
        return false;
      }
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!isCrossRequestCurrent(request, controller)) return false;
      const now = Date.now();
      for (const item of parseShopData(d.shops || [], '', null, now, 'cross')) mktCrossMap.set(item.key, item);
      rebuildPriceEvidence();
      refreshWarehouse();
      if (st) st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 跨城補查「${kw}」完成！累計跨城快照 ${mktCrossMap.size} 筆`;
      renderMkt();
      return true;
    } catch (e) {
      if (e?.name !== 'AbortError' && isCrossRequestCurrent(request, controller) && st) {
        st.textContent = '⚠️ 補查失敗：' + e.message;
      }
      return false;
    } finally {
      if (crossAbortCtrl === controller) {
        crossAbortCtrl = null;
        crossBusy = false;
      }
    }
  }

  mktPanel.querySelector('#roi-mkt-cross').onclick = () => {
    const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
    if (!kw) return alert('請在搜尋框輸入關鍵字（或先選擇卡片總類或武器／防具細分類）再點跨城補查！');
    void doCrossSearch(kw);
  };

  async function mktAutoTick() {
    const generation = mktAutoGeneration;
    const isCurrent = () => generation === mktAutoGeneration && mktAuto15s && mktView
      && !document.hidden && mktPanel.isConnected && !mktPanel.hidden;
    if (!isCurrent() || Date.now() < crossCooldownUntil) return;
    const runTask = async () => {
      if (!isCurrent() || Date.now() < crossCooldownUntil) return;
      const cf = findCityVendingFieldset();
      if (!cf) {
        stopMktAuto('已離開攤位頁');
        return;
      }
      const refBtn = [...cf.querySelectorAll('button')].find((b) => clean(b.textContent) === '重新整理' && !b.disabled);
      const st = mktPanel.querySelector('#roi-mkt-status');
      if (refBtn) {
        refBtn.click();
        if (st) st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 已觸發 15 秒原生重新整理...`;
        await sleep(TIMING.marketSnapshotWait);
        if (!isCurrent() || findCityVendingFieldset() !== cf) return;
        const p = readFiberForUi(() => getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId));
        if (p === undefined) return;
        if (updateLocalListings(p)) renderMkt();
      }
      const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
      if (kw && mktAuto15s && Date.now() >= crossCooldownUntil) {
        await sleep(TIMING.marketCrossSearchGap);
        if (isCurrent() && findCityVendingFieldset() === cf && Date.now() >= crossCooldownUntil) {
          await doCrossSearch(kw, true);
        }
      }
    };
    if (navigator.locks?.request) {
      await navigator.locks.request('roi-lean-market-lock', { ifAvailable: true }, async (lock) => {
        if (!isCurrent()) return;
        if (!lock) {
          const st = mktPanel.querySelector('#roi-mkt-status');
          if (st) st.textContent = '⏸️ 另一分頁正在整理攤位，本分頁自動禮讓防 429';
          return;
        }
        await runTask();
      });
    } else {
      await runTask();
    }
  }

  function startMktAuto() {
    if (Date.now() < crossCooldownUntil) {
      const remSec = Math.max(1, Math.ceil((crossCooldownUntil - Date.now()) / 1000));
      const st = mktPanel.querySelector('#roi-mkt-status');
      if (st) st.textContent = `⏳ 跨城查價冷卻中（剩餘約 ${remSec} 秒），請稍後再啟動`;
      return;
    }
    ++mktAutoGeneration;
    mktAuto15s = true;
    mktAutoBtn.textContent = '⏹ 停止 15s 自動整理';
    mktAutoBtn.style.background = '#dc2626';
    clearInterval(mktAutoTimer);
    void mktAutoTick();
    mktAutoTimer = setInterval(() => { void mktAutoTick(); }, TIMING.marketRefresh);
  }

  function stopMktAuto(reason = '') {
    ++mktAutoGeneration;
    mktAuto15s = false;
    clearInterval(mktAutoTimer);
    mktAutoTimer = null;
    if (crossAbortCtrl) {
      try { crossAbortCtrl.abort(); } catch { log("market", "無法取消補查"); }
      crossAbortCtrl = null;
    }
    crossBusy = false;
    ++crossRequest;
    mktAutoBtn.textContent = '▶️ 啟動 15s 自動整理';
    mktAutoBtn.style.background = 'linear-gradient(135deg,#16763a,#136039)';
    if (reason && mktPanel.querySelector('#roi-mkt-status')) mktPanel.querySelector('#roi-mkt-status').textContent = `🔴 ${reason}`;
  }
  mktAutoBtn.onclick = () => (mktAuto15s ? stopMktAuto('已手動停止 15s 自動整理') : startMktAuto());

  function parseShopData(shops, defaultCity, selfId, seenTime = Date.now(), srcType = 'local') {
    const out = [];
    for (const s of shops) {
      if (!s?.items || (selfId != null && String(s.vendorId) === String(selfId))) continue;
      for (const i of s.items) {
        if (!i.qty || !i.price) continue;
        const base = clean(i.name) || `道具 #${i.itemId}`;
        const { cat, sub } = classifyItem(i.itemId, base);
        const slots = i.slots ?? SLOTS_MAP.get(i.itemId) ?? 0;
        const cards = (i.cards || []).filter(Boolean);
        if (i.atk || i.def || i.matk || i.weaponLevel || i.description) {
          recordItemDetail(i.itemId, {
            ...(i.atk ? { atk: Number(i.atk) } : {}),
            ...(i.matk ? { matk: Number(i.matk) } : {}),
            ...(i.def ? { def: Number(i.def) } : {}),
            ...(i.weaponLevel ? { wLv: Number(i.weaponLevel) } : {}),
            ...(i.description ? { desc: clean(i.description) } : {})
          });
        }
        const extraTags = [
          i.forged ? '鍛造武器' : '',
          i.element ? `屬性:${i.element}` : '',
          i.starCrumbs ? `星星角×${i.starCrumbs}` : '',
          i.options ? (Array.isArray(i.options) ? i.options.join('、') : String(i.options)) : ''
        ].filter(Boolean).join(' ｜ ');

        const cNames = cards.map((c) => ITEM_NAME_CACHE.get(c) || `卡片#${c}`);
        const full = `${i.refine ? '+' + i.refine + ' ' : ''}${base}${slots ? ` [${slots}]` : ''}${cNames.length ? ` (${cNames.join('、')})` : ''}`;
        const spec = `${i.refine || 0}|${slots}|${cards.join(',')}`;
        const key = `${s.vendorId}|${i.cartUid}|${i.itemId}|${spec}`;
        const oldPrice = mktPrevPrices.get(key);
        const changeTag = oldPrice === undefined ? '' : oldPrice !== i.price ? ` (原 ${oldPrice.toLocaleString()})` : '';
        mktPrevPrices.delete(key);
        mktPrevPrices.set(key, i.price);
        if (mktPrevPrices.size > 20000) mktPrevPrices.delete(mktPrevPrices.keys().next().value);
        out.push({
          id: i.itemId, refine: i.refine || 0, slots, cards, cNames, base, name: full, lower: full.toLowerCase(),
          cat, sub, price: i.price, qty: i.qty, seller: clean(s.vendorName) || `#${s.vendorId}`,
          city: s.mapId || defaultCity, seen: seenTime, source: srcType, changeTag, rawSpecText: extraTags,
          vendorId: s.vendorId, protectionSpec: i.refine || cards.length || i.forged || i.unidentified || i.broken ? null : protectionSpec(i),
          specKey: `${i.itemId}|${spec}`, key
        });
      }
    }
    return out;
  }

  let marketExpiryTimer = null;
  let localSnapshot = null;
  function updateLocalListings(p) {
    if (!p) return false;
    const city = p.snap.mapId;
    if (localSnapshot?.shops === p.shops && localSnapshot.city === city && localSnapshot.selfId === p.selfId) return false;
    mktListings = parseShopData(p.shops, city, p.selfId, Date.now(), 'local');
    rebuildPriceEvidence();
    localSnapshot = { shops: p.shops, city, selfId: p.selfId };
    return true;
  }

  function renderMkt() {
    if (mktPanel.hidden) return;
    const allMap = new Map();
    clearTimeout(marketExpiryTimer);
    let expires = Infinity;
    mktListings.forEach((x) => allMap.set(x.key, x));
    mktCrossMap.forEach((x, k) => { if (Date.now() - x.seen >= 1800000) mktCrossMap.delete(k);
      else {
        expires = Math.min(expires, x.seen + 1800000);
        if (!allMap.has(k) || allMap.get(k).seen < x.seen) allMap.set(k, x);
      }
    });
    if (Number.isFinite(expires)) marketExpiryTimer = setTimeout(renderMkt, Math.max(1, expires - Date.now()));
    mktKeyMap = allMap;
    let pool = [...allMap.values()];
    if (mktPanel.querySelector('#roi-mkt-min').checked) {
      const best = new Map();
      pool.forEach((r) => { if (!best.has(r.specKey) || r.price < best.get(r.specKey).price) best.set(r.specKey, r); });
      pool = [...best.values()];
    }
    const counts = { all: pool.length, favorites: pool.filter((r) => mktFavs.has(r.id)).length }, subCounts = {};
    pool.forEach((r) => { counts[r.cat] = (counts[r.cat] || 0) + 1; if (r.cat === mktFilter) subCounts[r.sub] = (subCounts[r.sub] || 0) + 1; });
    [...mktTabsBox.children].forEach((b) => {
      const cid = b.dataset.cid; b.textContent = `${CAT_TABS[cid]} (${counts[cid] || 0})`;
      b.style.outline = mktFilter === cid ? '2px solid #38bdf8' : '';
    });
    const opts = CAT_SUBS[mktFilter];
    const isDetail = Boolean(opts);
    mktSubWrap.style.display = isDetail ? 'inline-flex' : 'none';
    if (isDetail) {
      if (mktSub !== 'all' && !opts.includes(mktSub)) mktSub = 'all';
      mktSubSel.innerHTML = [`<option value="all">全部 (${counts[mktFilter] || 0})</option>`, ...opts.map((k) => `<option value="${k}">${SUB_LABELS[k]} (${subCounts[k] || 0})</option>`)].join('');
      mktSubSel.value = mktSub;
    }
    const q = mktPanel.querySelector('#roi-mkt-q').value.trim().toLowerCase(), sm = mktPanel.querySelector('#roi-mkt-sort').value;
    const shown = pool.filter((r) => (mktFilter === 'all' || (mktFilter === 'favorites' ? mktFavs.has(r.id) : r.cat === mktFilter)) && (!isDetail || mktSub === 'all' || r.sub === mktSub) && (!q || r.lower.includes(q)))
      .sort((a, b) => Number(mktFavs.has(b.id)) - Number(mktFavs.has(a.id)) || (sm === 'asc' ? a.price - b.price : sm === 'desc' ? b.price - a.price : zhCollator.compare(a.name, b.name)));

    const rows = shown.slice(0, 120).map((r) => {
      const age = Math.floor((Date.now() - r.seen) / 60000);
      const src = r.source === 'cross' ? `·補查${age < 1 ? '剛剛' : age + '分前'}` : '';
      const row = element('div', null, 'display:grid;grid-template-columns:minmax(240px,1fr) 165px 55px 140px;gap:6px;padding:6px 10px;border-bottom:1px solid var(--roi-edge)55;align-items:center;font-size:12px');
      row.className = 'roi-mkt-row';
      row.dataset.rkey = r.key;
      const item = element('span', null, 'display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:wrap');
      const fav = element('button', mktFavs.has(r.id) ? '★' : '☆', mktFavs.has(r.id) ? 'color:var(--roi-warning)' : '');
      fav.type = 'button'; fav.className = 'xp-btn small'; fav.dataset.act = 'fav';
      const img = element('img', null, 'width:21px;height:21px;object-fit:contain');
      img.src = `/client/item/${r.id}.png`; img.loading = 'lazy';
      const clip = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const name = element('span', r.name, `${clip};font-weight:${r.refine || r.cards.length ? 'bold' : 'normal'};color:${r.cards.length ? 'var(--roi-warning)' : r.refine ? 'var(--roi-info)' : 'inherit'}`);
      item.append(fav, img, name);
      if (r.changeTag) item.append(element('small', r.changeTag, 'color:var(--roi-warning)'));
      const price = element('span', null, 'text-align:right;white-space:nowrap');
      const money = element('span', r.price.toLocaleString() + ' Z', getMoneyColorVars(r.price));
      money.className = 'roi-mc-text';
      const find = element('button', '🔍', 'margin-left:4px');
      find.type = 'button'; find.className = 'xp-btn small'; find.dataset.act = 'find'; find.title = '切回原生攤位定位購買 / 跨城搜尋';
      price.append(money, find);
      const seller = element('span', r.seller, clip);
      seller.append(element('small', ` (${TOWN_NAMES[r.city] || r.city}${src})`, 'color:var(--roi-info)'));
      row.append(item, price, element('span', '剩 ' + r.qty, 'text-align:right'), seller);
      return row;
    });
    mktRowsBox.replaceChildren(...(rows.length ? rows : [element('div', '無符合商品', 'padding:16px;text-align:center;color:var(--roi-muted)')]));
  }

  let lastHoveredTarget = null;
  let marketLookupCache = null;
  let marketLookupRef = null;
  function getMarketLookup() {
    if (marketLookupCache && marketLookupRef?.listings === mktListings && marketLookupRef?.crossSize === mktCrossMap.size) {
      return marketLookupCache;
    }
    const map = new Map();
    const pushItem = (item) => {
      const k = `${item.id}|${item.refine}|${Number(item.price)}`;
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(item);
    };
    for (const item of mktListings) pushItem(item);
    for (const item of mktCrossMap.values()) pushItem(item);
    marketLookupCache = map;
    marketLookupRef = { listings: mktListings, crossSize: mktCrossMap.size };
    return map;
  }

  function processHoverEvent(e) {
    if (isScrollingPage) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (tooltip.contains(target)) return;

    const mktRow = target.closest('[data-rkey]');
    if (mktRow) {
      if (!state.marketHover) return hideTooltip();
      if (lastHoveredTarget === mktRow && tooltipVisible) {
        hoverPoint = { x: e.clientX, y: e.clientY };
        positionTooltip(false);
        return;
      }
      const r = mktKeyMap.get(mktRow.dataset.rkey);
      if (r) {
        lastHoveredTarget = mktRow;
        populateRichTooltip(r);
        showTooltip(e);
        return;
      }
    }

    const natRow = target.closest('[data-ro-hover-id]');
    if (natRow && (target.closest('img, button[aria-label$="的物品資訊"], a, td') || natRow.closest('table.roi-market-table'))) {
      if ((!state.itemHover || !state.marketHover) && !(isStallContext(natRow) ? state.marketHover : state.itemHover)) return hideTooltip();
      if (lastHoveredTarget === natRow && tooltipVisible) {
        hoverPoint = { x: e.clientX, y: e.clientY };
        positionTooltip(false);
        return;
      }
      lastHoveredTarget = natRow;
      const id = Number(natRow.dataset.roHoverId);
      const refine = Number(natRow.dataset.roHoverRefine) || 0;
      const cards = natRow.dataset.roHoverCards ? natRow.dataset.roHoverCards.split(',').map(Number).filter(Boolean) : [];
      const rawName = natRow.dataset.roHoverName || ITEM_NAME_CACHE.get(id) || `道具 #${id}`;
      const priceCell = natRow.querySelector('[data-roi-market-col="price"]');
      const priceText = priceCell ? clean(roiPriceText(priceCell)) : '';
      const priceMatch = priceText.match(amtRx);
      const price = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : undefined;
      const cardsKnown = natRow.dataset.roHoverCards !== undefined;

      const stack = readNearbyItemStack(natRow, id, refine);
      const stackCards = Array.isArray(stack?.cards) ? stack.cards.filter(Boolean) : null;

      let matches = [];
      if (price !== undefined && (natRow.closest('table.roi-market-table') || isStallContext(natRow))) {
        const candidates = getMarketLookup().get(`${id}|${refine}|${price}`) || [];
        if (candidates.length > 1) {
          const stripped = rawName.replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\].*$/, '').trim();
          const names = candidates.filter((item) => clean(item.name) === rawName || clean(item.base) === stripped);
          matches = names.length ? names : candidates;
        } else {
          matches = candidates;
        }
      }
      const listing = matches[0];
      const consistent = Boolean(listing && (matches.length === 1 || matches.every((item) => item.specKey === listing.specKey)));

      const finalCards = stackCards ?? (cardsKnown ? cards : consistent ? listing.cards : []);
      const finalCardsKnown = stackCards !== null || cardsKnown || consistent;
      const finalSlots = stack?.slots ?? (matches.length && (matches.length === 1 || matches.every((item) => item.slots === listing.slots)) ? listing.slots : undefined);
      const extraTags = stack ? [
        stack.forged ? '鍛造武器' : '',
        stack.element ? `屬性:${stack.element}` : '',
        stack.starCrumbs ? `星星角×${stack.starCrumbs}` : '',
        stack.options ? (Array.isArray(stack.options) ? stack.options.join('、') : String(stack.options)) : ''
      ].filter(Boolean).join(' ｜ ') : (consistent ? listing?.rawSpecText : '');

      populateRichTooltip({
        id,
        refine,
        price,
        qty: consistent ? listing?.qty : undefined,
        seller: consistent ? listing?.seller : undefined,
        city: consistent ? listing?.city : undefined,
        name: rawName,
        base: rawName.replace(/^\+\s*\d+\s*/, ''),
        slots: finalSlots,
        cards: finalCards,
        cardsKnown: finalCardsKnown,
        rawSpecText: extraTags
      });
      showTooltip(e);
      return;
    }
    hideTooltip();
  }

  document.addEventListener('mouseover', (e) => {
    if (isScrollingPage) return;
    pendingHoverEvent = e;
    if (hoverRafId) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = 0;
      const ev = pendingHoverEvent;
      pendingHoverEvent = null;
      if (ev) processHoverEvent(ev);
    });
  }, { passive: true });

  mktRowsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const r = mktKeyMap.get(btn.closest('[data-rkey]')?.dataset.rkey); if (!r) return;
    if (btn.dataset.act === 'fav') {
      const adding = !mktFavs.has(r.id);
      try {
        mktFavs = new Set(updateStoredValue('roi-favorites-v1', validateFavorites, [...mktFavs], (latest) => {
          const next = new Set(latest);
          if (adding) next.add(r.id); else next.delete(r.id);
          return [...next];
        }));
      } catch (error) { log('market', '收藏儲存失敗', error.name); }
      renderMkt();
    } else if (btn.dataset.act === 'find') {
      triggerNativeTownSearch(r.base);
    }
  });

  const mktSwitch = document.createElement('span'); mktSwitch.dataset.roiBrowseSwitch = ''; mktSwitch.style.cssText = 'display:inline-flex;gap:4px;margin-left:8px;';
  const bNat = document.createElement('button'); bNat.className = 'xp-btn small'; bNat.textContent = '原生攤位'; bNat.onclick = () => { mktView = false; stopMktAuto(); syncMktMount(); };
  const bCat = document.createElement('button'); bCat.className = 'xp-btn small'; bCat.textContent = '📊 商品分類'; bCat.onclick = () => { mktView = true; syncMktMount(); };
  mktSwitch.append(bNat, bCat);

  function findCityVendingFieldset() {
    return [...document.querySelectorAll('fieldset')].find((f) => {
      if (f === mktPanel || f.closest('[hidden],[inert],[aria-hidden="true"]') || !visible(f.parentElement)) return false;
      if (!visible(f) && !f.hasAttribute('data-roi-browse-hidden')) return false;
      const legTxt = clean(roiPriceText([...f.children].find((e) => e.tagName === 'LEGEND') || document.createElement('span')));
      return /的攤位/.test(legTxt) && !/^(?:搜尋|我的攤位)/.test(legTxt);
    });
  }

  // 攤位元件的 props.snap 可能是較早 render 留下的舊快照（元件未重繪時同一物件會一直被讀到）。
  // 每個快照物件只在第一次被看到時套用一次，舊快照不會在每次路由時把較新的 API 餘額改回去。
  const seenBalanceSnapshots = new WeakSet();
  function syncMarketBalance(snapshot, actorId) {
    if (!snapshot || typeof snapshot !== 'object' || seenBalanceSnapshots.has(snapshot)) return;
    seenBalanceSnapshots.add(snapshot);
    const character = snapshot?.character;
    const id = snapshotCharacterId(snapshot) ?? positiveId(actorId);
    const ownerMatches = id ? id === state.activeCharId :
      Boolean(character?.name && character.name === state.activeCharName &&
        state.chars.filter(c => c.name === character.name).length === 1 &&
        state.chars.some(c => Number(c.id) === state.activeCharId && c.name === character.name));
    const balance = character?.zeny;
    if (!state.activeCharId || !ownerMatches || !Number.isSafeInteger(balance) || balance < 0) return;
    if (state.curZeny === balance && state.charZenyMap[state.activeCharId] === balance) return;
    state.initZenyMap[state.activeCharId] ??= balance;
    state.curZeny = balance;
    localZenyAt.set(state.activeCharId, Date.now());
    state.charZenyMap[state.activeCharId] = balance;
    updateHUD();
    renderChars();
  }

  function syncMktMount() {
    ensurePackItemsLoaded();
    refreshTownSearchResults(findTownSearchUI());
    const allFields = [...document.querySelectorAll('fieldset')].filter((f) => f !== mktPanel);
    const searchField = allFields.find((f) => clean(roiPriceText([...f.children].find((e) => e.tagName === 'LEGEND') || document.createElement('span'))).startsWith('搜尋所有城鎮的攤位'));
    if (searchField) {
      const upperFields = allFields.filter((f) => f.parentElement === searchField.parentElement && /^(?:手推車|開攤|我的攤位|賣出紀錄)/.test(clean([...f.children].find((e) => e.tagName === 'LEGEND')?.textContent)));
      upperFields.forEach((f) => { if (state.mktUpperFold) f.setAttribute('data-roi-native-fold', ''); else f.removeAttribute('data-roi-native-fold'); });
      const sLeg = [...searchField.children].find((e) => e.tagName === 'LEGEND');
      if (upperFields.length && sLeg) {
        if (upperFoldBtn.parentElement !== sLeg) sLeg.appendChild(upperFoldBtn);
        const label = state.mktUpperFold ? '展開手推車／開攤／紀錄' : '收折手推車／開攤／紀錄';
        if (upperFoldBtn.textContent !== label) upperFoldBtn.textContent = label;
      }
    } else {
      document.querySelectorAll('[data-roi-native-fold]').forEach((el) => el.removeAttribute('data-roi-native-fold'));
    }

    const cf = findCityVendingFieldset();
    if (!cf) {
      mktPanel.remove();
      if (mktAuto15s || crossAbortCtrl) stopMktAuto('已離開攤位頁');
      document.querySelectorAll('[data-roi-browse-hidden]').forEach((el) => el.removeAttribute('data-roi-browse-hidden'));
      return;
    }
    for (const previous of document.querySelectorAll('[data-roi-browse-hidden]')) if (previous !== cf) previous.removeAttribute('data-roi-browse-hidden');
    if (mktPanel.previousElementSibling !== cf) cf.after(mktPanel);
    const opening = mktView && mktPanel.hidden;
    mktPanel.hidden = !mktView;
    if (mktView) cf.setAttribute('data-roi-browse-hidden', '');
    else cf.removeAttribute('data-roi-browse-hidden');
    const leg = mktView ? mktPanel.querySelector('#roi-mkt-leg') : [...cf.children].find((e) => e.tagName === 'LEGEND');
    if (leg && mktSwitch.parentElement !== leg) leg.appendChild(mktSwitch);
    const p = readFiberForUi(() => getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId));
    if (p === undefined) { if (opening) renderMkt(); return; }
    syncMarketBalance(p?.snap, p?.characterId);
    if ((updateLocalListings(p) || opening) && mktView) renderMkt();
  }

  function currentLootAutoControl() {
    const controls = [...document.querySelectorAll('[data-roi-loot-auto]')].filter(visible);
    return controls.length === 1 && !controls[0].disabled ? controls[0] : null;
  }

  const hudViewOptions = { full: '完整', compact: '精簡' };
  const hudColumnOptions = { auto: '自動', one: '單欄', two: '雙欄' };
  const hudViewKey = 'roi-hud-layout-v1';
  const hudLayout = { view: 'full', columns: 'auto' };
  try {
    const saved = JSON.parse(sessionStorage.getItem(hudViewKey) || 'null');
    if (Object.hasOwn(hudViewOptions, saved?.view)) hudLayout.view = saved.view;
    if (Object.hasOwn(hudColumnOptions, saved?.columns)) hudLayout.columns = saved.columns;
  } catch { log('hud', '無法讀取浮窗版型'); }

  const hudMetricPrefKey = () => hudLayout.view === 'compact' ? 'hudCompactMetrics' : 'hudMetrics';
  const hudOptions = (items) => Object.entries(items).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
  function orderHudRows(parent, rows) {
    rows.forEach((row, index) => {
      if (row !== parent.children[index]) parent.insertBefore(row, parent.children[index] ?? null);
    });
  }

  function syncHudSettings() {
    const pane = document.querySelector('#pane-cfg.active');
    if (!pane) return;
    for (const input of pane.querySelectorAll('[data-ro-pref]')) input.checked = state[input.dataset.roPref];
    pane.querySelector('#c-hud-view').value = hudLayout.view;
    pane.querySelector('#c-hud-columns').value = hudLayout.columns;
    pane.querySelector('#c-hud-number').value = state.hudNumberFormat;
    const metricSettings = pane.querySelector('#roi-hud-metric-settings');
    const metrics = state[hudMetricPrefKey()];
    const positions = new Map(metrics.map((key, index) => [key, index]));
    const rows = [...metricSettings.children];
    for (const row of rows) {
      const index = positions.get(row.dataset.roMetricSetting);
      row.querySelector('input').checked = index !== undefined;
      row.querySelector('[data-ro-metric-move="-1"]').disabled = index === undefined || index === 0;
      row.querySelector('[data-ro-metric-move="1"]').disabled = index === undefined || index === metrics.length - 1;
    }
    orderHudRows(metricSettings, rows.sort((a, b) =>
      (positions.get(a.dataset.roMetricSetting) ?? Infinity) - (positions.get(b.dataset.roMetricSetting) ?? Infinity)));
    pane.querySelector('#c-price-lock').checked = priceOptions.enabled;
    const priceThreshold = pane.querySelector('#c-price-threshold');
    if (priceThreshold && priceThreshold !== document.activeElement && priceThreshold.value !== String(priceOptions.threshold)) {
      priceThreshold.value = priceOptions.threshold;
    }
    pane.querySelector('#c-rare-sync').checked = rareAutoMap;
    const loot = currentLootAutoControl();
    const lootSwitch = pane.querySelector('#c-loot-sync');
    lootSwitch.checked = Boolean(loot?.checked);
    lootSwitch.disabled = !loot;
    const auto = pane.querySelector('#c-market-auto');
    auto.checked = mktAuto15s;
    auto.disabled = !mktAuto15s && (!mktPanel.isConnected || mktPanel.hidden);
    pane.querySelector('#c-market-min').checked = mktPanel.querySelector('#roi-mkt-min').checked;
    syncRefineSettings(pane);
  }

  const hudSkillControls = 'button[aria-label$=" +1"], [role="region"][aria-label="技能點預覽"], [role="region"][aria-label="屬性點預覽"]';
  let hudFit = null, hudYield = null, hudSizeObserver = null, browserMenuObserver = null;
  function resizeHud() { hudFit?.(); }
  window.addEventListener('resize', resizeHud);
  window.addEventListener('pagehide', function releaseHud(event) {
    if (event.persisted) return;
    window.removeEventListener('pagehide', releaseHud);
    window.removeEventListener('resize', resizeHud);
    hudSizeObserver?.disconnect();
    browserMenuObserver?.disconnect();
    hudFit = hudYield = null;
  });
  function ensureHUD() {
    if (!document.body || document.getElementById('ro-helper-hud')) return;
    // 浮窗被移除後重建時，沿用同一份樣式並釋放舊的觀察器，避免重複 CSS 與監聽器累積。
    hudSizeObserver?.disconnect();
    browserMenuObserver?.disconnect();
    browserMenuObserver = null;
    const st = document.querySelector('style[data-roi-style]') || document.createElement('style');
    st.dataset.roiStyle = '';
    st.textContent = `
      /* 直接繼承遊戲的主題色，切換介面或夜間模式時由 CSS 更新。 */
      :root {
        --roi-surface:var(--face,#fff); --roi-panel:var(--face-2,#f4f6fb);
        --roi-inset:var(--face,#fff); --roi-selected:var(--select-soft,#d3e0fb);
        --roi-edge:var(--edge-mid,#b4c0da); --roi-frame:var(--win-border,#7d8fbc);
        --roi-title:var(--title-2,#dbe4f5); --roi-title-text:var(--title-text,#1d2d5a);
        --roi-text:var(--text,#1b1b1b); --roi-muted:#4b5563;
        --roi-info:#165587; --roi-warning:#854009; --roi-success:#136039;
        --roi-danger:#a5222d; --roi-damage:#9d2664; --roi-shadow:rgba(0,0,0,.28);
        --roi-scheme:light; --roi-ref-glow:none;
        --roi-ref-4:#1e568f; --roi-ref-5:#136039; --roi-ref-6:#4d6318;
        --roi-ref-7:#7a5200; --roi-ref-8:#934307; --roi-ref-9:#a5222d; --roi-ref-10:#9b1740;
      }
      html.night {
        --roi-surface:var(--face,#1e222b); --roi-panel:var(--face-2,#252a35);
        --roi-inset:var(--face,#151923); --roi-selected:var(--select-soft,#2f3d63);
        --roi-edge:var(--edge-mid,#444d63); --roi-frame:var(--win-border,#4a5570);
        --roi-title:var(--title-2,#2b3244); --roi-title-text:var(--title-text,#d6def2);
        --roi-text:var(--text,#dde2ec); --roi-muted:#b0bccf;
        --roi-info:#93c5fd; --roi-warning:#fde047; --roi-success:#86efac;
        --roi-danger:#fda4af; --roi-damage:#f9a8d4; --roi-shadow:rgba(0,0,0,.65);
        --roi-scheme:dark; --roi-ref-glow:0 0 5px color-mix(in srgb,currentColor 45%,transparent);
        --roi-ref-4:#93c5fd; --roi-ref-5:#6ee7b7; --roi-ref-6:#bef264;
        --roi-ref-7:#fde047; --roi-ref-8:#fdba74; --roi-ref-9:#fda4af; --roi-ref-10:#ff91ad;
      }
      #ro-helper-hud, #roi-helper-mvp-panel, [data-roi-party-move-dialog] { color-scheme:var(--roi-scheme); }
      [data-roi-browse-hidden], [data-roi-native-fold] { display: none !important; }
      table[data-roi-town-results] { display: block; overflow: auto; }
      table[data-roi-town-results] > :is(thead, tbody) > tr > :first-child:not([colspan]) { width: 100%; }
      nav.xp-menubar[aria-label="主選單"],
      nav.xp-menubar[aria-label="主選單"] > .xp-menu-group { flex-wrap:wrap !important; min-width:0; max-width:100%; }
      nav.xp-menubar[aria-label="主選單"] .xp-menu-item { flex-shrink:0; white-space:nowrap; }
      [data-roi-wh-custom-view] > ul > li:not([data-roi-wh-pinned]),
      [data-roi-wh-custom-view] [data-roi-wh-native-bulk],
      [data-roi-wh-custom-tabs] > input { display:none !important; }
      [data-roi-wh-custom-tabs] > button:not([data-roi-wh-custom-tab])[aria-selected="true"] { background:var(--face-2) !important; font-weight:normal !important; }
      [data-roi-wh-custom-tab][aria-selected="true"] { background:var(--tab-on,#d4d0c8); font-weight:bold; }
      @keyframes roi-stop-pulse { to { outline-offset:4px; outline-color:transparent; } }
      #ro-fab.roi-stop-alert { outline:3px solid #ef4444; animation:roi-stop-pulse 1.2s ease-out infinite; }
      @media (prefers-reduced-motion:reduce) { #ro-fab.roi-stop-alert { animation:none; } }
      [data-roi-wh-pin], [data-roi-wh-pin-search] { flex:none; inline-size:16px; padding:0; border:0; background:transparent; color:inherit; line-height:1; cursor:pointer; }
      [data-roi-wh-pin][aria-pressed="true"] { color:var(--roi-warning); }
      html:not([data-roi-money-off]) .roi-mc-text { color: var(--roi-mc) !important; font-weight: bold !important; font-variant-numeric: tabular-nums; }
      html:not([data-roi-money-off]):is(.night,[data-info-night]) .roi-mc-text { color: var(--roi-mn) !important; -webkit-text-fill-color: currentColor !important; }
      .roi-mkt-row:hover { background:rgba(56,189,248,0.12) !important; }
      table.roi-market-table { width:100% !important; table-layout:fixed !important; }
      table.roi-market-table tr > [data-roi-market-col] { box-sizing:border-box !important; }
      table.roi-market-table tr > [data-roi-market-col="item"] { width:auto !important; }
      table.roi-market-table tr > [data-roi-market-col="price"] { position:relative !important; width:180px !important; padding-right:48px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="stock"] { width:65px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input"] { width:85px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:150px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:64px !important; max-width:100% !important; box-sizing:border-box !important; }
      table.roi-market-table td[data-roi-market-col="price"] > button[data-roi-price-search] { position:absolute; right:22px; top:50%; transform:translateY(-50%); width:21px; height:21px; padding:0; border:0; background:transparent; color:var(--roi-info) !important; font:14px sans-serif; cursor:pointer; }
      @media(max-width:600px) {
        table.roi-market-table tr > [data-roi-market-col="price"] { width:135px !important; }
        table.roi-market-table tr > [data-roi-market-col="stock"] { width:45px !important; }
        table.roi-market-table tr > [data-roi-market-col="input"] { width:65px !important; }
        table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:110px !important; }
        table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:52px !important; }
      }
      li[data-roi-wh-locked] { background:linear-gradient(90deg,rgba(245,158,11,0.22),transparent 85%)!important; border-left:3px solid #f59e0b!important; padding-left:4px!important; }
      button[data-roi-wh-badge="lock"] { background:var(--roi-panel)!important; color:var(--roi-warning)!important; border:1px solid #f59e0b!important; border-radius:4px!important; padding:0 5px!important; margin:0 4px!important; font-size:11px!important; font-weight:bold!important; cursor:pointer!important; }
      button[data-roi-wh-badge="unlock"] { background:transparent!important; color:var(--roi-muted)!important; border:1px dashed #475569!important; border-radius:4px!important; padding:0 4px!important; margin:0 4px!important; font-size:11px!important; opacity:0.6; cursor:pointer!important; }
      [data-ro-ref-tier="4"]  { color: var(--roi-ref-4) !important; font-weight: 600 !important; }
      [data-ro-ref-tier="5"]  { color: var(--roi-ref-5) !important; font-weight: 600 !important; }
      [data-ro-ref-tier="6"]  { color: var(--roi-ref-6) !important; font-weight: 700 !important; }
      [data-ro-ref-tier="7"]  { color: var(--roi-ref-7) !important; font-weight: 700 !important; text-shadow: var(--roi-ref-glow) !important; }
      [data-ro-ref-tier="8"]  { color: var(--roi-ref-8) !important; font-weight: 800 !important; text-shadow: var(--roi-ref-glow) !important; }
      [data-ro-ref-tier="9"]  { color: var(--roi-ref-9) !important; font-weight: 800 !important; text-shadow: var(--roi-ref-glow) !important; }
      [data-ro-ref-tier="10"] { color: var(--roi-ref-10) !important; font-weight: 900 !important; text-shadow: var(--roi-ref-glow) !important; background: linear-gradient(90deg, rgba(255,45,85,0.22), rgba(250,204,21,0.18)) !important; border-radius: 4px !important; padding: 0 5px !important; border: 1px solid rgba(255,215,0,0.65) !important; }
      #ro-helper-hud { position:fixed; top:48px; right:14px; z-index:2147483646; font-family:system-ui,-apple-system,"Microsoft JhengHei",sans-serif; user-select:none; touch-action:none; }
      #ro-helper-hud[data-roi-hud-yield] { pointer-events:none; }
      #ro-helper-hud[data-roi-hud-yield] > #ro-hud-card { visibility:hidden; pointer-events:none; }
      #ro-helper-hud[data-roi-hud-yield] > #ro-fab { display:flex !important; position:fixed; left:var(--roi-hud-yield-x); top:var(--roi-hud-yield-y); pointer-events:auto; cursor:pointer !important; }
      #ro-hud-card { background:var(--roi-surface); backdrop-filter:blur(12px); color:var(--roi-text); border:1.5px solid var(--roi-frame); border-radius:12px; box-sizing:border-box; width:min(365px,calc(100vw - 8px)); max-height:calc(100vh - 8px); max-height:calc(100dvh - 8px); box-shadow:0 16px 40px var(--roi-shadow); font-size:12px; overflow:auto; }
      #ro-drag { position:sticky; top:0; z-index:1; }
      .ro-tab { flex:1; text-align:center; padding:8px 2px; cursor:pointer; color:var(--roi-muted); font-weight:bold; font-size:11px; border-bottom:2px solid transparent; transition:all 0.15s; }
      .ro-tab:hover { color:var(--roi-text); background:var(--roi-panel); }
      .ro-tab.active { color:var(--roi-warning); border-bottom-color:var(--roi-warning); background:var(--roi-selected); }
      .ro-pane { display:none; padding:10px 12px; max-height:410px; overflow-y:auto; touch-action:pan-y; }
      .ro-pane.active { display:block; }
      .ro-box { background:var(--roi-panel); border:1px solid var(--roi-edge); border-radius:8px; padding:7px 9px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); }
      #roi-hud-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-bottom:7px; }
      #roi-hud-metrics[data-columns="one"] { grid-template-columns:minmax(0,1fr); }
      @media (max-width:420px) {
        #roi-hud-metrics[data-columns="auto"] { grid-template-columns:minmax(0,1fr); }
      }
      #roi-hud-metrics[data-view="compact"] { gap:4px; }
      #roi-hud-metrics[data-view="compact"] .ro-box { padding:4px 7px; }
      #roi-hud-metrics [data-roi-metric] { min-width:0; overflow-wrap:anywhere; }
      [data-ro-metric-setting], #roi-char-filters { display:flex; align-items:center; gap:5px; }
      [data-ro-metric-setting] label { flex:1; min-width:0; }
      #roi-char-filters { flex-wrap:wrap; margin-bottom:7px; }
      #pane-cfg fieldset { min-inline-size:0; margin:0 0 8px; display:grid; gap:6px; }
      #pane-cfg legend { color:var(--roi-warning); font-weight:bold; }
      #pane-cfg label { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
      #pane-cfg label > input { margin:0 4px 0 0; }
      #pane-cfg input[type="number"] { width:7em; color:var(--roi-text); background:var(--roi-inset); border:1px solid var(--roi-edge); border-radius:4px; }
    `;
    if (!st.isConnected) document.head.appendChild(st);
    document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);

    const hud = document.createElement('div'); hud.id = 'ro-helper-hud';
    const initialMetrics = state[hudMetricPrefKey()];
    const metricKeys = [...new Set([...initialMetrics, ...Object.keys(hudMetricLabels)])];
    hud.innerHTML = `
      <div id="ro-fab" style="display:${state.hudMin ? 'flex' : 'none'};width:46px;height:46px;border-radius:50%;background:var(--roi-title);border:2px solid var(--roi-frame);color:var(--roi-info);align-items:center;justify-content:center;font-size:21px;cursor:move;box-shadow:0 8px 24px var(--roi-shadow);" title="可拖曳移動｜點擊展開">⚡</div>
      <div id="ro-hud-card" style="display:${state.hudMin ? 'none' : 'block'};">
        <div id="ro-drag" style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px 10px;background:var(--roi-title);border-bottom:1px solid var(--roi-edge);font-weight:bold;color:var(--roi-title-text);cursor:move;" title="按住可拖曳移動視窗">
          <span style="white-space:nowrap;">⚡ RO Idle v3.5.8.2 測試版</span>
          <button id="ro-min-btn" style="background:var(--roi-selected);color:var(--roi-text);border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-weight:bold;">━</button>
        </div>
        <div style="display:flex;background:var(--roi-inset);border-bottom:1px solid var(--roi-edge);">
          <div class="ro-tab active" data-t="tel">📊 效率</div>
          <span data-roi-mvp-slot></span>
          <div class="ro-tab" data-t="chr">👥 分身</div>
          <div class="ro-tab" data-t="lot">🎒 掉寶</div>
          <div class="ro-tab" data-t="cfg">⚙️ 設定</div>
        </div>
        <div class="ro-pane active" id="pane-tel">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;font-size:11.5px;">
            <span>角色：<b id="u-name" style="color:var(--roi-info);">讀取中</b></span>
            <span id="u-time" style="color:var(--roi-success);font-weight:bold;font-variant-numeric:tabular-nums;">⏱️ 00:00</span>
          </div>
          <div id="roi-hud-metrics" data-view="${hudLayout.view}" data-columns="${hudLayout.columns}">
            ${metricKeys.map((key) => `<div class="ro-box" data-roi-metric="${key}" ${initialMetrics.includes(key) ? '' : 'hidden'}>
              <small style="color:var(--roi-muted);" ${key === 'dmg' ? 'title="本角色在監測期間的輸出 ÷ 未暫停秒數，包含待機時間"' : key === 'hitRate' ? 'title="只計已記錄起訖的交戰，從發現怪物到擊倒。搜尋與待機不計。"' : ''}>${hudMetricLabels[key]}</small>
              <div id="u-${key}" style="font-size:13.5px;font-weight:bold;color:${key === 'dmg' ? 'var(--roi-damage)' : 'var(--roi-info)'};margin-top:2px;">0</div>
            </div>`).join('')}
          </div>
          <div style="display:flex;gap:6px;">
            <button id="b-pause" style="flex:1;background:linear-gradient(135deg,#a34f05,#854009);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">⏸️ 暫停監測</button>
            <button id="b-reset" style="flex:1;background:var(--roi-selected);color:var(--roi-text);border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">🔄 歸零</button>
          </div>
        </div>
        <div class="ro-pane" id="pane-chr">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;background:var(--roi-inset);padding:7px 10px;border-radius:6px;border:1px solid var(--roi-edge);">
            <span>💰 帳號總 Zeny：</span><b id="u-tzeny" style="color:var(--roi-warning);">待同步</b>
          </div>
          <div id="roi-char-filters">
            <label><input type="checkbox" data-ro-char-filter="charAttentionOnly"> 只看停止或異常</label>
            <label><input type="checkbox" data-ro-char-filter="charAttentionFirst"> 停止或異常置頂</label>
          </div>
          <div id="u-clist">同步中...</div>
        </div>
        <div class="ro-pane" id="pane-lot">
          <fieldset class="ro-box">
            <legend>MVP 紀錄（本次開頁）</legend>
            <label>查看首領 <select id="u-mvp-boss" class="xp-input"><option value="">全部 MVP</option></select></label>
            <div id="u-mvp-combat"></div>
            <details open><summary>MVP 戰鬥結果</summary><div id="u-mvp-battles" style="max-height:135px;overflow:auto;"></div></details>
            <details open><summary>MVP 掉落與獎勵</summary><div id="u-mvp-loot" style="max-height:135px;overflow:auto;"></div></details>
          </fieldset>
          <div id="u-rlist" style="background:var(--roi-inset);padding:7px;border-radius:6px;border:1px solid var(--roi-edge);margin-bottom:7px;max-height:75px;overflow:auto;color:var(--roi-warning);font-size:11px;">尚無稀有掉落...</div>
          <div id="u-llist" style="background:var(--roi-inset);padding:7px;border-radius:6px;border:1px solid var(--roi-edge);max-height:190px;overflow:auto;font-size:11px;">尚無撿取紀錄...</div>
        </div>
        <div class="ro-pane" id="pane-cfg">
          <div data-roi-browser-menu hidden style="margin-bottom:8px;"></div>
          <fieldset class="ro-box"><legend>顯示與通知</legend>
            <label><input type="checkbox" data-ro-pref="itemHover"> 背包與倉庫物品懸浮提示</label>
            <label><input type="checkbox" data-ro-pref="marketHover"> 攤位商品懸浮提示</label>
            <label><input type="checkbox" data-ro-pref="moneyColor"> 金額分色</label>
            <label><input type="checkbox" data-ro-pref="sound"> 音效</label>
            <label><input type="checkbox" data-ro-pref="notify"> 桌面通知</label>
          </fieldset>
          <fieldset class="ro-box"><legend>效率儀表盤欄位</legend>
            <label>此分頁版型 <select id="c-hud-view" class="xp-input">${hudOptions(hudViewOptions)}</select></label>
            <label>此分頁欄數 <select id="c-hud-columns" class="xp-input">${hudOptions(hudColumnOptions)}</select></label>
            <label>數字格式 <select id="c-hud-number" class="xp-input">${hudOptions(hudNumberFormats)}</select></label>
            <div id="roi-hud-metric-settings">
              ${Object.entries(hudMetricLabels).map(([key, label]) =>
                `<div data-ro-metric-setting="${key}">
                  <label><input type="checkbox" data-ro-metric-pref="${key}"> ${label}</label>
                  <button type="button" class="xp-btn small" aria-label="${label}上移" data-ro-metric-move="-1">↑</button>
                  <button type="button" class="xp-btn small" aria-label="${label}下移" data-ro-metric-move="1">↓</button>
                </div>`).join('')}
            </div>
          </fieldset>
          <fieldset class="ro-box"><legend>倉庫</legend>
            <label><input type="checkbox" data-ro-pref="whProtectPins"> 清倉排除自選（★）</label>
            <label><input type="checkbox" data-ro-pref="whSaleReview"> 出售前清單核對</label>
            <label><input type="checkbox" data-ro-pref="whAutoEquipCard"> 自動保護卡片、精煉或有洞裝備</label>
            <label><input type="checkbox" id="c-price-lock"> 掛牌價自動保護</label>
            <label>保護門檻 <input type="number" id="c-price-threshold" min="1" max="1000000000000" step="1" value="${priceOptions.threshold}"> Zeny</label>
          </fieldset>
          <fieldset class="ro-box"><legend>精煉</legend>
            <label><input type="checkbox" id="ref-skip-cfm" data-roi-ref-confirm> 精煉時略過確認窗</label>
            <label><input type="checkbox" id="ref-auto-wh" data-roi-ref-warehouse> 自動領料及存倉</label>
            <label>每次領料 <input type="number" id="ref-material-batch" data-roi-ref-batch min="1" max="1000" step="1"> 個</label>
          </fieldset>
          <fieldset class="ro-box"><legend>攤位</legend>
            <label><input type="checkbox" data-ro-pref="mktUpperFold"> 收折手推車、開攤及紀錄</label>
            <label><input type="checkbox" id="c-market-min"> 只顯示同規格最低價</label>
            <label title="請先開啟商品分類"><input type="checkbox" id="c-market-auto"> 每 15 秒自動整理（商品分類開啟時）</label>
          </fieldset>
          <fieldset class="ro-box"><legend>掛機設定</legend>
            <label><input type="checkbox" id="c-rare-sync"> 隨地圖同步必撿稀有掉落</label>
            <label title="請先開啟該角色的道具與補給"><input type="checkbox" id="c-loot-sync"> 本角隨地圖自動設定戰利品（道具與補給開啟時）</label>
          </fieldset>
          <div id="c-settings-status" role="status" style="color:var(--roi-warning);"></div>
          <div style="font-weight:bold;color:var(--roi-warning);margin-bottom:4px;">🔒 自訂倉庫貴重保護詞 (由你決定)</div>
          <textarea id="i-words" rows="2" placeholder="例：布里刊, 亡者遺物, 神之金屬, 鋁" style="width:100%;box-sizing:border-box;background:var(--roi-inset);color:var(--roi-warning);border:1px solid var(--roi-edge);border-radius:6px;padding:6px;font-size:11.5px;user-select:text;"></textarea>
          <button id="b-save-words" style="width:100%;margin:6px 0 8px;background:linear-gradient(135deg,#16763a,#136039);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">💾 儲存自訂貴重詞並套用至倉庫</button>
          <div style="display:flex;gap:6px;">
            <button id="b-exp-json" style="flex:1;background:linear-gradient(135deg,#0369a1,#075581);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📤 匯出備份</button>
            <button id="b-imp-json" style="flex:1;background:var(--roi-selected);color:var(--roi-text);border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📥 匯入還原</button>
            <input type="file" id="i-imp-file" accept=".json" style="display:none;">
          </div>
        </div>
      </div>
    `;
    hud.querySelector('#i-words').value = state.customProtectWords.join(', ');
    state.renderedLootRev = -1;
    document.body.appendChild(hud);
    const mvpSlot = hud.querySelector('[data-roi-mvp-slot]');
    if (mvpRadar) mvpSlot.replaceWith(mvpRadar.button);
    else mvpSlot.remove();

    function attachBrowserMenu() {
      const menu = document.getElementById('mgm-userscript-menu');
      const slot = hud.querySelector('[data-roi-browser-menu]');
      if (!menu || menu.parentElement === slot) return Boolean(menu);
      menu.style.cssText = 'position:relative;top:auto;right:auto;z-index:2;font:12px system-ui;color:var(--roi-text);';
      slot.append(menu);
      slot.hidden = false;
      return true;
    }
    if (!attachBrowserMenu()) {
      const observer = browserMenuObserver = new MutationObserver(() => {
        if (attachBrowserMenu()) { observer.disconnect(); if (browserMenuObserver === observer) browserMenuObserver = null; }
      });
      observer.observe(document.body, { childList: true });
    }

    let yieldDismissed = false;
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    function syncHudYield(hudRect) {
      if (document.hidden || !hud.isConnected) return;
      const controls = [...document.querySelectorAll(hudSkillControls)]
        .filter(el => visible(el) && getComputedStyle(el).visibility === 'visible');
      const rects = controls.map(el => el.getBoundingClientRect())
        .filter(rect => rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight &&
          rect.right > rect.left && rect.bottom > rect.top);
      if (!controls.length) yieldDismissed = false;
      if (state.hudMin || yieldDismissed || !rects.length ||
          !rects.some(rect => intersects(rect, hudRect ??= hud.getBoundingClientRect()))) {
        hud.removeAttribute('data-roi-hud-yield');
        return;
      }

      // Keep the card in layout so the original footprint remains measurable while yielded.
      const size = 50, edge = 4; // The floating button is 46px plus two 2px borders.
      const maxX = Math.max(0, innerWidth - size - edge);
      const maxY = Math.max(0, innerHeight - size - edge);
      const xs = [maxX, edge, ...rects.map(rect => rect.left - size)];
      const ys = [edge, maxY, ...rects.map(rect => rect.bottom)];
      let spot;
      for (const y of ys) {
        if (y < 0 || y > maxY) continue;
        const x = xs.find(x => x >= 0 && x <= maxX &&
          !rects.some(rect => intersects(rect, { left: x, top: y, right: x + size, bottom: y + size })));
        if (x !== undefined) { spot = { x, y }; break; }
      }
      const left = (spot?.x ?? maxX) + 'px', top = (spot?.y ?? 0) + 'px';
      if (hud.style.getPropertyValue('--roi-hud-yield-x') !== left) hud.style.setProperty('--roi-hud-yield-x', left);
      if (hud.style.getPropertyValue('--roi-hud-yield-y') !== top) hud.style.setProperty('--roi-hud-yield-y', top);
      hud.toggleAttribute('data-roi-hud-yield', true);
    }

    function clampHud(left, top, { width, height }) {
      const edge = 4;
      const maxLeft = innerWidth - width - edge;
      const maxTop = innerHeight - height - edge;
      return {
        left: Math.min(Math.max(0, maxLeft), Math.max(edge, left)),
        top: Math.min(Math.max(0, maxTop), Math.max(edge, top))
      };
    }

    function writeHudPosition({ left, top }) {
      hud.style.right = 'auto';
      hud.style.left = left + 'px';
      hud.style.top = top + 'px';
    }

    function fitHud() {
      if (!hud.isConnected || document.hidden) return;
      const rect = hud.getBoundingClientRect();
      const { left, top } = state.hudPos || {};
      const position = clampHud(Number.isFinite(left) ? left : innerWidth - rect.width - 14,
        Number.isFinite(top) ? top : 48, rect);
      syncHudYield({ ...position, right: position.left + rect.width, bottom: position.top + rect.height });
      writeHudPosition(position);
    }

    fitHud();
    hudFit = fitHud;
    hudYield = () => syncHudYield();
    hudSizeObserver = new ResizeObserver(fitHud);
    hudSizeObserver.observe(hud);

    const bindDrag = (handle, onClick) => {
      let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        dragging = true; moved = false;
        const rect = hud.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = rect.left; oy = rect.top;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        if (!moved || hud.hasAttribute('data-roi-hud-yield')) return;
        state.hudPos = clampHud(ox + dx, oy + dy, hud.getBoundingClientRect());
        writeHudPosition(state.hudPos);
      });
      handle.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        handle.releasePointerCapture(e.pointerId);
        if (moved) {
          if (!hud.hasAttribute('data-roi-hud-yield')) { savePrefs(); syncHudYield(); }
        } else if (onClick) onClick();
      });
    };

    const setMin = (m) => {
      if (!m && hud.hasAttribute('data-roi-hud-yield')) {
        yieldDismissed = true;
        syncHudYield();
        return;
      }
      if (!m) {
        clearTransientCharAlerts();
        document.getElementById('ro-fab').classList.remove('roi-stop-alert');
      }
      state.hudMin = m; savePrefs();
      document.getElementById('ro-hud-card').style.display = m ? 'none' : 'block';
      document.getElementById('ro-fab').style.display = m ? 'flex' : 'none';
      fitHud();
    };
    bindDrag(document.getElementById('ro-drag'), null);
    bindDrag(document.getElementById('ro-fab'), () => setMin(false));
    document.getElementById('ro-min-btn').onclick = () => setMin(true);

    hud.querySelectorAll('.ro-tab[data-t]').forEach((t) => t.onclick = () => {
      hud.querySelectorAll('.ro-tab,.ro-pane').forEach((x) => x.classList.remove('active'));
      t.classList.add('active'); document.getElementById('pane-' + t.dataset.t).classList.add('active');
      if (t.dataset.t === 'cfg') syncHudSettings();
      if (t.dataset.t === 'lot') renderMvpHistory();
      if (t.dataset.t === 'chr') renderChars();
    });

    const settings = hud.querySelector('#pane-cfg');
    const settingsStatus = settings.querySelector('#c-settings-status');
    const bossFilter = hud.querySelector('#u-mvp-boss');
    bossFilter.onchange = () => renderMvpHistory(true);
    for (const input of settings.querySelectorAll('[data-ro-metric-pref]')) {
      input.onchange = () => {
        const key = input.dataset.roMetricPref;
        const pref = hudMetricPrefKey();
        state[pref] = input.checked ? [...new Set([...state[pref], key])] : state[pref].filter(value => value !== key);
        savePrefs();
        updateHUD();
      };
    }
    for (const button of settings.querySelectorAll('[data-ro-metric-move]')) {
      button.onclick = () => {
        const pref = hudMetricPrefKey();
        const metrics = [...state[pref]];
        const row = button.closest('[data-ro-metric-setting]');
        const from = metrics.indexOf(row.dataset.roMetricSetting);
        const to = from + Number(button.dataset.roMetricMove);
        if (from < 0 || to < 0 || to >= metrics.length) return;
        [metrics[from], metrics[to]] = [metrics[to], metrics[from]];
        const hadFocus = document.activeElement === button;
        state[pref] = metrics;
        savePrefs();
        updateHUD();
        if (hadFocus) (button.disabled ? row.querySelector('button:not(:disabled)') : button)?.focus();
      };
    }
    for (const [key, options] of [['view', hudViewOptions], ['columns', hudColumnOptions]]) {
      settings.querySelector('#c-hud-' + key).onchange = ({ target }) => {
        if (!Object.hasOwn(options, target.value)) return;
        hudLayout[key] = target.value;
        try { sessionStorage.setItem(hudViewKey, JSON.stringify(hudLayout)); }
        catch { log('hud', '無法儲存浮窗版型'); }
        updateHUD();
      };
    }
    settings.querySelector('#c-hud-number').onchange = ({ target }) => {
      if (!Object.hasOwn(hudNumberFormats, target.value)) return;
      state.hudNumberFormat = target.value;
      savePrefs();
      updateHUD();
    };
    for (const input of hud.querySelectorAll('[data-ro-char-filter]')) {
      input.onchange = () => {
        state[input.dataset.roCharFilter] = input.checked;
        savePrefs();
        renderChars();
      };
    }
    for (const input of settings.querySelectorAll('[data-ro-pref]')) {
      input.onchange = () => {
        const key = input.dataset.roPref;
        if (key === 'whSaleReview') {
          setWarehouseSaleReview(input.checked);
          return;
        }
        state[key] = input.checked;
        savePrefs();
        if (key === 'itemHover' || key === 'marketHover') hideTooltip();
        if (key === 'moneyColor') {
          document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);
          if (state.moneyColor) alignAndColorizeNativeMarkets();
        }
        if (key === 'whProtectPins') refreshWarehouse();
        if (key === 'whAutoEquipCard') refreshWarehouse(true);
        if (key === 'mktUpperFold') syncMktMount();
      };
    }
    const bindSetting = (id, apply) => {
      settings.querySelector('#' + id).onchange = (event) => {
        settingsStatus.textContent = '';
        try { apply(event.target); }
        catch (error) { settingsStatus.textContent = error.message; }
        syncHudSettings();
      };
    };
    bindSetting('c-price-lock', (input) => savePriceOptions({ enabled: input.checked }));
    bindSetting('c-price-threshold', (input) => {
      const threshold = Number(input.value);
      if (!validThreshold(threshold)) {
        input.value = priceOptions.threshold;
        throw Error('保護門檻請輸入 1 至 1 兆之間的整數');
      }
      try { savePriceOptions({ threshold }); }
      finally { input.value = priceOptions.threshold; }
    });
    bindSetting('c-rare-sync', (input) => setRareAutoMap(input.checked));
    bindSetting('c-loot-sync', (input) => {
      const control = currentLootAutoControl();
      if (control && control.checked !== input.checked) control.click();
    });
    bindSetting('c-market-min', (input) => {
      mktPanel.querySelector('#roi-mkt-min').checked = input.checked;
      renderMkt();
    });
    bindSetting('c-market-auto', (input) => {
      if (mktAuto15s && !input.checked) stopMktAuto('已手動停止 15s 自動整理');
      else if (!mktAuto15s && input.checked && mktPanel.isConnected && !mktPanel.hidden) startMktAuto();
    });
    bindRefineSettings(settings, settingsStatus);

    document.getElementById('b-save-words').onclick = () => {
      let words;
      try { words = validateWords(document.getElementById('i-words').value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean)); }
      catch (error) { alert('⚠️ ' + error.message); return; }
      state.customProtectWords = words;
      try { GM_setValue('ro_custom_protect_words_v091', words); } catch { log("hud", "自訂貴重詞儲存失敗"); }
      refreshWarehouse(true);
      alert(`✅ 已更新自訂貴重詞 (${state.customProtectWords.length} 項)！`);
    };

    document.getElementById('b-exp-json').onclick = () => {
      const payload = {
        format: 'ro-idle-lean-backup', version: 1,
        prefs: readValidatedSetting('ro_lean_prefs_v091', validatePrefs, {}),
        words: state.customProtectWords,
        wh: { marks: state.whMarks, autoLocks: state.whAutoLocks, pins: state.whPins },
        priceOptions,
        refineMaterialBatch: refMaterialBatch,
        favs: [...mktFavs]
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ROIdle-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    };
    const fileInp = document.getElementById('i-imp-file');
    document.getElementById('b-imp-json').onclick = () => fileInp.click();
    fileInp.onchange = async () => {
      try {
        const f = fileInp.files[0]; if (!f) return;
        if (!Number.isSafeInteger(f.size) || f.size < 1 || f.size > MAX_BACKUP_BYTES) throw Error('備份大小上限為 2 MB');
        const text = await f.text();
        if (fileInp.files[0] !== f) return;
        if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw Error('備份大小上限為 2 MB');
        const writes = prepareBackupWrites(JSON.parse(text));
        commitBackupWrites(writes);
        alert('✅ 備份匯入成功，即將重新載入頁面！');
        location.reload();
      } catch (e) { alert('⚠️ 匯入失敗：' + e.message); }
    };

    const bPause = document.getElementById('b-pause');
    bPause.onclick = () => {
      if (!state.paused) { state.accMs += Date.now() - state.lastResumed; state.paused = true; bPause.textContent = '▶️ 繼續監測'; bPause.style.background = 'linear-gradient(135deg,#16763a,#136039)'; }
      else { state.lastResumed = Date.now(); state.paused = false; bPause.textContent = '⏸️ 暫停監測'; bPause.style.background = 'linear-gradient(135deg,#a34f05,#854009)'; }
      combatHitMeter.interrupt(Date.now());
      updateHUD();
    };
    document.getElementById('b-reset').onclick = () => {
      combatHitMeter.reset();
      state.accMs = 0; state.lastResumed = Date.now(); state.kills = 0; state.bexp = 0; state.jexp = 0; state.dmgSum = 0; state.hits = 0; state.maxDmg = 0; state.damageTaken = 0; state.damageStartMs = 0; state.pickupQty = 0; state.missed = 0;
      state.loot = Object.create(null); state.lootRev++; state.renderedLootRev = -1;
      if (state.activeCharId) state.initZenyMap[state.activeCharId] = state.curZeny;
      document.getElementById('u-llist').innerHTML = '尚無撿取紀錄...';
      updateHUD();
    };
  }

  let hudRefs = null;
  function getHudRefs() {
    if (hudRefs && hudRefs.bexp?.isConnected) return hudRefs;
    const bexp = document.getElementById('u-bexp');
    if (!bexp) return null;
    hudRefs = {
      name: document.getElementById('u-name'),
      time: document.getElementById('u-time'),
      bexp,
      jexp: document.getElementById('u-jexp'),
      kph: document.getElementById('u-kph'),
      dmg: document.getElementById('u-dmg'),
      total: document.getElementById('u-total'),
      peak: document.getElementById('u-peak'),
      hits: document.getElementById('u-hits'),
      hitRate: document.getElementById('u-hitRate'),
      taken: document.getElementById('u-taken'),
      pickups: document.getElementById('u-pickups'),
      zeny: document.getElementById('u-zeny'),
      miss: document.getElementById('u-miss'),
      llist: document.getElementById('u-llist'),
      rlist: document.getElementById('u-rlist')
    };
    return hudRefs;
  }

  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '億' : n >= 1e4 ? (n / 1e4).toFixed(1) + '萬' : Math.round(n).toLocaleString();
  function formatHudNumber(value, format) {
    const absolute = Math.abs(value);
    const unit = format === 'auto' ? absolute >= 1e8 ? 'yi' : 'wan' : format;
    if (unit === 'yi' && absolute >= 1e8) return (value / 1e8).toFixed(2) + '億';
    if (unit === 'wan' && absolute >= 1e4) return (value / 1e4).toFixed(1) + '萬';
    return Math.round(value).toLocaleString('zh-TW');
  }

  function updateHUD() {
    if (document.hidden || state.hudMin) return;
    syncHudSettings();
    const refs = getHudRefs();
    if (!refs) return;
    const monitoredMs = state.accMs + (state.paused ? 0 : Date.now() - state.lastResumed);
    const sec = Math.max(1, Math.floor(monitoredMs / 1000)), hrs = sec / 3600;
    const grid = document.getElementById('roi-hud-metrics');
    const metrics = state[hudMetricPrefKey()];
    if (grid.dataset.view !== hudLayout.view) grid.dataset.view = hudLayout.view;
    if (grid.dataset.columns !== hudLayout.columns) grid.dataset.columns = hudLayout.columns;
    if (refs.metrics !== metrics) {
      const cards = new Map([...grid.children].map((box) => [box.dataset.roiMetric, box]));
      const shown = new Set(metrics);
      for (const [key, box] of cards) {
        box.hidden = !shown.has(key);
      }
      orderHudRows(grid, metrics.map((key) => cards.get(key)).filter(Boolean));
      refs.metrics = metrics;
    }
    const number = (value) => formatHudNumber(value, state.hudNumberFormat);
    refs.name.textContent = state.activeCharName;
    refs.time.textContent = `${state.paused ? '⏸️ ' : '⏱️ '}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    refs.bexp.textContent = number(state.bexp / hrs);
    refs.jexp.textContent = number(state.jexp / hrs);
    refs.kph.textContent = `${number(state.kills / hrs)}/h (${number(state.kills)})`;
    const damageSeconds = Math.max(1, (monitoredMs - state.damageStartMs) / 1000);
    refs.dmg.textContent = number(state.dmgSum / damageSeconds);
    refs.total.textContent = number(state.dmgSum);
    refs.peak.textContent = number(state.maxDmg);
    refs.hits.textContent = number(state.hits);
    const combatRate = combatHitMeter.rate;
    refs.hitRate.textContent = combatRate === null ? '—' : combatRate.toLocaleString('zh-TW', { maximumFractionDigits: 2 }) + ' 次/秒';
    refs.taken.textContent = number(state.damageTaken);
    refs.pickups.textContent = number(state.pickupQty);
    renderMvpHistory();
    const initZ = state.initZenyMap[state.activeCharId] ?? state.curZeny, diff = state.curZeny - initZ;
    const money = state.hudNumberFormat === 'auto' ? (value) => value.toLocaleString('zh-TW') : number;
    refs.zeny.textContent = `${money(state.curZeny)} Z (${diff >= 0 ? '+' : ''}${money(diff)})`;
    refs.miss.textContent = `${number(state.missed)} 次`;

    if (state.lootRev !== state.renderedLootRev) {
      state.renderedLootRev = state.lootRev;
      const lEntries = Object.entries(state.loot).sort((a, b) => b[1] - a[1]);
      if (lEntries.length) refs.llist.replaceChildren(...lEntries.map(([name, qty]) => {
        const row = element('div', null, 'display:flex;justify-content:space-between;border-bottom:1px dashed #334155;padding:3px 0;');
        row.append(element('span', name), element('b', `×${qty}`, 'color:var(--roi-success)'));
        return row;
      }));
    }
    const list = refs.rlist;
    const pending = Math.min(state.rares.length, state.rareRev - Number(list.dataset.rev || 0));
    if (pending > 0) {
      if (!list.children.length) list.textContent = '';
      const rows = state.rares.slice(0, pending).map((line) => element('div', line));
      list.prepend(...rows);
      while (list.children.length > rareLimit) list.lastElementChild.remove();
      list.dataset.rev = state.rareRev;
    }
  }

  function renderMvpHistory(force = false) {
    const pane = document.querySelector('#pane-lot.active');
    if (!pane) return;
    const filter = pane.querySelector('#u-mvp-boss');
    const actor = state.activeCharId;
    const history = mvpBattleHistory.get(actor);
    const key = `${actor}/${history?.rev ?? 0}`;
    if (!force && filter.dataset.roiHistoryKey === key) return;
    const entries = history?.entries ?? [];
    const combat = history?.combat ?? new Map();
    const selected = filter.dataset.roiActor === String(actor) ? filter.value : '';
    if (filter.dataset.roiHistoryKey !== key) {
      const bosses = [...new Set([...entries.map(entry => entry.boss), ...combat.keys()])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      const names = ['', ...bosses];
      if (filter.options.length !== names.length || names.some((name, i) => filter.options[i]?.value !== name)) {
        filter.replaceChildren(new Option('全部 MVP', ''), ...bosses.map(boss => new Option(boss, boss)));
      }
      filter.value = bosses.includes(selected) ? selected : '';
      filter.dataset.roiActor = String(actor);
      filter.dataset.roiHistoryKey = key;
    }
    const summaries = [...combat].filter(([boss]) => !filter.value || boss === filter.value);
    const summary = pane.querySelector('#u-mvp-combat');
    summary.replaceChildren(...summaries.map(([boss, stats]) => element('div',
      `${boss} · 輸出 ${fmt(stats.damage)} · 傷害 ${fmt(stats.hits)} 次 · 承傷 ${fmt(stats.taken)}`)));
    const shown = entries.filter(entry => !filter.value || entry.boss === filter.value);
    const render = (id, rows, empty) => {
      const target = pane.querySelector(id);
      if (!rows.length) { target.textContent = empty; return; }
      target.replaceChildren(...rows.map(entry => element('div', entry.text)));
    };
    render('#u-mvp-battles', shown.filter(entry => entry.kind === 'battle'), '尚無 MVP 戰鬥結果');
    render('#u-mvp-loot', shown.filter(entry => entry.hasLoot), '尚無可辨識來源的 MVP 掉落');
  }

  function recordCharAlert(id, reason) {
    if (!id) return;
    if (state.charAlerts[id]?.reason !== '已停止掛機') state.charAlerts[id] = { reason, at: Date.now() };
    if (state.hudMin) document.getElementById('ro-fab')?.classList.add('roi-stop-alert');
  }
  function clearTransientCharAlerts(id, before = Infinity) {
    let changed = false;
    for (const [key, alert] of Object.entries(state.charAlerts)) {
      if ((id != null && String(id) !== key) || alert.reason === '已停止掛機' || alert.at > before) continue;
      delete state.charAlerts[key];
      changed = true;
    }
    if (changed) {
      if (!Object.keys(state.charAlerts).length) document.getElementById('ro-fab')?.classList.remove('roi-stop-alert');
      renderChars();
    }
  }
  let charMaps = null, charMapsRequested = false;
  function renderChars() {
    const box = document.getElementById('u-clist'); if (!box) return;
    if (!charMapsRequested && box.closest('.ro-pane.active') && state.chars.some((c) => c.mapId && !Object.hasOwn(TOWN_NAMES, c.mapId))) {
      charMapsRequested = true;
      Promise.resolve().then(loadLootPack).then((pack) => {
        charMaps = pack.maps;
        renderChars();
      }).catch(() => log('hud', '無法載入地圖名稱'));
    }
    for (const input of document.querySelectorAll('#roi-char-filters [data-ro-char-filter]')) {
      input.checked = state[input.dataset.roCharFilter];
    }
    const balance = (id) => Object.hasOwn(state.charZenyMap, id) && Number.isFinite(state.charZenyMap[id]) ? state.charZenyMap[id] : null;
    let sum = 0, pending = 0;
    for (const { id } of state.chars) {
      const value = balance(id);
      if (value === null) pending++;
      else sum += value;
    }
    document.getElementById('u-tzeny').textContent = !state.charRosterLoaded || (pending && pending === state.chars.length)
      ? '待同步' : sum.toLocaleString('zh-TW') + ' Z' + (pending ? `（${pending} 角待同步）` : '');
    const needsAttention = (c) => !c.running || Boolean(state.charAlerts[c.id]);
    const shown = state.charAttentionOnly ? state.chars.filter(needsAttention) : [...state.chars];
    if (state.charAttentionFirst) shown.sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)));
    if (!shown.length) {
      box.textContent = state.charAttentionOnly && state.chars.length ? '目前沒有停止或異常的分身'
        : state.charRosterLoaded ? '沒有分身資料' : '同步中…';
      return;
    }
    box.replaceChildren(...shown.map((c) => {
      const row = element('div', null, `display:flex;justify-content:space-between;align-items:center;background:var(--roi-panel);padding:6px 10px;border-radius:6px;margin-bottom:5px;border-left:3px solid ${c.running ? '#22c55e' : '#ef4444'}`);
      const detail = element('div');
      const map = charMaps?.get(c.mapId)?.name || (Object.hasOwn(TOWN_NAMES, c.mapId) && TOWN_NAMES[c.mapId]) || c.mapId || '—';
      const zeny = balance(c.id);
      const summary = element('div', `📍 ${map} ｜ 💰 ${zeny === null ? '待同步' : zeny.toLocaleString('zh-TW') + ' Z'}`, 'font-size:11px;color:var(--roi-info);margin-top:2px');
      if (c.mapId && c.mapId !== map) summary.title = c.mapId;
      detail.append(element('b', c.name), element('small', ` (Lv.${c.baseLv}/${c.jobLv})`, 'color:var(--roi-muted)'), summary);
      const alert = state.charAlerts[c.id];
      if (alert) {
        detail.append(element('small', '⚠ ' + alert.reason, 'color:var(--roi-danger)'));
        if (alert.reason !== '已停止掛機') row.onclick = () => clearTransientCharAlerts(c.id);
      }
      row.append(detail, element('b', c.running ? '🟢掛機' : '🔴停止', `color:${c.running ? 'var(--roi-success)' : 'var(--roi-danger)'}`));
      return row;
    }));
  }

  let lastInteractionAt = -Infinity;
  // ===== 全隊（同帳號）移到此地圖 =====
  // 指令與遊戲相同：POST /api/characters/{id}/commands {commandId, command}，同源 cookie + x-ro-client 標頭。
  // 「停止」要等那一場打完才生效（10 秒～數分鐘），所以等待改由隊伍資料判定，不用固定時間。
  const partyMapIdRx = /^[a-z0-9_]{1,40}$/i;
  class PartyMoveError extends Error {
    constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
  }
  function validatePartyView(value) {
    const id = (v) => Number.isSafeInteger(v) && v > 0;
    if (!isPlainRecord(value)) throw Error('隊伍資料格式不符');
    const party = value.party;
    if (party === null || party === undefined) return { party: null, own: [] };
    if (!isPlainRecord(party) || !id(party.id) || !Array.isArray(party.members) || party.members.length > 12) throw Error('隊伍資料格式不符');
    const members = party.members.map((m) => {
      if (!isPlainRecord(m) || !id(m.id) || typeof m.name !== 'string' || m.name.length > 40 || typeof m.running !== 'boolean' ||
          typeof m.mapId !== 'string' || !partyMapIdRx.test(m.mapId)) throw Error('隊員資料格式不符');
      return { id: m.id, name: m.name, mapId: m.mapId, running: m.running, baseLv: Number.isSafeInteger(m.baseLv) ? m.baseLv : null, job: typeof m.job === 'string' ? m.job.slice(0, 40) : '' };
    });
    const own = (Array.isArray(value.own) ? value.own : []).slice(0, 12).flatMap((o) => (
      isPlainRecord(o) && id(o.id) && (o.partyId === null || id(o.partyId)) ? [{ id: o.id, partyId: o.partyId, vending: o.vending === true }] : []));
    return { party: { id: party.id, leaderId: id(party.leaderId) ? party.leaderId : null, members }, own };
  }
  function planPartyMove(view, me, target, rosterIds) {
    if (!partyMapIdRx.test(target || '')) throw Error('沒有選擇有效的地圖');
    if (!view.party) throw Error('目前角色沒有隊伍');
    const mine = new Set([...rosterIds].map(Number));
    if (!mine.has(me)) throw Error('目前角色不在本帳號名單內');
    const own = new Map(view.own.filter((o) => o.partyId === view.party.id).map((o) => [o.id, o]));
    const meMember = view.party.members.find((m) => m.id === me);
    if (!meMember) throw Error('隊伍資料裡找不到目前角色');
    const rows = view.party.members.map((m) => {
      const self = m.id === me;
      const ours = self || (own.has(m.id) && mine.has(m.id));
      const vending = ours && own.get(m.id)?.vending === true;
      return { ...m, self, ours, vending, move: ours && !vending };
    });
    const movers = rows.filter((r) => r.move);
    if (movers.length < 2) throw Error('隊伍裡沒有其他可移動的同帳號角色');
    if (movers.every((r) => r.running && r.mapId === target)) throw Error('大家已經都在這張地圖掛機');
    return { me, target, rows, movers, stopIds: movers.filter((r) => r.running).map((r) => r.id) };
  }
  // deps：getParty()、command(id, cmd)、applyOwnMap(target)、kicks（EventTarget，遊戲有請求完成或戰鬥日誌時發 'settled'／'kick'）
  //       onStatus(text)、limits {stopWaitMs, verifyMs, minGapMs, heartbeatMs}
  function createPartyMoveRunner(deps) {
    const L = { stopWaitMs: 180000, verifyMs: 30000, minGapMs: 2500, heartbeatMs: 10000, ...deps.limits };
    let cancelled = false;
    const names = new Map();
    const label = (id) => names.get(id) || `#${id}`;
    const isRateLimit = (e) => e?.status === 429 || e?.code === 'RATE_LIMITED';
    let inFlight = 0, maxInFlight = 0;
    async function send(id, command) {
      if (cancelled) throw new PartyMoveError('已取消');
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await deps.command(id, command); }
      catch (e) { throw e instanceof PartyMoveError ? new PartyMoveError(`${label(id)}：${e.message}`, e.status, e.code) : new PartyMoveError(`${label(id)}：${e?.message || e}`); }
      finally { inFlight--; }
    }
    // 事件驅動等待：遊戲請求完成、戰鬥日誌、指令回應都會「踢」一下，重抓隊伍資料（至少間隔 minGapMs）；
    // 完全沒有事件時每 heartbeatMs 補抓一次；超過 timeoutMs 失敗。所有計時器與監聽在結束時清除。
    function waitParty(check, timeoutMs, describe) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        let done = false, fetching = false, lastFetch = 0, gapTimer = 0, beatTimer = 0, limitTimer = 0, last = null;
        const finish = (fn, v) => {
          if (done) return; done = true;
          clearTimeout(gapTimer); clearTimeout(beatTimer); clearTimeout(limitTimer);
          deps.kicks?.removeEventListener('settled', kick); deps.kicks?.removeEventListener('kick', kick);
          cancelHook = null; fn(v);
        };
        const fetchNow = async () => {
          if (done || fetching) return;
          fetching = true; lastFetch = Date.now();
          clearTimeout(beatTimer);
          try {
            last = await deps.getParty();
            if (done) return;
            const r = check(last);
            if (r) return finish(resolve, last);
            deps.onStatus?.(describe(last, Math.round((Date.now() - started) / 1000)));
          } catch (e) {
            if (isRateLimit(e)) return finish(reject, new PartyMoveError('讀取隊伍資料被限流：' + e.message, e.status, e.code));
          } finally {
            fetching = false;
            if (!done) beatTimer = setTimeout(fetchNow, L.heartbeatMs);
          }
        };
        function kick() {
          if (done || fetching || gapTimer) return;
          const wait = lastFetch + L.minGapMs - Date.now();
          if (wait <= 0) void fetchNow();
          else gapTimer = setTimeout(() => { gapTimer = 0; void fetchNow(); }, wait);
        }
        cancelHook = () => finish(reject, new PartyMoveError('已取消'));
        deps.kicks?.addEventListener('settled', kick); deps.kicks?.addEventListener('kick', kick);
        limitTimer = setTimeout(() => finish(reject, new PartyMoveError(`等候逾時（${Math.round(timeoutMs / 1000)} 秒）：` + describe(last || { party: null }, Math.round(timeoutMs / 1000)))), timeoutMs);
        void fetchNow();
      });
    }
    let cancelHook = null;
    async function run(plan, { startAfter = true } = {}) {
      for (const r of plan.rows) names.set(r.id, r.self ? `${r.name}（你）` : r.name);
      const stopped = [], started = [], lines = [];
      const byId = (view, id) => view?.party?.members.find((m) => m.id === id);
      let phase = 'apply';
      try {
        deps.onStatus?.('套用你的掛機地圖…');
        await deps.applyOwnMap(plan.target);
        phase = 'stop';
        for (const id of plan.stopIds) {
          deps.onStatus?.(`停止 ${label(id)}（${stopped.length + 1}/${plan.stopIds.length}）`);
          await send(id, { type: 'stop' });
          stopped.push(id);
        }
        if (plan.stopIds.length) {
          await waitParty((v) => plan.stopIds.every((id) => byId(v, id) && !byId(v, id).running), L.stopWaitMs, (v, s) => {
            const left = plan.stopIds.filter((id) => byId(v, id)?.running !== false).map(label);
            return `等待 ${left.join('、') || '隊員'} 打完這場（已等 ${s} 秒，可按取消）`;
          });
        }
        if (!startAfter) return { ok: true, lines: plan.movers.map((r) => `⏸️ ${label(r.id)}：已停止`), maxInFlight };
        phase = 'start';
        const fresh = await deps.getParty();
        const ordered = [...plan.movers].sort((a, b) => Number(b.self) - Number(a.self));
        for (const r of ordered) {
          const now = byId(fresh, r.id);
          if (!r.self && now?.mapId !== plan.target) {
            deps.onStatus?.(`${label(r.id)} 前往 ${plan.target}`);
            await send(r.id, { type: 'selectMap', mapId: plan.target });
          }
          deps.onStatus?.(`開始 ${label(r.id)}（${started.length + 1}/${ordered.length}）`);
          await send(r.id, { type: 'start' });
          started.push(r.id);
        }
        phase = 'verify';
        let final = null;
        try {
          final = await waitParty((v) => started.every((id) => byId(v, id)?.running && byId(v, id)?.mapId === plan.target), L.verifyMs,
            (v, s) => `確認大家都在 ${plan.target} 掛機（${s} 秒）`);
        } catch (e) {
          if (e.message === '已取消') throw e;
          final = await deps.getParty().catch(() => null);
        }
        for (const id of started) {
          const m = byId(final, id);
          const okRow = m?.running && m.mapId === plan.target;
          lines.push(`${okRow ? '✅' : '⚠️'} ${label(id)}：${m ? `${m.mapId}${m.running ? ' 掛機中' : ' 停止'}` : '讀不到狀態'}`);
        }
        for (const r of plan.rows.filter((x) => !x.move)) lines.push(`➖ ${label(r.id)}：${r.vending ? '擺攤中，未變動' : '非本帳號角色，未變動'}`);
        return { ok: lines.every((l) => !l.startsWith('⚠️')), lines, maxInFlight };
      } catch (e) {
        lines.push(`🛑 ${e.message}`);
        // 回復：被我們停掉、還沒重新開始的角色照原設定重新開始；被限流時不再送任何指令。
        const restore = stopped.filter((id) => !started.includes(id));
        if (restore.length && !isRateLimit(e) && phase !== 'apply') {
          const wasCancelled = cancelled; cancelled = false;
          for (const id of restore) {
            try { await send(id, { type: 'start' }); lines.push(`↩️ ${label(id)}：已恢復掛機（原地圖設定）`); }
            catch (err) { lines.push(`⚠️ ${label(id)}：恢復失敗（${err.message}），請手動開始`); if (isRateLimit(err)) break; }
          }
          cancelled = wasCancelled;
        } else if (restore.length) {
          for (const id of restore) lines.push(`⚠️ ${label(id)}：已停止，請稍後手動開始`);
        }
        for (const id of started) lines.push(`ℹ️ ${label(id)}：已送出開始`);
        return { ok: false, error: e, lines, maxInFlight };
      }
    }
    return { run, cancel() { cancelled = true; cancelHook?.(); }, get maxInFlight() { return maxInFlight; } };
  }

  let partyMoveActive = null;
  const partyMapGroup = () => [...document.querySelectorAll('[role="group"][aria-label="掛機地圖"]')].find(visible) || null;
  function partyCommandId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  // 與遊戲相同的請求方式：同源 cookie；POST 帶 content-type 與 x-ro-client。走 pollFetch，不計入 pageNet。
  async function partyApiJson(path, init = {}) {
    const res = await pollFetch(path, { credentials: 'same-origin', cache: 'no-store', ...init,
      signal: globalThis.AbortSignal?.timeout?.(init.method === 'POST' ? 30000 : 15000) });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { throw new PartyMoveError(`伺服器回應格式不正確（HTTP ${res.status}）`, res.status, 'INVALID_RESPONSE'); }
    if (!res.ok) throw new PartyMoveError(String(body?.error?.message || `請求失敗（HTTP ${res.status}）`).slice(0, 200), res.status, String(body?.error?.code || 'HTTP_' + res.status));
    return body;
  }
  async function partyCommand(id, command) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new PartyMoveError('角色編號不正確');
    const body = await partyApiJson(`/api/characters/${id}/commands`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ro-client': '1' },
      body: JSON.stringify({ commandId: partyCommandId(), command }) });
    if (body?.ok !== true) throw new PartyMoveError('伺服器沒有確認這個指令', 200, 'NOT_OK');
    pageNet.events.dispatchEvent(new Event('kick'));
    return body;
  }
  async function partyReadConfig(me) {
    const d = await partyApiJson(`/api/characters/${me}?deferCatchup=1`);
    const config = d?.snapshot?.config;
    if (Number(d?.characterId) !== me || !isPlainRecord(config) || typeof config.lockMap !== 'string') throw new PartyMoveError('讀不到你目前的掛機設定');
    return config;
  }
  // 掛機設定面板的實際結構（遊戲前端 index-Dxm6ToCt.js）：
  //   設定元件 props {snap, save, characterId}，草稿在它的 useState（未修改時為 null，畫面用 draft ?? snap.config）
  //   └ 分頁容器 props {on, draft, advanced}（draft = 目前草稿，沒有 update）
  //     └ … └ 地圖選單 props {label:'掛機地圖', maps, value: draft.lockMap, onChange} → role=group 的 DOM
  //   有 {draft, update} 的元件是「藥水與補給」等兄弟區塊，不是地圖選單的祖先，所以不能用它來找。
  const partyLog = (...args) => { log('party-move', ...args); };
  function partyReadSettings(group) {
    const read = (matcher) => readFiberForUi(() => getCommittedProps(group, matcher)) || null;
    const picker = read((x) => x?.label === '掛機地圖' && Object.hasOwn(x, 'value'));
    const holder = read((x) => x?.draft && typeof x.draft === 'object' && typeof x.draft.lockMap === 'string');
    const panel = read((x) => x?.snap?.config && typeof x.snap.config === 'object' && typeof x.save === 'function');
    const pressed = [...group.querySelectorAll('button[aria-pressed="true"]')].filter(visible);
    const domTarget = pressed.length === 1 ? String(getReactFiber(pressed[0])?.key ?? '') : '';
    const applyBtns = [...document.querySelectorAll('button')].filter((b) => visible(b) && clean(b.textContent) === '套用設定');
    const applyEnabled = applyBtns.length ? applyBtns.some((b) => !b.disabled) : null;
    const candidates = [picker?.value, holder?.draft?.lockMap, domTarget].filter((v) => typeof v === 'string' && partyMapIdRx.test(v));
    const target = candidates[0] || '';
    const info = {
      target, draft: holder?.draft || null, applied: panel?.snap?.config || null, applyEnabled,
      diag: {
        picker: picker ? { value: typeof picker.value === 'string' ? picker.value : typeof picker.value, maps: Array.isArray(picker.maps) ? picker.maps.length : null } : null,
        draftHolder: holder ? Object.keys(holder).slice(0, 8) : null,
        panel: panel ? Object.keys(panel).slice(0, 8) : null,
        domTarget: domTarget || null, pressedButtons: pressed.length,
        applyButtons: applyBtns.length, applyEnabled,
        fiber: Boolean(getReactFiber(group)), candidatesAgree: new Set(candidates).size <= 1,
      },
    };
    if (applyEnabled === false) resetRareSyncDelta();
    partyLog('讀取掛機設定', info.diag);
    return info;
  }
  // 比較用的正規化：物件鍵排序、undefined 當作沒有；必撿稀有掉落當集合比（順序無關，空陣列 = 未設定）。
  const partyNorm = (v) => v === null || typeof v !== 'object' ? v
    : Array.isArray(v) ? v.map(partyNorm)
      : Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, partyNorm(v[k])]));
  const partyIdSet = (v) => new Set(Array.isArray(v) ? v.map(Number).filter(Number.isSafeInteger) : []);
  function partyDraftDiffKeys(draft, config) {
    const keys = new Set([...Object.keys(draft), ...Object.keys(config)]);
    keys.delete('lockMap');
    return [...keys].filter((k) => {
      if (k === 'rarePickup') {
        const a = partyIdSet(draft[k]), b = partyIdSet(config[k]);
        return a.size !== b.size || [...a].some((x) => !b.has(x));
      }
      return JSON.stringify(partyNorm(draft[k])) !== JSON.stringify(partyNorm(config[k]));
    }).sort();
  }
  // 只回報形狀（型別、長度、鍵數），不印內容。
  const partyShape = (v) => v === undefined ? 'undefined' : v === null ? 'null' : Array.isArray(v) ? `array(${v.length})`
    : typeof v === 'object' ? `object(${Object.keys(v).length} keys)` : typeof v === 'boolean' ? String(v) : typeof v;
  // 地圖連動的必撿稀有掉落：差異必須完全是「隨地圖同步」這次自己勾／取消的道具，且同步對象就是目標地圖。
  function partyRareCoupling(draft, config, me, target) {
    const a = partyIdSet(draft.rarePickup), b = partyIdSet(config.rarePickup);
    const added = [...a].filter((x) => !b.has(x)), removed = [...b].filter((x) => !a.has(x));
    const d = rareSyncDelta;
    const reasons = [];
    if (!rareAutoMap) reasons.push('sync-off');
    if (d.tainted) reasons.push('sync-unknown-id');
    if (d.charId !== me) reasons.push('sync-other-char');
    if (d.lockMap !== target) reasons.push('sync-other-map');
    const manualAdded = added.filter((x) => d.net.get(x) !== true).length;
    const manualRemoved = removed.filter((x) => d.net.get(x) !== false).length;
    if (manualAdded || manualRemoved) reasons.push('not-from-sync');
    return { ok: reasons.length === 0, added: added.length, removed: removed.length, manualAdded, manualRemoved, syncNet: d.net.size, reasons };
  }
  // extra：[] 代表除了地圖（與地圖連動的必撿稀有掉落）沒有其他修改；null 代表無法確認。
  function partyExtraChanges(info, config, me, target) {
    if (!info.draft) return { extra: info.applyEnabled === false ? [] : null, rare: null };
    let extra = partyDraftDiffKeys(info.draft, config), rare = null;
    if (extra.includes('rarePickup')) {
      rare = partyRareCoupling(info.draft, config, me, target);
      if (rare.ok) extra = extra.filter((k) => k !== 'rarePickup');
    }
    if (extra.length || rare || debugEnabled()) {
      const diff = partyDraftDiffKeys(info.draft, config).map((k) => ({ key: k, before: partyShape(config[k]), after: partyShape(info.draft[k]) }));
      partyLog('草稿差異', { target, applied: config.lockMap, diff, rare, blocking: extra });
    }
    return { extra, rare };
  }
  function partyMapNames(group) {
    for (let f = getReactFiber(group); f; f = f.return) {
      const p = f.memoizedProps;
      if (p?.label === '掛機地圖' && Array.isArray(p.maps)) {
        return new Map(p.maps.filter((m) => typeof m?.id === 'string' && typeof m.name === 'string').map((m) => [m.id, m.name]));
      }
    }
    return new Map();
  }
  async function partyApplyOwnMap(me, target, group) {
    const config = await partyReadConfig(me);
    if (config.lockMap === target) return;
    const info = partyReadSettings(group);
    if (info.target !== target) throw new PartyMoveError('掛機設定的地圖已變更，請重新操作');
    const { extra } = partyExtraChanges(info, config, me, target);
    if (extra === null) throw new PartyMoveError('讀不到完整草稿，無法確認有沒有其他未套用的修改；請先手動按「套用設定」再按 🚩');
    if (extra.length) throw new PartyMoveError(`掛機設定還有其他未套用的修改（${extra.slice(0, 5).join('、')}），請先套用或還原`);
    const btn = [...document.querySelectorAll('button')].find((b) => visible(b) && !b.disabled && clean(b.textContent) === '套用設定');
    if (!btn) throw new PartyMoveError('找不到「套用設定」按鈕，請保持掛機設定開著');
    const path = `/api/characters/${me}/commands`;
    const settled = new Promise((resolve, reject) => {
      const on = (e) => { if (e.detail?.method === 'POST' && e.detail.path === path) { off(); resolve(e.detail.status); } };
      const timer = setTimeout(() => { off(); reject(new PartyMoveError('套用設定逾時（20 秒），請檢查掛機設定')); }, 20000);
      const off = () => { clearTimeout(timer); pageNet.events.removeEventListener('settled', on); };
      pageNet.events.addEventListener('settled', on);
    });
    btn.click();
    const status = await settled;
    const after = await partyReadConfig(me);
    if (after.lockMap !== target) throw new PartyMoveError(`套用後掛機地圖仍是 ${after.lockMap}（HTTP ${status}）`);
  }
  function showPartyMoveDialog(plan, mapNames, needApply, rare = null) {
    const mapLabel = (id) => mapNames.get(id) ? `${mapNames.get(id)}（${id}）` : id;
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.dataset.roiPartyMoveDialog = '';
      dlg.style.cssText = 'width:min(560px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:var(--roi-surface);color:var(--roi-text);border:1.5px solid #38bdf8;border-radius:12px;box-shadow:0 16px 48px var(--roi-shadow);font-size:13px;';
      dlg.append(element('div', `🚩 全隊移到 ${mapLabel(plan.target)}`, 'font-weight:bold;font-size:15px;color:var(--roi-info);border-bottom:1px solid var(--roi-edge);padding-bottom:8px;margin-bottom:8px;'));
      const list = element('div', null, 'max-height:46vh;overflow:auto;margin-bottom:10px;border:1px solid var(--roi-edge);border-radius:6px;padding:6px 10px;background:var(--roi-inset);');
      for (const r of plan.rows) {
        const row = element('div', null, 'display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed var(--roi-edge)');
        const who = `${r.name}${r.self ? '（你）' : ''}${r.baseLv ? ` Lv${r.baseLv}` : ''}`;
        const st = !r.ours ? '非本帳號，不動' : r.vending ? '擺攤中，不動' : r.running ? '掛機中 → 停止後移動' : '停止 → 移動';
        row.append(element('span', who), element('span', `${mapLabel(r.mapId)} → ${r.move ? mapLabel(plan.target) : '—'}`, 'color:var(--roi-text)'), element('b', st, `color:${r.move ? 'var(--roi-success)' : 'var(--roi-muted)'};white-space:nowrap`));
        list.append(row);
      }
      dlg.append(list);
      const notes = [
        needApply ? `會先替你按「套用設定」，把你的掛機地圖改成 ${mapLabel(plan.target)}。` : '',
        needApply && rare && (rare.added || rare.removed) ? `必撿稀有掉落已隨地圖同步更新（新增 ${rare.added}、取消 ${rare.removed} 項），會和地圖一起套用。` : '',
        plan.stopIds.length ? '「停止」要等那一場打完才生效，可能要等幾十秒到幾分鐘，過程中可以取消。' : '',
      ].filter(Boolean).join(' ');
      if (notes) dlg.append(element('div', notes, 'font-size:12px;color:var(--roi-text);margin-bottom:8px;'));
      const startLabel = element('label', ' 完成後全部開始掛機', 'display:flex;gap:4px;align-items:center;font-size:12px;margin-bottom:10px;');
      const startBox = element('input'); startBox.type = 'checkbox'; startBox.checked = true; startLabel.prepend(startBox);
      dlg.append(startLabel);
      const btns = element('div', null, 'display:flex;justify-content:flex-end;gap:8px;');
      const cancel = element('button', '取消'); cancel.type = 'button'; cancel.className = 'xp-btn small';
      const ok = element('button', '確定移動'); ok.type = 'button'; ok.className = 'xp-btn small primary';
      btns.append(cancel, ok); dlg.append(btns);
      let result = null, done = false;
      // Esc 會觸發 close；按鈕直接收尾。任何路徑都只移除一次、只回覆一次。
      const finish = () => { if (done) return; done = true; if (dlg.open && typeof dlg.close === 'function') dlg.close(); dlg.remove(); resolve(result); };
      dlg.addEventListener('close', finish);
      cancel.onclick = finish;
      ok.onclick = () => { result = { startAfter: startBox.checked }; finish(); };
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    });
  }
  async function startPartyMove(bar) {
    const status = bar.querySelector('[data-roi-party-move-status]');
    const btn = bar.querySelector('[data-roi-party-move]');
    const stopBtn = bar.querySelector('[data-roi-party-move-cancel]');
    const out = bar.querySelector('[data-roi-party-move-result]');
    if (partyMoveActive || document.hidden) return;
    if (hasActiveOperation()) { status.textContent = '⚠️ 精煉／領倉進行中，請稍後再試'; return; }
    const group = partyMapGroup();
    const me = Number(state.activeCharId);
    btn.disabled = true; out.replaceChildren();
    try {
      if (!group) throw Error('請先開啟掛機設定的地圖選單');
      if (!Number.isSafeInteger(me) || me <= 0) throw Error('還不知道目前角色，請稍候再試');
      status.textContent = '讀取隊伍與設定…';
      const info = partyReadSettings(group);
      if (!info.target) {
        console.warn('[ROI party-move] 讀不到掛機設定選的地圖', info.diag);
        throw Error('讀不到掛機設定選的地圖，請在地圖選單點選一張地圖後再試');
      }
      if (!info.diag.candidatesAgree) console.warn('[ROI party-move] 地圖來源不一致，以選單 value 為準', info.diag);
      const target = info.target;
      const config = await partyReadConfig(me);
      const { extra, rare } = partyExtraChanges(info, config, me, target);
      if (extra === null) {
        console.warn('[ROI party-move] 讀不到完整草稿且有未套用的修改', info.diag);
        throw Error('讀不到完整草稿，無法確認有沒有其他未套用的修改；請先手動按「套用設定」再按 🚩');
      }
      if (extra.length) throw Error(`掛機設定還有其他未套用的修改（${extra.slice(0, 5).join('、')}），請先套用或還原，再使用全隊移動`);
      const view = validatePartyView(await partyApiJson(`/api/characters/${me}/party`));
      const plan = planPartyMove(view, me, target, nativeRosterIds?.size ? nativeRosterIds : state.myCharIds);
      status.textContent = '請在視窗中確認';
      const choice = await showPartyMoveDialog(plan, partyMapNames(group), config.lockMap !== target, rare?.ok ? rare : null);
      if (!choice) { status.textContent = '已取消'; return; }
      if (Number(state.activeCharId) !== me) throw Error('角色已切換，請重新操作');
      const runner = createPartyMoveRunner({
        getParty: async () => validatePartyView(await partyApiJson(`/api/characters/${me}/party`)),
        command: partyCommand,
        applyOwnMap: (t) => partyApplyOwnMap(me, t, group),
        kicks: pageNet.events,
        onStatus: (text) => { status.textContent = text; },
      });
      partyMoveActive = runner;
      stopBtn.hidden = false;
      const result = await runner.run(plan, choice);
      status.textContent = result.ok ? '🎉 全隊移動完成' : '⚠️ 全隊移動沒有全部完成，請看下方明細';
      for (const line of result.lines) out.append(element('div', line));
      alertUser(result.ok ? '🚩 全隊移動完成' : '⚠️ 全隊移動未完成', result.lines.slice(0, 6).join('\n'), !result.ok);
    } catch (e) {
      status.textContent = '⚠️ ' + (e?.message || e);
    } finally {
      partyMoveActive = null;
      btn.disabled = false; stopBtn.hidden = true;
    }
  }
  function syncPartyMoveBar() {
    const bars = [...document.querySelectorAll('[data-roi-party-move-bar]')];
    const group = partyMapGroup();
    if (!group) { if (!partyMoveActive) bars.forEach((b) => b.remove()); return; }
    let bar = bars.shift();
    bars.forEach((b) => b.remove());
    if (!bar) {
      bar = element('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0;font-size:12px;');
      bar.dataset.roiPartyMoveBar = '';
      const btn = element('button', '🚩 全隊移到此地圖'); btn.type = 'button'; btn.className = 'xp-btn small'; btn.dataset.roiPartyMove = '';
      btn.title = '把同隊的自己角色停止、換到這張地圖，再一起開始掛機';
      const stop = element('button', '取消'); stop.type = 'button'; stop.className = 'xp-btn small'; stop.dataset.roiPartyMoveCancel = ''; stop.hidden = true;
      const status = element('span', null, 'color:var(--roi-info)'); status.dataset.roiPartyMoveStatus = '';
      const out = element('div', null, 'flex-basis:100%;font-size:11.5px;line-height:1.5'); out.dataset.roiPartyMoveResult = '';
      btn.onclick = () => { void startPartyMove(bar); };
      stop.onclick = () => { partyMoveActive?.cancel(); };
      bar.append(btn, stop, status, out);
    }
    if (group.nextElementSibling !== bar) group.after(bar);
  }

  const hasActiveOperation = () => refBusy || cartShortcutBusy || visitingWarehouse || partyMoveActive !== null;
  const isActiveWindow = () => hasActiveOperation() ||
    (!document.hidden && (document.hasFocus() || performance.now() - lastInteractionAt <= TIMING.recentInteraction));

  function trackRouterInteraction() {
    if (document.hidden) return;
    const now = performance.now();
    if (now - lastInteractionAt >= TIMING.pointerSample) lastInteractionAt = now;
  }

  for (const event of ['pointermove', 'keydown', 'pointerdown']) {
    document.addEventListener(event, trackRouterInteraction, { passive: true, capture: true });
  }

  function routerDelay() {
    if (isActiveWindow()) return TIMING.activeRouter;
    return document.hidden ? TIMING.hiddenRouter : TIMING.visibleRouter;
  }
  const logSnapshots = [];
  let logTimer = null;
  let lastAlertRender = -Infinity;
  let alertRenderTimer = null;
  function renderLogAlertChars() {
    if (alertRenderTimer !== null) return;
    const remaining = TIMING.alertRenderGap - (performance.now() - lastAlertRender);
    if (remaining > 0) {
      alertRenderTimer = setTimeout(() => {
        alertRenderTimer = null;
        lastAlertRender = performance.now();
        renderChars();
      }, remaining);
      return;
    }
    lastAlertRender = performance.now();
    renderChars();
  }
  function flushLogBatch(size) {
    for (const { text, historical, combatEvent } of logSnapshots.splice(0, size)) parseLog(text, historical, combatEvent);
  }
  function scheduleLogBatch() {
    if (logTimer !== null || !logSnapshots.length) return;
    logTimer = setTimeout(() => {
      logTimer = null;
      flushLogBatch(document.hidden ? 800 : 200);
      scheduleLogBatch();
    }, isActiveWindow() ? TIMING.activeLogFlush : TIMING.idleLogFlush);
  }
  function queueLogLine(line, historical = false) {
    if (!line) return;
    const text = clean(line.textContent);
    if (!text || state.processedLines.get(line) === text) return;
    state.processedLines.set(line, text);
    let combatEvent = null;
    if (!historical) {
      const gameLog = getReactFiber(line)?.return?.memoizedProps?.l;
      if (Number.isSafeInteger(gameLog?.id) && Number.isFinite(gameLog.wall) &&
          typeof gameLog.text === 'string' && gameLog.text.trim() && text.endsWith(clean(gameLog.text))) {
        combatEvent = { id: gameLog.id, wall: gameLog.wall };
      }
      const eventId = combatEvent ? `${combatEvent.wall}/${combatEvent.id}` : null;
      recordMvpLog(text, state.activeCharId, eventId);
    }
    if (rxRareDrop.test(text)) {
      state.rares.unshift(`[${new Date().toLocaleTimeString()}] ✨ ${text}`);
      if (state.rares.length > rareLimit) state.rares.pop();
      state.rareRev++;
      alertUser('✨ 稀有掉落', text, false);
    }
    if (rxDangerLog.test(text)) {
      recordCharAlert(state.activeCharId, text.includes('負重') ? '負重停止' : '戰鬥不能');
      renderLogAlertChars();
      alertUser('⚠️ 掛機異常', text, true);
    }
    if (state.paused) return;
    if (logSnapshots.length >= 2000) flushLogBatch(document.hidden ? 800 : 200);
    logSnapshots.push({ text, historical, combatEvent });
    scheduleLogBatch();
  }
  function clearQueuedCharacterLogs() {
    // 警報及稀有紀錄已在讀取舊角色文字時寫入；此處只清理待計統計。
    clearTimeout(logTimer);
    logTimer = null;
    logSnapshots.length = 0;
  }

  let lastRouterAt = 0;
  function runPageRouter() {
    lastRouterAt = Date.now();
    refreshRareHelper();
    const refreshAnnotations = !document.hidden || hasActiveOperation();
    if (refreshAnnotations && document.querySelector('table.xp-table')) alignAndColorizeNativeMarkets();
    if (document.querySelector('input[aria-label="搜尋物品"]') || refPanel) refreshRefinePanel();
    const legends = [...document.querySelectorAll('fieldset > legend')].map((l) => clean(l.textContent));
    if (
      document.querySelector([lootItemGroupSelector, lootOpenKoreSelector, monsterSelectSelector].join(',')) ||
      rareKnownRoots.size > 0 ||
      legends.some((t) => /^必撿稀有掉落/.test(t))
    ) mountSettingsTools();
    syncPartyMoveBar();
    if (legends.some((t) => /^倉庫/.test(t))) refreshWarehouse();
    if (legends.some((t) => /的攤位/.test(t)) || mktPanel.isConnected || townResultsTable) syncMktMount();
    if (refreshAnnotations) annotateAllRefinedEquipment();
    syncHudSettings();
    mvpRadar?.syncFromStats();
    hudYield?.();
  }

  let uiTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    clearTimeout(uiTimer);
    uiTimer = null;
    runPageRouter();
    if (canShareCharPoll()) void pollChars();
  });
  const ROUTER_TEXT_SCOPE = 'fieldset,table,legend,.xp-sunken,[role="dialog"],select,label';
  const ROUTER_SLOW_DELAY = TIMING.textRouter;
  let slowTimer = null;
  new MutationObserver((records) => {
    let domChanged = false, slowChanged = false, sawLog = false;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el || !el.isConnected || el.closest('#ro-helper-hud,#roi-helper-mvp-panel,#roi-item-hover-tooltip,[data-roi-market-browser],[data-ro-wh-bar],[data-ro-rare-helper],[data-roi-settings-tools],[data-roi-refine-helper],[data-roi-price-search],[data-roi-upper-fold],[data-roi-party-move-bar],[data-roi-party-move-dialog]')) continue;
      if (r.type === 'attributes' && !el.matches('fieldset') && !el.querySelector('fieldset') &&
          !el.matches(hudSkillControls) && !el.querySelector(hudSkillControls) &&
          !el.matches('[role="tabpanel"][aria-label="道具"]') && !el.querySelector('[role="tabpanel"][aria-label="道具"]')) continue;
      if (el.closest('.log-window')) {
        sawLog = true;
        if (r.type === 'characterData' || r.type === 'childList') queueLogLine(el.closest('.log-line'));
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('.log-line')) queueLogLine(n);
          n.querySelectorAll?.('.log-line').forEach(line => queueLogLine(line));
        });
        continue;
      }
      if (r.type === 'childList') r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        n.querySelectorAll?.('.log-window .log-line').forEach(line => queueLogLine(line));
      });
      // 純文字變動且不在需處理的容器內：改走慢速通道，避免倒數計時、HP 等文字每 160ms 觸發整頁路由。
      if (!el.closest(ROUTER_TEXT_SCOPE) && (r.type === 'characterData' ||
          (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 3)))) { slowChanged = true; continue; }
      domChanged = true;
    }
    // 全隊移動等待中：戰鬥日誌有新行代表伺服器狀態在推進，提醒等待器重抓隊伍資料（有最小間隔）。
    if (sawLog && partyMoveActive) pageNet.events.dispatchEvent(new Event('kick'));
    if (domChanged && !uiTimer) {
      clearTimeout(slowTimer); slowTimer = null;
      uiTimer = setTimeout(() => { uiTimer = null; runPageRouter(); }, routerDelay());
    } else if (slowChanged && !uiTimer && !slowTimer) {
      slowTimer = setTimeout(() => { slowTimer = null; if (!uiTimer) runPageRouter(); }, ROUTER_SLOW_DELAY);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes:true, attributeFilter:['hidden','aria-hidden','inert','class','style'] });

  // MVP 雷達（個人 MVP 時刻表）：融入儀表盤頂部與分頁，點選視窗外畫面自動關閉（儀表盤保留）
  function createMvpSchedule() {
    const schedules = {"俄塞里斯":[["夢羅克金字塔 4樓","moc_pryd04",3600000,600000]],"巴風特":[["普隆德拉迷宮森林 3樓","prt_maze03",7200000,600000]],"死靈":[["吉芬地下密穴 3樓","gef_dun02",7200000,600000]],"蜂后":[["妙勒妙勒尼山脈北區 04","mjolnir_04",7200000,600000]],"黃金蟲":[["普隆德拉地下水道 4樓","prt_sewb4",3600000,600000]],"獸人英雄":[["吉芬原野 02","gef_fild02",86400000,600000],["西邊 獸人村","gef_fild14",3600000,600000]],"海盜之王":[["艾爾貝塔沈船 2樓","treasure02",7200000,600000]],"虎王":[["斐揚森林 11","pay_fild11",7200000,600000]],"蟻后":[["夢羅克螞蟻地獄密穴 2樓","anthell02",7200000,600000]],"月夜貓":[["斐揚洞穴 5樓(廢村)","pay_dun04",3600000,600000]],"法老王":[["夢羅克人面獅身像 地下 5樓","in_sphinx5",3600000,600000]],"皮里恩":[["蘇克拉特沙漠 17","moc_fild17",7200000,600000]],"獸人酋長":[["獸人村","gef_fild10",7200000,600000]],"冰暴騎士":[["薑餅城玩具分類場","xmas_dun02",3600000,600000]],"卡崙":[["薑餅城原野","xmas_fild01",7200000,600000]],"黑暗之王":[["克雷斯特漢姆古城 地下公墓","gl_chyard",3600000,600000]],"烏龜將軍":[["舊良宮","tur_dun04",3600000,600000]],"死靈騎士":[["尼芙菲姆 鬼峽谷","nif_fild02",7980000,0]],"德古拉男爵":[["吉芬地下密穴 2樓","gef_dun01",3600000,600000]],"墨蛇君":[["崑崙武陵道院","gon_dun03",5650000,600000]],"元靈武士":[["天津町 地下神舍","ama_dun03",5460000,600000]],"古埃及王":[["夢羅克金字塔 地下 2樓","moc_pryd06",3600000,600000]],"塔奧群卡":[["克魔島西邊洞穴加露","beach_dun",18000000,600000]],"RSX-0806":[["艾音貝赫礦山 2樓","ein_dun02",7500000,600000]],"白素貞":[["龍之城審良宮","lou_dun03",7000000,600000]],"騎士領主 賽依連":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"十字刺客 艾勒梅斯":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神工匠 哈沃得":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神官 瑪嘉雷特":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"神射手 迪文":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"超魔導師 凱特莉娜":[["活體實驗研究所 地下 3樓","lhz_dun03",6000000,1800000]],"闇●劍士 賽尼亞":[["活體實驗研究所 地下 2樓","lhz_dun02",7200000,600000]],"貝思波":[["優配擂斯中心部","jupe_core",7200000,600000]],"嗒妮小姐":[["哎喲泰雅 古神殿內部","ayo_dun02",25200000,600000]],"迪塔勒泰晤勒斯":[["毀葛深淵湖水 地下洞穴 3樓","abyss_03",10800000,600000]],"齊爾-D-01":[["機械娃娃工廠 2樓","kh_dun02",7200000,3600000]],"蘭特克力斯":[["毀葛奧丁神殿北區","odin_tem03",28800000,600000]],"幽暗夢魘":[["拉赫神殿聖域二樓中區","ra_san05",18000000,600000]],"阿特羅斯":[["拉赫歐茲峽谷 02","ra_fild02",14400000,600000],["拉赫 伊達平原 03","ra_fild03",10800000,600000],["拉赫 阿巫敦拉草原 04","ra_fild04",18000000,600000]],"伊夫利特":[["菲音斯 托爾火山洞穴 3樓","thor_v03",39600000,600000]],"墮落大神官 悉潘":[["無名島修道院 地下1樓","abbey02",7200000,600000]],"詛咒蠅王":[["無名島修道院 地下2樓","abbey03",43200000,600000]],"青冠龍":[["莫斯科森林最深處","mosk_dun03",7200000,600000]]};
    const format = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    const formatTimeOnly = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });

    function readMinute(text, now) {
      const line = text.normalize('NFKC').trim();
      const match = line.match(/最後一次擊殺:\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/)
        || line.match(/打倒過\s*\(\s*(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*\)\s*,\s*隊伍現在遇不到/);
      if (!match) return null;
      const [, month, day, hour, minute] = match.map(Number);
      if (hour > 23 || minute > 59) return null;
      const taipeiNow = new Date(now + 8 * 3600000);
      const year = taipeiNow.getUTCFullYear();
      let nearest = null;
      for (const y of [year, year - 1, year + 1]) {
        const local = new Date(Date.UTC(y, month - 1, day, hour, minute));
        const time = local.getTime() - 8 * 3600000;
        if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || time > now + 300000) continue;
        if (nearest === null || Math.abs(time - now) < Math.abs(nearest - now)) nearest = time;
      }
      return nearest;
    }

    function node(tag, text, className) {
      const el = document.createElement(tag);
      if (text != null) el.textContent = text;
      if (className) el.className = className;
      return el;
    }

    function formatDuration(ms) {
      const totalMin = Math.max(1, Math.ceil(ms / 60000));
      if (totalMin < 60) return totalMin + ' 分';
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
    }

    function formatRange(start, end) {
      const s = format.format(start);
      const eFull = format.format(end);
      return s.slice(0, 5) === eFull.slice(0, 5)
        ? `${s} ～ ${formatTimeOnly.format(end)}`
        : `${s} ～ ${eFull}`;
    }

    const monsterIds = {"俄塞里斯":1038,"巴風特":1039,"死靈":1046,"蜂后":1059,"黃金蟲":1086,"獸人英雄":1087,"海盜之王":1112,"虎王":1115,"蟻后":1147,"月夜貓":1150,"法老王":1157,"皮里恩":1159,"獸人酋長":1190,"冰暴騎士":1251,"卡崙":1252,"黑暗之王":1272,"烏龜將軍":1312,"死靈騎士":1373,"德古拉男爵":1389,"墨蛇君":1418,"元靈武士":1492,"古埃及王":1511,"塔奧群卡":1583,"RSX-0806":1623,"白素貞":1630,"騎士領主 賽依連":1646,"十字刺客 艾勒梅斯":1647,"神工匠 哈沃得":1648,"神官 瑪嘉雷特":1649,"神射手 迪文":1650,"超魔導師 凱特莉娜":1651,"闇●劍士 賽尼亞":1658,"貝思波":1685,"嗒妮小姐":1688,"迪塔勒泰晤勒斯":1719,"齊爾-D-01":1734,"蘭特克力斯":1751,"幽暗夢魘":1768,"阿特羅斯":1785,"伊夫利特":1832,"墮落大神官 悉潘":1871,"詛咒蠅王":1874,"青冠龍":1885};
    const frames = new Map();
    async function drawPortrait(canvas) {
      const id = canvas.dataset.monster;
      try {
        if (!frames.has(id)) frames.set(id, fetch('/client/mob/'+id+'.json')
          .then(async response => {
            if (!response.ok) throw Error();
            const frame = (await response.json()).stand.frames[0];
            if (!Array.isArray(frame) || frame.length < 4 || !frame.slice(0,4).every(Number.isFinite) || frame[2] <= 0 || frame[3] <= 0) throw Error();
            return frame;
          }).catch(error => { frames.delete(id); throw error; }));
        const [x,y,w,h] = await frames.get(id);
        if (!canvas.isConnected || !isRadarOpen()) { if (canvas.isConnected) portraits.observe(canvas); return; }
        const image = new Image();
        image.src = '/client/mob/'+id+'.png';
        await image.decode();
        const ctx = canvas.getContext('2d');
        const scale = Math.min(2, (canvas.width-8)/w, (canvas.height-8)/h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image,x,y,w,h,(canvas.width-w*scale)/2,(canvas.height-h*scale)/2,w*scale,h*scale);
      } catch {
        if (canvas.isConnected) canvas.parentElement?.replaceChildren(node('small','圖片暫缺','no-portrait'));
      }
    }

    const style = node('style', `
      #roi-helper-mvp-open {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 0;
        border-bottom: 2px solid transparent;
        background: transparent;
      }
      #roi-helper-mvp-open:hover,
      #roi-helper-mvp-open[aria-expanded="true"] {
        border-bottom-color: var(--roi-warning);
        color: var(--roi-warning);
        background: var(--roi-panel);
      }
      #roi-helper-mvp-open .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 16px;
        height: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: #f59e0b;
        color: #16120a;
        font-size: 10.5px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-open .badge:empty { display: none; }

      #roi-helper-mvp-panel {
        position: fixed;
        inset: 0;
        margin: auto;
        z-index: 2147483647;
        box-sizing: border-box;
        width: min(920px, calc(100vw - 24px));
        height: fit-content;
        max-height: 84vh;
        max-height: 84dvh;
        padding: 0;
        background: var(--roi-surface);
        backdrop-filter: blur(12px);
        color: var(--roi-text);
        border: 1.5px solid var(--roi-frame);
        border-radius: 12px;
        box-shadow: 0 20px 64px var(--roi-shadow);
        font: 13.5px/1.45 system-ui, -apple-system, "Microsoft JhengHei", sans-serif;
        overflow: hidden;
      }
      #roi-helper-mvp-panel:not([open]) { display: none; }
      #roi-helper-mvp-panel[open] { display: flex; flex-direction: column; }

      #roi-helper-mvp-panel button {
        border: 1px solid var(--roi-edge);
        background: var(--roi-panel);
        color: var(--roi-text);
        border-radius: 7px;
        padding: 6px 12px;
        font: inherit;
        cursor: pointer;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      #roi-helper-mvp-panel button:hover {
        background: var(--roi-selected);
        border-color: #6b84a3;
      }
      #roi-helper-mvp-panel button:focus-visible,
      #roi-helper-mvp-open:focus-visible,
      #roi-helper-mvp-panel input:focus-visible {
        outline: 2px solid #ffcf80;
        outline-offset: 2px;
      }

      #roi-helper-mvp-panel header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 11px 16px;
        background: var(--roi-title);
        border-top: 2px solid #fbbf24;
        border-bottom: 1px solid var(--roi-edge);
      }
      #roi-helper-mvp-panel .title-wrap {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      #roi-helper-mvp-panel .title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #roi-helper-mvp-panel h2 {
        margin: 0;
        color: var(--roi-info);
        font-size: 16.5px;
        font-weight: 750;
        letter-spacing: .02em;
      }
      #roi-helper-mvp-panel .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      #roi-helper-mvp-panel .btn-ghost {
        background: transparent;
        border-color: #3d4f66;
        color: var(--roi-muted);
      }
      #roi-helper-mvp-panel .btn-ghost:hover {
        background: var(--roi-panel);
        color: var(--roi-text);
      }

      #roi-helper-mvp-panel .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 16px;
        background: var(--roi-panel);
        border-bottom: 1px solid var(--roi-edge);
      }
      #roi-helper-mvp-panel .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #roi-helper-mvp-panel .filter-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid var(--roi-edge);
        background: var(--roi-panel);
        color: var(--roi-muted);
        font-size: 12.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .filter-chip:hover {
        border-color: #5a7291;
        color: var(--roi-text);
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] {
        background: var(--roi-selected);
        border-color: #82a6d1;
        color: var(--roi-text);
        font-weight: 650;
      }
      #roi-helper-mvp-panel .filter-chip .count {
        padding: 0 5px;
        border-radius: 999px;
        background: var(--roi-surface);
        color: var(--roi-muted);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] .count {
        background: var(--roi-panel);
        color: var(--roi-warning);
      }

      #roi-helper-mvp-panel .search-wrap {
        position: relative;
        flex: 1 1 200px;
        max-width: 260px;
      }
      #roi-helper-mvp-panel .search-input {
        width: 100%;
        box-sizing: border-box;
        padding: 5px 28px 5px 10px;
        border: 1px solid var(--roi-edge);
        border-radius: 7px;
        background: var(--roi-surface);
        color: var(--roi-text);
        font: inherit;
        font-size: 13px;
      }
      #roi-helper-mvp-panel .search-input::placeholder { color: var(--roi-muted); }
      #roi-helper-mvp-panel .search-clear {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        padding: 1px 6px;
        border: none;
        background: transparent;
        color: var(--roi-muted);
        font-size: 14px;
        line-height: 1;
      }
      #roi-helper-mvp-panel .search-clear:hover {
        background: transparent;
        color: var(--roi-text);
      }

      #roi-helper-mvp-panel small { color: var(--roi-muted); font-size: 12px; }

      #roi-helper-mvp-panel main {
        padding: 14px 16px;
        overflow: auto;
        overscroll-behavior: contain;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      #roi-helper-mvp-panel .notice-bar {
        margin: 0;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--roi-panel);
        border: 1px solid var(--roi-edge);
        color: var(--roi-text);
        font-size: 12.5px;
      }
      #roi-helper-mvp-panel .notice-bar.warn {
        background: var(--roi-inset);
        border-color: #7c5330;
        color: var(--roi-warning);
      }

      #roi-helper-mvp-panel .group-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      #roi-helper-mvp-panel .group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--roi-edge);
        color: var(--roi-text);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: .03em;
      }
      #roi-helper-mvp-panel .group-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      #roi-helper-mvp-panel .group-dot.window { background: #f59e0b; box-shadow: 0 0 8px #f59e0b99; }
      #roi-helper-mvp-panel .group-dot.upcoming { background: #60a5fa; }
      #roi-helper-mvp-panel .group-dot.passed { background: #34d399; }
      #roi-helper-mvp-panel .group-dot.unknown { background: #64748b; }
      #roi-helper-mvp-panel .group-count {
        color: var(--roi-muted);
        font-size: 12px;
        font-weight: 500;
      }

      #roi-helper-mvp-panel .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr));
        gap: 10px;
        align-items: stretch;
      }

      #roi-helper-mvp-panel article.mvp-card {
        position: relative;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 12px 11px 14px;
        background: var(--roi-panel);
        border: 1px solid rgba(71, 85, 105, 0.65);
        border-left-width: 4px;
        border-radius: 10px;
        transition: border-color .15s ease, transform .15s ease;
      }
      #roi-helper-mvp-panel article.mvp-card:hover {
        border-color: #64748b;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="window"] {
        border-left-color: #f59e0b;
        background: var(--roi-panel);
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="upcoming"] {
        border-left-color: #60a5fa;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="passed"] {
        border-left-color: #34d399;
      }
      #roi-helper-mvp-panel article.mvp-card[data-state="unknown"] {
        border-left-color: #4b5d75;
        opacity: .92;
      }

      #roi-helper-mvp-panel .boss-head {
        display: flex;
        align-items: center;
        gap: 11px;
      }
      #roi-helper-mvp-panel .portrait {
        flex: 0 0 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border: 1px solid var(--roi-edge);
        border-radius: 8px;
        background: var(--roi-panel);
        overflow: hidden;
      }
      #roi-helper-mvp-panel canvas {
        width: 64px;
        height: 64px;
        image-rendering: pixelated;
      }
      #roi-helper-mvp-panel .no-portrait {
        color: var(--roi-muted);
        font-size: 11px;
      }
      #roi-helper-mvp-panel .boss-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      #roi-helper-mvp-panel .boss-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #roi-helper-mvp-panel h3 {
        margin: 0;
        color: var(--roi-text);
        font-size: 16px;
        font-weight: 700;
        letter-spacing: .02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #roi-helper-mvp-panel .status-pill {
        flex-shrink: 0;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        background: var(--roi-panel);
        color: var(--roi-muted);
        border: 1px solid var(--roi-edge);
      }
      #roi-helper-mvp-panel .status-pill[data-state="window"] {
        background: var(--roi-inset);
        border-color: #b46914;
        color: var(--roi-warning);
      }
      #roi-helper-mvp-panel .status-pill[data-state="upcoming"] {
        background: var(--roi-inset);
        border-color: #2f629e;
        color: var(--roi-info);
      }
      #roi-helper-mvp-panel .status-pill[data-state="passed"] {
        background: var(--roi-inset);
        border-color: #256e59;
        color: var(--roi-success);
      }

      #roi-helper-mvp-panel .kill-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--roi-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .source-tag {
        padding: 0 5px;
        border-radius: 4px;
        background: var(--roi-panel);
        color: var(--roi-info);
        font-size: 11px;
      }

      #roi-helper-mvp-panel .maps-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding-top: 8px;
        border-top: 1px solid var(--roi-edge);
      }
      #roi-helper-mvp-panel .multi-map-hint {
        color: var(--roi-muted);
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .map-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 7px 9px;
        border-radius: 7px;
        background: var(--roi-panel);
        border: 1px solid var(--roi-edge);
      }
      #roi-helper-mvp-panel .map-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #roi-helper-mvp-panel .map-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 9px;
        background: var(--roi-panel);
        border-color: #395878;
        color: var(--roi-text);
        font-size: 12.5px;
        font-weight: 600;
        text-align: left;
      }
      #roi-helper-mvp-panel .map-btn:hover {
        background: var(--roi-selected);
        border-color: #5b87b5;
        color: var(--roi-text);
      }
      #roi-helper-mvp-panel .map-btn::after {
        content: '前往 ›';
        color: var(--roi-info);
        font-size: 11.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .interval-tag {
        color: var(--roi-muted);
        font-size: 11.5px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .window-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12.5px;
      }
      #roi-helper-mvp-panel .window-label {
        color: var(--roi-muted);
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .time {
        color: var(--roi-warning);
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .progress-track {
        height: 3px;
        border-radius: 999px;
        background: var(--roi-panel);
        overflow: hidden;
      }
      #roi-helper-mvp-panel .progress-fill {
        height: 100%;
        border-radius: 999px;
        background: #60a5fa;
      }
      #roi-helper-mvp-panel .progress-fill[data-state="window"] { background: #f59e0b; }
      #roi-helper-mvp-panel .progress-fill[data-state="passed"] { background: #34d399; }

      #roi-helper-mvp-panel .empty-state {
        padding: 28px 16px;
        text-align: center;
        color: var(--roi-muted);
        background: var(--roi-panel);
        border: 1px dashed #32445c;
        border-radius: 10px;
      }

      #roi-helper-mvp-panel footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 16px;
        background: var(--roi-panel);
        border-top: 1px solid var(--roi-edge);
      }

      @media (max-width: 560px) {
        #roi-helper-mvp-panel .toolbar { flex-direction: column; align-items: stretch; }
        #roi-helper-mvp-panel .search-wrap { max-width: none; }
        #roi-helper-mvp-panel .map-top { flex-wrap: wrap; }
      }
    `);
    document.head.append(style);

    const open = document.createElement('button');
    open.id = 'roi-helper-mvp-open';
    open.type = 'button';
    open.className = 'ro-tab';
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-controls', 'roi-helper-mvp-panel');
    open.title = '開啟／收合 MVP 雷達（開啟時點視窗外畫面可自動關閉）';
    const openLabel = node('span', '🧭 MVP');
    const openBadge = node('span', '', 'badge');
    openBadge.title = '目前處於預估重生時段的 MVP 數量';
    open.append(openLabel, openBadge);

    const panel = document.createElement('div');
    panel.id = 'roi-helper-mvp-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'roi-helper-mvp-title');
    panel.hidden = true;

    const isRadarOpen = () => !panel.hidden && panel.hasAttribute('open');

    const title = node('h2', '🧭 個人 MVP 雷達');
    title.id = 'roi-helper-mvp-title';
    const meta = node('small', '');
    const titleRow = node('div', null, 'title-row');
    titleRow.append(title);
    const titleWrap = node('div', null, 'title-wrap');
    titleWrap.append(titleRow, meta);

    const refresh = node('button', '重新整理');
    refresh.type = 'button';
    const close = node('button', '關閉', 'btn-ghost');
    close.type = 'button';

    let refreshTimer;
    function closeRadar() {
      if (!isRadarOpen()) return;
      panel.removeAttribute('open');
      panel.hidden = true;
      open.setAttribute('aria-expanded', 'false');
      clearInterval(refreshTimer);
      portraits.disconnect();
    }

    close.onclick = closeRadar;

    const headerActions = node('div', null, 'header-actions');
    headerActions.append(refresh, close);
    const header = document.createElement('header');
    header.append(titleWrap, headerActions);

    let activeFilter = 'all';
    let searchQuery = '';
    const filterDefs = [
      ['all', '全部'],
      ['ready', '可挑戰'],
      ['upcoming', '即將重生'],
      ['recorded', '有紀錄']
    ];
    const filterBar = node('div', null, 'filters');
    const filterButtons = new Map();
    for (const [key, label] of filterDefs) {
      const btn = node('button', null, 'filter-chip');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', key === activeFilter ? 'true' : 'false');
      const txt = node('span', label);
      const cnt = node('span', '0', 'count');
      btn.append(txt, cnt);
      btn.onclick = () => {
        activeFilter = key;
        for (const [k, b] of filterButtons) {
          b.setAttribute('aria-pressed', k === activeFilter ? 'true' : 'false');
        }
        render(latestData || capture());
      };
      filterButtons.set(key, btn);
      filterBar.append(btn);
    }

    const searchWrap = node('div', null, 'search-wrap');
    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'search-input';
    searchInput.placeholder = '搜尋 MVP 或地圖名稱 / ID…';
    searchInput.setAttribute('aria-label', '搜尋 MVP 或地圖');
    const searchClear = node('button', '×', 'search-clear');
    searchClear.type = 'button';
    searchClear.title = '清除搜尋';
    searchClear.hidden = true;
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      searchClear.hidden = !searchQuery;
      render(latestData || capture());
    });
    searchClear.onclick = () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.hidden = true;
      searchInput.focus();
      render(latestData || capture());
    };
    searchWrap.append(searchInput, searchClear);

    const toolbar = node('div', null, 'toolbar');
    const mergeLabel = document.createElement('label');
    const mergeSwitch = document.createElement('input');
    mergeSwitch.type = 'checkbox';
    mergeSwitch.checked = state.mvpMergeRoster;
    mergeSwitch.onchange = () => {
      state.mvpMergeRoster = mergeSwitch.checked;
      savePrefs();
      refreshPreferences();
    };
    mergeLabel.append(mergeSwitch, ' 合併同帳號分身紀錄');
    toolbar.append(filterBar, mergeLabel, searchWrap);

    const results = document.createElement('main');
    const footer = document.createElement('footer');
    footer.append(
      node('small', '台北時間 (UTC+8) · 點選視窗外畫面自動關閉'),
      node('small', '點擊地圖名稱可自動帶入掛機設定')
    );

    const portraits = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting && isRadarOpen()) {
        portraits.unobserve(entry.target);
        drawPortrait(entry.target);
      }
    }, { root: results });

    panel.append(header, toolbar, results, footer);
    document.body.append(panel);

    function nativeProfileName() {
      const menu = document.querySelector('nav.xp-menubar[aria-label="主選單"]');
      return menu?.parentElement?.querySelector(':scope > .xp-title .caption')
        ?.textContent.match(/-\s*\[([^\]]+)\]/)?.[1].trim() || '';
    }

    function currentSnapshot(expectedName) {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find(k => k.startsWith('__reactContainer$'));
      const stack = [root[key]?.stateNode?.current];
      let identity = null;
      for (let steps = 0; stack.length && steps < 4000; steps++) {
        const fiber = stack.pop();
        if (!fiber) continue;
        const props = fiber.memoizedProps;
        for (const snap of [props?.data?.s, props?.snap, props?.s]) {
          const name = typeof snap?.character?.name === 'string' ? snap.character.name.trim() : '';
          if (!name || (expectedName && name !== expectedName)) continue;
          if (Array.isArray(snap.mvpLastKill)) return snap;
          if (snap.mapId != null) identity ??= snap;
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      return identity;
    }

    function timestamp(value) {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      const at = typeof value === 'number' ? value : Date.parse(value);
      return Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? at : null;
    }

    const visibleIgnoringAria = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    function namedButton(label) {
      return [...document.querySelectorAll('button,[role="tab"]')].find(el =>
        visibleIgnoringAria(el) && !el.disabled && [el.textContent.trim(),el.getAttribute('aria-label'),el.title].includes(label));
    }
    function setSearch(input, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true, inputType:'insertReplacementText', data:value}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    function until(read, shouldAbort, root) {
      return waitForUi(read, { root, timeout: 8000, shouldAbort });
    }
    const mapGroup = () => [...document.querySelectorAll('[role="group"][aria-label="掛機地圖"]')].find(visibleIgnoringAria);
    function reactFiber(el) {
      const key = Object.keys(el).find(name => name.startsWith('__reactFiber$'));
      return key && el[key];
    }
    function pickerMaps(group) {
      for (let fiber = reactFiber(group); fiber; fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (props?.label === '掛機地圖' && Array.isArray(props.maps)) return props.maps;
      }
      return [];
    }
    let navigating = false;
    async function chooseMap(map, id) {
      if (navigating) return;
      navigating = true;
      const actor = state.activeCharId, epoch = refineIdentityEpoch;
      const shouldAbort = () => state.activeCharId !== actor || refineIdentityEpoch !== epoch;
      closeRadar();
      try {
        if (!mapGroup()) {
          let tab = namedButton('掛機設定');
          if (!tab) {
            namedButton('冒險')?.click();
            tab = await until(() => namedButton('掛機設定'), shouldAbort);
          }
          if (!tab && !mapGroup()) throw Error('找不到掛機設定入口。請先開啟掛機設定再點地圖。');
          tab?.click();
        }
        const findFilter = () => [...document.querySelectorAll('input[type="search"]')].find(el =>
          visibleIgnoringAria(el) && el.closest('label')?.textContent.includes('搜尋設定'));
        await until(() => mapGroup() || findFilter(), shouldAbort);
        if (!mapGroup() && findFilter()) setSearch(findFilter(),'掛機地圖');
        const field = await until(() => mapGroup()?.querySelector('input[aria-label="掛機地圖：搜尋"]'), shouldAbort);
        if (!field) throw Error('找不到原生掛機地圖選單。');
        const options = pickerMaps(field.closest('[role="group"]'));
        const label = options.find(option => option.id === id)?.name || map;
        const uniqueLabel = options.filter(option => option.name === label).length === 1;
        const query = uniqueLabel ? label : id;
        setSearch(field, query);
        const choice = () => {
          const group = mapGroup();
          if (group?.querySelector('input[aria-label="掛機地圖：搜尋"]')?.value !== query) return null;
          const buttons = [...group.querySelectorAll('button[aria-pressed]')].filter(visibleIgnoringAria);
          const exact = buttons.filter(button => reactFiber(button)?.key === id);
          if (exact.length > 1) return null;
          let button = exact[0];
          if (!button) {
            const byName = buttons.filter(candidate => candidate.firstElementChild?.textContent.trim() === label);
            if (byName.length !== 1 || reactFiber(byName[0])?.key != null) return null;
            button = byName[0];
          }
          return !button.disabled || button.getAttribute('aria-pressed') === 'true' ? button : null;
        };
        const button = await until(choice, shouldAbort, field.closest('[role="group"]')?.parentElement);
        if (!button) throw Error('原生選單無法確認這張地圖：'+map+'（'+id+'）。');
        let selected = button;
        if (button.getAttribute('aria-pressed') !== 'true') {
          button.click();
          selected = await until(() => {
            const target = choice();
            return target?.getAttribute('aria-pressed') === 'true' && target;
          }, shouldAbort, field.closest('[role="group"]')?.parentElement);
        }
        if (!selected) throw Error('尚未確認選取成功，請在掛機設定檢查地圖。');
        selected.scrollIntoView({block:'nearest'});
        selected.focus({preventScroll:true});
      } catch (error) {
        alert(error.message);
      } finally { navigating = false; }
    }

    const cacheRoot = 'ro-idle.mvp.v1/';
    const profileKey = cacheRoot + 'last-profile';
    const memory = new Map();
    const savedKillsCache = new Map();
    const mvpChangeKey = 'roi-mvp-record-change-v1';
    let lastProfile = '';
    let storageFailed = false;
    try { lastProfile = sessionStorage.getItem(profileKey) || ''; } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }

    function prefixFor(profile) {
      return cacheRoot + encodeURIComponent(profile) + '/';
    }

    function mvpBossName(name) {
      const trimmed = name.trim();
      return /^詛咒蠅王?(?:\s*[/／]\s*詛咒蠅王?)?$/.test(trimmed) ? '詛咒蠅王' : trimmed;
    }

    function remember(profile, name, at) {
      const key = prefixFor(profile) + name;
      const previous = memory.get(key) || 0;
      if (at <= previous) return;
      let newest = at;
      try {
        const stored = timestamp(Number(localStorage.getItem(key))) || 0;
        newest = Math.max(stored, at);
        if (at > stored) {
          localStorage.setItem(key, String(at));
          if (typeof GM_addValueChangeListener === 'function') {
            try { GM_setValue(mvpChangeKey, validateMvpChange({ key, at })); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
          }
        }
      } catch { storageFailed = true; }
      memory.set(key, newest);
      savedKillsCache.delete(profile);
    }
    function savedKills(profile) {
      if (savedKillsCache.has(profile)) return savedKillsCache.get(profile);
      const prefix = prefixFor(profile);
      const kills = new Map();
      function merge(key, at) {
        if (!key?.startsWith(prefix) || !at) return;
        const name = mvpBossName(key.slice(prefix.length));
        kills.set(name, Math.max(kills.get(name) || 0, at));
      }
      for (const [key, at] of memory) merge(key, at);
      try {
        for (let n = 0; n < localStorage.length; n++) {
          const key = localStorage.key(n);
          if (key?.startsWith(prefix)) merge(key, timestamp(Number(localStorage.getItem(key))));
        }
      } catch { storageFailed = true; }
      if (savedKillsCache.size >= 32) savedKillsCache.delete(savedKillsCache.keys().next().value);
      savedKillsCache.set(profile, kills);
      return kills;
    }

    function validateMvpChange(value) {
      if (!isPlainRecord(value) || typeof value.key !== 'string' || value.key.length > 512 ||
          !value.key.startsWith(cacheRoot) || value.key === profileKey || !timestamp(value.at)) throw Error('MVP 變更訊號格式不符');
      return { key: value.key, at: value.at };
    }
    function invalidateSavedKills(key) {
      if (typeof key !== 'string' || !key.startsWith(cacheRoot) || key === profileKey) return;
      memory.delete(key);
      for (const profile of savedKillsCache.keys()) {
        if (key.startsWith(prefixFor(profile))) savedKillsCache.delete(profile);
      }
    }
    window.addEventListener('storage', event => {
      if (event.storageArea !== localStorage) return;
      if (event.key === null) { memory.clear(); savedKillsCache.clear(); }
      else invalidateSavedKills(event.key);
    });
    listenRemote(mvpChangeKey, validateMvpChange, (change) => invalidateSavedKills(change.key));

    let lastBackgroundAt = -Infinity;
    let latestData;
    const findStatsList = () => [...document.querySelectorAll('ul[aria-label="MVP 最後一次擊殺"]')]
      .find((list) => visibleIgnoringAria(list) && !list.closest('[hidden],[inert],[aria-hidden="true"]'));
    function capture(list = findStatsList()) {
      const nativeName = nativeProfileName();
      const snap = currentSnapshot(nativeName);
      const profile = nativeName || snap?.character.name.trim() || '';
      const api = profile && foregroundMvpSnapshot?.character.name?.trim() === profile ? foregroundMvpSnapshot : null;
      if (profile && profile !== lastProfile) {
        lastProfile = profile;
        try { sessionStorage.setItem(profileKey, profile); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
      }
      const live = new Map();
      function record(name, at) {
        if (typeof name !== 'string' || !name || !at) return;
        const boss = mvpBossName(name);
        if (!boss) return;
        live.set(boss, Math.max(live.get(boss) || 0, at));
        if (profile) remember(profile, boss, at);
      }
      if (list) {
        const now = Date.now();
        for (const row of list.children) {
          const name = row.children[0]?.textContent.trim();
          if (name && !/未變身[，,]\s*沒有 MVP/.test(name)) {
            record(name, readMinute(row.children[1]?.textContent || '', now));
          }
        }
      }
      for (const records of [api?.mvpLastKill, snap?.mvpLastKill]) {
        if (!Array.isArray(records)) continue;
        for (const entry of records) {
          if (!entry?.noMvp) record(entry?.name, timestamp(entry?.at));
        }
      }
      latestData = {profile, live, hasList:Boolean(list) || Array.isArray(snap?.mvpLastKill) || Boolean(api)};
      updateFloatingBadge(latestData);
      return latestData;
    }

    function evaluateBoss(name, at, maps, now) {
      const known = Number.isFinite(at);
      if (!known || !maps?.length) {
        return { state: 'unknown', sortTime: Infinity, badgeText: '時間未知' };
      }
      let hasWindow = false;
      let earliestUpcoming = Infinity;
      let latestPassed = -Infinity;
      for (const [, , base, variance] of maps) {
        if (base == null) continue;
        const start = at + base;
        const end = start + (variance || 0);
        if (now >= start && now <= end) hasWindow = true;
        else if (now < start) earliestUpcoming = Math.min(earliestUpcoming, start);
        else latestPassed = Math.max(latestPassed, end);
      }
      if (hasWindow) {
        return { state: 'window', sortTime: 0, badgeText: '重生時段中' };
      }
      if (Number.isFinite(earliestUpcoming)) {
        return {
          state: 'upcoming',
          sortTime: earliestUpcoming,
          badgeText: '約 ' + formatDuration(earliestUpcoming - now) + '後'
        };
      }
      if (latestPassed > -Infinity) {
        return { state: 'passed', sortTime: -latestPassed, badgeText: '已過預估時段' };
      }
      return { state: 'unknown', sortTime: Infinity, badgeText: '時間未知' };
    }

    function displayKills(owner, live) {
      const kills = new Map(owner ? savedKills(owner) : undefined);
      for (const [name, at] of live) kills.set(name, Math.max(kills.get(name) || 0, at));
      const sources = new Map();
      if (state.mvpMergeRoster && owner && state.chars.some(c => c.name === owner)) {
        for (const c of state.chars) {
          if (!c.name || c.name === owner) continue;
          for (const [name, at] of savedKills(c.name)) {
            if (at <= (kills.get(name) || 0)) continue;
            kills.set(name, at);
            sources.set(name, c.name);
          }
        }
      }
      return { kills, sources };
    }
    function refreshPreferences() {
      mergeSwitch.checked = state.mvpMergeRoster;
      if (isRadarOpen()) render();
      else if (latestData) updateFloatingBadge(latestData);
    }
    function updateFloatingBadge(data) {
      if (!data) return;
      const now = Date.now();
      const { profile, live, hasList } = data;
      const historical = !profile && !hasList && lastProfile;
      const owner = profile || historical;
      const { kills } = displayKills(owner, live);
      let windowCount = 0;
      for (const [name, maps] of Object.entries(schedules)) {
        const info = evaluateBoss(name, kills.get(name), maps, now);
        if (info.state === 'window') windowCount++;
      }
      const text = windowCount > 0 ? String(windowCount) : '';
      if (openBadge.textContent !== text) openBadge.textContent = text;
    }

    function captureBackground() {
      const now = performance.now();
      if (now - lastBackgroundAt >= TIMING.mvpCaptureGap) {
        capture();
        lastBackgroundAt = now;
      }
      return latestData;
    }

    let lastStatsList, lastStatsText = '', lastStatsProfile = '';
    function syncFromStats() {
      const list = findStatsList();
      const text = list?.textContent || '';
      const profile = nativeProfileName();
      if (list === lastStatsList && text === lastStatsText && profile === lastStatsProfile) return;
      lastStatsList = list;
      lastStatsText = text;
      lastStatsProfile = profile;
      const data = capture(list);
      if (isRadarOpen()) render(data);
    }

    function render(data = capture()) {
      const scrollTop = isRadarOpen() ? results.scrollTop : 0;
      const focused = document.activeElement;
      const focusedBoss = focused?.closest?.('article')?.querySelector('h3')?.textContent;
      const focusedMap = focused?.title;
      portraits.disconnect();
      results.replaceChildren();

      const now = Date.now();
      const { profile, live, hasList } = data;
      const historical = !profile && !hasList && lastProfile;
      const owner = profile || historical;
      const { kills, sources } = displayKills(owner, live);

      meta.textContent = historical
        ? `角色：${owner}（本機離線紀錄）`
        : `${profile || '未辨識角色'} · 更新於 ${format.format(now)}`;

      if (historical) {
        results.append(node('p', `目前畫面未載入角色快照，以下顯示「${owner}」在本機保存的擊殺時間。`, 'notice-bar'));
      } else if (!profile && hasList) {
        results.append(node('p', '目前無法辨識角色名稱；開啟一次「統計」分頁即可依角色自動保存紀錄。', 'notice-bar'));
      } else if (!hasList && !kills.size) {
        results.append(node('p', '尚未讀取到擊殺紀錄，請先切換至「統計」分頁一次再按「重新整理」。', 'notice-bar'));
      }
      if (storageFailed) {
        results.append(node('p', '瀏覽器目前無法寫入 localStorage，重新整理網頁後紀錄可能不會保留。', 'notice-bar warn'));
      }

      const allNames = [...new Set([...kills.keys(), ...Object.keys(schedules)])];
      const items = allNames.map(name => {
        const at = kills.get(name);
        const maps = Object.hasOwn(schedules, name) ? schedules[name] : [];
        const evalInfo = evaluateBoss(name, at, maps, now);
        return { name, at, maps, ...evalInfo };
      });

      const counts = {
        all: items.length,
        ready: items.filter(i => i.state === 'window' || i.state === 'passed').length,
        upcoming: items.filter(i => i.state === 'upcoming').length,
        recorded: items.filter(i => Number.isFinite(i.at)).length
      };
      for (const [key, btn] of filterButtons) {
        btn.querySelector('.count').textContent = String(counts[key] ?? 0);
      }

      const filtered = items.filter(item => {
        if (activeFilter === 'ready' && item.state !== 'window' && item.state !== 'passed') return false;
        if (activeFilter === 'upcoming' && item.state !== 'upcoming') return false;
        if (activeFilter === 'recorded' && !Number.isFinite(item.at)) return false;
        if (searchQuery) {
          const hitName = item.name.toLowerCase().includes(mvpBossName(searchQuery));
          const hitMap = item.maps.some(([m, id]) => m.toLowerCase().includes(searchQuery) || id.toLowerCase().includes(searchQuery));
          if (!hitName && !hitMap) return false;
        }
        return true;
      });

      if (!filtered.length) {
        results.append(node('div', '沒有符合目前篩選或搜尋條件的 MVP。', 'empty-state'));
        results.scrollTop = 0;
        return;
      }

      const groups = [
        { key: 'window', label: '預估重生時段中（建議立即前往）', list: [] },
        { key: 'upcoming', label: '即將進入重生時段', list: [] },
        { key: 'passed', label: '已過預估時段（可能已重生或未被擊殺）', list: [] },
        { key: 'unknown', label: '尚無擊殺紀錄', list: [] }
      ];
      const groupMap = Object.fromEntries(groups.map(g => [g.key, g]));
      for (const item of filtered) {
        groupMap[item.state].list.push(item);
      }
      for (const g of groups) {
        g.list.sort((a, b) => a.sortTime - b.sortTime || a.name.localeCompare(b.name, 'zh-Hant'));
      }

      for (const g of groups) {
        if (!g.list.length) continue;
        const section = node('section', null, 'group-section');
        const gHeader = node('div', null, 'group-header');
        gHeader.append(
          node('span', null, `group-dot ${g.key}`),
          node('span', g.label),
          node('span', `(${g.list.length})`, 'group-count')
        );
        const grid = node('div', null, 'cards-grid');

        for (const { name, at, maps, state, badgeText } of g.list) {
          const known = Number.isFinite(at);
          const missing = !kills.has(name) && hasList;
          const card = document.createElement('article');
          card.className = 'mvp-card';
          card.dataset.state = state;

          const head = node('div', null, 'boss-head');
          if (Object.hasOwn(monsterIds, name)) {
            const portrait = node('div', null, 'portrait');
            const canvas = document.createElement('canvas');
            canvas.setAttribute('aria-hidden', 'true');
            canvas.width = canvas.height = 128;
            canvas.dataset.monster = monsterIds[name];
            portrait.append(canvas);
            head.append(portrait);
            portraits.observe(canvas);
          }

          const info = node('div', null, 'boss-info');
          const titleLine = node('div', null, 'boss-title-row');
          const pill = node('span', known ? badgeText : (missing ? '清單無紀錄' : '時間未知'), 'status-pill');
          pill.dataset.state = state;
          titleLine.append(node('h3', name), pill);

          const killMeta = node('div', null, 'kill-meta');
          if (known) {
            const isLive = live.get(name) === at;
            killMeta.append(
              node('span', (isLive ? '最後擊殺 ' : '上次紀錄 ') + format.format(at)),
              node('span', sources.has(name) ? '快取 · ' + sources.get(name) : isLive ? '即時' : '快取', 'source-tag')
            );
          } else {
            killMeta.append(node('span', missing ? '目前清單無擊殺紀錄' : '尚未讀取到擊殺時間'));
          }
          info.append(titleLine, killMeta);
          head.append(info);
          card.append(head);

          if (!maps?.length) {
            card.append(node('small', '官方地圖表未列出沒地圖與重生間隔。'));
            grid.append(card);
            continue;
          }

          const mapsList = node('div', null, 'maps-list');
          if (maps.length > 1 && known) {
            mapsList.append(node('div', '多張候選地圖（請對照實際擊殺地點）', 'multi-map-hint'));
          }

          for (const [map, id, base, variance] of maps) {
            const row = node('div', null, 'map-row');
            const top = node('div', null, 'map-top');
            const place = node('button', map, 'map-btn');
            place.type = 'button';
            place.title = '在掛機設定選擇 ' + id;
            place.onclick = () => chooseMap(map, id);

            const intervalText = base == null
              ? '間隔未知'
              : `${Math.round(base / 60000)}${variance ? '～' + Math.round((base + variance) / 60000) : ''} 分`;
            top.append(place, node('span', intervalText, 'interval-tag'));
            row.append(top);

            if (focusedBoss === name && focusedMap === place.title) {
              place.focus({ preventScroll: true });
            }

            if (known && base != null) {
              const start = at + base;
              const end = start + (variance || 0);
              const mapState = now < start ? 'upcoming' : (now <= end ? 'window' : 'passed');

              const winRow = node('div', null, 'window-row');
              const labelText = mapState === 'upcoming'
                ? `約 ${formatDuration(start - now)}後進入`
                : (mapState === 'window' ? '重生時段中' : '已過預估時段');
              const timeEl = node('span', formatRange(start, end), 'time');
              timeEl.setAttribute('aria-label', '預估重生 ' + timeEl.textContent);
              winRow.append(node('span', labelText, 'window-label'), timeEl);
              row.append(winRow);

              const track = node('div', null, 'progress-track');
              const fill = node('div', null, 'progress-fill');
              fill.dataset.state = mapState;
              const ratio = end > at ? Math.max(0, Math.min(1, (now - at) / (end - at))) : 1;
              fill.style.width = Math.round(ratio * 100) + '%';
              track.append(fill);
              row.append(track);
            }

            mapsList.append(row);
          }

          card.append(mapsList);
          grid.append(card);
        }

        section.append(gHeader, grid);
        results.append(section);
      }

      results.scrollTop = scrollTop;
    }

    function draggable(el, handle) {
      const key = el.id + '-position-v1';
      let saved, drag, suppress = false;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
      function place(x,y) {
        const rect = el.getBoundingClientRect();
        Object.assign(el.style, {margin:'0',right:'auto',bottom:'auto',
          left:Math.max(0, Math.min(x,innerWidth-rect.width))+'px',
          top:Math.max(0, Math.min(y,innerHeight-rect.height))+'px'});
      }
      function restore() {
        if (el.getClientRects().length && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x,saved.y);
      }
      Object.assign(handle.style,{touchAction:'none',cursor:'grab',userSelect:'none'});
      handle.title='拖曳調整位置';
      handle.addEventListener('pointerdown',e=>{
        if (!e.isPrimary || e.button!==0 || (handle!==el && e.target.closest('button,input'))) return;
        const r=el.getBoundingClientRect();
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top};
        suppress=false;
        handle.setPointerCapture(e.pointerId);
      });
      handle.addEventListener('pointermove',e=>{
        if (drag?.id!==e.pointerId) return;
        const dx=e.clientX-drag.x, dy=e.clientY-drag.y;
        if (!suppress && Math.hypot(dx,dy)<5) return;
        suppress=true;
        place(drag.left+dx,drag.top+dy);
      });
      handle.addEventListener('lostpointercapture',()=>{
        if (drag && suppress) {
          const r=el.getBoundingClientRect(); saved={x:r.left,y:r.top};
          try {localStorage.setItem(key,JSON.stringify(saved));} catch { log("mvp", "無法取得或同步本機 MVP 設定"); }
        }
        drag=null;
      });
      handle.addEventListener('click',e=>{
        if (suppress && e.detail) { e.preventDefault();e.stopImmediatePropagation(); }
        suppress=false;
      },true);
      window.addEventListener('resize',restore);
      restore();return restore;
    }

    const positionPanel = draggable(panel, header);
    function openRadar() {
      if (isRadarOpen()) return;
      panel.hidden = false;
      panel.setAttribute('open', '');
      open.setAttribute('aria-expanded', 'true');
      render();
      positionPanel();
      clearInterval(refreshTimer);
      refreshTimer = window.setInterval(() => {
        if (isRadarOpen() && !document.hidden) render(captureBackground());
      }, TIMING.mvpRender);
    }
    function toggleRadar() {
      if (isRadarOpen()) closeRadar();
      else openRadar();
    }

    open.onclick = (e) => {
      e.stopPropagation();
      toggleRadar();
    };
    refresh.onclick = () => render();

    document.addEventListener('pointerdown', (e) => {
      if (!isRadarOpen()) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (panel.contains(target) || open.contains(target)) return;
      closeRadar();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isRadarOpen()) closeRadar();
    });

    captureBackground();
    window.setInterval(() => { if (!document.hidden) captureBackground(); }, TIMING.mvpBackground);
    document.addEventListener('visibilitychange', captureBackground);
    window.addEventListener('pagehide', captureBackground);
    document.addEventListener('click', event => {
      const control = event.target.closest?.('button, [role="tab"], a');
      if (control && !control.closest('#ro-helper-hud') && !panel.contains(control) && /掛機設定|尋找怪物|切換角色|回城|地圖/.test(control.textContent)) captureBackground();
    }, true);
    const knownBosses = new Set(Object.keys(schedules).map(clean));
    return { button: open, syncFromStats, refreshPreferences, isKnownBoss: name => knownBosses.has(name) };
  }

  let mvpRadar;
  if (!location.pathname.startsWith('/info')) {
    try {
      mvpRadar = createMvpSchedule();
    } catch (error) {
      log('mvp', '時刻表初始化失敗', error.name);
    }
  }

  document.querySelectorAll('.log-window .log-line').forEach(line => queueLogLine(line, true));
  listenSharedSettings();
  if (canShareCharPoll()) listenRemote(charPollKey, validateCharPoll, applySharedCharPoll);
  window.addEventListener('focus', runPageRouter);
  // Remove the previous version's classes from nodes left in the live page.
  const oldRowClass = ['ro', 'wh', 'locked'].join('-');
  const oldBadgeClasses = ['lock', 'unlock'].map(kind => ['ro', 'badge', kind].join('-'));
  document.querySelectorAll(`li.${oldRowClass}`).forEach(row => row.classList.remove(oldRowClass));
  document.querySelectorAll('button[data-ro-lock]').forEach(button => button.classList.remove(...oldBadgeClasses));
  ensureHUD(); pollChars(); runPageRouter();
  setInterval(() => {
    clearTransientCharAlerts(null, Date.now() - TIMING.charAlertExpiry);
    if (document.hidden) return;
    ensureHUD(); updateHUD();
    if (Date.now() - lastRouterAt > 1200) refreshRareHelper();
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup) lootSyncPanels.get(itemGroup)?.();
  }, TIMING.hudRefresh);
  setInterval(pollChars, charPollInterval);
})();
