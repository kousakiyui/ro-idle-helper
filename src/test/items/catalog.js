
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
