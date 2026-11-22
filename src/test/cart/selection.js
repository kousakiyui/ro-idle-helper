
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
