const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const production = read('  function readMonsterRules(', '  const itemIds =')
  + read('  const lootSyncPanels = ', '  const refSelected =');
const dom = new JSDOM('<div role="tablist" aria-label="OpenKore 設定檔"></div><div><select aria-label="怪物控制：加入怪物"></select></div>', { pretendToBeVisual: true });
const { document } = dom.window;
const original = [
  { monsterId: 30, action: 'priority', minHp: 75, siegeWeight: 2 },
  { monsterId: 10, action: 'lure', escape: 'sight', minSp: 20 }
];
const initial = {
  lockMap: 'a',
  monsterRules: original,
  targets: { blacklist: [40], whitelist: [99] },
  escape: { dangerMonsters: [50], danger: 'teleport' }
};
const changes = [];
const props = {
  draft: initial,
  mapMonsters: [10, 50, 60, { id: '60' }, 70],
  update(patch) {
    changes.push(patch);
    this.draft = { ...this.draft, ...patch };
  }
};
const host = document.querySelector('select').parentElement;
let characterId = 1;
const settings = new Map();
const positiveId = (value) => /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
const env = {
  document,
  element(tag, text = '') { const el = document.createElement(tag); el.textContent = text; return el; },
  getCommittedProps(node, match) {
    if (!node?.isConnected) return null;
    const editor = { characterId, snap: { character: { name: '角色' } } };
    const shelf = { children: [{ props: { title: '怪物控制', children: { props } } }] };
    return [props, shelf, editor].find(match) || null;
  },
  positiveId,
  snapshotCharacterId: (snapshot) => positiveId(snapshot?.character?.id),
  plainObject: (value) => !!value && typeof value === 'object',
  validateCategoryProfiles: (value) => value,
  GM_getValue: (_key, fallback) => fallback,
  readValidatedSetting: (key, validate, fallback) => settings.has(key) ? validate(settings.get(key)) : fallback,
  GM_setValue: (key, value) => settings.set(key, value),
  FiberTraversalTimeout: class extends Error {},
  log: (_scope, error) => { throw error; }
};
const mount = new Function(...Object.keys(env), production + 'return mountSettingsTools;')(...Object.values(env));
const message = () => document.querySelector('[data-roi-mon-status]').textContent;
const mode = () => document.querySelector('[data-roi-mon-mode]');
const choose = (value) => {
  assert.equal(mode().disabled, false);
  mode().value = value;
  mode().dispatchEvent(new dom.window.Event('change'));
};

function check(label, run) {
  run();
  console.log('PASS ' + label);
}

try {
  mount();
  check('編輯器有角色 ID 但快照無 ID 時仍可選模式，預設關閉', () => {
    assert.equal(mode().value, 'off');
    assert.equal(mode().disabled, false);
    assert.deepEqual([...mode().options].map((option) => option.value), ['off', 'add', 'replace']);
    assert.ok(!document.querySelector('[data-roi-mon-auto]'));
    assert.equal(changes.length, 0);
  });
  check('新增模式只追加缺少的本圖怪物，保留異圖、條件和舊版規則', () => {
    choose('add');
    assert.equal(changes.length, 1);
    assert.equal(settings.get('roi-monster-auto-map-v1:1'), 'add');
    assert.deepEqual(props.draft.monsterRules, [
      ...original,
      { monsterId: 40, action: 'defend' },
      { monsterId: 50, action: 'attack', escape: 'sight' },
      { monsterId: 60, action: 'attack' },
      { monsterId: 70, action: 'attack' }
    ]);
    assert.deepEqual(props.draft.targets, { blacklist: [], whitelist: [99] });
    assert.deepEqual(props.draft.escape, { dangerMonsters: [], danger: 'teleport' });
    mount();
    assert.equal(changes.length, 1);
  });
  check('只留本圖模式會移除外圖怪物，即使本圖已全部設定也會處理', () => {
    choose('replace');
    assert.equal(changes.length, 2);
    assert.deepEqual(props.draft.monsterRules, [
      original[1], { monsterId: 50, action: 'attack', escape: 'sight' },
      { monsterId: 60, action: 'attack' }, { monsterId: 70, action: 'attack' }
    ]);
    assert.match(message(), /移除 2 隻非本圖怪物/);
    assert.equal(settings.get('roi-monster-auto-map-v1:1'), 'replace');
  });
  check('OpenKore 切到其他頁後仍能換圖，使用新圖清單並保留重疊規則', () => {
    host.remove();
    props.draft.lockMap = 'b';
    props.mapMonsters = [10, 80];
    mount();
    mount();
    assert.equal(changes.length, 3);
    assert.deepEqual(props.draft.monsterRules, [original[1], { monsterId: 80, action: 'attack' }]);
    const replacementHost = document.body.appendChild(document.createElement('div'));
    replacementHost.innerHTML = '<select aria-label="怪物控制：加入怪物"></select>';
    mount();
    assert.equal(mode().value, 'replace');
    assert.equal(document.querySelectorAll('[data-roi-mon-mode]').length, 1);
    assert.equal(changes.length, 3);
  });
  check('地圖清單為空、無法確認或超過上限時維持原草稿', () => {
    props.draft.lockMap = 'c';
    props.mapMonsters = [80, null];
    mount();
    assert.match(message(), /無法確認本圖怪物清單/);
    props.mapMonsters = [];
    mount();
    assert.match(message(), /目前地圖沒有可同步的怪物/);
    props.draft.lockMap = 'd';
    props.mapMonsters = Array.from({ length: 201 }, (_, i) => 1000 + i);
    mount();
    assert.match(message(), /200 隻上限/);
    assert.equal(changes.length, 3);
  });
  check('切到其他角色載入該角色選項，舊版開關自動沿用新增模式', () => {
    characterId = 2;
    props.draft = { ...initial };
    props.mapMonsters = [10, 80];
    mount();
    assert.equal(mode().value, 'off');
    assert.equal(changes.length, 3);
    settings.set('roi-monster-auto-map-v1:3', true);
    characterId = 3;
    mount();
    assert.equal(mode().value, 'add');
    assert.equal(changes.length, 4);
    assert.deepEqual(props.draft.monsterRules.map((rule) => rule.monsterId), [30, 10, 40, 50, 80]);
  });
} finally {
  dom.window.close();
}
