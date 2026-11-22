// ==UserScript==
// @name         RO Idle 便利助手｜測試版
// @namespace    local.ro-idle.warehouse-helper.test
// @version      3.5.1.2
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
  function validatePrefs(value) {
    if (!isPlainRecord(value)) throw Error('偏好設定格式不符');
    const result = {};
    for (const key of ['sound', 'notify', 'moneyColor', 'itemHover', 'marketHover', 'whProtectPins', 'mvpMergeRoster', 'whProtect', 'whSaleReview', 'whAutoEquipCard', 'hudMin', 'mktUpperFold']) {
      if (!Object.hasOwn(value, key)) continue;
      if (typeof value[key] !== 'boolean') throw Error('偏好設定的 ' + key + ' 必須是開關');
      result[key] = value[key];
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
      result[id] = { enabled: profile.enabled, modes };
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
      const clean = validate(value);
      writes.push([key, json ? JSON.stringify(clean) : clean]);
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
  } catch {}
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
        } catch {}
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
    const stack = [{ f: root, found: null, route: [] }];
    let guard = 0;
    const budget = createFiberScanBudget(el, propsScanRetries);
    while (stack.length && ++guard < 80000) {
      budget.step();
      const { f: node, found, route } = stack.pop();
      const p = node.memoizedProps;
      const next = p && matcher(p) ? p : found;
      if (node.stateNode === el) {
        budget.complete();
        if (next) fiberRouteMap.set(el, route);
        return next;
      }
      if (node.sibling) stack.push({ f: node.sibling, found, route: [...route, 's'] });
      if (node.child) stack.push({ f: node.child, found: next, route: [...route, 'c'] });
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
    kills: 0, bexp: 0, jexp: 0, dmgSum: 0, hits: 0, maxDmg: 0,
    loot: {}, lootRev: 0, renderedLootRev: -1,
    rares: [], rareRev: 0,
    missed: 0,
    sound: false, notify: false, moneyColor: true, itemHover: true, marketHover: true,
    whProtectPins: true, mvpMergeRoster: false, charAlerts: {}, whProtect: true, whSaleReview: true, whAutoEquipCard: true,
    whMarks: {}, whAutoLocks: {}, customProtectWords: [],
    hudMin: false, hudPos: null, mktUpperFold: false,
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
    'whSaleReview', 'whAutoEquipCard', 'hudMin', 'hudPos', 'mktUpperFold'];
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
    if (state.notify && Date.now() - state.lastNotifyAt > 5000 && typeof GM_notification === 'function') {
      state.lastNotifyAt = Date.now();
      GM_notification({ title, text, timeout: 5000 });
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
            if (state.activeCharId != null) clearQueuedCharacterLogs();
            refineIdentityEpoch++;
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
  const pageNet = { inFlight: 0, settled: 0 };
  try {
    const origFetch = page.fetch;
    if (origFetch) {
      page.fetch = async function (...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const path = u.replace(location.origin, '').split('?')[0];
        const isDetail = /^\/api\/characters\/\d+$/.test(path);
        const request = isDetail ? ++detailRequest : 0;
        pageNet.inFlight++;
        let res;
        try { res = await origFetch.apply(this, args); }
        finally { pageNet.inFlight--; pageNet.settled++; }
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
  const charPollInterval = 45000;
  // 重用門檻須小於輪詢間隔，否則計時器準時觸發時會跳過自己上一輪的結果，實際週期變成 90 秒。
  const charPollReuseMs = charPollInterval - 5000;
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
  const rxDmgLog = /造成\s*([\d,]+)\s*點傷害/;
  const rxExpLog = /獲得\s*Base EXP\s*([\d,]+)(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*\/\s*Job EXP\s*([\d,]+)/;
  const rxLootLog = /撿取物品\s*[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/;
  function parseLog(t) {
    if (state.paused) return;
    const dm = t.match(rxDmgLog);
    if (dm) { const v = parseInt(dm[1].replace(/,/g, ''), 10); if (v) { state.dmgSum += v; state.hits++; if (v > state.maxDmg) state.maxDmg = v; } }
    if (t.includes('成功擊敗')) state.kills++;
    const em = t.match(rxExpLog);
    if (em) { state.bexp += parseInt(em[1].replace(/,/g, ''), 10) || 0; state.jexp += parseInt(em[2].replace(/,/g, ''), 10) || 0; }
    const lm = t.match(rxLootLog);
    if (lm) {
      const name = lm[1].trim(), q = parseInt(lm[2], 10) || 1;
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
    return li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/client\/item\/(\d+)\.png(?:[?#]|$)/)?.[1];
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
    dlg.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:80vh;padding:16px 18px;background:rgba(15,23,42,0.98);color:#f8fafc;border:1.5px solid #f59e0b;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,0.92);font-size:13px;backdrop-filter:blur(10px);';
    dlg.innerHTML = `
      <div style="font-weight:bold;font-size:15px;color:#fbbf24;border-bottom:1px solid #334155;padding-bottom:8px;margin-bottom:8px;">🛡️ 倉庫待售清單核對（共 ${items.length} 項）</div>
      <div style="max-height:48vh;overflow:auto;margin-bottom:10px;border:1px solid #334155;border-radius:6px;padding:6px 10px;background:#090d16;"></div>
      <div style="font-size:12px;color:#cbd5e1;margin-bottom:10px;"><span data-sale-caption></span>｜核對無誤後按「確認出售」，遊戲仍會顯示原生販售確認。</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="xp-btn small" id="wh-rev-cancel">取消</button>
        <button type="button" class="xp-btn small" id="wh-rev-ok" style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;font-weight:bold;border:none;">確認出售</button>
      </div>
    `;
    const itemsBox = dlg.children[1];
    for (const item of items) {
      const row = element('div', null, 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed #1e293b');
      row.append(element('span', item.name), element('b', '×' + item.qty.toLocaleString(), 'color:#4ade80'));
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
        bar.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0 6px;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #f59e0b;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const mkBtn = (txt, fn, bg = '') => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'xp-btn small'; b.textContent = txt;
          if (bg) b.style.cssText = `background:${bg};color:#fff;font-weight:bold;border:none;`;
          b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
          return b;
        };
        const stSpan = document.createElement('span');
        stSpan.dataset.roWhStatus = ''; stSpan.style.color = '#fde047';
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
              if (li.classList.contains('ro-wh-locked')) { if (cb.checked) { cb.click(); cnt--; } continue; }
              if (!cb.checked && cnt < 100) { cb.click(); if (++cnt % 15 === 0) await sleep(10); }
            }
          }, 'linear-gradient(135deg,#d97706,#b45309)'),
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
            li.classList.contains('ro-wh-locked') === Boolean(reason) &&
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
        li.classList.toggle('ro-wh-locked', locked);

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
        lBtn.className = locked ? 'ro-badge-lock' : 'ro-badge-unlock';
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
          if (next && row.classList.contains('ro-wh-locked') && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ')) continue;
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
  function validateRareAutoMap(value) {
    if (typeof value !== 'boolean') throw Error('稀有掉落開關格式不符');
    return value;
  }
  let rareAutoMap = readValidatedSetting('roi-rare-auto-map-v1', validateRareAutoMap, true);
  function setRareAutoMap(enabled) {
    try { GM_setValue('roi-rare-auto-map-v1', validateRareAutoMap(enabled)); } catch {}
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

  function fastSelectRare(root, group, next) {
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
      current.box.click();
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

  const rareHeadingXPath = '//text()[contains(., "必撿稀有掉落")]';
  function refreshRareHelper() {
    // 頁面沒有「必撿稀有掉落」文字時，略過整頁 div/span 掃描（原生 XPath 單次比對）。
    try {
      if (!document.evaluate(rareHeadingXPath, document.body, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue) return;
    } catch {}
    for (const root of findRareRoots()) {
      let panel = rarePanels.get(root);
      if (!panel?.isConnected || !root.contains(panel)) {
        panel = document.createElement('div');
        panel.dataset.roRareHelper = '';
        panel.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        const statusSpan = document.createElement('span');
        statusSpan.dataset.roRareStatus = ''; statusSpan.style.color = '#4ade80';
        statusSpan.textContent = rareAutoMap ? '稀有掉落自動同步已開啟' : '稀有掉落自動同步已關閉';
        panel.append(statusSpan);
        const h = [...root.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].find((e) => e.childElementCount <= 3 && isRareHeading(e.textContent));
        if (h?.parentElement === root) h.after(panel);
        else root.prepend(panel);
        rarePanels.set(root, panel);
      }
      if (rareAutoMap) {
        const context = getRareContext(root);
        if (context) {
          const mapSig = JSON.stringify([context.p.draft.lockMap, context.p.monsterIds]);
          if (rareLastMap.get(root) !== mapSig) {
            if (fastSelectRare(root, 'sync', true)) rareLastMap.set(root, mapSig);
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
    try { void loadLootPack().catch(() => {}); } catch {}
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
      for (const drop of [...(monster.drops ?? []), monster.card, ...(monster.mvpDrops ?? [])]) {
        const item = pack.items.get(drop?.itemId);
        if (item) loot.set(item.id, item.name);
      }
    }
    return loot;
  }

  const lootSyncPanels = new WeakMap();
  const lootModes = ['off', 'store', 'valuable'];
  const lootOres = new Set([984, 985, 756, 757, 1010, 1011]);
  const isValuableLoot = (id, name = '') => classifyItem(id, name).cat === 'card' || lootOres.has(id)
    || state.whMarks[id] === 'lock' || state.customProtectWords.some((word) => word && name.includes(word));

  const lootCategoryLabels = { consumable: '消耗品', equipment: '裝備', card: '卡片', other: '其他' };
  const lootCategoryModes = {
    off: '保留原設定', store: '全部存倉', priority: '優先撿取＋存倉', valuable: '僅貴重物優先撿取＋存倉'
  };
  const categorySyncByCharacter = new Map();

  function lootCategory(id, name, pack) {
    const item = pack.items.get(id);
    if (item?.category === 'card') return 'card';
    if (item?.category === 'equipment') return 'equipment';
    if (item?.category === 'consumable') return 'consumable';
    const cat = classifyItem(id, name).cat;
    return cat === 'weapon' || cat === 'armor' ? 'equipment'
      : cat === 'card' || cat === 'consumable' ? cat : 'other';
  }

  function buildCategoryLootPatch(draft, loot, pack, modes, previous) {
    const storage = storageRule(draft.autoStorage);
    const priority = listItems(draft.lootPriority);
    const storageBase = storage.items.filter((id) => !previous?.storage.has(id));
    const priorityBase = priority.filter((id) => !previous?.priority.has(id));
    const stored = new Set(), prioritized = new Set();
    const supplies = lootSupplyIds(draft);
    const counts = Object.fromEntries(Object.keys(lootCategoryLabels).map((cat) => [cat, 0]));
    for (const [id, name] of loot) {
      const category = lootCategory(id, name, pack);
      const mode = modes[category];
      if (mode === 'off' || !Object.hasOwn(lootCategoryModes, mode)) continue;
      if (mode === 'valuable' && !isValuableLoot(id, name)) continue;
      // 沿用既有補品、補給排除規則。
      if (supplies.has(id)) continue;
      counts[category]++;
      stored.add(id);
      if (mode === 'priority' || mode === 'valuable') prioritized.add(id);
    }
    const storageItems = [...new Set([...storageBase, ...stored])];
    const priorityItems = [...new Set([...priorityBase, ...prioritized])];
    if (storageItems.length > 2000 || priorityItems.length > 500) {
      throw Error('分類設定會超過存倉或優先撿取上限，請縮小範圍');
    }
    const patch = {};
    if (stored.size || JSON.stringify(storageItems) !== JSON.stringify(storage.items)) {
      patch.autoStorage = { ...storage, ...(stored.size ? { enabled: true } : {}), items: storageItems };
    }
    if (prioritized.size || JSON.stringify(priorityItems) !== JSON.stringify(priority)) {
      patch.lootPriority = { ...(draft.lootPriority?.rare ? { rare: true } : {}), items: priorityItems };
    }
    if (stored.size) {
      patch.autoLoot = true;
      patch.autoSell = itemIds(draft.autoSell).filter((id) => !stored.has(id));
    }
    return {
      patch, counts,
      tracked: {
        storage: new Set([...stored].filter((id) => !storageBase.includes(id))),
        priority: new Set([...prioritized].filter((id) => !priorityBase.includes(id)))
      }
    };
  }

  function mountSettingsTools() {
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup && !itemGroup.querySelector('[data-roi-settings-tools]')) {
      const box = document.createElement('div');
      box.dataset.roiSettingsTools = '';
      box.style.cssText = 'flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      const status = document.createElement('span'); status.style.color = '#4ade80';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'minmax(56px,auto) minmax(0,1fr) auto';
      box.style.width = '100%';
      box.style.boxSizing = 'border-box';
      const getProps = () => {
        const p = getCommittedProps(itemGroup, (x) => typeof x.update === 'function' && x.draft && x.snap?.character);
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
      const saveSettings = () => {
        const all = readValidatedSetting(settingsKey, validateCategoryProfiles, {});
        const next = plainObject(all) ? { ...all } : {};
        next[boundCharacter] = preferences;
        GM_setValue(settingsKey, validateCategoryProfiles(next));
      };
      const sync = async (automatic = false) => {
        let pendingKey = null;
        try {
          const before = getProps();
          bindCharacter(before);
          const id = boundCharacter, mapId = before.draft.lockMap;
          const modes = { ...preferences.modes };
          pendingKey = JSON.stringify([id, mapId, modes, preferences.enabled]);
          if (automatic && (!preferences.enabled || pendingKey === lastAutoKey)) return;
          const token = ++request;
          lastAutoKey = pendingKey;
          status.textContent = '讀取本圖掉落…';
          const pack = await loadLootPack();
          if (token !== request || !itemGroup.isConnected) return;
          const current = getProps();
          if (characterKey(current) !== id || current.draft.lockMap !== mapId) {
            lastAutoKey = null;
            return;
          }
          const loot = getMapLoot(pack, mapId);
          const result = buildCategoryLootPatch(current.draft, loot, pack, modes, categorySyncByCharacter.get(id));
          if (Object.keys(result.patch).length) current.update(result.patch);
          categorySyncByCharacter.set(id, result.tracked);
          for (const [cat, count] of Object.entries(result.counts)) counters.get(cat).textContent = count + ' 種';
          status.textContent = Object.keys(result.patch).length ? '已更新草稿，請按「套用設定」' : '分類設定已同步';
        } catch (error) {
          if (pendingKey === lastAutoKey) lastAutoKey = null;
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
            preferences.modes[cat] = select.value;
            saveSettings(); lastAutoKey = null; request++;
            if (preferences.enabled) void sync(true);
            else status.textContent = '設定已記住，按「設定本圖」寫入草稿';
          } catch (error) { status.textContent = '⚠️ ' + error.message; }
        };
      }
      const syncNow = element('button', '設定本圖');
      syncNow.type = 'button'; syncNow.className = 'xp-btn small';
      syncNow.onclick = () => { void sync(); };
      auto.onchange = () => {
        try {
          const p = getProps();
          if (characterKey(p) !== boundCharacter) { bindCharacter(p); return; }
          preferences.enabled = auto.checked;
          saveSettings(); lastAutoKey = null; request++;
          if (preferences.enabled) void sync(true);
          else status.textContent = '已關閉自動設定';
        } catch (error) { status.textContent = '⚠️ ' + error.message; }
      };
      const note = element('span', '依本圖掉落設定；已指定的補品與補給會排除。', 'grid-column:1 / -1;color:var(--text-dim)');
      status.style.gridColumn = '2 / -1';
      box.append(note, syncNow, status);
      const tick = () => {
        try {
          bindCharacter(getProps());
          if (preferences.enabled) void sync(true);
        } catch (error) { if (!(error instanceof FiberTraversalTimeout)) auto.disabled = true; }
      };
      lootSyncPanels.set(itemGroup, tick);
      itemGroup.append(box);
    }
    lootSyncPanels.get(itemGroup)?.();

    const monSel = document.querySelector('select[aria-label="怪物控制：加入怪物"]');
    const monHost = monSel?.parentElement;
    const liveMonsterSelect = () => monHost?.querySelector('select[aria-label="怪物控制：加入怪物"]');
    const monsterDraft = () => getCommittedProps(liveMonsterSelect(), (x) => typeof x.update === 'function' && x.draft?.targets && x.draft?.escape);
    const mapMonsterIds = () => {
      const fromProps = getCommittedProps(liveMonsterSelect(), (x) => Array.isArray(x.mapMonsters) || Array.isArray(x.monsterIds));
      const raw = fromProps?.mapMonsters || fromProps?.monsterIds
        || findRareRoots().map((root) => getRareContext(root)?.p.monsterIds).find(Array.isArray);
      return raw && [...new Set(raw.map((m) => Number(typeof m === 'object' ? m.id ?? m.monsterId : m)))]
        .filter((id) => Number.isSafeInteger(id) && id > 0);
    };
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
      addBtn('🔄 同步本圖怪物', () => {
        const status = monHost.querySelector('[data-roi-mon-status]') || document.createElement('span');
        status.dataset.roiMonStatus = '';
        if (!status.isConnected) monHost.append(status);
        const p = monsterDraft(), ids = mapMonsterIds();
        if (!p || !ids) { status.textContent = '無法讀取本圖怪物清單或設定草稿，請重新開啟掛機設定'; return; }
        if (!ids.length) { status.textContent = '目前地圖沒有可同步的怪物'; return; }
        const current = readMonsterRules(p.draft);
        const oldById = new Map(current.map((rule) => [Number(rule.monsterId), rule]));
        const rules = ids.map((id) => oldById.get(id) || { monsterId: id, action: 'attack' });
        if (rules.length > 200) { status.textContent = '本圖怪物超過 200 隻，無法同步'; return; }
        p.update({
          monsterRules: rules,
          targets: { ...p.draft.targets, blacklist: [] },
          escape: { ...p.draft.escape, dangerMonsters: [] }
        });
        status.textContent = '已同步本圖 ' + rules.length + ' 隻怪物，請按套用設定';
      });
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

  function readBackpackContext(force = false) {
    const inputs = [...document.querySelectorAll('input[aria-label="搜尋物品"]')].filter(visible);
    if (inputs.length !== 1) return null;
    let host = inputs[0].parentElement;
    while (host && host !== document.body && !host.querySelector('table.xp-table')) host = host.parentElement;
    const table = host?.querySelector('table.xp-table');
    if (!table || !table.textContent.includes('回城賣') || !table.textContent.includes('存倉')) return null;
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

  async function waitForCartView(read) {
    for (let attempt = 0; attempt < 30 && !document.hidden; attempt++) {
      const result = read();
      if (result) return result;
      await sleep(80);
    }
    return null;
  }

  let cartShortcutBusy = false;
  async function putStackInCart(root, inventoryTab, cartTab, stack) {
    const cartField = () => uniqueVisible(root, 'fieldset', (field) =>
      /^手推車(?:[ (]|$)/.test(clean(field.querySelector(':scope > legend')?.textContent)));
    let box, submitted = false;
    cartShortcutBusy = true;
    try {
      cartTab.click();
      const section = root !== document && await waitForCartView(() => uniqueVisible(root, 'nav[aria-label="設定分類"] button',
        (button) => clean(button.textContent) === '手推車'));
      if (section && section.getAttribute('aria-current') !== 'page') section?.click();

      const field = await waitForCartView(cartField);
      if (!field) throw Error('找不到原版手推車介面');
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
        && uniqueVisible(field, 'button', (button) => !button.disabled && /^放入\s+1\s+項$/.test(clean(button.textContent))));
      if (!submit || document.hidden) throw Error('找不到原版「放入 1 項」按鈕');
      submitted = true;
      submit.click();
      // Return only after the backpack stack disappeared. The native cart shows errors.
      const moved = await waitForCartView(() => field.isConnected && !box.isConnected);
      if (moved && inventoryTab.isConnected && visible(inventoryTab)) inventoryTab.click();
    } catch (error) {
      if (!submitted && box?.isConnected && box.checked && !box.disabled) box.click();
      if (!submitted && inventoryTab.isConnected && visible(inventoryTab) && cartField()) inventoryTab.click();
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
        if (inDetail && el?.tagName === 'BUTTON' && visible(el) && matcher(clean(el.textContent))) return el;
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
    const actor = refineActor(readBackpackContext(true));
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

  async function selectBagItemRow(uid, session) {
    assertRefineTarget(session, uid);
    const b = readBackpackContext(true);
    const row = b?.rows.find((r) => r.uid === uid);
    const btn = row && [...row.row.querySelectorAll('td button')].find((x) => !x.disabled && !x.closest('[data-roi-refine-helper]'));
    if (!btn) throw Error('找不到該裝備列');
    clickRefineControl(session, btn, uid);
    await refineAwait(session, sleep(90));
    return assertRefineTarget(session, uid);
  }

  async function equipItemByUid(uid, session) {
    let b = await refineAwait(session, selectBagItemRow(uid, session));
    b = assertRefineTarget(session, uid);
    if (Object.values(b.s.equipment || {}).includes(uid)) return b;
    const eqBtn = await readRefineDetail(b.table, uid, (t) => t === '裝備', session);
    if (!eqBtn || eqBtn.disabled) throw Error('此職業無法穿戴該裝備進行忽克連精煉');
    clickRefineControl(session, eqBtn, uid);
    for (let i = 0; i < 40; i++) {
      await refineAwait(session, sleep(100));
      b = assertRefineTarget(session, uid);
      if (b && Object.values(b.s.equipment || {}).includes(uid)) return b;
    }
    throw Error('穿戴裝備逾時');
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
        for (let i = 0; i < 25 && !field; i++) { await refineAwait(session, sleep(100)); field = findWhField(); }
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
        await refineAwait(session, sleep(25));
        if (materialQuantity !== null) {
          const amount = li.querySelector('input[type="number"]');
          const stackText = clean(li.textContent).match(/×\s*([\d,]+)/)?.[1];
          const stack = stackText ? Number(stackText.replace(/,/g, '')) : amount ? NaN : 1;
          const quantity = materialWithdrawalAmount(materialQuantity, stack, amount?.max ?? '');
          if (amount) {
            assertRefineSession(session);
            if (!li.contains(amount) || Number(warehouseItemId(li)) !== id) throw Error('領料項目已變動');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw Error('無法設定領料數量，已停止');
            setter.call(amount, String(quantity));
            amount.dispatchEvent(new Event('input', { bubbles: true }));
            amount.dispatchEvent(new Event('change', { bubbles: true }));
            await refineAwait(session, sleep(100));
            const currentAmount = cb.closest('li')?.querySelector('input[type="number"]');
            if (!currentAmount?.isConnected || Number(currentAmount.value) !== quantity) throw Error('遊戲未接受領料數量，已停止');
          } else if (stack !== 1 || quantity !== 1) {
            throw Error('無法確認領料數量，已停止以避免取出整疊');
          }
          selected.get(cb).quantity = quantity;
        }
        if (selected.size >= maxItems) break;
      }
      if (!selected.size) return [];
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
      try { clickRefineControl(session, btn); }
      finally { refineWarehouseSubmitButton = null; }
      submitted = true;
      if (materialQuantity === null) await refineAwait(session, sleep(450));
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
          for (let i = 0; i < 25; i++) {
            await refineAwait(session, sleep(100), true);
            if (readBackpackContext(true)) break;
          }
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

  // 已付費、材料已扣、等級未升，且點擊後遊戲送出的請求都已回應（且之後沒有新的回應）時，
  // 連續兩次讀取結果相同即可確定「未升階」，不必等滿 8 秒；遊戲若不走 fetch，仍以原本 80 次上限為後備。
  function refineNoUpgradeSettled(gate, confirmed, net) {
    if (!confirmed || net.inFlight > 0 || net.settled <= gate.since) { gate.candidate = null; return false; }
    if (gate.candidate === net.settled) return true;
    gate.candidate = net.settled;
    return false;
  }

  async function waitForRefineMaterial(session, id, beforeQty) {
    let backpackReady = false;
    try {
      assertRefineSession(session);
      for (let i = 0; i < 40; i++) {
        await refineAwait(session, sleep(100));
        const b = readBackpackContext(true);
        backpackReady = Boolean(b);
        if (b && materialCount(b.s.inventory, id) > beforeQty) return;
      }
    } catch (error) {
      throw Error(`已送出領倉，確認入帳時停止（${error.message}）。請確認背包與倉庫。`);
    }
    throw Error(backpackReady
      ? '已送出領倉，但材料入帳逾時。請確認背包與倉庫。'
      : '已送出領倉，但等待入帳逾時時背包介面仍未就緒。請確認背包與倉庫。');
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
      characterId, epoch: refineIdentityEpoch, targetUid: null,
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

        if (!pool.length && refAutoWh) {
          session.targetUid = null;
          const before = new Set(b.s.inventory.map((x) => x.uid));
          const picked = await tryWithdrawFromWarehouse(trackedItemIds, limitPlus, setStatus, modeType === 'safe_only' ? safeLimits : null, 15, session);
          assertRefineSession(session);
          if (picked.length) {
            const expected = picked.map((x) => `${x.id}:${x.refine}`).sort().join(',');
            let received = false;
            for (let i = 0; i < 40; i++) {
              b = readBackpackContext(true);
              const added = b?.s.inventory.filter((x) => !before.has(x.uid) && trackedItemIds.has(x.itemId)) || [];
              if (added.map((x) => `${x.itemId}:${x.refine || 0}`).sort().join(',') === expected) {
                for (const x of added.filter((item) => canRefine(item) && (item.refine || 0) < limitPlus)) {
                  session.items.set(x.uid, refineItemSignature(x));
                  runUids.add(x.uid); refSelected.add(x.uid);
                }
                received = true;
                break;
              }
              await refineAwait(session, sleep(100));
            }
            if (!received) throw Error('領取後背包新增的裝備與本批不符，請確認背包');
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

        const safeBtn = !skillOnly && await readRefineDetail(b.table, uid, (t) => /^一鍵精煉到安全值\s*\+\d+/.test(t), session);
        const nativeLimit = Number(clean(safeBtn?.textContent).match(/\+(\d+)/)?.[1]);
        if (modeType === 'safe_only' && nativeLimit > 0) safeLimits.set(target.st.itemId, nativeLimit);
        if (safeBtn && !safeBtn.disabled) {
          const safeTarget = Number(safeBtn.textContent.match(/\+(\d+)/)?.[1]) || 4;
          if (curPlus < safeTarget && (modeType === 'safe_only' || safeTarget <= refTargetPlus)) {
            setStatus(`⚡ 一鍵安全值：【${target.name}】+${curPlus} ➔ +${safeTarget}...`);
            if (refStop || document.hidden) throw Error('已中止精煉');
            let confirmed = false;
            const originalConfirm = page.confirm;
            let accepted = true;
            try {
              page.confirm = (message) => {
                if (refSkipConfirm) return true;
                accepted = originalConfirm.call(page, message);
                return accepted;
              };
              if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
              clickRefineControl(session, safeBtn, uid);
            } finally {
              page.confirm = originalConfirm;
            }
            if (!accepted) throw Error('已取消原生安全精煉');
            let missingContext = 0;
            for (let i = 0; i < 60; i++) {
              await refineAwait(session, sleep(100));
              if (refStop || document.hidden) throw Error('已中止精煉');
              b = readBackpackContext(true);
              if (!b) {
                if (++missingContext >= 5) throw Error('背包介面持續無法讀取，請確認精煉結果');
                continue;
              }
              missingContext = 0;
              const nowSt = b?.s.inventory.find((x) => x.uid === uid);
              if (nowSt && (nowSt.refine || 0) >= safeTarget) { confirmed = true; successCnt++; break; }
            }
            if (!confirmed) throw Error(`【${target.name}】安全精煉結果逾時，請確認裝備`);
            if (modeType === 'safe_only' || safeTarget === refTargetPlus) refSelected.delete(uid);
            await refineAwait(session, sleep(250));
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
        const recipeItem = refinePack?.items?.get(target.st.itemId);
        const weaponLevel = Math.min(4, Math.max(1, recipeItem?.weaponLevel ?? 1));
        const steps = recipeItem?.slots?.includes('weapon') ? refinePack?.refine?.weapon?.[weaponLevel] : refinePack?.refine?.armor;
        const material = steps?.[curPlus]?.material;
        if ((!activeBtn || activeBtn.disabled) && refAutoWh && (!skillOnly || (skillBtn && b.s.character.sp >= 5))) {
          if (!material) throw Error(`【${target.name}】找不到精煉材料資料`);
          const beforeOreQty = materialCount(b.s.inventory, material);
          session.targetUid = null;
          const pulledOres = material ? await tryWithdrawFromWarehouse(new Set([material]), limitPlus, setStatus, null, 1, session, refMaterialBatch) : [];
          if (pulledOres.length) {
            await waitForRefineMaterial(session, material, beforeOreQty);
            session.targetUid = uid;
            b = await refineAwait(session, selectBagItemRow(uid, session));
            if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');
            skillBtn = await readRefineDetail(b.table, uid, isWeaponRefineButton, session);
            npcBtn = skillOnly ? null : await readRefineDetail(b.table, uid, isNpcRefineButton, session);
            activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
          } else {
            assertRefineSession(session);
          }
        }
        if (!activeBtn || activeBtn.disabled) throw Error(skillOnly
          ? `【${target.name}】武器精練不可用，請確認技能等級、材料與 SP（至少 5）`
          : `【${target.name}】精煉按鈕不可用（礦石已用盡、Zeny/SP不足或不在主城）`);

        if (refStop || document.hidden) throw Error('已中止精煉');
        const beforeMatQty = material ? materialCount(b.s.inventory, material) : 0;
        const beforeZeny = b.s.character.zeny, beforeSp = b.s.character.sp;
        setStatus(`🔨 衝裝中：【${target.name}】+${curPlus} ➔ +${curPlus + 1} (成功:${successCnt} 爆:${brokenCnt})`);

        const origConfirm = page.confirm;
        let userAccepted = true, settleGate = { since: pageNet.settled, candidate: null };
        try {
          page.confirm = (msg) => {
            if (refSkipConfirm || /成功率 100%|一定成功/.test(String(msg))) return true;
            userAccepted = origConfirm.call(page, msg);
            return userAccepted;
          };
          if ((assertRefineTarget(session, uid).s.inventory.find((item) => item.uid === uid).refine || 0) !== curPlus) throw Error('精煉值已變動');
          settleGate = { since: pageNet.settled, candidate: null };
          clickRefineControl(session, activeBtn, uid);
        } finally {
          page.confirm = origConfirm;
        }
        if (!userAccepted) throw Error('玩家手動取消精煉');

        let resolved = false, missingContext = 0, confirmedNoUpgrade = false;
        // Before counting a paid failure, give a late result one more fresh read.
        for (let i = 0; i < 80 || (i === 80 && confirmedNoUpgrade); i++) {
          await refineAwait(session, sleep(100));
          b = readBackpackContext(true);
          if (refStop || document.hidden) throw Error('已中止精煉');
          if (!b) {
            confirmedNoUpgrade = false;
            settleGate.candidate = null;
            if (++missingContext >= 5) throw Error('背包介面持續無法讀取，請確認精煉結果');
            continue;
          }
          missingContext = 0;
          const nowSt = b.s.inventory.find((x) => x.uid === uid);
          const paid = activeBtn === skillBtn ? (b.s.character.sp <= beforeSp - 5) : (b.s.character.zeny < beforeZeny);
          confirmedNoUpgrade = Boolean(nowSt && paid && (nowSt.refine || 0) <= curPlus &&
            (!material || materialCount(b.s.inventory, material) < beforeMatQty));
          if (nowSt && (nowSt.refine || 0) === curPlus + 1) {
            successCnt++; resolved = true;
            if (nowSt.refine >= limitPlus) {
              refSelected.delete(uid);
              if (refAutoWh && nowSt.refine >= refTargetPlus && !refStop && !document.hidden) {
                const stBtn = await readRefineDetail(b.table, uid, (t) => /^存入倉庫|^存倉$/.test(t), session);
                if (stBtn && !stBtn.disabled) { clickRefineControl(session, stBtn, uid); await refineAwait(session, sleep(150)); }
              }
            }
            break;
          }
          if (!nowSt && paid) {
            brokenCnt++; resolved = true; refSelected.delete(uid);
            break;
          }
          if (refineNoUpgradeSettled(settleGate, confirmedNoUpgrade, pageNet)) break;
        }
        if (!resolved && confirmedNoUpgrade) {
          // An unchanged or lower level after the final read counts as a failed attempt.
          failedCnt++;
          skipped.add(uid);
          refSelected.delete(uid);
          setStatus(`⚠️ 【${target.name}】已確認消耗，精煉未升階，繼續下一件`);
          resolved = true;
        }
        if (!resolved) throw Error('精煉結果不明，請核對裝備與消耗');
        await refineAwait(session, sleep(320));
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
    warehouse.checked = refAutoWh;
    if (batch !== document.activeElement) batch.value = refMaterialBatch;
    for (const control of [confirm, warehouse, batch]) control.disabled = refBusy;
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
      if (refBusy && !visitingWarehouse) refStop = true;
      refPanel?.remove(); refPanel = null; return;
    }
    if (!refPanel?.isConnected) {
      refPanel = document.createElement('div');
      refPanel.dataset.roiRefineHelper = '';
      refPanel.className = 'xp-sunken p-2';
      refPanel.style.cssText = 'display:grid;gap:6px;margin-bottom:8px;border-left:3px solid #f59e0b;background:linear-gradient(90deg,rgba(15,23,42,0.94),rgba(30,41,59,0.85));border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      refPanel.innerHTML = `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="xp-btn small" id="ref-toggle" style="font-weight:bold;color:#fbbf24;">🔨 展開精煉清單</button>
          <button type="button" class="xp-btn small" id="ref-sel-all">全選本頁裝備</button>
          <button type="button" class="xp-btn small" id="ref-sel-clr">取消全選</button>
          <label style="color:#93c5fd;">模式：<select id="ref-mode" class="xp-input">
            <option value="round_robin">🔄 輪流齊頭衝 (+1輪流)</option>
            <option value="single_focus">🎯 單件直衝到底</option>
          </select></label>
          <label style="color:#fbbf24;font-weight:bold;">目標 +<input type="number" id="ref-target" class="xp-input" value="${refTargetPlus}" min="1" max="10" style="width:48px;"></label>
          <button type="button" class="xp-btn small" id="ref-run-safe" style="background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;">🛡️ 所選衝到安全值</button>
          <button type="button" class="xp-btn small" id="ref-run-target" style="background:linear-gradient(135deg,#d97706,#b45309);color:#fff;font-weight:bold;border:none;">🚀 啟動衝到目標 +N</button>
          <button type="button" class="xp-btn small" id="ref-run-skill" hidden>神工匠武器精練</button>
          <button type="button" class="xp-btn small" id="ref-stop" style="background:#dc2626;color:#fff;display:none;border:none;">⏹ 停止</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
          <label><input type="checkbox" data-roi-ref-confirm> 精煉時略過確認窗</label>
          <label><input type="checkbox" data-roi-ref-warehouse> 自動領料及存倉</label>
          <label>每次領料 <input type="number" data-roi-ref-batch class="xp-input" min="1" max="1000" step="1" style="width:64px;"> 個</label>
        </div>
        <span data-roi-ref-settings-status role="status" style="color:#fde047;"></span>
        <div data-ref-categories role="group" aria-label="精煉裝備分類" style="display:none;gap:6px;flex-wrap:wrap;"></div>
        <div data-ref-list style="display:none;max-height:210px;overflow:auto;gap:4px;padding:6px;background:#090d16;border-radius:6px;border:1px solid #1e293b;"></div>
        <div data-ref-status style="font-size:11.5px;color:#4ade80;">💡 支援 Ctrl / ⌘ 點擊勾選全部同名裝備；安全值後神工匠用技能，一般職業自動穿戴找忽克連並在結束後穿回原裝。</div>
      `;
      b.host.insertBefore(refPanel, b.table.closest('.xp-sunken') || b.table);
      bindRefineSettings(refPanel, refPanel.querySelector('[data-roi-ref-settings-status]'));

      const loadRefineData = async () => {
        if (refinePack) return;
        const status = refPanel.querySelector('[data-ref-status]');
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
      refPanel.querySelector('#ref-stop').onclick = () => { refStop = true; };
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
      button.style.color = active ? '#fbbf24' : '';
      button.style.borderColor = active ? '#fbbf24' : '';
    }
    const eqRows = refineRowsForPage(b.rows);
    const sig = JSON.stringify([!!refinePack, refCategory, refBusy, [...refSelected], eqRows.map((r) => [r.uid, r.st.refine])]);
    if (listEl.dataset.sig === sig) return;
    listEl.dataset.sig = sig;
    listEl.replaceChildren();
    if (refinePack && !eqRows.length) listEl.append(element('span', '沒有可精煉的裝備', 'color:#94a3b8'));
    eqRows.forEach((r) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 6px;cursor:pointer;border-bottom:1px dashed #1e293b;';
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
      const name = element('span', `+${r.st.refine || 0} ${r.name}${slots ? ` [${slots}]` : ''} `, `color:${r.st.refine ? '#38bdf8' : '#e2e8f0'}`);
      applyRefineLevelColor(name, r.st.refine || 0);
      name.append(element('small', `(${SUB_LABELS[r.sub] || r.cat})`, 'color:#64748b'));
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
  tooltip.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;width:320px;box-sizing:border-box;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px);overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere;background:linear-gradient(160deg,#0f172a,#172554);color:#f8fafc;border:1.5px solid #38bdf8;border-radius:10px;padding:11px 13px;box-shadow:0 12px 28px rgba(0,0,0,0.88);font-size:12px;line-height:1.45;contain:layout style;will-change:transform;';
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

  function renderDescBlock(container, rawDesc, currentRefine = 0, baseColor = '#cbd5e1', fontSize = '11px') {
    const items = formatItemDescLines(rawDesc, currentRefine);
    if (!items.length) return;
    const list = element('div', null, `display:flex;flex-direction:column;gap:3px;font-size:${fontSize};line-height:1.45;`);
    for (const item of items) {
      if (item.type === 'meta') {
        const metaEl = element('div', `📋 ${item.text}`, 'color:#93c5fd;font-size:10.5px;padding-bottom:3px;margin-bottom:1px;border-bottom:1px dashed rgba(148,163,184,0.2);');
        list.append(metaEl);
      } else if (item.type === 'refine') {
        const isCur = currentRefine > 0 && currentRefine === item.refineLv;
        const row = element(
          'div',
          `${isCur ? '▶ ' : '• '}${item.text}`,
          isCur
            ? 'color:#fde047;font-weight:bold;background:rgba(250,204,21,0.14);padding:2px 6px;border-radius:4px;border-left:2px solid #facc15;'
            : item.active
              ? 'color:#86efac;padding-left:4px;'
              : 'color:#94a3b8;padding-left:4px;'
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
    tooltip.style.borderColor = hasCards ? '#facc15' : isRefined ? '#38bdf8' : 'rgba(56,189,248,0.75)';
    const header = element('div', null, 'display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(148,163,184,0.28);padding-bottom:8px;margin-bottom:8px;');
    const iconWrap = element('div', null, `position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 30% 30%,rgba(56,189,248,0.2),rgba(15,23,42,0.95));border-radius:8px;border:1px solid ${hasCards ? '#facc15' : isRefined ? '#38bdf8' : '#334155'};flex-shrink:0;`);
    const icon = element('img', null, 'width:26px;height:26px;object-fit:contain;');
    icon.src = `/client/item/${numId}.png`;
    iconWrap.append(icon);
    const titleBox = element('div', null, 'min-width:0;flex:1;');
    const titleLine = element('div', data.name || data.base || dbInfo.name || `道具 #${numId}`, `font-weight:bold;font-size:13.5px;color:${hasCards ? '#fde047' : isRefined ? '#38bdf8' : '#f8fafc'};line-height:1.3;`);
    titleLine.append(element('small', ` #${numId}`, 'color:#64748b;font-weight:normal;'));
    const subLine = element('div', null, 'display:flex;flex-wrap:wrap;align-items:center;gap:4px;font-size:11px;color:#94a3b8;margin-top:2px;');
    const typePill = element('span', SUB_LABELS[sub] || CAT_TABS[cat] || cat, 'background:rgba(245,158,11,0.16);color:#fbbf24;border:1px solid rgba(245,158,11,0.35);padding:0 5px;border-radius:4px;font-weight:bold;');
    subLine.append(typePill);
    const wLv = dbInfo.wLv || (cat === 'weapon' ? WLV_MAP.get(numId) : null);
    if (wLv) subLine.append(element('span', `Lv.${wLv}武器`, 'color:#cbd5e1;'));
    if (dbInfo.reqLv) subLine.append(element('span', `需求Lv.${dbInfo.reqLv}`, 'color:#94a3b8;'));
    if (dbInfo.weight != null) subLine.append(element('span', `重量 ${dbInfo.weight}`, 'color:#94a3b8;'));
    titleBox.append(titleLine, subLine);
    header.append(iconWrap, titleBox);
    nodes.push(header);

    if (dbInfo.atk || dbInfo.matk || dbInfo.def || dbInfo.mdef || dbInfo.desc || data.rawSpecText) {
      const statBox = element('div', null, 'background:rgba(9,13,22,0.78);padding:7px 9px;border-radius:7px;margin-bottom:7px;border:1px solid #1e293b;font-size:11.5px;');
      const statParts = [
        dbInfo.atk ? `⚔️ ATK ${dbInfo.atk}` : '',
        dbInfo.matk ? `🔮 MATK ${dbInfo.matk}` : '',
        dbInfo.def ? `🛡️ DEF ${dbInfo.def}` : '',
        dbInfo.mdef ? `✨ MDEF ${dbInfo.mdef}` : ''
      ].filter(Boolean);
      if (statParts.length) statBox.append(element('div', statParts.join(' ｜ '), 'color:#e2e8f0;font-weight:bold;margin-bottom:5px;'));
      if (dbInfo.desc) renderDescBlock(statBox, dbInfo.desc, Number(data.refine) || 0, '#e2e8f0', '11px');
      if (data.rawSpecText) statBox.append(element('div', `✨ ${data.rawSpecText}`, 'color:#a7f3d0;font-size:11px;margin-top:4px;padding-top:3px;border-top:1px dashed rgba(148,163,184,0.2);'));
      nodes.push(statBox);
    }

    const maxSlots = Math.max(slots, cards.length);
    if (maxSlots > 0 && data.cardsKnown === false) {
      nodes.push(element('div', `💎 插槽 ${maxSlots} 洞（目前清單未提供插卡明細）`, 'font-size:11px;color:#93c5fd;margin-bottom:6px;'));
    }
    if (maxSlots > 0 && data.cardsKnown !== false) {
      const cardBox = element('div', null, 'background:linear-gradient(180deg,rgba(15,23,42,0.92),rgba(9,13,22,0.92));padding:7px 9px;border-radius:7px;border:1px solid rgba(250,204,21,0.35);margin-bottom:7px;');
      const cardHeader = element('div', null, 'display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#fde047;margin-bottom:5px;font-weight:bold;');
      cardHeader.append(
        element('span', `💎 卡片插槽 (${cards.length} / ${maxSlots})`),
        element('span', cards.length ? '已插卡強化' : '尚未插卡', `font-size:10px;padding:1px 5px;border-radius:4px;background:${cards.length ? 'rgba(250,204,21,0.18)' : 'rgba(100,116,139,0.2)'};color:${cards.length ? '#fde047' : '#94a3b8'};`)
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
          const cTitle = element('div', cName, 'font-weight:bold;color:#fde047;font-size:11.5px;');
          cDetail.append(cTitle);
          if (cInfo.desc) {
            const cDescWrap = element('div', null, 'margin-top:2px;');
            renderDescBlock(cDescWrap, cInfo.desc, 0, '#a7f3d0', '10.5px');
            cDetail.append(cDescWrap);
          } else {
            cDetail.append(element('div', '（卡片效果說明尚未載入）', 'color:#64748b;font-size:10px;margin-top:1px;'));
          }
          cRow.append(cIcon, cDetail);
          cardBox.append(cRow);
        } else {
          const emptyRow = element('div', null, `display:flex;align-items:center;gap:6px;padding:3px 0;color:#64748b;font-size:11px;${idx ? 'border-top:1px dashed #1e293b;' : ''}`);
          emptyRow.append(element('span', '◇', 'color:#475569;'), element('span', `空插槽 [${idx + 1}]（未插卡）`));
          cardBox.append(emptyRow);
        }
      }
      nodes.push(cardBox);
    }

    if (data.price) {
      const foot = element('div', null, 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.22);font-size:11px;color:#94a3b8;');
      const sellerText = `🏪 ${data.seller || '露天攤位'}${data.city ? ` (${TOWN_NAMES[data.city] || data.city})` : ''}`;
      const priceText = data.qty && data.qty > 1
        ? `單價 ${data.price.toLocaleString()} Z × ${data.qty} = ${(data.price * data.qty).toLocaleString()} Z`
        : `售價 ${data.price.toLocaleString()} Z`;
      foot.append(
        element('span', sellerText, 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'),
        element('b', priceText, 'color:#4ade80;white-space:nowrap;')
      );
      nodes.push(foot);
    }

    tooltip.replaceChildren(...nodes);
  }

  mktPanel.innerHTML = `
    <legend class="legend" id="roi-mkt-leg">🏪 攤位分類檢視 </legend>
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
      <button type="button" id="roi-mkt-auto" class="xp-btn small" style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;font-weight:bold;border:none;">▶️ 啟動 15s 自動整理</button>
      <input type="text" id="roi-mkt-q" class="xp-input" placeholder="篩選商品/插卡 (或跨城補查字)..." style="min-width:175px;">
      <select id="roi-mkt-sort" class="xp-input"><option value="asc">價低➔高</option><option value="desc">價高➔低</option><option value="name">名稱</option></select>
      <label><input type="checkbox" id="roi-mkt-min" checked> 同規格最低</label>
      <button type="button" id="roi-mkt-cross" class="xp-btn small" style="background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;font-weight:bold;border:none;">🛰️ 立即跨城補查</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-bottom:6px;">
      <div id="roi-mkt-tabs" style="display:flex;flex-wrap:wrap;gap:4px;"></div>
      <label id="roi-mkt-sub-wrap" style="display:none;color:#fbbf24;font-weight:bold;">細分類：<select id="roi-mkt-sub" class="xp-input"></select></label>
    </div>
    <div id="roi-mkt-status" style="font-size:11px;color:#38bdf8;margin-bottom:5px;">目前城鎮攤位快照｜指到裝備可看精煉加成與插卡詳情，點 🔍 可切回原生購買</div>
    <div id="roi-mkt-rows" style="max-height:60vh;overflow:auto;border:1px solid #334155;border-radius:6px;background:rgba(9,13,22,0.5);"></div>
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
        await sleep(800);
        if (!isCurrent() || findCityVendingFieldset() !== cf) return;
        const p = readFiberForUi(() => getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId));
        if (p === undefined) return;
        if (updateLocalListings(p)) renderMkt();
      }
      const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
      if (kw && mktAuto15s && Date.now() >= crossCooldownUntil) {
        await sleep(2200);
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
    mktAutoTimer = setInterval(() => { void mktAutoTick(); }, 15000);
  }

  function stopMktAuto(reason = '') {
    ++mktAutoGeneration;
    mktAuto15s = false;
    clearInterval(mktAutoTimer);
    mktAutoTimer = null;
    if (crossAbortCtrl) {
      try { crossAbortCtrl.abort(); } catch {}
      crossAbortCtrl = null;
    }
    crossBusy = false;
    ++crossRequest;
    mktAutoBtn.textContent = '▶️ 啟動 15s 自動整理';
    mktAutoBtn.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
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
      const row = element('div', null, 'display:grid;grid-template-columns:minmax(240px,1fr) 165px 55px 140px;gap:6px;padding:6px 10px;border-bottom:1px solid #33415555;align-items:center;font-size:12px');
      row.className = 'roi-mkt-row';
      row.dataset.rkey = r.key;
      const item = element('span', null, 'display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:wrap');
      const fav = element('button', mktFavs.has(r.id) ? '★' : '☆', mktFavs.has(r.id) ? 'color:#facc15' : '');
      fav.type = 'button'; fav.className = 'xp-btn small'; fav.dataset.act = 'fav';
      const img = element('img', null, 'width:21px;height:21px;object-fit:contain');
      img.src = `/client/item/${r.id}.png`; img.loading = 'lazy';
      const clip = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const name = element('span', r.name, `${clip};font-weight:${r.refine || r.cards.length ? 'bold' : 'normal'};color:${r.cards.length ? '#fde047' : r.refine ? '#38bdf8' : 'inherit'}`);
      item.append(fav, img, name);
      if (r.changeTag) item.append(element('small', r.changeTag, 'color:#fb923c'));
      const price = element('span', null, 'text-align:right;white-space:nowrap');
      const money = element('span', r.price.toLocaleString() + ' Z', getMoneyColorVars(r.price));
      money.className = 'roi-mc-text';
      const find = element('button', '🔍', 'margin-left:4px');
      find.type = 'button'; find.className = 'xp-btn small'; find.dataset.act = 'find'; find.title = '切回原生攤位定位購買 / 跨城搜尋';
      price.append(money, find);
      const seller = element('span', r.seller, clip);
      seller.append(element('small', ` (${TOWN_NAMES[r.city] || r.city}${src})`, 'color:#93c5fd'));
      row.append(item, price, element('span', '剩 ' + r.qty, 'text-align:right'), seller);
      return row;
    });
    mktRowsBox.replaceChildren(...(rows.length ? rows : [element('div', '無符合商品', 'padding:16px;text-align:center;color:#94a3b8')]));
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
      } catch (error) { console.warn('便利助手收藏儲存失敗', error); }
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

  function syncHudSettings() {
    const pane = document.querySelector('#pane-cfg.active');
    if (!pane) return;
    for (const input of pane.querySelectorAll('[data-ro-pref]')) input.checked = state[input.dataset.roPref];
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

  let hudFit = null, hudSizeObserver = null, browserMenuObserver = null;
  window.addEventListener('resize', () => hudFit?.());
  function ensureHUD() {
    if (!document.body || document.getElementById('ro-helper-hud')) return;
    // 浮窗被移除後重建時，沿用同一份樣式並釋放舊的觀察器，避免重複 CSS 與監聽器累積。
    hudSizeObserver?.disconnect();
    browserMenuObserver?.disconnect();
    browserMenuObserver = null;
    const st = document.querySelector('style[data-roi-style]') || document.createElement('style');
    st.dataset.roiStyle = '';
    st.textContent = `
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
      [data-roi-wh-pin][aria-pressed="true"] { color:#b45309; }
      html.night [data-roi-wh-pin][aria-pressed="true"] { color:#fbbf24; }
      html:not([data-roi-money-off]) .roi-mc-text { color: var(--roi-mc) !important; font-weight: bold !important; font-variant-numeric: tabular-nums; }
      html:not([data-roi-money-off]):is(.night,[data-info-night]) .roi-mc-text,
      html:not([data-roi-money-off]) #roi-mkt-rows .roi-mc-text { color: var(--roi-mn) !important; -webkit-text-fill-color: currentColor !important; }
      .roi-mkt-row:hover { background:rgba(56,189,248,0.12) !important; }
      table.roi-market-table { width:100% !important; table-layout:fixed !important; }
      table.roi-market-table tr > [data-roi-market-col] { box-sizing:border-box !important; }
      table.roi-market-table tr > [data-roi-market-col="item"] { width:auto !important; }
      table.roi-market-table tr > [data-roi-market-col="price"] { position:relative !important; width:180px !important; padding-right:48px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="stock"] { width:65px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input"] { width:85px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:150px !important; text-align:right !important; white-space:nowrap !important; }
      table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:64px !important; max-width:100% !important; box-sizing:border-box !important; }
      table.roi-market-table td[data-roi-market-col="price"] > button[data-roi-price-search] { position:absolute; right:22px; top:50%; transform:translateY(-50%); width:21px; height:21px; padding:0; border:0; background:transparent; color:#38bdf8 !important; font:14px sans-serif; cursor:pointer; }
      @media(max-width:600px) {
        table.roi-market-table tr > [data-roi-market-col="price"] { width:135px !important; }
        table.roi-market-table tr > [data-roi-market-col="stock"] { width:45px !important; }
        table.roi-market-table tr > [data-roi-market-col="input"] { width:65px !important; }
        table.roi-market-table tr > [data-roi-market-col="input-stock"] { width:110px !important; }
        table.roi-market-table tr > [data-roi-market-col^="input"] input[type="number"] { width:52px !important; }
      }
      li.ro-wh-locked { background:linear-gradient(90deg,rgba(245,158,11,0.22),transparent 85%)!important; border-left:3px solid #f59e0b!important; padding-left:4px!important; }
      button.ro-badge-lock { background:linear-gradient(135deg,#78350f,#92400e)!important; color:#fde047!important; border:1px solid #f59e0b!important; border-radius:4px!important; padding:0 5px!important; margin:0 4px!important; font-size:11px!important; font-weight:bold!important; cursor:pointer!important; }
      button.ro-badge-unlock { background:transparent!important; color:#64748b!important; border:1px dashed #475569!important; border-radius:4px!important; padding:0 4px!important; margin:0 4px!important; font-size:11px!important; opacity:0.6; cursor:pointer!important; }
      [data-ro-ref-tier="4"]  { color: #60a5fa !important; font-weight: 600 !important; }
      [data-ro-ref-tier="5"]  { color: #34d399 !important; font-weight: 600 !important; }
      [data-ro-ref-tier="6"]  { color: #a3e635 !important; font-weight: 700 !important; }
      [data-ro-ref-tier="7"]  { color: #facc15 !important; font-weight: 700 !important; text-shadow: 0 0 5px rgba(250,204,21,0.45) !important; }
      [data-ro-ref-tier="8"]  { color: #fb923c !important; font-weight: 800 !important; text-shadow: 0 0 7px rgba(251,146,60,0.55) !important; }
      [data-ro-ref-tier="9"]  { color: #f87171 !important; font-weight: 800 !important; text-shadow: 0 0 9px rgba(248,113,113,0.7) !important; }
      [data-ro-ref-tier="10"] { color: #ff2d55 !important; font-weight: 900 !important; text-shadow: 0 0 8px #ff2d55, 0 0 3px #ffd700 !important; background: linear-gradient(90deg, rgba(255,45,85,0.22), rgba(250,204,21,0.18)) !important; border-radius: 4px !important; padding: 0 5px !important; border: 1px solid rgba(255,215,0,0.65) !important; }
      #ro-helper-hud { position:fixed; top:48px; right:14px; z-index:2147483646; font-family:system-ui,-apple-system,"Microsoft JhengHei",sans-serif; user-select:none; touch-action:none; }
      #ro-hud-card { background:linear-gradient(165deg,rgba(15,23,42,0.96),rgba(9,13,22,0.98)); backdrop-filter:blur(12px); color:#f8fafc; border:1.5px solid rgba(56,189,248,0.75); border-radius:12px; box-sizing:border-box; width:min(365px,calc(100vw - 8px)); max-height:calc(100vh - 8px); max-height:calc(100dvh - 8px); box-shadow:0 16px 40px rgba(0,0,0,0.88), 0 0 15px rgba(56,189,248,0.15); font-size:12px; overflow:auto; }
      #ro-drag { position:sticky; top:0; z-index:1; }
      .ro-tab { flex:1; text-align:center; padding:8px 2px; cursor:pointer; color:#94a3b8; font-weight:bold; font-size:11px; border-bottom:2px solid transparent; transition:all 0.15s; }
      .ro-tab:hover { color:#e2e8f0; background:rgba(30,41,59,0.5); }
      .ro-tab.active { color:#fbbf24; border-bottom-color:#fbbf24; background:rgba(30,41,59,0.9); }
      .ro-pane { display:none; padding:10px 12px; max-height:410px; overflow-y:auto; touch-action:pan-y; }
      .ro-pane.active { display:block; }
      .ro-box { background:rgba(30,41,59,0.75); border:1px solid rgba(71,85,105,0.65); border-radius:8px; padding:7px 9px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); }
      #pane-cfg fieldset { min-inline-size:0; margin:0 0 8px; display:grid; gap:6px; }
      #pane-cfg legend { color:#fbbf24; font-weight:bold; }
      #pane-cfg label { display:flex; align-items:center; flex-wrap:wrap; gap:4px; }
      #pane-cfg label > input { margin:0 4px 0 0; }
      #pane-cfg input[type="number"] { width:7em; color:#f8fafc; background:#0f172a; border:1px solid #475569; border-radius:4px; }
    `;
    if (!st.isConnected) document.head.appendChild(st);
    document.documentElement.toggleAttribute('data-roi-money-off', !state.moneyColor);

    const hud = document.createElement('div'); hud.id = 'ro-helper-hud';
    hud.innerHTML = `
      <div id="ro-fab" style="display:${state.hudMin ? 'flex' : 'none'};width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#0f172a,#1e293b);border:2px solid #38bdf8;color:#38bdf8;align-items:center;justify-content:center;font-size:21px;cursor:move;box-shadow:0 8px 24px rgba(0,0,0,0.85);" title="可拖曳移動｜點擊展開">⚡</div>
      <div id="ro-hud-card" style="display:${state.hudMin ? 'none' : 'block'};">
        <div id="ro-drag" style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px 10px;background:linear-gradient(90deg,#1e293b,#0f172a);border-bottom:1px solid #334155;font-weight:bold;color:#38bdf8;cursor:move;" title="按住可拖曳移動視窗">
          <span style="white-space:nowrap;">⚡ RO Idle v3.5.1.2 測試版</span>
          <button id="ro-min-btn" style="background:#334155;color:#fff;border:none;border-radius:5px;padding:2px 8px;cursor:pointer;font-weight:bold;">━</button>
        </div>
        <div style="display:flex;background:#090d16;border-bottom:1px solid #1e293b;">
          <div class="ro-tab active" data-t="tel">📊 效率</div>
          <span data-roi-mvp-slot></span>
          <div class="ro-tab" data-t="chr">👥 分身</div>
          <div class="ro-tab" data-t="lot">🎒 掉寶</div>
          <div class="ro-tab" data-t="cfg">⚙️ 設定</div>
        </div>
        <div class="ro-pane active" id="pane-tel">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;font-size:11.5px;">
            <span>角色：<b id="u-name" style="color:#38bdf8;">讀取中</b></span>
            <span id="u-time" style="color:#4ade80;font-weight:bold;font-variant-numeric:tabular-nums;">⏱️ 00:00</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:7px;">
            <div class="ro-box"><small style="color:#94a3b8;">Base EXP/h</small><div id="u-bexp" style="font-size:13.5px;font-weight:bold;color:#facc15;margin-top:2px;">0</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">Job EXP/h</small><div id="u-jexp" style="font-size:13.5px;font-weight:bold;color:#38bdf8;margin-top:2px;">0</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">擊殺 (累計)</small><div id="u-kph" style="font-size:13.5px;font-weight:bold;color:#4ade80;margin-top:2px;">0/h (0)</div></div>
            <div class="ro-box"><small style="color:#94a3b8;">均傷 / 最高</small><div id="u-dmg" style="font-size:13.5px;font-weight:bold;color:#f472b6;margin-top:2px;">0 / 0</div></div>
          </div>
          <div class="ro-box" style="margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;">
            <div><small style="color:#94a3b8;">隨身 Zeny (本角淨變動)</small><div id="u-zeny" style="font-weight:bold;color:#facc15;font-size:13px;margin-top:2px;">0 Z (+0)</div></div>
            <div style="text-align:right;"><small style="color:#94a3b8;">漏撿</small><div id="u-miss" style="font-weight:bold;color:#f87171;font-size:13px;margin-top:2px;">0</div></div>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="b-pause" style="flex:1;background:linear-gradient(135deg,#d97706,#b45309);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">⏸️ 暫停監測</button>
            <button id="b-reset" style="flex:1;background:#334155;color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">🔄 歸零</button>
          </div>
        </div>
        <div class="ro-pane" id="pane-chr">
          <div style="display:flex;justify-content:space-between;margin-bottom:7px;background:#090d16;padding:7px 10px;border-radius:6px;border:1px solid #1e293b;">
            <span>💰 帳號總 Zeny：</span><b id="u-tzeny" style="color:#facc15;">計算中...</b>
          </div>
          <div id="u-clist">同步中...</div>
        </div>
        <div class="ro-pane" id="pane-lot">
          <div id="u-rlist" style="background:#090d16;padding:7px;border-radius:6px;border:1px solid #1e293b;margin-bottom:7px;max-height:75px;overflow:auto;color:#fde047;font-size:11px;">尚無稀有掉落...</div>
          <div id="u-llist" style="background:#090d16;padding:7px;border-radius:6px;border:1px solid #1e293b;max-height:190px;overflow:auto;font-size:11px;">尚無撿取紀錄...</div>
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
          <div id="c-settings-status" role="status" style="color:#fde047;"></div>
          <div style="font-weight:bold;color:#fbbf24;margin-bottom:4px;">🔒 自訂倉庫貴重保護詞 (由你決定)</div>
          <textarea id="i-words" rows="2" placeholder="例：布里刊, 亡者遺物, 神之金屬, 鋁" style="width:100%;box-sizing:border-box;background:#090d16;color:#fde047;border:1px solid #475569;border-radius:6px;padding:6px;font-size:11.5px;user-select:text;"></textarea>
          <button id="b-save-words" style="width:100%;margin:6px 0 8px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">💾 儲存自訂貴重詞並套用至倉庫</button>
          <div style="display:flex;gap:6px;">
            <button id="b-exp-json" style="flex:1;background:linear-gradient(135deg,#0284c7,#0369a1);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📤 匯出備份</button>
            <button id="b-imp-json" style="flex:1;background:#334155;color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">📥 匯入還原</button>
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
      menu.style.cssText = 'position:relative;top:auto;right:auto;z-index:2;font:12px system-ui;color:#eee;';
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

    function placeHud(left, top) {
      const { width, height } = hud.getBoundingClientRect();
      const edge = 4;
      const maxLeft = innerWidth - width - edge;
      const maxTop = innerHeight - height - edge;
      const x = Math.min(Math.max(0, maxLeft), Math.max(edge, left));
      const y = Math.min(Math.max(0, maxTop), Math.max(edge, top));
      hud.style.right = 'auto';
      hud.style.left = x + 'px';
      hud.style.top = y + 'px';
      return { left: x, top: y };
    }

    function fitHud() {
      if (!hud.isConnected) return;
      const { width } = hud.getBoundingClientRect();
      const { left, top } = state.hudPos || {};
      placeHud(Number.isFinite(left) ? left : innerWidth - width - 14, Number.isFinite(top) ? top : 48);
    }

    fitHud();
    hudFit = fitHud;
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
        if (!moved) return;
        state.hudPos = placeHud(ox + dx, oy + dy);
      });
      handle.addEventListener('pointerup', (e) => {
        if (!dragging) return;
        dragging = false;
        handle.releasePointerCapture(e.pointerId);
        if (moved) savePrefs();
        else if (onClick) onClick();
      });
    };

    const setMin = (m) => {
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
    });

    const settings = hud.querySelector('#pane-cfg');
    const settingsStatus = settings.querySelector('#c-settings-status');
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
      try { GM_setValue('ro_custom_protect_words_v091', words); } catch {}
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
      if (!state.paused) { state.accMs += Date.now() - state.lastResumed; state.paused = true; bPause.textContent = '▶️ 繼續監測'; bPause.style.background = 'linear-gradient(135deg,#16a34a,#15803d)'; }
      else { state.lastResumed = Date.now(); state.paused = false; bPause.textContent = '⏸️ 暫停監測'; bPause.style.background = 'linear-gradient(135deg,#d97706,#b45309)'; }
      updateHUD();
    };
    document.getElementById('b-reset').onclick = () => {
      state.accMs = 0; state.lastResumed = Date.now(); state.kills = 0; state.bexp = 0; state.jexp = 0; state.dmgSum = 0; state.hits = 0; state.maxDmg = 0; state.missed = 0;
      state.loot = {}; state.lootRev++; state.renderedLootRev = -1;
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
      zeny: document.getElementById('u-zeny'),
      miss: document.getElementById('u-miss'),
      llist: document.getElementById('u-llist'),
      rlist: document.getElementById('u-rlist')
    };
    return hudRefs;
  }

  const fmt = (n) => n >= 1e8 ? (n / 1e8).toFixed(2) + '億' : n >= 1e4 ? (n / 1e4).toFixed(1) + '萬' : Math.round(n).toLocaleString();
  function updateHUD() {
    if (document.hidden || state.hudMin) return;
    syncHudSettings();
    const refs = getHudRefs();
    if (!refs) return;
    const sec = Math.max(1, Math.floor((state.accMs + (state.paused ? 0 : Date.now() - state.lastResumed)) / 1000)), hrs = sec / 3600;
    refs.name.textContent = state.activeCharName;
    refs.time.textContent = `${state.paused ? '⏸️ ' : '⏱️ '}${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    refs.bexp.textContent = fmt(state.bexp / hrs);
    refs.jexp.textContent = fmt(state.jexp / hrs);
    refs.kph.textContent = `${Math.round(state.kills / hrs)}/h (${state.kills})`;
    refs.dmg.textContent = `${fmt(state.hits ? state.dmgSum / state.hits : 0)} / ${fmt(state.maxDmg)}`;
    const initZ = state.initZenyMap[state.activeCharId] ?? state.curZeny, diff = state.curZeny - initZ;
    refs.zeny.textContent = `${state.curZeny.toLocaleString()} Z (${diff >= 0 ? '+' : ''}${diff.toLocaleString()})`;
    refs.miss.textContent = `${state.missed} 次`;

    if (state.lootRev !== state.renderedLootRev) {
      state.renderedLootRev = state.lootRev;
      const lEntries = Object.entries(state.loot).sort((a, b) => b[1] - a[1]);
      if (lEntries.length) refs.llist.replaceChildren(...lEntries.map(([name, qty]) => {
        const row = element('div', null, 'display:flex;justify-content:space-between;border-bottom:1px dashed #334155;padding:3px 0;');
        row.append(element('span', name), element('b', `×${qty}`, 'color:#4ade80'));
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
  function renderChars() {
    const box = document.getElementById('u-clist'); if (!box) return;
    const sum = [...state.myCharIds].reduce((total, id) => total + (state.charZenyMap[id] || 0), 0);
    document.getElementById('u-tzeny').textContent = sum.toLocaleString() + ' Z';
    box.replaceChildren(...state.chars.map((c) => {
      const row = element('div', null, `display:flex;justify-content:space-between;align-items:center;background:rgba(30,41,59,0.8);padding:6px 10px;border-radius:6px;margin-bottom:5px;border-left:3px solid ${c.running ? '#22c55e' : '#ef4444'}`);
      const detail = element('div');
      detail.append(element('b', c.name), element('small', ` (Lv.${c.baseLv}/${c.jobLv})`, 'color:#94a3b8'),
        element('div', `📍 ${c.mapId} ｜ 💰 ${(state.charZenyMap[c.id] || 0).toLocaleString()} Z`, 'font-size:11px;color:#93c5fd;margin-top:2px'));
      const alert = state.charAlerts[c.id];
      if (alert) {
        detail.append(element('small', '⚠ ' + alert.reason, 'color:#f87171'));
        if (alert.reason !== '已停止掛機') row.onclick = () => clearTransientCharAlerts(c.id);
      }
      row.append(detail, element('b', c.running ? '🟢掛機' : '🔴停止', `color:${c.running ? '#4ade80' : '#f87171'}`));
      return row;
    }));
  }

  let lastInteractionAt = -Infinity;
  const hasActiveOperation = () => refBusy || cartShortcutBusy || visitingWarehouse;
  const isActiveWindow = () => hasActiveOperation() ||
    (!document.hidden && (document.hasFocus() || performance.now() - lastInteractionAt <= 5000));

  function trackRouterInteraction() {
    if (document.hidden) return;
    const now = performance.now();
    if (now - lastInteractionAt >= 100) lastInteractionAt = now;
  }

  for (const event of ['pointermove', 'keydown', 'pointerdown']) {
    document.addEventListener(event, trackRouterInteraction, { passive: true, capture: true });
  }

  function routerDelay() {
    if (isActiveWindow()) return 160;
    return document.hidden ? 700 : 300;
  }
  const logSnapshots = [];
  let logTimer = null;
  let lastAlertRender = -Infinity;
  let alertRenderTimer = null;
  function renderLogAlertChars() {
    if (alertRenderTimer !== null) return;
    const remaining = 250 - (performance.now() - lastAlertRender);
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
    for (const text of logSnapshots.splice(0, size)) parseLog(text);
  }
  function scheduleLogBatch() {
    if (logTimer !== null || !logSnapshots.length) return;
    logTimer = setTimeout(() => {
      logTimer = null;
      flushLogBatch(document.hidden ? 800 : 200);
      scheduleLogBatch();
    }, isActiveWindow() ? 120 : 250);
  }
  function queueLogLine(line) {
    if (!line) return;
    const text = clean(line.textContent);
    if (!text || state.processedLines.get(line) === text) return;
    state.processedLines.set(line, text);
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
    logSnapshots.push(text);
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
      document.querySelector('[aria-label="道具設定的複製與匯出匯入"],select[aria-label="怪物控制：加入怪物"]') ||
      rareKnownRoots.size > 0 ||
      legends.some((t) => /^必撿稀有掉落/.test(t))
    ) mountSettingsTools();
    if (legends.some((t) => /^倉庫/.test(t))) refreshWarehouse();
    if (legends.some((t) => /的攤位/.test(t)) || mktPanel.isConnected || townResultsTable) syncMktMount();
    if (refreshAnnotations) annotateAllRefinedEquipment();
    syncHudSettings();
    mvpRadar?.syncFromStats();
  }

  let uiTimer = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    clearTimeout(uiTimer);
    uiTimer = null;
    runPageRouter();
    if (canShareCharPoll()) void pollChars();
  });
  new MutationObserver((records) => {
    let domChanged = false;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el || !el.isConnected || el.closest('#ro-helper-hud,#roi-helper-mvp-panel,#roi-item-hover-tooltip,[data-roi-market-browser],[data-ro-wh-bar],[data-ro-rare-helper],[data-roi-settings-tools],[data-roi-refine-helper],[data-roi-price-search],[data-roi-upper-fold]')) continue;
      if (r.type === 'attributes' && !el.matches('fieldset') && !el.querySelector('fieldset')) continue;
      if (el.closest('.log-window')) {
        if (r.type === 'characterData' || r.type === 'childList') queueLogLine(el.closest('.log-line'));
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('.log-line')) queueLogLine(n);
          n.querySelectorAll?.('.log-line').forEach(queueLogLine);
        });
        continue;
      }
      if (r.type === 'childList') r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        n.querySelectorAll?.('.log-window .log-line').forEach(queueLogLine);
      });
      domChanged = true;
    }
    if (domChanged && !uiTimer) {
      uiTimer = setTimeout(() => { uiTimer = null; runPageRouter(); }, routerDelay());
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
        border-bottom-color: #fbbf24;
        color: #fbbf24;
        background: rgba(30, 41, 59, 0.9);
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
        background: linear-gradient(165deg, rgba(15, 23, 42, 0.97), rgba(9, 13, 22, 0.99));
        backdrop-filter: blur(12px);
        color: #edf1f7;
        border: 1.5px solid rgba(56, 189, 248, 0.72);
        border-radius: 12px;
        box-shadow: 0 20px 64px rgba(0, 0, 0, 0.9), 0 0 18px rgba(56, 189, 248, 0.14);
        font: 13.5px/1.45 system-ui, -apple-system, "Microsoft JhengHei", sans-serif;
        color-scheme: dark;
        overflow: hidden;
      }
      #roi-helper-mvp-panel:not([open]) { display: none; }
      #roi-helper-mvp-panel[open] { display: flex; flex-direction: column; }

      #roi-helper-mvp-panel button {
        border: 1px solid #485b73;
        background: #223146;
        color: #eef3fa;
        border-radius: 7px;
        padding: 6px 12px;
        font: inherit;
        cursor: pointer;
        transition: background .15s ease, border-color .15s ease, color .15s ease;
      }
      #roi-helper-mvp-panel button:hover {
        background: #2b3e57;
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
        background: linear-gradient(90deg, #1e293b, #0f172a);
        border-top: 2px solid #fbbf24;
        border-bottom: 1px solid #334155;
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
        color: #38bdf8;
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
        color: #c2d0e2;
      }
      #roi-helper-mvp-panel .btn-ghost:hover {
        background: #223146;
        color: #fff;
      }

      #roi-helper-mvp-panel .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 16px;
        background: rgba(15, 23, 42, 0.85);
        border-bottom: 1px solid #263549;
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
        border: 1px solid #384960;
        background: #1b283b;
        color: #b7c6da;
        font-size: 12.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .filter-chip:hover {
        border-color: #5a7291;
        color: #fff;
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] {
        background: #2b415e;
        border-color: #82a6d1;
        color: #fff;
        font-weight: 650;
      }
      #roi-helper-mvp-panel .filter-chip .count {
        padding: 0 5px;
        border-radius: 999px;
        background: #0f1724;
        color: #9fb3cc;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .filter-chip[aria-pressed="true"] .count {
        background: #17263a;
        color: #ffd894;
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
        border: 1px solid #3c4e66;
        border-radius: 7px;
        background: #090d16;
        color: #eef3fa;
        font: inherit;
        font-size: 13px;
      }
      #roi-helper-mvp-panel .search-input::placeholder { color: #7588a3; }
      #roi-helper-mvp-panel .search-clear {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        padding: 1px 6px;
        border: none;
        background: transparent;
        color: #8ca0bc;
        font-size: 14px;
        line-height: 1;
      }
      #roi-helper-mvp-panel .search-clear:hover {
        background: transparent;
        color: #fff;
      }

      #roi-helper-mvp-panel small { color: #a9b9ce; font-size: 12px; }

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
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid #344761;
        color: #c8d7ea;
        font-size: 12.5px;
      }
      #roi-helper-mvp-panel .notice-bar.warn {
        background: #2d2118;
        border-color: #7c5330;
        color: #fbd3a8;
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
        border-bottom: 1px solid #263549;
        color: #cddbf0;
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
        color: #889cb8;
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
        background: rgba(30, 41, 59, 0.72);
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
        background: linear-gradient(145deg, rgba(66, 44, 16, 0.55), rgba(30, 41, 59, 0.78));
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
        border: 1px solid #3c4f66;
        border-radius: 8px;
        background: radial-gradient(circle at 50% 45%, #37485d, #090d16 82%);
        overflow: hidden;
      }
      #roi-helper-mvp-panel canvas {
        width: 64px;
        height: 64px;
        image-rendering: pixelated;
      }
      #roi-helper-mvp-panel .no-portrait {
        color: #7d90aa;
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
        color: #fff;
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
        background: #243347;
        color: #b7c8de;
        border: 1px solid #394d68;
      }
      #roi-helper-mvp-panel .status-pill[data-state="window"] {
        background: #422c10;
        border-color: #b46914;
        color: #ffd584;
      }
      #roi-helper-mvp-panel .status-pill[data-state="upcoming"] {
        background: #172e4c;
        border-color: #2f629e;
        color: #9ecbff;
      }
      #roi-helper-mvp-panel .status-pill[data-state="passed"] {
        background: #13352c;
        border-color: #256e59;
        color: #8ce9c3;
      }

      #roi-helper-mvp-panel .kill-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #9eb0c7;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .source-tag {
        padding: 0 5px;
        border-radius: 4px;
        background: #233348;
        color: #9ec3e6;
        font-size: 11px;
      }

      #roi-helper-mvp-panel .maps-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding-top: 8px;
        border-top: 1px solid #29384d;
      }
      #roi-helper-mvp-panel .multi-map-hint {
        color: #9fb2ca;
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .map-row {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 7px 9px;
        border-radius: 7px;
        background: rgba(9, 13, 22, 0.72);
        border: 1px solid #263549;
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
        background: #21364c;
        border-color: #395878;
        color: #dceeff;
        font-size: 12.5px;
        font-weight: 600;
        text-align: left;
      }
      #roi-helper-mvp-panel .map-btn:hover {
        background: #2a4663;
        border-color: #5b87b5;
        color: #fff;
      }
      #roi-helper-mvp-panel .map-btn::after {
        content: '前往 ›';
        color: #8cc5ea;
        font-size: 11.5px;
        font-weight: 500;
      }
      #roi-helper-mvp-panel .interval-tag {
        color: #8da1bc;
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
        color: #93a7c2;
        font-size: 11.5px;
      }
      #roi-helper-mvp-panel .time {
        color: #ffdc9c;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }
      #roi-helper-mvp-panel .progress-track {
        height: 3px;
        border-radius: 999px;
        background: #223044;
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
        color: #92a5bf;
        background: #162131;
        border: 1px dashed #32445c;
        border-radius: 10px;
      }

      #roi-helper-mvp-panel footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 16px;
        background: rgba(15, 23, 42, 0.9);
        border-top: 1px solid #2b3a4f;
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

    const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    function namedButton(label) {
      return [...document.querySelectorAll('button,[role="tab"]')].find(el =>
        visible(el) && !el.disabled && [el.textContent.trim(),el.getAttribute('aria-label'),el.title].includes(label));
    }
    function setSearch(input, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new InputEvent('input', {bubbles:true, composed:true, inputType:'insertReplacementText', data:value}));
      input.dispatchEvent(new Event('change', {bubbles:true}));
    }
    async function until(read) {
      for (let n = 0; n < 100; n++) {
        const value = read();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve,80));
      }
      return null;
    }
    const mapGroup = () => [...document.querySelectorAll('[role="group"][aria-label="掛機地圖"]')].find(visible);
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
      closeRadar();
      try {
        if (!mapGroup()) {
          let tab = namedButton('掛機設定');
          if (!tab) {
            namedButton('冒險')?.click();
            tab = await until(() => namedButton('掛機設定'));
          }
          if (!tab && !mapGroup()) throw Error('找不到掛機設定入口。請先開啟掛機設定再點地圖。');
          tab?.click();
        }
        const findFilter = () => [...document.querySelectorAll('input[type="search"]')].find(el =>
          visible(el) && el.closest('label')?.textContent.includes('搜尋設定'));
        await until(() => mapGroup() || findFilter());
        if (!mapGroup() && findFilter()) setSearch(findFilter(),'掛機地圖');
        const field = await until(() => mapGroup()?.querySelector('input[aria-label="掛機地圖：搜尋"]'));
        if (!field) throw Error('找不到原生掛機地圖選單。');
        const options = pickerMaps(field.closest('[role="group"]'));
        const label = options.find(option => option.id === id)?.name || map;
        const uniqueLabel = options.filter(option => option.name === label).length === 1;
        const query = uniqueLabel ? label : id;
        setSearch(field, query);
        const choice = () => {
          const group = mapGroup();
          if (group?.querySelector('input[aria-label="掛機地圖：搜尋"]')?.value !== query) return null;
          const buttons = [...group.querySelectorAll('button[aria-pressed]')].filter(visible);
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
        const button = await until(choice);
        if (!button) throw Error('原生選單無法確認這張地圖：'+map+'（'+id+'）。');
        let selected = button;
        if (button.getAttribute('aria-pressed') !== 'true') {
          button.click();
          selected = await until(() => {
            const target = choice();
            return target?.getAttribute('aria-pressed') === 'true' && target;
          });
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
    try { lastProfile = sessionStorage.getItem(profileKey) || ''; } catch {}

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
            try { GM_setValue(mvpChangeKey, validateMvpChange({ key, at })); } catch {}
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
      .find((list) => visible(list) && !list.closest('[hidden],[inert],[aria-hidden="true"]'));
    function capture(list = findStatsList()) {
      const nativeName = nativeProfileName();
      const snap = currentSnapshot(nativeName);
      const profile = nativeName || snap?.character.name.trim() || '';
      const api = profile && foregroundMvpSnapshot?.character.name?.trim() === profile ? foregroundMvpSnapshot : null;
      if (profile && profile !== lastProfile) {
        lastProfile = profile;
        try { sessionStorage.setItem(profileKey, profile); } catch {}
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
      if (now - lastBackgroundAt >= 1000) {
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
      try { saved = JSON.parse(localStorage.getItem(key)); } catch {}
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
          try {localStorage.setItem(key,JSON.stringify(saved));} catch {}
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
      }, 30000);
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
    window.setInterval(() => { if (!document.hidden) captureBackground(); }, 15000);
    document.addEventListener('visibilitychange', captureBackground);
    window.addEventListener('pagehide', captureBackground);
    document.addEventListener('click', event => {
      const control = event.target.closest?.('button, [role="tab"], a');
      if (control && !control.closest('#ro-helper-hud') && !panel.contains(control) && /掛機設定|尋找怪物|切換角色|回城|地圖/.test(control.textContent)) captureBackground();
    }, true);
    return { button: open, syncFromStats, refreshPreferences };
  }

  let mvpRadar;
  if (!location.pathname.startsWith('/info')) {
    try {
      mvpRadar = createMvpSchedule();
    } catch (error) {
      console.warn('個人 MVP 時刻表初始化失敗', error);
    }
  }

  document.querySelectorAll('.log-window .log-line').forEach(queueLogLine);
  listenSharedSettings();
  if (canShareCharPoll()) listenRemote(charPollKey, validateCharPoll, applySharedCharPoll);
  window.addEventListener('focus', runPageRouter);
  ensureHUD(); pollChars(); runPageRouter();
  setInterval(() => {
    clearTransientCharAlerts(null, Date.now() - 600000);
    if (document.hidden) return;
    ensureHUD(); updateHUD();
    if (Date.now() - lastRouterAt > 1200) refreshRareHelper();
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup) lootSyncPanels.get(itemGroup)?.();
  }, 1500);
  setInterval(pollChars, charPollInterval);
})();
