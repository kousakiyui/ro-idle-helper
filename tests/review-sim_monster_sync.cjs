const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const production = read('  function readMonsterRules(', '  const itemIds =')
  + 'const lootSyncPanels = new WeakMap();'
  + read('  function mountSettingsTools()', '  const refSelected =');
const dom = new JSDOM('<div><select aria-label="怪物控制：加入怪物"></select></div>');
const { document } = dom.window;
const original = [
  { monsterId: 30, action: 'priority', minHp: 75, siegeWeight: 2 },
  { monsterId: 10, action: 'lure', escape: 'sight', minSp: 20 }
];
const initial = {
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
const mount = new Function('document', 'getCommittedProps', 'findRareRoots', production + 'return mountSettingsTools;')(
  document, (select, check) => select?.isConnected && check(props) ? props : null, () => []
);
const message = () => document.querySelector('[data-roi-mon-status]').textContent;
const sync = () => [...document.querySelectorAll('[data-roi-mon-btn]')]
  .find((button) => button.textContent.includes('同步本圖怪物')).click();

function check(label, run) {
  run();
  console.log('PASS ' + label);
}

try {
  mount();
  check('同步只追加缺少的本圖怪物，保留原本順序、異圖設定及細項', () => {
    sync();
    assert.equal(changes.length, 1);
    assert.deepEqual(props.draft.monsterRules, [
      ...original,
      { monsterId: 40, action: 'defend' },
      { monsterId: 50, action: 'attack', escape: 'sight' },
      { monsterId: 60, action: 'attack' },
      { monsterId: 70, action: 'attack' }
    ]);
    assert.deepEqual(props.draft.targets, { blacklist: [], whitelist: [99] });
    assert.deepEqual(props.draft.escape, { dangerMonsters: [], danger: 'teleport' });
    assert.match(message(), /新增本圖 2 隻怪物，保留既有 4 隻設定/);
    assert.deepEqual(initial.targets.blacklist, [40]);
    assert.deepEqual(initial.escape.dangerMonsters, [50]);
  });
  check('重按、空地圖或只有已設定的舊版怪物時不改草稿', () => {
    sync();
    assert.equal(changes.length, 1);
    assert.match(message(), /本圖怪物都已設定/);
    props.mapMonsters = [];
    sync();
    assert.match(message(), /目前地圖沒有可同步的怪物/);
    props.mapMonsters = [40, 50];
    props.draft = initial;
    sync();
    assert.equal(changes.length, 1);
    assert.equal(props.draft, initial);
  });
  check('上限計入保留的舊版規則，超過時不進行部分更新', () => {
    props.draft = {
      ...initial,
      monsterRules: Array.from({ length: 197 }, (_, i) => ({ monsterId: 1000 + i, action: 'lure' }))
    };
    props.mapMonsters = [40, 60, 70];
    sync();
    assert.equal(changes.length, 1);
    assert.match(message(), /超過 200 隻上限/);
    props.mapMonsters = [40, 60];
    sync();
    assert.equal(changes.length, 2);
    assert.equal(props.draft.monsterRules.length, 200);
    assert.deepEqual(props.draft.monsterRules.at(-1), { monsterId: 60, action: 'attack' });
  });
} finally {
  dom.window.close();
}
