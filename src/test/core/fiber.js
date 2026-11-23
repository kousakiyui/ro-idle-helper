
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
  class FiberTraversalTimeout extends Error {
    constructor() { super('介面讀取逾時，請稍後再試'); }
  }

  let fiberRetryScheduled = false;
  function createFiberScanBudget(host, attempts) {
    const deadline = performance.now() + 8;
    let visited = 0;
    return {
      step() {
        if ((++visited & 255) !== 0 || performance.now() < deadline) return;
        const retries = attempts.get(host) || 0;
        if (retries < 3) {
          attempts.set(host, retries + 1);
          if (!fiberRetryScheduled) {
            fiberRetryScheduled = true;
            requestAnimationFrame(() => {
              fiberRetryScheduled = false;
              runPageRouter();
            });
          }
        }
        throw new FiberTraversalTimeout();
      },
      complete() { attempts.delete(host); }
    };
  }
  const propsScanRetries = new WeakMap();
  const backpackScanRetries = new WeakMap();
  const detailScanRetries = new WeakMap();

  function readFiberForUi(read) {
    try { return read(); }
    catch (error) {
      if (!(error instanceof FiberTraversalTimeout)) throw error;
      return undefined;
    }
  }

  function getCommittedProps(el, matcher) {
    // 由 return 指標回推 child/sibling 路徑；任何一段對不上（樹正在變動）就不快取。
    const fiberRouteFrom = (top, node) => {
      const out = [];
      for (let guard = 0; node && node !== top; guard++) {
        const parent = node.return;
        if (!parent || guard > 80000) return null;
        let s = parent.child, k = 0;
        for (; s && s !== node; s = s.sibling) k++;
        if (!s) return null;
        for (let i = 0; i < k; i++) out.push('s');
        out.push('c');
        node = parent;
      }
      return node === top ? out.reverse() : null;
    };
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
    const nodes = [root], founds = [null];
    let guard = 0;
    const budget = createFiberScanBudget(el, propsScanRetries);
    while (nodes.length && ++guard < 80000) {
      budget.step();
      const node = nodes.pop(), found = founds.pop();
      const p = node.memoizedProps;
      const next = p && matcher(p) ? p : found;
      if (node.stateNode === el) {
        budget.complete();
        const route = next ? fiberRouteFrom(root, node) : null;
        if (route) fiberRouteMap.set(el, route);
        return next;
      }
      if (node.sibling) { nodes.push(node.sibling); founds.push(found); }
      if (node.child) { nodes.push(node.child); founds.push(next); }
    }
    budget.complete();
    return null;
  }
