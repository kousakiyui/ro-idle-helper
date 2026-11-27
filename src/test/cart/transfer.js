
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
          if (shouldAbort() || document.hidden) throw Error('角色已變更或流程已停止');
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
