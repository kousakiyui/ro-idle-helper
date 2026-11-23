const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const production = read('  const itemIds = ', '  let lootPack;')
  + read('  function getMapLoot(', '  const refSelected =');
const dom = new JSDOM('<div role="group" aria-label="道具設定的複製與匯出匯入"></div>');
const { document } = dom.window;
const pack = {
  items: new Map([101, 102, 103, 104, 105, 106, 107, 108].map((id) => [id, { id, name: String(id), category: 'equipment' }])),
  maps: new Map([['a', { spawns: [{ monsterId: 1 }] }], ['b', { spawns: [{ monsterId: 2 }] }]]),
  monsters: new Map([[1, { drops: [101, 102, 103, 104, 105, 106].map((itemId) => ({ itemId })) }],
    [2, { drops: [101, 104, 106, 107, 108].map((itemId) => ({ itemId })) }]])
};
const modes = { consumable: 'off', equipment: 'priority', card: 'off', other: 'off' };
const draft = {
  lockMap: 'a', autoSell: [101], autoStorage: { enabled: true, abovePercent: 80, items: [102] },
  lootPriority: { rare: true, items: [103] }, restock: [{ itemId: 105 }]
};
const inventory = [{ itemId: 104 }, { itemId: '104' }];
const profiles = { player: { enabled: true, modes } };
const changes = [];
const props = {
  snap: { character: { id: 'player' }, inventory: inventory.concat(
    Array.from({ length: 1300 }, (_, i) => ({ itemId: 3000 + i }))) },
  draft,
  update(patch) {
    changes.push(patch);
    this.draft = { ...this.draft, ...patch };
  }
};
const env = {
  document,
  element(tag, text = '') { const el = document.createElement(tag); el.textContent = text; return el; },
  getCommittedProps: () => props,
  classifyItem: () => ({ cat: 'weapon' }),
  loadLootPack: async () => pack,
  readValidatedSetting: () => profiles,
  validateCategoryProfiles: (value) => value,
  salvageCategoryProfiles: () => {},
  plainObject: (value) => !!value && typeof value === 'object',
  GM_getValue: (_key, fallback) => fallback,
  GM_setValue(_key, value) { Object.assign(profiles, value); },
  FiberTraversalTimeout: class extends Error {}
};
const { buildCategoryLootPatch, getMapLoot, mountSettingsTools } = new Function(
  ...Object.keys(env), production + 'return { buildCategoryLootPatch, getMapLoot, mountSettingsTools };'
)(...Object.values(env));

function check(label, fn) {
  fn();
  console.log('PASS ' + label);
}
const settle = () => new Promise(setImmediate);

async function run() {
  check('既有販賣、存倉、優先撿取、補給及背包物品不受本圖分類覆蓋', () => {
    const result = buildCategoryLootPatch(draft, getMapLoot(pack, 'a'), pack, modes, inventory);
    assert.deepEqual(result.patch, {
      autoStorage: { enabled: true, abovePercent: 80, items: [102, 106] },
      autoLoot: true, lootPriority: { rare: true, items: [103, 106] }
    });
    assert.deepEqual([result.added, result.preserved, result.skippedCarried, result.counts.equipment], [1, 3, 1, 1]);
  });
  check('舊格式和停用的存倉規則在補項目時保留', () => {
    const result = buildCategoryLootPatch({
      ...draft, autoStorage: { ...draft.autoStorage, enabled: false }, lootPriority: [103]
    }, getMapLoot(pack, 'a'), pack, modes, inventory);
    assert.equal(result.patch.autoStorage.enabled, false);
    assert.deepEqual(result.patch.lootPriority, { items: [103, 106] });
  });
  check('背包快照缺失或超過清單上限時拒絕寫入', () => {
    const loot = getMapLoot(pack, 'a');
    assert.throws(() => buildCategoryLootPatch(draft, loot, pack, modes, undefined), /無法讀取背包/);
    assert.throws(() => buildCategoryLootPatch({
      ...draft, lootPriority: Array.from({ length: 500 }, (_, i) => 3000 + i)
    }, loot, pack, modes, inventory), /超過存倉或優先撿取上限/);
    assert.throws(() => buildCategoryLootPatch({
      ...draft, autoStorage: Array.from({ length: 2000 }, (_, i) => 3000 + i)
    }, loot, pack, modes, inventory), /超過存倉或優先撿取上限/);
  });
  mountSettingsTools();
  await settle();
  check('背包有 1300 多項、畫面沒有道具列時，自動設定仍只新增本圖缺漏', () => {
    assert.equal(changes.length, 1);
    assert.match(document.body.textContent, /新增 1 種，保留既有設定 3 種，略過背包已有 1 種/);
  });
  props.draft.lockMap = 'b';
  props.snap.inventory.push({ itemId: 107 });
  mountSettingsTools();
  await settle();
  check('換圖保留前次新增和玩家既有規則，只補新圖符合條件的道具', () => {
    assert.equal(changes.length, 2);
    assert.deepEqual(props.draft.autoSell, [101]);
    assert.deepEqual(props.draft.autoStorage.items, [102, 106, 108]);
    assert.deepEqual(props.draft.lootPriority.items, [103, 106, 108]);
    assert.match(document.body.textContent, /新增 1 種，保留既有設定 2 種，略過背包已有 2 種/);
  });
  document.querySelector('[data-roi-settings-tools] button').click();
  await settle();
  check('手動重複按設定本圖沒有缺漏時不寫入草稿', () => {
    assert.equal(changes.length, 2);
    assert.match(document.body.textContent, /新增 0 種，保留既有設定 3 種，略過背包已有 2 種/);
  });
  const follow = document.querySelector('[data-roi-loot-auto]');
  const onlyHere = document.querySelector('[data-roi-loot-auto-here]');
  const selectMap = async (map) => {
    props.draft.lockMap = map;
    mountSettingsTools();
    await settle();
  };
  follow.click();
  onlyHere.click();
  await settle();
  check('本圖自動設定綁定地圖，獨立於隨地圖選項', () => {
    assert.equal(profiles.player.enabled, false);
    assert.equal(profiles.player.currentMap, 'b');
    assert.equal(onlyHere.checked, true);
  });
  pack.items.set(109, { id: 109, name: '新圖掉落', category: 'equipment' });
  pack.monsters.get(1).drops.push({ itemId: 109 });
  await selectMap('a');
  check('只勾自動設定本圖，切到別張圖時不會寫入', () => {
    assert.equal(onlyHere.checked, false);
    assert.equal(changes.length, 2);
  });
  pack.items.set(110, { id: 110, name: '本圖新掉落', category: 'equipment' });
  pack.monsters.get(2).drops.push({ itemId: 110 });
  await selectMap('b');
  check('回到綁定地圖自動補設定，兩個開關都開也不重複寫入', () => {
    assert.equal(onlyHere.checked, true);
    assert.equal(changes.length, 3);
    assert.ok(props.draft.autoStorage.items.includes(110));
    follow.click();
  });
  await settle();
  assert.equal(changes.length, 3);
  await selectMap('a');
  check('開啟隨地圖自動設定後可同步新圖，原有規則仍保留', () => {
    assert.equal(changes.length, 4);
    assert.deepEqual(props.draft.autoStorage.items, [102, 106, 108, 110, 109]);
  });
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => dom.window.close());
