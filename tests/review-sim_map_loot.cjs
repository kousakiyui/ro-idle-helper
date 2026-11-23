const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const production = read('  const itemIds = ', '  let lootPack;')
  + read('  function getMapLoot(', '  const refSelected =');
const dom = new JSDOM('<div role="tablist" aria-label="OpenKore 設定檔"></div><div role="group" aria-label="道具設定的複製與匯出匯入"></div>');
const { document } = dom.window;
const pack = {
  items: new Map([101, 102, 103, 104, 105, 106, 107, 108, 111, 112, 113, 114, 115]
    .map((id) => [id, { id, name: String(id), category: 'equipment' }])),
  maps: new Map([['a', { spawns: [{ monsterId: 1 }] }], ['b', { spawns: [{ monsterId: 2 }] }]]),
  monsters: new Map([
    [1, {
      drops: [101, 102, 103, 104, 105, 111].map((itemId) => ({ itemId })),
      card: { itemId: 113 }, mvpDrops: [{ itemId: 114 }],
      skills: [{ skill: 'NPC_METAMORPHOSIS', vals: [3] }]
    }],
    [2, { drops: [101, 104, 106, 107, 108].map((itemId) => ({ itemId })) }],
    [3, { drops: [{ itemId: 106 }, { itemId: 115 }] }]
  ])
};
const modes = { consumable: 'off', equipment: 'priority', card: 'off', other: 'off' };
const draft = {
  lockMap: 'a', autoSell: [101], autoStorage: { enabled: true, abovePercent: 80, items: [102] },
  lootPriority: { rare: true, items: [103] }, restock: [{ itemId: 105 }],
  autoLoot: false, lootFilter: { mode: 'except', items: [111, 115] }
};
const inventory = [{ itemId: 104 }, { itemId: '104' }, { itemId: 112 }];
let profiles = { player: { enabled: false, modes, currentMap: 'a' }, alt: { enabled: false, modes } };
const validation = new Function('isPlainRecord',
  read('  function validateCategoryProfiles(', '  function prepareBackupWrites(')
  + 'return { validateCategoryProfiles, salvageCategoryProfiles };'
)((value) => !!value && typeof value === 'object' && !Array.isArray(value));
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
  positiveId: (value) => /^[1-9]\d*$/.test(String(value)) ? Number(value) : null,
  snapshotCharacterId: () => null,
  element(tag, text = '') { const el = document.createElement(tag); el.textContent = text; return el; },
  getCommittedProps(node, check) {
    const candidate = node?.getAttribute('role') === 'tablist'
      ? { children: [{ props: { title: '道具設定', children: { props } } }] }
      : props;
    return node?.isConnected && check(candidate) ? candidate : null;
  },
  classifyItem: () => ({ cat: 'weapon' }),
  loadLootPack: async () => pack,
  readValidatedSetting: (_key, validate) => validate(profiles),
  ...validation,
  plainObject: (value) => !!value && typeof value === 'object',
  GM_getValue: (_key, fallback) => fallback,
  GM_setValue(_key, value) { profiles = value; },
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
  check('官方已設定的販賣、存倉、優先撿取、補給和撿取清單全部保留', () => {
    const result = buildCategoryLootPatch(draft, getMapLoot(pack, 'a'), pack, modes);
    assert.deepEqual(result.patch, {
      autoStorage: { enabled: true, abovePercent: 80, items: [102, 104, 106] },
      lootPriority: { rare: true, items: [103, 104, 106] }
    });
    assert.deepEqual([result.added, result.preserved, result.counts.equipment], [2, 6, 2]);
  });
  check('選圖只用一般掉落和變身怪物，排除只在背包及額外 MVP 獎勵的品項', () => {
    assert.deepEqual([...getMapLoot(pack, 'a').keys()], [101, 102, 103, 104, 105, 111, 106, 115]);
  });
  check('舊格式和停用的存倉規則在補項目時保留，空清單也不改開關', () => {
    const result = buildCategoryLootPatch({
      ...draft, autoStorage: { ...draft.autoStorage, enabled: false }, lootPriority: [103]
    }, getMapLoot(pack, 'a'), pack, modes);
    assert.equal(result.patch.autoStorage.enabled, false);
    assert.deepEqual(result.patch.lootPriority, { items: [103, 104, 106] });
    const empty = buildCategoryLootPatch({ autoLoot: false }, new Map([[104, '104']]), pack, modes);
    assert.equal(empty.patch.autoStorage.enabled, false);
    assert.equal(Object.hasOwn(empty.patch, 'autoLoot'), false);
  });
  check('超過清單上限時拒絕寫入', () => {
    const loot = getMapLoot(pack, 'a');
    assert.throws(() => buildCategoryLootPatch({
      ...draft, lootPriority: Array.from({ length: 500 }, (_, i) => 3000 + i)
    }, loot, pack, modes), /超過存倉或優先撿取上限/);
    assert.throws(() => buildCategoryLootPatch({
      ...draft, autoStorage: Array.from({ length: 2000 }, (_, i) => 3000 + i)
    }, loot, pack, modes), /超過存倉或優先撿取上限/);
  });
  mountSettingsTools();
  await settle();
  check('背包有 1300 多項、畫面沒有道具列時，自動設定仍只新增本圖缺漏', () => {
    assert.equal(changes.length, 1);
    assert.match(document.body.textContent, /新增 2 種，保留既有設定 6 種/);
  });
  const group = document.querySelector('[role="group"]');
  const follow = document.querySelector('[data-roi-loot-auto]');
  check('舊版本圖勾選移轉到唯一的隨地圖開關，移除手動按鈕', () => {
    assert.equal(follow.checked, true);
    assert.equal(group.querySelectorAll('input[type="checkbox"]').length, 1);
    assert.equal(group.querySelector('[data-roi-settings-tools] button'), null);
  });
  group.remove();
  props.draft.lockMap = 'b';
  props.snap.inventory.push({ itemId: 107 });
  mountSettingsTools();
  await settle();
  check('OpenKore 道具頁卸載後仍可換圖同步，只補新圖未設定品項', () => {
    assert.equal(changes.length, 2);
    assert.deepEqual(props.draft.autoSell, [101]);
    assert.deepEqual(props.draft.autoStorage.items, [102, 104, 106, 107, 108]);
    assert.deepEqual(props.draft.lootPriority.items, [103, 104, 106, 107, 108]);
    assert.deepEqual(props.draft.lootFilter, draft.lootFilter);
    assert.equal(props.draft.autoLoot, false);
  });
  const nextGroup = group.cloneNode(false);
  document.body.append(nextGroup);
  mountSettingsTools();
  await settle();
  check('重開道具頁勾選仍在，同張圖不重複修改草稿', () => {
    assert.equal(changes.length, 2);
    assert.equal(nextGroup.querySelector('[data-roi-loot-auto]').checked, true);
    assert.match(document.body.textContent, /新增 2 種，保留既有設定 3 種/);
  });
  const selectMap = async (map) => {
    props.draft.lockMap = map;
    mountSettingsTools();
    await settle();
  };
  follow.click();
  await settle();
  check('取消勾選後，舊版單圖設定不會讓它重新開啟', () => {
    assert.equal(profiles.player.enabled, false);
    assert.equal(Object.hasOwn(profiles.player, 'currentMap'), false);
  });
  pack.items.set(109, { id: 109, name: '新圖掉落', category: 'equipment' });
  pack.monsters.get(1).drops.push({ itemId: 109 });
  await selectMap('a');
  check('關閉後換圖不寫入，重新勾選立即補本圖', () => {
    assert.equal(follow.checked, false);
    assert.equal(changes.length, 2);
    follow.click();
  });
  await settle();
  assert.equal(changes.length, 3);
  assert.ok(props.draft.autoStorage.items.includes(109));
  pack.items.set(110, { id: 110, name: '本圖新掉落', category: 'equipment' });
  pack.monsters.get(2).drops.push({ itemId: 110 });
  await selectMap('b');
  check('再次換圖保持勾選並保留前一張圖已寫入的規則', () => {
    assert.equal(follow.checked, true);
    assert.equal(changes.length, 4);
    assert.deepEqual(props.draft.autoStorage.items, [102, 104, 106, 107, 108, 109, 110]);
  });
  props.snap = { character: { id: 'alt' } };
  props.draft = draft;
  mountSettingsTools();
  await settle();
  check('切換角色載入各自開關，關閉的角色不自動寫入', () => {
    assert.equal(changes.length, 4);
    assert.equal(follow.checked, false);
  });
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => dom.window.close());
