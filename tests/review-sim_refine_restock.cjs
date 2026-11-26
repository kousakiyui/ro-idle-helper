const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(process.argv[2], 'utf8');
const read = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const production = read('  const isWeaponRefineButton =', '  function waitForRefineResult(')
  + read('  async function runHybridRefine(', '  function syncRefineSettings(');
const steps = [984, 984, 985].map((material) => ({ material, rate: 100, price: 10 }));

async function simulate({
  mode = 'safe_only', stock = { 984: 2, 985: 1 }, ores = [], zeny = 30, sp = 100,
  failCredit, extraEquip = false, batch = 1, stopDuringCredit, autoWarehouse = true
} = {}) {
  const equip = { uid: 1, itemId: 100, refine: 0 };
  const other = { uid: 2, itemId: 101, refine: 2 };
  const inventory = [equip, ...(extraEquip ? [other] : []), ...ores.map(([itemId, qty]) => ({ itemId, qty }))];
  const trace = [], status = { textContent: '' };
  let pending = null, selected = 1, actor = 9, skillUsed = false, step = 0;
  const b = { s: { inventory, character: { zeny, sp, skills: { WS_WEAPONREFINE: 5 } } }, table: {}, host: {} };
  const snapshot = () => {
    b.rows = inventory.filter((item) => item.uid != null).map((st) => ({ st, uid: st.uid, name: '裝備' + st.uid }));
    return b;
  };
  const count = (id) => inventory.find((item) => item.itemId === id)?.qty || 0;
  const assertSession = (session) => {
    if (session.characterId !== actor) throw Error('角色已變更');
  };
  const assertTarget = (session, uid) => {
    assertSession(session);
    assert.ok(inventory.some((item) => item.uid === uid));
    return snapshot();
  };
  const nativeButton = (_table, uid, match) => {
    const item = inventory.find((item) => item.uid === uid);
    if (!item || uid !== selected || item.refine >= 3) return null;
    const names = mode === 'skill_only' ? ['武器精練（技能，成功率 100%）'] : ['一鍵精煉到安全值 +3'];
    const textContent = names.find((name) => match(name.normalize('NFKC')));
    if (!textContent) return null;
    const needed = mode === 'skill_only' ? [steps[item.refine]] : steps.slice(item.refine);
    const materials = new Map();
    for (const { material } of needed) materials.set(material, (materials.get(material) || 0) + 1);
    return {
      textContent, materials,
      disabled: (mode === 'skill_only' ? sp < 5 : zeny < 10 * needed.length)
        || [...materials].some(([id, qty]) => count(id) < qty)
    };
  };
  const env = {
    refPanel: { isConnected: true, querySelector: () => status },
    refSelected: new Set([1, ...(extraEquip ? [2] : [])]),
    refMaterialBatch: batch, refTargetPlus: 3, refMode: 'round_robin', refAutoWh: autoWarehouse, refSkipConfirm: true,
    refinePack: { items: new Map([100, 101].map((id) => [id, { slots: ['weapon'], weaponLevel: 1, weaponType: 'sword' }])),
      refine: { weapon: { 1: steps } } },
    page: { confirm: () => true }, pageNet: { settled: 0 }, document: { hidden: false },
    positiveId: (value) => typeof value === 'number' && value > 0 ? value : null,
    clean: (value) => String(value ?? ''),
    refreshRefinePanel() {}, alertUser() {}, readFiberForUi: (read) => read(),
    FiberTraversalTimeout: class extends Error {},
    isEligibleEquip: (row) => row.st.refine < 3,
    readBackpackContext: snapshot,
    refineActor: () => actor,
    refineItemSignature: (item) => item.itemId,
    assertRefineSession: assertSession, assertRefineTarget: assertTarget,
    async refineAwait(session, promise) { const value = await promise; assertSession(session); return value; },
    async selectBagItemRow(uid, session) { selected = uid; return assertTarget(session, uid); },
    readRefineDetail: nativeButton, findNativeDetailBtn: nativeButton,
    async waitForRefineCommandSlot(session) { assertSession(session); },
    clickRefineCommand(session, button, uid) {
      assertTarget(session, uid);
      assert.equal(button.disabled, false);
      for (const [id, qty] of button.materials) inventory.find((item) => item.itemId === id).qty -= qty;
      const item = inventory.find((entry) => entry.uid === uid);
      item.refine = mode === 'skill_only' ? item.refine + 1 : 3;
      trace.push('refine:' + item.refine);
      step = item.refine;
      skillUsed = mode === 'skill_only';
    },
    async tryWithdrawFromWarehouse(ids, _limit, _status, _rules, _max, session, amount) {
      assertSession(session);
      if (amount === undefined) return [];
      assert.equal(session.targetUid, 1);
      const [id] = ids;
      trace.push('withdraw:' + id);
      const qty = Math.min(amount, stock[id] || 0);
      if (!qty) return [];
      assert.equal(pending, null);
      pending = { id, qty };
      stock[id] -= qty;
      return [{ id, quantity: qty }];
    },
    async waitForRefineUi(session, check) {
      assertSession(session);
      if (pending) {
        assert.equal(check(), false, '材料入帳前不可推進');
        if (stopDuringCredit) actor = 2;
        assertSession(session);
        const { id, qty } = pending;
        pending = null;
        const applied = failCredit ? qty - 1 : qty;
        if (!inventory.some((item) => item.itemId === id)) inventory.push({ itemId: id, qty: 0 });
        inventory.find((item) => item.itemId === id).qty += applied;
        trace.push('credit:' + id);
      }
      return check();
    },
    async waitForRefineResult(session, uid, options) {
      assert.equal(options.useSkill, skillUsed);
      const current = assertTarget(session, uid);
      return { kind: 'success', b: current, nowSt: inventory.find((item) => item.uid === uid) };
    }
  };
  const run = new Function(...Object.keys(env),
    'let refBusy = false, refStop = false, refineIdentityEpoch = 0;\n' + production + 'return runHybridRefine;'
  )(...Object.values(env));
  await run(mode);
  return { trace, status: status.textContent, step, equip, other };
}

