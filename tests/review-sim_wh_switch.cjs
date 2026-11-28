const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
function extract(from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, from);
  return source.slice(start, end);
}
const production = extract('  function planRefineWithdrawal(', '  const isWeaponRefineButton')
  + extract('  async function partyApiJson(', '  function partySelectedMap(');

function fixture(options = {}) {
  const equipment = { uid: 41, itemId: 1201, qty: 1, refine: 4 };
  const inventory = [equipment, ...(options.inventory ?? [])];
  const snapshot = { character: { zeny: options.zeny ?? 100 }, inventory,
    weight: options.weight ?? 40, derived: { weightMax: 100 }, mapId: options.mapId ?? 'prontera' };
  const storage = { fees: { prontera: 40 }, items: options.items ?? [{ sid: 7, itemId: 984, qty: 50 }] };
  const characterId = 1;
  const signature = item => JSON.stringify([item.itemId, item.cards ?? [], item.forged ?? null]);
  const session = { characterId, targetUid: options.equipment ? null : 41, items: new Map([[41, signature(equipment)]]) };
  let actor = characterId;
  const requests = [];
  const document = new Proxy({}, { get() { throw Error('背景領倉不可依賴頁面切換或點擊'); } });
  function assertSession(session) {
    if (actor !== session.characterId) throw Error('角色已切換');
    return { s: snapshot };
  }
  const context = vm.createContext({
    document,
    AbortSignal,
    Event,
    performance,
    lastRefineCommandAt: -Infinity,
    partyCommandId: () => 'test-command-1',
    isPlainRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    PartyMoveError: class extends Error {
      constructor(message, status, code) { super(message); this.status = status; this.code = code; }
    },
    refinePack: { items: new Map([
      [984, { category: 'material', weight: 2 }],
      [1201, { category: 'equipment', weight: 24 }],
    ]) },
    canRefine: item => item.itemId === 1201 && !item.locked && !item.broken,
    validMaterialBatch: n => Number.isSafeInteger(n) && n >= 1 && n <= 1000,
    pageNet: { events: new EventTarget() },
    waitForRefineCommandSlot: async () => {},
    assertRefineSession: assertSession,
    assertRefineTarget(s, uid) { assert.equal(uid, s.targetUid); return assertSession(s); },
    refineItemSignature: signature,
    async pollFetch(path, init) {
      requests.push({ path, ...init });
      const response = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });
      if (path === '/api/storage') {
        if (options.switchOnStock) actor = 2;
        return response(200, { storage });
      }
      if (path === '/api/characters/1?deferCatchup=1') {
        if (options.switchOnSnapshot) actor = 2;
        return response(200, { characterId, commandRevision: 12, snapshot: options.serverTargetChanged
          ? { ...snapshot, inventory: [{ ...equipment, refine: 5 }] } : snapshot });
      }
      assert.equal(path, '/api/characters/1/commands');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(init.headers['x-ro-client'], '1');
      assert.equal(init.method, 'POST');
      if (options.network) throw Error('伺服器未回應');
      if (options.rejection) return response(409, { error: { code: 'REVISION_CONFLICT', message: '角色狀態已更新' } });
      return response(200, { ok: true });
    },
  });
  vm.runInContext(production + '\nthis.withdraw = tryWithdrawFromWarehouse;', context);
  return {
    async run(batch = 20, limits = null) {
      return context.withdraw(new Set([options.equipment ? 1201 : 984]), 10, () => {}, limits, options.equipment ? 15 : 1, session, options.equipment ? null : batch);
    },
    posts: () => requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body)),
  };
}

function onlyPost(f, items) {
  assert.deepEqual(f.posts(), [{
    commandId: 'test-command-1',
    expectedCommandRevision: 12,
    command: { type: 'storageWithdraw', items }
  }]);
}

async function check(label, fn) {
  await fn(); console.log('PASS ' + label);
}

(async () => {
  await check('不換頁並帶上角色修訂版本，使用原生 sid/qty 領取', async () => {
    const f = fixture();
    const result = await f.run();
    assert.equal(result[0].quantity, 20);
    onlyPost(f, [{ sid: 7, qty: 20 }]);
  });
  await check('每批領取量受實際庫存與背包可承受重量限制', async () => {
    const weight = fixture({ weight: 95 });
    await weight.run();
    onlyPost(weight, [{ sid: 7, qty: 2 }]);
    const stock = fixture({ items: [{ sid: 7, itemId: 984, qty: 1 }] });
    await stock.run();
    onlyPost(stock, [{ sid: 7, qty: 1 }]);
  });
  await check('背包滿時只允許可合疊材料，並略過不同綁定狀態的堆疊', async () => {
    const inventory = [{ uid: 42, itemId: 984, qty: 4 }, ...Array.from({ length: 98 }, () => ({}))];
    const f = fixture({ inventory, items: [{ sid: 6, itemId: 984, qty: 50, bound: true }, { sid: 7, itemId: 984, qty: 50 }] });
    await f.run();
    onlyPost(f, [{ sid: 7, qty: 20 }]);
  });
  await check('背景領裝依安全上限與容量，跳過上鎖及已達目標的裝備', async () => {
    const f = fixture({ equipment: true, items: [
      { sid: 1, itemId: 1201, qty: 1, refine: 4 },
      { sid: 2, itemId: 1201, qty: 1, refine: 1, locked: true },
      { sid: 3, itemId: 1201, qty: 1, refine: 2 },
      { sid: 4, itemId: 1201, qty: 1, refine: 3 }
    ] });
    await f.run(undefined, new Map([[1201, 4]]));
    onlyPost(f, [{ sid: 3, qty: 1 }, { sid: 4, qty: 1 }]);
  });
  await check('庫存不足、太重、無倉庫服務或支付不起時不送出領取', async () => {
    const none = fixture({ items: [] });
    assert.equal((await none.run()).length, 0);
    for (const options of [{ weight: 100 }, { mapId: 'pay_fild01' }, { zeny: 39 }]) {
      const f = fixture(options);
      await assert.rejects(f.run(), /負重不足|城鎮倉庫|支付倉庫費/);
      assert.equal(f.posts().length, 0);
    }
  });
  await check('讀庫存或讀角色期間切角、目標變動時不送出領取', async () => {
    for (const options of [{ switchOnStock: true }, { switchOnSnapshot: true }, { serverTargetChanged: true }]) {
      const f = fixture(options);
      await assert.rejects(f.run(), /角色已切換|精煉目標已變動/);
      assert.equal(f.posts().length, 0);
    }
  });
  await check('伺服器拒絕或請求結果不明時，都只送出一次', async () => {
    const network = fixture({ network: true });
    await assert.rejects(network.run(), /結果不明/);
    onlyPost(network, [{ sid: 7, qty: 20 }]);
    const conflict = fixture({ rejection: true });
    await assert.rejects(conflict.run(), /角色狀態已更新/);
    onlyPost(conflict, [{ sid: 7, qty: 20 }]);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
