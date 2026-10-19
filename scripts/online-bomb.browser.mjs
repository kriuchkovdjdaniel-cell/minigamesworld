// Isolated browser fixture: every Firebase operation stays in this in-memory broker.
export async function createBombBrowserQA(browser, base) {
  let tree = {}, revision = 0;
  const pages = [], errors = [];
  const get = path => path.split("/").filter(Boolean).reduce((value, key) => value?.[key], tree) ?? null;
  const put = (path, value) => {
    const parts = path.split("/").filter(Boolean), key = parts.pop(); let parent = tree;
    for (const part of parts) parent = parent[part] ??= {};
    if (value == null) delete parent[key]; else parent[key] = structuredClone(value);
  };
  const broadcast = async () => {
    const event = { tree: structuredClone(tree), revision };
    await Promise.all(pages.filter(page => !page.isClosed()).map(page => page.evaluate(data => window.__qaReceive?.(data), event).catch(() => {})));
  };
  async function database({ operation, path, value, expected }) {
    if (operation === "get") return { value: get(path), revision };
    if (operation === "cas" && expected !== revision) return { committed: false, value: get(path), revision };
    if (operation === "patch") for (const [key, part] of Object.entries(value)) put(`${path}/${key}`, part);
    else put(path, value);
    revision++;
    const result = { committed: true, value: structuredClone(get(path)), revision };
    await broadcast(); return result;
  }
  async function client({ app = true, mobile = false, width = 1280, height = 800 } = {}) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
    await context.exposeBinding("__qaDatabase", (_, args) => database(args));
    await context.addInitScript(({ app }) => {
      localStorage.setItem("snake-settings", JSON.stringify({ musicDisabled: true, volume: 60, graphicsQuality: "low" }));
      if (app) window.__TAURI_INTERNALS__ = {};
      const listeners = new Map(); let tree = {}, revision = -1;
      const get = path => path.split("/").filter(Boolean).reduce((value, key) => value?.[key], tree) ?? null;
      const snap = value => ({ val: () => structuredClone(value), exists: () => value != null, forEach: callback => Object.entries(value || {}).forEach(([key, child]) => callback({ ...snap(child), key })) });
      window.__qaReceive = event => {
        if (event.revision <= revision) return;
        tree = event.tree; revision = event.revision;
        for (const [path, callbacks] of [...listeners]) for (const fn of [...callbacks]) fn(snap(get(path)));
      };
      const ref = path => ({
        once: async () => snap((await window.__qaDatabase({ operation: "get", path })).value),
        on(event, fn) { if (!listeners.has(path)) listeners.set(path, new Set()); listeners.get(path).add(fn); this.once().then(value => { if (listeners.get(path)?.has(fn)) fn(value); }); },
        off(event, fn) { if (fn) listeners.get(path)?.delete(fn); else listeners.delete(path); },
        set: value => window.__qaDatabase({ operation: "set", path, value }),
        update: value => window.__qaDatabase({ operation: "patch", path, value }),
        remove: () => window.__qaDatabase({ operation: "set", path, value: null }),
        child: key => ref(`${path}/${key}`), orderByChild() { return this; }, equalTo() { return this; }, limitToLast() { return this; }, limitToFirst() { return this; },
        async transaction(update) {
          for (let attempt = 0; attempt < 100; attempt++) {
            const before = await window.__qaDatabase({ operation: "get", path });
            const value = update(structuredClone(before.value));
            if (value === undefined) return { committed: false, snapshot: snap(before.value) };
            const result = await window.__qaDatabase({ operation: "cas", path, expected: before.revision, value });
            if (result.committed) return { committed: true, snapshot: snap(result.value) };
          }
          throw new Error("QA transaction contention");
        },
        onDisconnect: () => ({ remove: async () => {}, update: async () => {}, cancel: async () => {} })
      });
      const user = { uid: crypto.randomUUID(), getIdToken: async () => "qa" };
      window.firebase = { initializeApp: () => ({ auth: () => ({ currentUser: user, signInAnonymously: async () => ({ user }), signOut: async () => {} }), database: () => ({ ref }) }) };
    }, { app });
    await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base); await page.waitForFunction(() => appUiReady);
    await page.evaluate(() => { authMenu.classList.add("closed"); showMainMenu(); });
    return page;
  }
  return { client, pages, errors, get, patch: (path, value) => database({ operation: "patch", path, value }), async dispose() { for (const page of pages) await page.context().close(); } };
}