async function check(label, scenario) {
  await scenario();
  console.log('PASS ' + label);
}

(async () => {
  await check('安全精煉連續補兩批神金和一批鋁，每批入帳後才繼續', async () => {
    const result = await simulate();
    assert.deepEqual(result.trace, ['withdraw:984', 'credit:984', 'withdraw:984', 'credit:984',
      'withdraw:985', 'credit:985', 'refine:3']);
    assert.equal(result.step, 3);
  });
  await check('神工匠消耗完補下一批，達標後停止領料', async () => {
    const result = await simulate({ mode: 'skill_only', zeny: 0 });
    assert.deepEqual(result.trace, ['withdraw:984', 'credit:984', 'refine:1', 'withdraw:984', 'credit:984',
      'refine:2', 'withdraw:985', 'credit:985', 'refine:3']);
  });
  await check('倉庫材料用完時略過缺料裝備，繼續處理可精煉的裝備', async () => {
    const result = await simulate({ stock: { 984: 1 }, ores: [[985, 1]], extraEquip: true });
    assert.deepEqual(result.trace, ['withdraw:984', 'credit:984', 'withdraw:984', 'refine:3']);
    assert.equal(result.equip.refine, 0);
    assert.equal(result.other.refine, 3);
    assert.match(result.status, /略過 1 件/);
  });
  await check('關閉自動領料、Zeny 或 SP 不夠、或已有足夠材料時不多領', async () => {
    assert.deepEqual((await simulate({ autoWarehouse: false })).trace, []);
    assert.deepEqual((await simulate({ zeny: 0 })).trace, []);
    assert.deepEqual((await simulate({ mode: 'skill_only', sp: 4 })).trace, []);
    const result = await simulate({ mode: 'skill_only', ores: [[984, 2], [985, 1]] });
    assert.deepEqual(result.trace, ['refine:1', 'refine:2', 'refine:3']);
  });
  await check('材料僅部分入帳或切角時，停止且不重送下一批', async () => {
    const partial = await simulate({ batch: 2, failCredit: true });
    assert.deepEqual(partial.trace, ['withdraw:984', 'credit:984']);
    assert.match(partial.status, /材料入帳逾時/);
    const switched = await simulate({ stopDuringCredit: true });
    assert.deepEqual(switched.trace, ['withdraw:984']);
    assert.match(switched.status, /角色已變更/);
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });
