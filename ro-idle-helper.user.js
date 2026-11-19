// ==UserScript==
// @name         RO Idle 便利助手｜倉庫保護與跨城市場
// @namespace    local.ro-idle.warehouse-helper
// @version      3.3.21
// @description  整合倉庫保護、跨城查價、掛機設定、背包精煉、全裝備精煉傷害標記、露天懸浮完整數值與插卡檢視及角色收支統計。
// @match        https://ro-idle.app/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @downloadURL https://update.greasyfork.org/scripts/604952/RO%20Idle%20%E4%BE%BF%E5%88%A9%E5%8A%A9%E6%89%8B%EF%BD%9C%E5%80%89%E5%BA%AB%E4%BF%9D%E8%AD%B7%E8%88%87%E8%B7%A8%E5%9F%8E%E5%B8%82%E5%A0%B4.user.js
// @updateURL https://update.greasyfork.org/scripts/604952/RO%20Idle%20%E4%BE%BF%E5%88%A9%E5%8A%A9%E6%89%8B%EF%BD%9C%E5%80%89%E5%BA%AB%E4%BF%9D%E8%AD%B7%E8%88%87%E8%B7%A8%E5%9F%8E%E5%B8%82%E5%A0%B4.meta.js
// ==/UserScript==

(() => {
  'use strict';
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

  // 武器等級壓縮表 (用於計算精煉附加 ATK/MATK 與過安全值額外高傷；未列出之武器預設 Lv.3)
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

  const CARD_SUB_RAW = {
    c_armor: '4001,4003,4008,4014,4017,4023,4031,4038,4043,4054,4061,4068,4076,4084,4088,4098,4099,4105,4114,4119,4120,4136,4141,4154,4161,4170,4175,4182,4184,4194,4196,4199,4207,4211,4213,4214,4221,4223,4226,4231,4232,4234,4242,4247,4252,4256,4262,4265,4273,4275,4280,4288,4295,4299,4300,4302,4304,4306,4312,4318,4324,4329,4332,4333,4334,4336,4338,4339,4342,4345,4353,4357,4369,4370,4372,4374,4377,4380,4382,4383,4386,4401,4402,4406,4408,4409,4410,4419,4426,4431,4432,4440',
    c_shield: '4005,4012,4013,4016,4022,4026,4032,4035,4042,4053,4056,4058,4066,4067,4072,4087,4089,4093,4103,4111,4116,4118,4124,4125,4128,4132,4135,4138,4177,4180,4187,4197,4203,4208,4218,4224,4230,4238,4244,4250,4253,4254,4277,4278,4293,4307,4315,4321,4326,4344,4356,4362,4373,4384,4391,4400,4407,4413,4414,4422,4427,4428,4435,4438,4439',
    c_head: '4010,4024,4030,4041,4052,4070,4091,4100,4104,4112,4122,4127,4145,4146,4148,4168,4169,4181,4185,4186,4188,4195,4198,4202,4216,4229,4240,4241,4259,4264,4268,4269,4279,4284,4291,4303,4313,4328,4330,4343,4349,4354,4363,4364,4365,4366,4387,4403,4405,4411,4412,4434,4453',
    c_garment: '4009,4015,4029,4047,4059,4071,4078,4081,4083,4094,4102,4108,4109,4113,4133,4149,4159,4163,4171,4174,4178,4179,4183,4191,4200,4209,4220,4249,4258,4270,4286,4297,4309,4325,4331,4341,4348,4359,4360,4375,4388,4404,4418,4429,4433,4436',
    c_shoes: '4025,4049,4050,4073,4090,4096,4097,4107,4123,4131,4137,4144,4160,4162,4190,4201,4212,4222,4228,4233,4236,4239,4246,4257,4283,4290,4308,4316,4319,4323,4340,4346,4358,4368,4376,4381,4416,4417,4423,4437,4441',
    c_acc: '4004,4027,4033,4036,4039,4040,4044,4051,4055,4064,4074,4077,4079,4086,4095,4101,4110,4139,4143,4166,4173,4193,4204,4205,4206,4215,4217,4219,4225,4227,4235,4237,4245,4266,4272,4285,4294,4296,4301,4310,4311,4322,4327,4335,4337,4347,4350,4351,4352,4355,4371,4389,4392,4393,4415,4420,4421,4424,4430'
  };
  const CARD_SUB_MAP = new Map();
  for (const [k, ids] of Object.entries(CARD_SUB_RAW)) ids.split(',').forEach((id) => CARD_SUB_MAP.set(Number(id), k));
  const ITEM_NAME_CACHE = new Map([[984, '神之金屬'], [985, '鋁'], [756, '神之金屬原石'], [757, '鋁原石'], [7054, '布里刊'], [934, '亡者遺物'], [7053, '賽依伐']]);

  // 動態裝備與卡片完整數值學習庫 (持久化記憶 ATK/MATK/DEF/重量/武器等級/卡片與裝備效果說明)
  const ITEM_DETAIL_DB = new Map();
  const isPollutedDesc = (s) => typeof s === 'string' && /(?:\bZeny\b|🔍|剩\s*\d+|購買\s*\()/.test(s);
  try {
    const savedDb = GM_getValue('roi_learned_item_db_v1', {});
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
    if (cleanedPolluted) GM_setValue('roi_learned_item_db_v1', Object.fromEntries(ITEM_DETAIL_DB));
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
    if (info.name) ITEM_NAME_CACHE.set(numId, info.name);
    if (!dbSaveTimer) {
      dbSaveTimer = setTimeout(() => {
        dbSaveTimer = null;
        try {
          if (ITEM_DETAIL_DB.size <= 3500) GM_setValue('roi_learned_item_db_v1', Object.fromEntries(ITEM_DETAIL_DB));
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
    c_weapon: '武器卡片', c_head: '頭飾卡片', c_armor: '鎧甲卡片', c_shield: '盾牌卡片', c_garment: '披肩卡片', c_shoes: '鞋子卡片', c_acc: '飾品卡片',
    other: '其他'
  };

  const CAT_SUBS = {
    card: ['c_weapon', 'c_head', 'c_armor', 'c_shield', 'c_garment', 'c_shoes', 'c_acc'],
    weapon: ['1hSword', '2hSword', 'dagger', 'katar', 'bow', 'staff', '2hStaff', 'mace', '1hSpear', '2hSpear', '1hAxe', '2hAxe', 'knuckle', 'book', 'instrument', 'whip'],
    armor: ['headTop', 'headMid', 'headLow', 'headTop+headMid', 'headMid+headLow', 'headTop+headMid+headLow', 'armor', 'shield', 'garment', 'shoes', 'accessory']
  };

  function classifyItem(id, name = '') {
    const numId = Number(id);
    if (name) ITEM_NAME_CACHE.set(numId, name);
    if ((numId >= 4001 && numId <= 4999) || name.endsWith('卡片')) return { cat: 'card', sub: CARD_SUB_MAP.get(numId) || 'c_weapon' };
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

  // 判斷 DOM 元素是否屬於攤位／拍賣介面
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

  // 非攤位介面：針對 +4 ~ +10 精煉裝備套用漸進式變色（+10 最顯眼）
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

  // 全域掃描：攤位顯示詳細精煉數值卡片/徽章；人物裝備欄、背包、倉庫等其他地方改用 +4~+10 分級變色
  function annotateAllRefinedEquipment() {
    tryLearnFromReactTree(document.querySelector('main, #root, table.xp-table, fieldset'));

    const bagRowMap = bagMemo?.val ? new Map(bagMemo.val.rows.map((x) => [x.row, x])) : null;
    for (const img of document.querySelectorAll('li img[src*="/client/item/"], table.xp-table tr img[src*="/client/item/"]')) {
      const row = img.closest('li, table.xp-table tr');
      if (!row || row.closest('#ro-helper-hud,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
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

    // 掃描原生物品資訊彈窗與裝備欄格子 (.xp-sunken)：動態學習數值；非攤位套用 +4~+10 變色
    for (const box of document.querySelectorAll('.xp-sunken')) {
      if (box.closest('#ro-helper-hud,[data-roi-market-browser],[data-roi-refine-helper]')) continue;
      box.querySelector(':scope > [data-ro-detail-ref-badge]')?.remove();
      // 跳過整張攤位/背包/倉庫表格或清單容器，避免把整個攤位的商品列當成單一物品說明抓進去
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
      const titleEl = [...box.querySelectorAll('button, span, div, b, strong, p')].find(
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
    while (stack.length && ++guard < 80000) {
      const { f: node, found, route } = stack.pop();
      const p = node.memoizedProps;
      const next = p && matcher(p) ? p : found;
      if (node.stateNode === el) {
        if (next) fiberRouteMap.set(el, route);
        return next;
      }
      if (node.sibling) stack.push({ f: node.sibling, found, route: [...route, 's'] });
      if (node.child) stack.push({ f: node.child, found: next, route: [...route, 'c'] });
    }
    return null;
  }

  const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const validWarehouseData = (value) => plainObject(value) && plainObject(value.marks) && plainObject(value.autoLocks);

  const state = {
    paused: false, accMs: 0, lastResumed: Date.now(),
    activeCharId: null, activeCharName: '讀取中...',
    initZenyMap: {}, curZeny: 0, chars: [], charZenyMap: {}, myCharIds: new Set(),
    kills: 0, bexp: 0, jexp: 0, dmgSum: 0, hits: 0, maxDmg: 0,
    loot: {}, lootRev: 0, renderedLootRev: -1,
    rares: [], rareRev: 0,
    missed: 0,
    sound: false, notify: false, moneyColor: true,
    whProtect: true, whSaleReview: true, whAutoEquipCard: true,
    whMarks: {}, whAutoLocks: {}, customProtectWords: [],
    hudMin: false, hudPos: null, mktUpperFold: false,
    processedLines: new WeakMap(), lastNotifyAt: 0
  };

  try {
    const savedAlert = GM_getValue('ro_lean_prefs_v091', null);
    if (savedAlert) Object.assign(state, savedAlert);
    const savedWh = JSON.parse(GM_getValue('warehouse-helper-v1', '{}'));
    state.whMarks = plainObject(savedWh?.marks) ? savedWh.marks : {};
    state.whAutoLocks = plainObject(savedWh?.autoLocks) ? savedWh.autoLocks : {};
    const savedWords = GM_getValue('ro_custom_protect_words_v091', []);
    if (Array.isArray(savedWords)) state.customProtectWords = savedWords;
  } catch {}

  function savePrefs() {
    try {
      GM_setValue('ro_lean_prefs_v091', {
        sound: state.sound, notify: state.notify,
        moneyColor: state.moneyColor,
        whProtect: state.whProtect, whSaleReview: state.whSaleReview, whAutoEquipCard: state.whAutoEquipCard,
        hudMin: state.hudMin, hudPos: state.hudPos, mktUpperFold: state.mktUpperFold
      });
    } catch {}
  }

  function findTownSearchUI() {
    for (const f of document.querySelectorAll('fieldset')) {
      const leg = [...f.children].find((c) => c.tagName === 'LEGEND');
      if (!leg || clean(roiPriceText(leg)) !== '搜尋所有城鎮的攤位') continue;
      for (const form of f.querySelectorAll('form')) {
        const inp = form.querySelector('input[type="text"],input[type="search"],input:not([type])');
        const btn = [...form.querySelectorAll('button')].find((b) => clean(b.textContent) === '搜尋');
        if (inp && btn) return { form, input: inp, button: btn };
      }
    }
    return null;
  }

  async function triggerNativeTownSearch(rawName) {
    const baseName = clean(rawName).replace(/（.*?）|\(.*?\)/g, '').replace(/^\+\s*\d+\s*/, '').replace(/\s*\[\d+\]\s*$/, '').trim();
    if (!baseName) return;
    if (mktView) { mktView = false; syncMktMount(); await sleep(50); }

    const target = findTownSearchUI();
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
              qBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); triggerNativeTownSearch(iName); };
              td.appendChild(qBtn);
            }
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

  function onApiData(url, text, foreground = true) {
    try {
      if (!text || text[0] !== '{') return;
      const path = String(url).replace(location.origin, '').split('?')[0];
      if (path !== '/api/characters' && !/^\/api\/characters\/\d+$/.test(path)) return;
      const d = JSON.parse(text);
      if (path === '/api/characters' && Array.isArray(d.characters) && d.characters.length <= 12) {
        const prevRun = new Set(state.chars.filter((c) => c.running).map((c) => c.id));
        if (state.chars.length > 0) {
          const stopped = d.characters.filter((c) => !c.running && prevRun.has(c.id));
          if (stopped.length) alertUser('🚨 分身停機警告', `${stopped.map((c) => c.name).join('、')} 已停止掛機`, true);
        }
        state.chars = d.characters;
        state.myCharIds = new Set(d.characters.map((c) => Number(c.id)));
        state.charRosterLoaded = true;
        for (const cache of [state.charZenyMap, state.initZenyMap]) {
          for (const id of Object.keys(cache)) {
            if (!state.myCharIds.has(Number(id))) delete cache[id];
          }
        }
        renderChars();
      } else if (d.characterId && d.snapshot?.character) {
        const cid = Number(d.characterId);
        if (state.charRosterLoaded && !state.myCharIds.has(cid)) return;
        const ch = d.snapshot.character;
        if (foreground) {
          state.activeCharId = cid;
          state.activeCharName = ch.name || d.name;
        }
        if (typeof ch.zeny === 'number') {
          if (state.initZenyMap[cid] === undefined) state.initZenyMap[cid] = ch.zeny;
          if (foreground) state.curZeny = ch.zeny;
          state.charZenyMap[cid] = ch.zeny;
        }
        updateHUD(); renderChars();
      }
    } catch {}
  }

  const pollFetch = page.fetch.bind(page);
  let detailRequest = 0;
  try {
    const origFetch = page.fetch;
    if (origFetch) {
      page.fetch = async function (...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const path = u.replace(location.origin, '').split('?')[0];
        const isDetail = /^\/api\/characters\/\d+$/.test(path);
        const request = isDetail ? ++detailRequest : 0;
        const res = await origFetch.apply(this, args);
        if (path === '/api/characters' || isDetail) {
          try { res.clone().text().then((t) => { if (!isDetail || request === detailRequest) onApiData(u, t); }).catch(() => {}); } catch {}
        }
        return res;
      };
    }
  } catch {}

  async function pollChars() {
    if (document.hidden) return;
    try {
      const r = await pollFetch('/api/characters');
      const d = await r.json();
      if (Array.isArray(d.characters)) {
        onApiData('/api/characters', JSON.stringify(d));
        for (const c of d.characters) {
          if (state.charZenyMap[c.id] === undefined) {
            const dr = await pollFetch(`/api/characters/${c.id}?deferCatchup=1`);
            const detail = await dr.text();
            if (state.charZenyMap[c.id] === undefined) onApiData(`/api/characters/${c.id}`, detail, false);
          }
        }
      }
    } catch {}
  }

  const rxRareDrop = /(?:卡片|稀有)!/;
  const rxDangerLog = /戰鬥不能|已經死亡|超過負重.*停止/;
  const rxDmgLog = /造成\s*([\d,]+)\s*點傷害/;
  const rxExpLog = /獲得\s*Base EXP\s*([\d,]+)(?:\s*\(\s*\d+(?:\.\d+)?\s*%\s*\))?\s*\/\s*Job EXP\s*([\d,]+)/;
  const rxLootLog = /撿取物品\s*[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/;
  function parseLog(el) {
    if (!el) return;
    const t = clean(el.textContent);
    if (!t || state.processedLines.get(el) === t) return;
    state.processedLines.set(el, t);
    if (rxRareDrop.test(t)) {
      state.rares.unshift(`[${new Date().toLocaleTimeString()}] ✨ ${t}`);
      if (state.rares.length > rareLimit) state.rares.pop();
      state.rareRev++;
      alertUser('✨ 稀有掉落', t, false);
    }
    if (rxDangerLog.test(t)) alertUser('⚠️ 掛機異常', t, true);
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
  const savedPriceOptions = GM_getValue(priceOptionKey, {});
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
  function savePriceOptions(options) {
    GM_setValue(priceOptionKey, options);
    priceOptions = options;
    refreshWarehouse();
  }
  GM_registerMenuCommand('設定掛牌價自動保護門檻', () => {
    const input = prompt('普通同規格至少 3 位賣家的最低掛牌價達多少 Zeny 時保護？', String(priceOptions.threshold));
    if (input === null) return;
    const threshold = Number(input.replace(/,/g, ''));
    if (!validThreshold(threshold)) return alert('請輸入 1 至 1 兆之間的整數。');
    savePriceOptions({ ...priceOptions, threshold });
  });
  GM_registerMenuCommand('切換掛牌價自動保護', () => {
    savePriceOptions({ ...priceOptions, enabled: !priceOptions.enabled });
    alert(priceOptions.enabled ? '已啟用掛牌價保護' : '已停止新增掛牌價保護，既有鎖定仍保留');
  });
  const instanceLockReasons = new Set(['自動保護：精煉裝備', '自動保護：有洞裝備', '自動保護：特殊/插卡']);
  function getLockReason(id, name, text) {
    if (state.whMarks[id] === 'lock') return '手動上鎖';
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

  function warehouseItemId(li) {
    return li?.querySelector('img[src*="/client/item/"]')?.getAttribute('src')?.match(/\/client\/item\/(\d+)\.png(?:[?#]|$)/)?.[1];
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
          mkBtn('出售前核對：開', () => { state.whSaleReview = !state.whSaleReview; savePrefs(); refreshWarehouse(); }),
          stSpan
        );
        f.insertBefore(bar, [...f.children].find((c) => c.tagName === 'UL') || null);
      }

      const reviewToggle = [...bar.querySelectorAll('button')].find((b) => b.textContent.startsWith('出售前核對：'));
      if (reviewToggle) {
        reviewToggle.textContent = `出售前核對：${state.whSaleReview ? '開' : '關'}`;
        reviewToggle.title = state.whSaleReview ? '目前啟用清單核對，點擊關閉' : '目前略過助手清單核對，點擊啟用';
        reviewToggle.setAttribute('aria-pressed', String(state.whSaleReview));
      }
      let dirty = false;
      for (const li of f.querySelectorAll('li')) {
        const cb = li.querySelector('input[type="checkbox"]'), nameBtn = li.querySelector('button[aria-label$="的物品資訊"]');
        if (!cb || !nameBtn) continue;
        const id = warehouseItemId(li);
        if (!id) continue;
        const name = clean(nameBtn.textContent), txt = clean(li.textContent);
        ITEM_NAME_CACHE.set(Number(id), name.replace(/^\+\d+\s*/, ''));
        if (rescanCustom && !String(state.whAutoLocks[id] || '').startsWith('已載入攤位普通同規格掛牌') && state.whMarks[id] !== 'lock') delete state.whAutoLocks[id];
        if (instanceLockReasons.has(state.whAutoLocks[id])) { delete state.whAutoLocks[id]; dirty = true; }
        const reason = getLockReason(id, name, txt);
        if (reason && !instanceLockReasons.has(reason) && !state.whMarks[id] && !state.whAutoLocks[id]) { state.whAutoLocks[id] = reason; dirty = true; }
        const locked = Boolean(reason);
        if (locked && clean(cb.getAttribute('aria-label')).startsWith('賣掉 ') && cb.checked) cb.click();
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
            state.whMarks[id] = nowLocked ? 'neutral' : 'lock';
            if (nowLocked) delete state.whAutoLocks[id];
            try { GM_setValue('warehouse-helper-v1', JSON.stringify({ marks: state.whMarks, autoLocks: state.whAutoLocks })); } catch {}
            refreshWarehouse();
          };
          li.insertBefore(lBtn, cb.nextSibling);
        }
        lBtn.dataset.roLock = id;
        lBtn.className = locked ? 'ro-badge-lock' : 'ro-badge-unlock';
        const lbl = locked ? '🔒 已鎖' : '🔓';
        if (lBtn.textContent !== lbl) lBtn.textContent = lbl;
        lBtn.title = locked ? `${name} (#${id})｜${reason}\n點擊解鎖` : `點擊鎖定 ${name}`;
      }
      if (dirty) try { GM_setValue('warehouse-helper-v1', JSON.stringify({ marks: state.whMarks, autoLocks: state.whAutoLocks })); } catch {}
    }
  }

  function bulkWhLock(f, lock) {
    const ids = [...new Set([...f.querySelectorAll('li')].filter(visible).map((li) => warehouseItemId(li)).filter(Boolean))];
    if (!ids.length || !confirm(`確定將目前可見的 ${ids.length} 種物品全部${lock ? '上鎖' : '解鎖'}？`)) return;
    ids.forEach((id) => { state.whMarks[id] = lock ? 'lock' : 'neutral'; if (!lock) delete state.whAutoLocks[id]; });
    try { GM_setValue('warehouse-helper-v1', JSON.stringify({ marks: state.whMarks, autoLocks: state.whAutoLocks })); } catch {}
    refreshWarehouse();
  }

  window.addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const f = e.target.closest('fieldset');
    if (!f) return;
    const btn = e.target.closest('button');
    if (btn) {
      const cap = clean(btn.textContent);
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

  const rarePanels = new WeakMap(), rareKnownRoots = new Set(), rareLastMap = new WeakMap();
  let rareAutoMap = GM_getValue('roi-rare-auto-map-v1', true) !== false;
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

  function refreshRareHelper() {
    for (const root of findRareRoots()) {
      let panel = rarePanels.get(root);
      if (!panel?.isConnected) {
        panel = document.createElement('div');
        panel.dataset.roRareHelper = '';
        panel.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        for (const [text, group, next] of [['此地圖全選', 'here', true], ['非此地圖全取消', 'away', false], ['✨ 此地圖全選＋其他取消', 'sync', true]]) {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'xp-btn small'; b.textContent = text;
          if (group === 'sync') b.style.cssText = 'color:#fde047;font-weight:bold;';
          b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fastSelectRare(root, group, next); };
          panel.append(b);
        }
        const autoBtn = document.createElement('button');
        autoBtn.type = 'button'; autoBtn.className = 'xp-btn small'; autoBtn.dataset.roiRareAuto = '';
        autoBtn.onclick = (e) => {
          e.preventDefault(); e.stopPropagation();
          rareAutoMap = !rareAutoMap;
          try { GM_setValue('roi-rare-auto-map-v1', rareAutoMap); } catch {}
          rareLastMap.delete(root);
          refreshRareHelper();
        };
        const statusSpan = document.createElement('span');
        statusSpan.dataset.roRareStatus = ''; statusSpan.style.color = '#4ade80';
        panel.append(autoBtn, statusSpan);
        const h = [...root.querySelectorAll('legend,h2,h3,h4,strong,b,div,p,span')].find((e) => e.childElementCount <= 3 && isRareHeading(e.textContent));
        if (h?.parentElement === root) h.after(panel);
        else root.prepend(panel);
        rarePanels.set(root, panel);
      }
      const autoBtn = panel.querySelector('[data-roi-rare-auto]');
      if (autoBtn) {
        autoBtn.textContent = '隨地圖同步：' + (rareAutoMap ? '🟢 開' : '⚪ 關');
        autoBtn.style.borderColor = rareAutoMap ? '#22c55e' : '';
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

  function buildLootPatch(draft, ids, mode) {
    const supplies = new Set([
      ...itemIds(draft.restock), ...itemIds(draft.townBuy), ...itemIds(draft.cureItems),
      ...itemIds(draft.autoBuy?.potions), ...itemIds(draft.autoBuy?.gems), ...itemIds([draft.autoBuy?.arrows?.itemId]),
      ...[draft.hpPotion, draft.spPotion, draft.buffPotion].flatMap((rule) => [...listItems(rule), ...itemIds([rule?.itemId])])
    ]);
    const selected = itemIds(ids).filter((id) => !supplies.has(id));
    if (!selected.length) return null;

    const autoStorage = storageRule(draft.autoStorage);
    const storageItems = [...new Set([...autoStorage.items, ...selected])];
    const priority = draft.lootPriority;
    const priorityItems = [...new Set([...listItems(priority), ...selected])];
    if (storageItems.length > 2000 || (mode === 'valuable' && priorityItems.length > 500)) {
      throw Error('同步會超過存倉或優先撿取的清單上限，請先移除不需要的項目');
    }

    const autoSell = itemIds(draft.autoSell);
    const stored = new Set(selected);
    const patch = {
      autoLoot: true,
      autoStorage: { ...autoStorage, enabled: true, items: storageItems },
      autoSell: autoSell.filter((id) => !stored.has(id))
    };
    if (mode === 'valuable') {
      patch.lootPriority = { ...(priority?.rare ? { rare: true } : {}), items: priorityItems };
    }
    return { patch, count: selected.length };
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

  function mountSettingsTools() {
    refreshRareHelper();
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup && !itemGroup.querySelector('[data-roi-settings-tools]')) {
      const box = document.createElement('div');
      box.dataset.roiSettingsTools = '';
      box.style.cssText = 'flex-basis:100%;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px;padding:6px 10px;background:linear-gradient(90deg,rgba(30,41,59,0.9),rgba(15,23,42,0.75));border-left:3px solid #38bdf8;border-radius:6px;font-size:11.5px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
      const status = document.createElement('span'); status.style.color = '#4ade80';
      const mk = (t, fn, bg = '') => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'xp-btn small'; b.textContent = t;
        if (bg) b.style.cssText = `background:${bg};color:#fff;font-weight:bold;border:none;`;
        b.onclick = () => { try { fn(); } catch (e) { status.textContent = '⚠️ ' + e.message; } };
        return b;
      };
      const getProps = () => {
        const p = getCommittedProps(itemGroup, (x) => typeof x.update === 'function' && x.draft && x.snap?.character);
        if (!p) throw Error('無法讀取設定草稿');
        return p;
      };

      const applyLoot = (p, ids, mode, previous) => {
        const draft = p.draft;
        const storage = storageRule(draft.autoStorage);
        const priority = listItems(draft.lootPriority);
        const storageBase = storage.items.filter((id) => !previous?.storage.has(id));
        const priorityBase = priority.filter((id) => !previous?.priority.has(id));
        const nextPriority = { ...(draft.lootPriority?.rare ? { rare: true } : {}), items: priorityBase };
        const result = buildLootPatch(previous ? {
          ...draft,
          autoStorage: { ...storage, items: storageBase },
          lootPriority: nextPriority
        } : draft, ids, mode);
        if (!result) {
          const patch = {};
          if (storageBase.length !== storage.items.length) patch.autoStorage = { ...storage, items: storageBase };
          if (priorityBase.length !== priority.length) patch.lootPriority = nextPriority;
          if (Object.keys(patch).length) {
            p.update(patch);
            status.textContent = '已移除前次同步項目，請按「套用設定」';
          } else {
            status.textContent = '沒有符合條件的戰利品';
          }
          return { storage: new Set(), priority: new Set() };
        }
        if (mode === 'store' && previous?.priority.size) {
          result.patch.lootPriority = nextPriority;
        }
        p.update(result.patch);
        const action = mode === 'valuable' ? '優先撿取＋存倉' : '自動存倉';
        status.textContent = `已設定 ${result.count} 種道具為「${action}」，請按「套用設定」`;
        return {
          storage: new Set(result.patch.autoStorage.items.filter((id) => !storageBase.includes(id))),
          priority: new Set(listItems(result.patch.lootPriority).filter((id) => !priorityBase.includes(id)))
        };
      };
      const configuredIds = (d) => [
        ...listItems(d.lootFilter), ...listItems(d.lootPriority), ...listItems(d.autoStorage), ...itemIds(d.autoSell)
      ];
      const inventoryIds = (snap) => {
        const equipped = new Set(Object.values(snap.equipment ?? {}));
        return itemIds((snap.inventory ?? []).filter((i) => !i.equipped && !equipped.has(i.uid)));
      };
      const auto = element('select');
      auto.className = 'xp-input';
      for (const [value, label] of [['off', '關閉'], ['store', '本圖戰利品存倉'], ['valuable', '本圖貴重物優先撿＋存倉']]) {
        const option = element('option', label);
        option.value = value;
        auto.append(option);
      }
      const savedMode = GM_getValue('roi-loot-auto-map', 'off');
      auto.value = lootModes.includes(savedMode) ? savedMode : 'off';
      const autoLabel = element('label', '隨地圖同步 ');
      autoLabel.append(auto);

      const getMapKey = (p) => JSON.stringify([p.snap.character.id ?? p.snap.character.name, p.draft.lockMap]);
      let lastAutoKey;
      const syncedByCharacter = new Map();
      const syncMapLoot = async (mode, automatic = false) => {
        try {
          const p = getProps(), mapKey = getMapKey(p);
          const key = JSON.stringify([mode, mapKey]);
          if (automatic) {
            if (key === lastAutoKey) return;
            lastAutoKey = key;
          }
          const pack = await loadLootPack();
          if (!itemGroup.isConnected || (automatic && (auto.value !== mode || lastAutoKey !== key))) return;
          const current = getProps();
          if (mapKey !== getMapKey(current)) return;
          const loot = getMapLoot(pack, current.draft.lockMap);
          const ids = [...loot].filter(([id, name]) => mode === 'store' || isValuableLoot(id, name)).map(([id]) => id);
          const character = current.snap.character;
          const characterKey = character.id ?? character.name;
          const next = applyLoot(current, ids, mode, syncedByCharacter.get(characterKey));
          if (next) syncedByCharacter.set(characterKey, next);
        } catch (e) { status.textContent = '⚠️ ' + e.message; }
      };
      const syncAutomatically = () => { if (auto.value !== 'off') void syncMapLoot(auto.value, true); };
      lootSyncPanels.set(itemGroup, syncAutomatically);
      auto.onchange = () => {
        GM_setValue('roi-loot-auto-map', auto.value);
        lastAutoKey = undefined;
        syncAutomatically();
      };

      box.append(
        mk('📦 戰利品全存倉 (給商人賣)', () => {
          const p = getProps();
          applyLoot(p, [...configuredIds(p.draft), ...inventoryIds(p.snap).filter((id) => classifyItem(id).cat !== 'consumable')], 'store');
        }, 'linear-gradient(135deg,#e11d48,#be123c)'),
        mk('💎 卡片/神金鋁/貴重詞 ➔ 優先撿+存倉', () => {
          const p = getProps();
          const candidates = [...configuredIds(p.draft), ...inventoryIds(p.snap), ...lootOres, ...Object.keys(state.whMarks).map(Number)];
          applyLoot(p, candidates.filter((id) => isValuableLoot(id, ITEM_NAME_CACHE.get(id))), 'valuable');
        }, 'linear-gradient(135deg,#d97706,#b45309)'),
        mk('同步本圖戰利品存倉', () => syncMapLoot('store')),
        autoLabel,
        status
      );
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
        b.onclick = fn;
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
  let bagMemo = null;
  const bagFastMiss = new WeakSet();
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
    // 常見情況只讀背包表格的 Fiber 路徑，避免精煉輪詢每次掃整棵 React 樹。
    const props = bagFastMiss.has(table) ? null : getCommittedProps(table, (p) => validSnap(p?.s) || validSnap(p?.snap));
    const localSnap = props?.s || props?.snap;
    if (validSnap(localSnap)) {
      const localRows = [...rowNodes].map((row) => {
        const fiber = getReactFiber(row);
        return /^\d+$/.test(fiber?.key || '') ? { uid: Number(fiber.key), row } : null;
      });
      if (localRows.every(Boolean)) { snaps.push(localSnap); rows.push(...localRows); }
    }
    if (!snaps.length) {
      bagFastMiss.add(table);
      const stack = [tree];
      let guard = 0;
      while (stack.length && ++guard < 80000) {
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

  const isEligibleEquip = (r) => canRefine(r.st);

  const refineRowsForPage = (rows) => rows.filter((row) =>
    isEligibleEquip(row) && (refCategory === 'all' || refineCategory(refinePack.items.get(row.st.itemId)) === refCategory));

  function findNativeDetailBtn(table, uid, matcher) {
    const tree = currentFiberRoot(table);
    if (!tree) return null;
    const search = (root, limit) => {
      const stack = [{ fiber: root, matching: false }];
      while (stack.length && limit-- > 0) {
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
    return (local && search(local, 10000)) || search(tree, 80000);
  }

  async function selectBagItemRow(uid) {
    const b = readBackpackContext(true);
    const row = b?.rows.find((r) => r.uid === uid);
    const btn = row && [...row.row.querySelectorAll('td button')].find((x) => !x.disabled && !x.closest('[data-roi-refine-helper]'));
    if (!btn) throw Error('找不到該裝備列');
    btn.click();
    await sleep(90);
    return readBackpackContext(true);
  }

  async function equipItemByUid(uid) {
    let b = await selectBagItemRow(uid);
    if (Object.values(b.s.equipment || {}).includes(uid)) return b;
    const eqBtn = findNativeDetailBtn(b.table, uid, (t) => t === '裝備');
    if (!eqBtn || eqBtn.disabled) throw Error('此職業無法穿戴該裝備進行忽克連精煉');
    eqBtn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      b = readBackpackContext(true);
      if (b && Object.values(b.s.equipment || {}).includes(uid)) return b;
    }
    throw Error('穿戴裝備逾時');
  }

  async function tryWithdrawFromWarehouse(wantedItemIds, targetPlusLimit, setStatus, limitsById, maxItems = 15) {
    const findWhField = () => [...document.querySelectorAll('fieldset')].find((f) => /^倉庫(?:\s*[（(]|$)/.test(clean([...f.children].find((c) => c.tagName === 'LEGEND')?.textContent)) && visible(f));
    let switchedTab = null;
    const selected = new Map();
    let submitted = false;
    visitingWarehouse = true;
    try {
      let field = findWhField();
      if (!field) {
        const tabs = [...document.querySelectorAll('.xp-menu-item, button, a')].filter(visible);
        const whTab = tabs.find((el) => clean(el.textContent) === '倉庫');
        switchedTab = tabs.find((el) => clean(el.textContent) === '背包');
        if (!whTab || !switchedTab) return [];
        whTab.click();
        for (let i = 0; i < 25 && !field; i++) { await sleep(100); field = findWhField(); }
        if (!field) throw Error('開啟倉庫逾時');
      }
      const checked = () => [...field.querySelectorAll('input[type="checkbox"]:checked')];
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
        cb.click();
        selected.set(cb, { id, refine });
        await sleep(25);
        if (maxItems === 1) {
          const amount = li.querySelector('input[type="number"]');
          const stackText = clean(li.textContent).match(/×\s*([\d,]+)/)?.[1];
          const stack = stackText ? Number(stackText.replace(/,/g, '')) : NaN;
          if (amount) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (!setter) throw Error('無法設定領料數量，已停止');
            setter.call(amount, '1');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
            amount.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(100);
            if (!amount.isConnected || Number(amount.value) !== 1) throw Error('遊戲未接受單件領料數量，已停止');
          } else if (stack !== 1) {
            throw Error('無法確認單件領料數量，已停止以避免取出整疊');
          }
        }
        if (selected.size >= maxItems) break;
      }
      if (!selected.size) return [];
      const boxes = checked();
      const btn = [...field.querySelectorAll('button')].find((b) => Number(clean(b.textContent).match(/^(?:領出|取出)\s*(\d+)\s*項/)?.[1]) === selected.size);
      if (refStop || document.hidden || !field.isConnected || boxes.length !== selected.size || boxes.some((cb) => !selected.has(cb)) || !btn || btn.disabled) {
        throw Error('倉庫勾選已變動或無法領取，已中止領倉');
      }
      setStatus(`📦 領取 ${selected.size} 項`);
      btn.click();
      submitted = true;
      await sleep(450);
      return [...selected.values()];
    } finally {
      try {
        if (!submitted) for (const cb of selected.keys()) if (cb.isConnected && cb.checked) cb.click();
        if (switchedTab) {
          switchedTab.click();
          for (let i = 0; i < 25; i++) { await sleep(100); if (readBackpackContext(true)) break; }
        }
      } finally { visitingWarehouse = false; }
    }
  }

  const isWeaponRefineButton = (text) => /^武器精[練煉]\s*\(\s*技能(?:[,\s)]|$)/.test(text);
  const isNpcRefineButton = (text) => /^請.+精[煉練]$/.test(text);
  const weaponRefineLevel = (snapshot) => snapshot.character.skills?.WS_WEAPONREFINE ?? 0;

  async function runHybridRefine(modeType) {
    if (refBusy) return;
    let b = readBackpackContext(true);
    if (!b) return;
    const setStatus = (msg) => { if (!refPanel?.isConnected && readBackpackContext(true)) refreshRefinePanel(); const el = refPanel?.querySelector('[data-ref-status]'); if (el) el.textContent = msg; };

    if (!refinePack) {
      try { refinePack = await loadLootPack(); }
      catch (e) { setStatus('⚠️ 無法載入精煉資料：' + e.message); return; }
    }

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
    let changedEquip = false, successCnt = 0, brokenCnt = 0;
    refBusy = true; refStop = false; refreshRefinePanel();

    try {
      while (!refStop) {
        b = readBackpackContext(true);
        if (!b || document.hidden) throw Error('已離開背包頁面');

        let pool = b.rows.filter((r) => isEligibleEquip(r) && runUids.has(r.uid) && refSelected.has(r.uid));
        pool = pool.filter((r) => !skipped.has(r.uid) && (r.st.refine || 0) < limitPlus);

        if (!pool.length && refAutoWh) {
          const before = new Set(b.s.inventory.map((x) => x.uid));
          const picked = await tryWithdrawFromWarehouse(trackedItemIds, limitPlus, setStatus, modeType === 'safe_only' ? safeLimits : null);
          if (picked.length) {
            const expected = picked.map((x) => `${x.id}:${x.refine}`).sort().join(',');
            let received = false;
            for (let i = 0; i < 40; i++) {
              b = readBackpackContext(true);
              const added = b?.s.inventory.filter((x) => !before.has(x.uid) && trackedItemIds.has(x.itemId)) || [];
              if (added.map((x) => `${x.itemId}:${x.refine || 0}`).sort().join(',') === expected) {
                for (const x of added.filter((item) => canRefine(item) && (item.refine || 0) < limitPlus)) {
                  runUids.add(x.uid); refSelected.add(x.uid);
                }
                received = true;
                break;
              }
              await sleep(100);
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
        b = await selectBagItemRow(uid);
        if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');

        const safeBtn = !skillOnly && findNativeDetailBtn(b.table, uid, (t) => /^一鍵精煉到安全值\s*\+\d+/.test(t));
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
                accepted = originalConfirm.call(page, message);
                return accepted;
              };
              safeBtn.click();
            } finally {
              page.confirm = originalConfirm;
            }
            if (!accepted) throw Error('已取消原生安全精煉');
            let missingContext = 0;
            for (let i = 0; i < 60; i++) {
              await sleep(100);
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
            await sleep(250);
            continue;
          }
        }
        if (modeType === 'safe_only') {
          skipped.add(uid);
          if (!safeBtn || (safeBtn.disabled && curPlus < nativeLimit)) safeLimits.delete(target.st.itemId);
          continue;
        }

        let skillBtn = findNativeDetailBtn(b.table, uid, isWeaponRefineButton);
        let npcBtn = skillOnly ? null : findNativeDetailBtn(b.table, uid, isNpcRefineButton);

        if (skillOnly && !skillBtn) {
          b = await equipItemByUid(uid);
          changedEquip = true;
          skillBtn = findNativeDetailBtn(b.table, uid, isWeaponRefineButton);
        }
        if (!skillOnly && !skillBtn && !npcBtn) {
          b = await equipItemByUid(uid);
          changedEquip = true;
          npcBtn = findNativeDetailBtn(b.table, uid, isNpcRefineButton);
        }

        let activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
        if ((!activeBtn || activeBtn.disabled) && refAutoWh && (!skillOnly || (skillBtn && b.s.character.sp >= 5))) {
          const item = refinePack?.items?.get(target.st.itemId);
          if (!item) throw Error(`【${target.name}】找不到精煉材料資料`);
          const level = Math.min(4, Math.max(1, item.weaponLevel ?? 1));
          const steps = item.slots.includes('weapon') ? refinePack.refine.weapon[level] : refinePack.refine.armor;
          const material = steps?.[curPlus]?.material;
          const pulledOres = material ? await tryWithdrawFromWarehouse(new Set([material]), limitPlus, setStatus, null, 1) : [];
          if (pulledOres.length) {
            b = await selectBagItemRow(uid);
            if (!b || refStop || document.hidden) throw Error('已離開背包或中止精煉');
            skillBtn = findNativeDetailBtn(b.table, uid, isWeaponRefineButton);
            npcBtn = skillOnly ? null : findNativeDetailBtn(b.table, uid, isNpcRefineButton);
            activeBtn = skillBtn && !skillBtn.disabled ? skillBtn : npcBtn;
          }
        }
        if (!activeBtn || activeBtn.disabled) throw Error(skillOnly
          ? `【${target.name}】武器精練不可用，請確認技能等級、材料與 SP（至少 5）`
          : `【${target.name}】精煉按鈕不可用（礦石已用盡、Zeny/SP不足或不在主城）`);

        if (refStop || document.hidden) throw Error('已中止精煉');
        const beforeZeny = b.s.character.zeny, beforeSp = b.s.character.sp;
        setStatus(`🔨 衝裝中：【${target.name}】+${curPlus} ➔ +${curPlus + 1} (成功:${successCnt} 爆:${brokenCnt})`);

        const origConfirm = page.confirm;
        let userAccepted = true;
        try {
          page.confirm = (msg) => {
            if (refSkipConfirm || /成功率 100%|一定成功/.test(String(msg))) return true;
            userAccepted = origConfirm.call(page, msg);
            return userAccepted;
          };
          activeBtn.click();
        } finally {
          page.confirm = origConfirm;
        }
        if (!userAccepted) throw Error('玩家手動取消精煉');

        let resolved = false, missingContext = 0;
        for (let i = 0; i < 80; i++) {
          await sleep(100);
          b = readBackpackContext(true);
          if (refStop || document.hidden) throw Error('已中止精煉');
          if (!b) {
            if (++missingContext >= 5) throw Error('背包介面持續無法讀取，請確認精煉結果');
            continue;
          }
          missingContext = 0;
          const nowSt = b.s.inventory.find((x) => x.uid === uid);
          const paid = activeBtn === skillBtn ? (b.s.character.sp <= beforeSp - 5) : (b.s.character.zeny < beforeZeny);
          if (nowSt && (nowSt.refine || 0) === curPlus + 1) {
            successCnt++; resolved = true;
            if (nowSt.refine >= limitPlus) {
              refSelected.delete(uid);
              if (refAutoWh && nowSt.refine >= refTargetPlus && !refStop && !document.hidden) {
                const stBtn = findNativeDetailBtn(b.table, uid, (t) => /^存入倉庫|^存倉$/.test(t));
                if (stBtn && !stBtn.disabled) { stBtn.click(); await sleep(150); }
              }
            }
            break;
          }
          if (!nowSt && paid) {
            brokenCnt++; resolved = true; refSelected.delete(uid);
            break;
          }
        }
        if (!resolved) throw Error('等待伺服器精煉結果逾時');
        await sleep(320);
      }
      if (refStop) throw Error('已中止精煉');
      setStatus(`🎉 精煉完成！累計成功升階 ${successCnt} 次，損壞 ${brokenCnt} 件，略過 ${skipped.size} 件。`);
      alertUser('🎉 背包精煉完成', `成功 ${successCnt} 次 / 損壞 ${brokenCnt} 件`, false);
    } catch (e) {
      setStatus(`🛑 已停止：${e.message} (成功:${successCnt} 爆:${brokenCnt})`);
    } finally {
      if (changedEquip) {
        const restoreOrder = [origEquip.weapon, ...Object.values(origEquip)];
        const failed = [];
        for (const uid of new Set(restoreOrder.filter(Boolean))) {
          try {
            b = readBackpackContext(true);
            if (b?.s.inventory.some((x) => x.uid === uid) && !Object.values(b.s.equipment || {}).includes(uid)) {
              await equipItemByUid(uid);
            }
          } catch { failed.push(uid); }
        }
        if (failed.length) setStatus('⚠️ 有裝備未能穿回，請檢查人物裝備欄');
      }
      refBusy = false;
      refreshRefinePanel();
    }
  }

  function refreshRefinePanel() {
    const b = readBackpackContext();
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
        <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#cbd5e1;">
          <label style="cursor:pointer;"><input type="checkbox" id="ref-skip-cfm" ${refSkipConfirm ? 'checked' : ''}> ⚡ 免跳確認窗(自動點確定)</label>
          <label style="cursor:pointer;color:#fde047;"><input type="checkbox" id="ref-auto-wh" ${refAutoWh ? 'checked' : ''}> 📦 倉庫連動：缺礦或裝備衝完時自動從倉庫領取同名胚子/神金鋁</label>
        </div>
        <div data-ref-categories role="group" aria-label="精煉裝備分類" style="display:none;gap:6px;flex-wrap:wrap;"></div>
        <div data-ref-list style="display:none;max-height:210px;overflow:auto;gap:4px;padding:6px;background:#090d16;border-radius:6px;border:1px solid #1e293b;"></div>
        <div data-ref-status style="font-size:11.5px;color:#4ade80;">💡 支援 Ctrl / ⌘ 點擊勾選全部同名裝備；安全值後神工匠用技能，一般職業自動穿戴找忽克連並在結束後穿回原裝。</div>
      `;
      b.host.insertBefore(refPanel, b.table.closest('.xp-sunken') || b.table);

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
        const backpack = readBackpackContext(true);
        if (backpack) refineRowsForPage(backpack.rows).forEach((r) => refSelected.add(r.uid));
        refOpen = true;
        refreshRefinePanel();
      };
      refPanel.querySelector('#ref-sel-clr').onclick = () => { if (!refBusy) { refSelected.clear(); refreshRefinePanel(); } };
      refPanel.querySelector('#ref-mode').value = refMode;
      refPanel.querySelector('#ref-mode').onchange = (e) => { refMode = e.target.value; };
      refPanel.querySelector('#ref-target').onchange = (e) => { refTargetPlus = Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 6)); e.target.value = refTargetPlus; };
      refPanel.querySelector('#ref-skip-cfm').onchange = (e) => { refSkipConfirm = e.target.checked; };
      refPanel.querySelector('#ref-auto-wh').onchange = (e) => { refAutoWh = e.target.checked; };
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
    for (const el of refPanel.querySelectorAll('#ref-mode,#ref-target,#ref-auto-wh,#ref-skip-cfm')) el.disabled = refBusy;
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
  let mktFavs = new Set(GM_getValue('roi-favorites-v1', []).filter(Number.isSafeInteger));
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

  // ==================== 【核心升級 2】使用安全 element() 建構露天裝備完整數值、精煉加成與插卡功能懸浮卡 ====================
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
      // 將黏在一起的「精煉 +N: ...」拆成獨立段落
      const parts = chunk.split(/(?=精煉\s*\+\s*\d+\s*[:：])/).map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        // 拆開「手杖,武器等級 3,攻擊力 80 INT +4 MATK +15%」這類前綴標頭與屬性條目
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

    // 1. 頂部圖示與標題區（精煉/插卡強化邊框與標籤）
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

    // 2. 原始數值與裝備/卡片效果說明區
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

    // 4. 插卡槽位與每張卡片的圖示、部位與功能說明
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
          const cSub = SUB_LABELS[CARD_SUB_MAP.get(cid) || 'c_weapon'];
          const cRow = element('div', null, `display:flex;align-items:flex-start;gap:6px;padding:4px 0;${idx ? 'border-top:1px dashed #334155;' : ''}`);
          const cIcon = element('img', null, 'width:18px;height:18px;object-fit:contain;margin-top:1px;flex-shrink:0;');
          cIcon.src = `/client/item/${cid}.png`;
          const cDetail = element('div', null, 'flex:1;min-width:0;');
          const cTitle = element('div', null, 'font-weight:bold;color:#fde047;font-size:11.5px;');
          cTitle.append(document.createTextNode(cName), element('small', ` (${cSub})`, 'color:#94a3b8;font-weight:normal;'));
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

    // 5. 攤位價格、數量與賣家底部列
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

  let crossRequest = 0;
  let crossBusy = false;
  let crossAbortCtrl = null;
  async function doCrossSearch(kw, automatic = false) {
    if (!kw || (automatic && crossBusy)) return;
    crossAbortCtrl?.abort();
    const controller = new AbortController();
    crossAbortCtrl = controller;
    const request = ++crossRequest;
    crossBusy = true;
    const st = mktPanel.querySelector('#roi-mkt-status');
    st.textContent = `🛰️ 正在跨城補查「${kw}」...`;
    try {
      const r = await fetch('/api/vending?q=' + encodeURIComponent(kw), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (r.status === 429) {
        stopMktAuto('HTTP 429：自動整理已停止，請稍後手動啟動');
        ++crossRequest;
        crossBusy = false;
        return;
      }
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const d = await r.json();
      const now = Date.now();
      if (request !== crossRequest) return;
      for (const item of parseShopData(d.shops || [], '', null, now, 'cross')) mktCrossMap.set(item.key, item);
      rebuildPriceEvidence();
      refreshWarehouse();
      st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 跨城補查「${kw}」完成！累計跨城快照 ${mktCrossMap.size} 筆`;
      renderMkt();
    } catch (e) { if (e.name !== 'AbortError' && request === crossRequest) st.textContent = '⚠️ 補查失敗：' + e.message; }
    finally { if (request === crossRequest) crossBusy = false; if (crossAbortCtrl === controller) crossAbortCtrl = null; }
  }

  mktPanel.querySelector('#roi-mkt-cross').onclick = () => {
    const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
    if (!kw) return alert('請在搜尋框輸入關鍵字（或先選擇卡片/武器/防具細分類）再點跨城補查！');
    doCrossSearch(kw);
  };

  async function mktAutoTick() {
    if (!mktAuto15s || !mktView || document.hidden) return;
    const runTask = async () => {
      const cf = findCityVendingFieldset();
      if (!cf) { stopMktAuto('已離開攤位頁'); return; }
      const refBtn = [...cf.querySelectorAll('button')].find((b) => clean(b.textContent) === '重新整理' && !b.disabled);
      const st = mktPanel.querySelector('#roi-mkt-status');
      if (refBtn) {
        refBtn.click();
        st.textContent = `🟢 [${new Date().toLocaleTimeString()}] 已觸發 15 秒原生重新整理...`;
        await sleep(800);
        const p = getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId);
        if (updateLocalListings(p)) renderMkt();
      }
      const kw = mktPanel.querySelector('#roi-mkt-q').value.trim() || (mktFilter === 'card' ? '卡片' : mktSub !== 'all' ? SUB_LABELS[mktSub] : '');
      if (kw && mktAuto15s) {
        await sleep(2200);
        if (mktAuto15s && !document.hidden) await doCrossSearch(kw, true);
      }
    };
    if (navigator.locks?.request) {
      navigator.locks.request('roi-lean-market-lock', { ifAvailable: true }, async (lock) => {
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
    mktAuto15s = true;
    mktAutoBtn.textContent = '⏹ 停止 15s 自動整理';
    mktAutoBtn.style.background = '#dc2626';
    clearInterval(mktAutoTimer);
    mktAutoTick();
    mktAutoTimer = setInterval(mktAutoTick, 15000);
  }

  function stopMktAuto(reason = '') {
    mktAuto15s = false;
    clearInterval(mktAutoTimer);
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
        mktPrevPrices.set(key, i.price);
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
    const isDetail = mktFilter === 'card' || mktFilter === 'weapon' || mktFilter === 'armor';
    mktSubWrap.style.display = isDetail ? 'inline-flex' : 'none';
    if (isDetail) {
      const opts = CAT_SUBS[mktFilter] || [];
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

  // 全域懸浮監聽：同時支援「商品分類 ([data-rkey])」與「原生露天攤位/背包/倉庫 ([data-ro-hover-id])」
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

      // 優先從 React Fiber 讀取該列直接綁定的物品實例（包含完整 cards、slots、鍛造/附魔）
      const stack = readNearbyItemStack(natRow, id, refine);
      const stackCards = Array.isArray(stack?.cards) ? stack.cards.filter(Boolean) : null;

      // 其次比對 O(1) 索引後的本地攤位與跨城補查快取
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
      if (mktFavs.has(r.id)) mktFavs.delete(r.id); else mktFavs.add(r.id);
      try { GM_setValue('roi-favorites-v1', [...mktFavs]); } catch {}
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

  function syncMktMount() {
    ensurePackItemsLoaded();
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
      if (mktAuto15s) stopMktAuto();
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
    const p = getCommittedProps(cf, (x) => Array.isArray(x.shops) && x.snap?.mapId);
    if ((updateLocalListings(p) || opening) && mktView) renderMkt();
  }

  function ensureHUD() {
    if (!document.body || document.getElementById('ro-helper-hud')) return;
    const st = document.createElement('style');
    st.textContent = `
      [data-roi-browse-hidden], [data-roi-native-fold] { display: none !important; }
      .roi-mc-text { color: var(--roi-mc) !important; font-weight: bold !important; font-variant-numeric: tabular-nums; }
      html.night .roi-mc-text, html[data-info-night] .roi-mc-text, #roi-mkt-rows .roi-mc-text { color: var(--roi-mn) !important; -webkit-text-fill-color: currentColor !important; }
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
      #ro-hud-card { background:linear-gradient(165deg,rgba(15,23,42,0.96),rgba(9,13,22,0.98)); backdrop-filter:blur(12px); color:#f8fafc; border:1.5px solid rgba(56,189,248,0.75); border-radius:12px; box-sizing:border-box; width:min(355px,calc(100vw - 8px)); max-height:calc(100vh - 8px); max-height:calc(100dvh - 8px); box-shadow:0 16px 40px rgba(0,0,0,0.88), 0 0 15px rgba(56,189,248,0.15); font-size:12px; overflow:auto; }
      #ro-drag { position:sticky; top:0; z-index:1; }
      .ro-tab { flex:1; text-align:center; padding:8px 2px; cursor:pointer; color:#94a3b8; font-weight:bold; font-size:11px; border-bottom:2px solid transparent; transition:all 0.15s; }
      .ro-tab:hover { color:#e2e8f0; background:rgba(30,41,59,0.5); }
      .ro-tab.active { color:#fbbf24; border-bottom-color:#fbbf24; background:rgba(30,41,59,0.9); }
      .ro-pane { display:none; padding:10px 12px; max-height:410px; overflow-y:auto; touch-action:pan-y; }
      .ro-pane.active { display:block; }
      .ro-box { background:rgba(30,41,59,0.75); border:1px solid rgba(71,85,105,0.65); border-radius:8px; padding:7px 9px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.04); }
    `;
    document.head.appendChild(st);

    const hud = document.createElement('div'); hud.id = 'ro-helper-hud';
    hud.innerHTML = `
      <div id="ro-fab" style="display:${state.hudMin ? 'flex' : 'none'};width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#0f172a,#1e293b);border:2px solid #38bdf8;color:#38bdf8;align-items:center;justify-content:center;font-size:21px;cursor:move;box-shadow:0 8px 24px rgba(0,0,0,0.85);" title="可拖曳移動｜點擊展開">⚡</div>
      <div id="ro-hud-card" style="display:${state.hudMin ? 'none' : 'block'};">
        <div id="ro-drag" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:linear-gradient(90deg,#1e293b,#0f172a);border-bottom:1px solid #334155;font-weight:bold;color:#38bdf8;cursor:move;" title="按住可拖曳移動視窗">
          <span>⚡ RO Idle 便利助手 v3.3.21</span>
          <button id="ro-min-btn" style="background:#334155;color:#fff;border:none;border-radius:5px;padding:2px 9px;cursor:pointer;font-weight:bold;">━</button>
        </div>
        <div style="display:flex;background:#090d16;border-bottom:1px solid #1e293b;">
          <div class="ro-tab active" data-t="tel">📊 效率</div>
          <div class="ro-tab" data-t="chr">👥 分身</div>
          <div class="ro-tab" data-t="lot">🎒 掉寶</div>
          <div class="ro-tab" data-t="cfg">🔒 貴重詞/備份</div>
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
          <div style="display:flex;gap:10px;margin-bottom:8px;font-size:11px;color:#cbd5e1;">
            <label style="cursor:pointer;"><input type="checkbox" id="c-snd" ${state.sound ? 'checked' : ''}> 🔊音效</label>
            <label style="cursor:pointer;"><input type="checkbox" id="c-ntf" ${state.notify ? 'checked' : ''}> 🔔通知</label>
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
          <div style="font-weight:bold;color:#fbbf24;margin-bottom:4px;">🔒 自訂倉庫貴重保護詞 (由你決定)</div>
          <textarea id="i-words" rows="2" placeholder="例：布里刊, 亡者遺物, 神之金屬, 鋁" style="width:100%;box-sizing:border-box;background:#090d16;color:#fde047;border:1px solid #475569;border-radius:6px;padding:6px;font-size:11.5px;user-select:text;"></textarea>
          <button id="b-save-words" style="width:100%;margin:6px 0 8px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;padding:6px;border-radius:6px;cursor:pointer;font-weight:bold;">💾 儲存自訂貴重詞並套用至倉庫</button>
          <div class="ro-box" style="display:flex;flex-direction:column;gap:5px;font-size:11px;margin-bottom:8px;">
            <label style="cursor:pointer;"><input type="checkbox" id="c-wheq" ${state.whAutoEquipCard ? 'checked' : ''}> ✨ 自動保護卡片 / +精煉 / 有洞裝備</label>
            <label style="cursor:pointer;"><input type="checkbox" id="c-mcol" ${state.moneyColor ? 'checked' : ''}> 🎨 啟用拍賣與表格價位 10 階分色</label>
          </div>
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
    // The embedded browser creates its userscript menu outside the game UI.
    // Keep that menu with the draggable helper window when it is available.
    function attachBrowserMenu() {
      const menu = document.getElementById('mgm-userscript-menu');
      const header = hud.querySelector('#ro-drag');
      if (!menu || !header || menu.parentElement === header) return;
      menu.style.cssText = 'position:relative;top:auto;right:auto;z-index:2;font:12px system-ui;color:#eee;margin-left:auto;margin-right:8px;';
      header.insertBefore(menu, header.querySelector('#ro-min-btn'));
    }
    attachBrowserMenu();
    const browserMenuObserver = new MutationObserver(() => {
      if (document.getElementById('mgm-userscript-menu')) {
        attachBrowserMenu();
        browserMenuObserver.disconnect();
      }
    });
    browserMenuObserver.observe(document.body, { childList: true });


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
    const hudSizeObserver = new ResizeObserver(fitHud);
    hudSizeObserver.observe(hud);
    window.addEventListener('resize', fitHud);

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
      state.hudMin = m; savePrefs();
      document.getElementById('ro-hud-card').style.display = m ? 'none' : 'block';
      document.getElementById('ro-fab').style.display = m ? 'flex' : 'none';
      fitHud();
    };
    bindDrag(document.getElementById('ro-drag'), null);
    bindDrag(document.getElementById('ro-fab'), () => setMin(false));
    document.getElementById('ro-min-btn').onclick = () => setMin(true);

    hud.querySelectorAll('.ro-tab').forEach((t) => t.onclick = () => {
      hud.querySelectorAll('.ro-tab,.ro-pane').forEach((x) => x.classList.remove('active'));
      t.classList.add('active'); document.getElementById('pane-' + t.dataset.t).classList.add('active');
    });

    document.getElementById('c-snd').onchange = (e) => { state.sound = e.target.checked; savePrefs(); };
    document.getElementById('c-ntf').onchange = (e) => { state.notify = e.target.checked; savePrefs(); };
    document.getElementById('c-wheq').onchange = (e) => { state.whAutoEquipCard = e.target.checked; savePrefs(); refreshWarehouse(true); };
    document.getElementById('c-mcol').onchange = (e) => { state.moneyColor = e.target.checked; savePrefs(); alignAndColorizeNativeMarkets(); renderMkt(); };

    document.getElementById('b-save-words').onclick = () => {
      state.customProtectWords = document.getElementById('i-words').value.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
      try { GM_setValue('ro_custom_protect_words_v091', state.customProtectWords); } catch {}
      refreshWarehouse(true);
      alert(`✅ 已更新自訂貴重詞 (${state.customProtectWords.length} 項)！`);
    };

    document.getElementById('b-exp-json').onclick = () => {
      const payload = {
        format: 'ro-idle-lean-backup', version: 1,
        prefs: GM_getValue('ro_lean_prefs_v091', {}),
        words: state.customProtectWords,
        wh: { marks: state.whMarks, autoLocks: state.whAutoLocks },
        priceOptions,
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
        const d = JSON.parse(await f.text());
        if (d.format !== 'ro-idle-lean-backup' && d.format !== 'ro-idle-helper-backup') throw Error('備份格式不符');
        const importedWh = d.settings?.['warehouse-helper-v1'] ?? d.wh;
        if (importedWh !== undefined && !validWarehouseData(importedWh)) throw Error('倉庫鎖定資料格式不符');
        const options = d.priceOptions ?? d.settings?.[priceOptionKey];
        if (options && validThreshold(options.threshold) && typeof options.enabled === 'boolean') GM_setValue(priceOptionKey, options);
        if (d.words) GM_setValue('ro_custom_protect_words_v091', d.words);
        if (importedWh !== undefined) GM_setValue('warehouse-helper-v1', JSON.stringify(importedWh));
        if (d.favs) GM_setValue('roi-favorites-v1', d.favs);
        if (d.prefs) GM_setValue('ro_lean_prefs_v091', d.prefs);
        if (d.settings?.['roi-favorites-v1']) GM_setValue('roi-favorites-v1', d.settings['roi-favorites-v1']);
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

  function renderChars() {
    const box = document.getElementById('u-clist'); if (!box) return;
    const sum = [...state.myCharIds].reduce((total, id) => total + (state.charZenyMap[id] || 0), 0);
    document.getElementById('u-tzeny').textContent = sum.toLocaleString() + ' Z';
    box.replaceChildren(...state.chars.map((c) => {
      const row = element('div', null, `display:flex;justify-content:space-between;align-items:center;background:rgba(30,41,59,0.8);padding:6px 10px;border-radius:6px;margin-bottom:5px;border-left:3px solid ${c.running ? '#22c55e' : '#ef4444'}`);
      const detail = element('div');
      detail.append(element('b', c.name), element('small', ` (Lv.${c.baseLv}/${c.jobLv})`, 'color:#94a3b8'),
        element('div', `📍 ${c.mapId} ｜ 💰 ${(state.charZenyMap[c.id] || 0).toLocaleString()} Z`, 'font-size:11px;color:#93c5fd;margin-top:2px'));
      row.append(detail, element('b', c.running ? '🟢掛機' : '🔴停止', `color:${c.running ? '#4ade80' : '#f87171'}`));
      return row;
    }));
  }

  function runPageRouter() {
    if (document.querySelector('table.xp-table')) alignAndColorizeNativeMarkets();
    if (document.querySelector('input[aria-label="搜尋物品"]') || refPanel) refreshRefinePanel();
    const legends = [...document.querySelectorAll('fieldset > legend')].map((l) => clean(l.textContent));
    if (
      document.querySelector('[aria-label="道具設定的複製與匯出匯入"],select[aria-label="怪物控制：加入怪物"]') ||
      rareKnownRoots.size > 0 ||
      legends.some((t) => /^必撿稀有掉落/.test(t))
    ) mountSettingsTools();
    if (legends.some((t) => /^倉庫/.test(t))) refreshWarehouse();
    if (legends.some((t) => /的攤位/.test(t)) || mktPanel.isConnected) syncMktMount();
    annotateAllRefinedEquipment();
  }

  let uiTimer = null;
  new MutationObserver((records) => {
    let domChanged = false;
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (!el || !el.isConnected || el.closest('#ro-helper-hud,#roi-item-hover-tooltip,[data-roi-market-browser],[data-ro-wh-bar],[data-ro-rare-helper],[data-roi-settings-tools],[data-roi-refine-helper],[data-roi-price-search],[data-roi-upper-fold]')) continue;
      if (r.type === 'attributes' && !el.matches('fieldset') && !el.querySelector('fieldset')) continue;
      if (el.closest('.log-window')) {
        if (r.type === 'characterData' || r.type === 'childList') parseLog(el.closest('.log-line'));
        r.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('.log-line')) parseLog(n);
          n.querySelectorAll?.('.log-line').forEach(parseLog);
        });
        continue;
      }
      if (r.type === 'childList') r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        n.querySelectorAll?.('.log-window .log-line').forEach(parseLog);
      });
      domChanged = true;
    }
    if (domChanged && !uiTimer) {
      uiTimer = setTimeout(() => { uiTimer = null; runPageRouter(); }, 160);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes:true, attributeFilter:['hidden','aria-hidden','inert','class','style'] });

  document.querySelectorAll('.log-window .log-line').forEach(parseLog);
  ensureHUD(); pollChars(); runPageRouter();
  setInterval(() => {
    if (document.hidden) return;
    ensureHUD(); updateHUD();
    const itemGroup = document.querySelector('[role="group"][aria-label="道具設定的複製與匯出匯入"]');
    if (itemGroup) lootSyncPanels.get(itemGroup)?.();
  }, 1500);
  setInterval(pollChars, 45000);
})();
