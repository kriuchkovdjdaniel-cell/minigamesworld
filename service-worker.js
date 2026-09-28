const CACHE_NAME = "minigameworld-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./minigameworld-icon.png",
  "./loading-music.mp3",
  "./assets/crystal-isles-3d.png",
  "./assets/dead-route-3d.png"
];
// Cache the self-contained 3D engine after first play, not during app installation.
const LAZY_ASSETS = ["./assets/three-games.js", "./assets/zombie-game.js"];
const MUSIC_ASSETS = [
  "./assets/music/neon-cartridge.mp3",
  "./assets/music/neon-coin-slot.mp3",
  "./assets/music/continue-countdown.mp3"
];

async function musicRangeResponse(response, range) {
  if (!range || response.status !== 200) return response;
  const bytes = await response.arrayBuffer(), size = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  let start = NaN, end = size - 1;
  if (match && (match[1] || match[2])) {
    start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    if (match[1] && match[2]) end = Math.min(end, Number(match[2]));
  }
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.set("accept-ranges", "bytes");
  if (!Number.isSafeInteger(start) || start < 0 || start >= size || end < start) {
    headers.set("content-range", `bytes */${size}`);
    headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

async function loadMusic(request) {
  const url = new URL(request.url); url.search = "";
  const cache = await caches.open(CACHE_NAME);
  let response = await cache.match(url.href);
  if (!response) {
    // Store one complete track on first play; partial responses cannot be cached.
    response = await fetch(url.href);
    if (response.status === 200) await cache.put(url.href, response.clone()).catch(() => {});
  }
  return musicRangeResponse(response, request.headers.get("range"));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("minigameworld-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (MUSIC_ASSETS.some((path) => new URL(path, self.registration.scope).pathname === requestUrl.pathname)) {
    event.respondWith(loadMusic(event.request));
    return;
  }

  const shellUrls = [...APP_SHELL, ...LAZY_ASSETS].map((path) => new URL(path, self.registration.scope).pathname);
  if (event.request.mode !== "navigate" && !shellUrls.includes(requestUrl.pathname)) return;
  const cacheKey = event.request.mode === "navigate" ? new URL("./index.html", self.registration.scope).href : event.request;
  const refresh = fetch(event.request).then(async (response) => {
    if (response.ok && response.type !== "opaque") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(cacheKey, response.clone());
    }
    return response;
  });
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith((async () => {
    const cached = await caches.match(cacheKey);
    if (cached && event.request.mode !== "navigate") return cached;
    try {
      return await Promise.race([
        refresh,
        new Promise((resolve, reject) => setTimeout(() => cached ? resolve(cached) : reject(new Error("offline")), 3000))
      ]);
    } catch {
      return cached || Response.error();
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "MGW_OPEN_APP" || !event.ports[0]) return;
  event.waitUntil((async () => {
    let opened = false;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.id === event.source?.id) continue;
      const isApp = await new Promise((resolve) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 250);
        channel.port1.onmessage = (reply) => { clearTimeout(timeout); channel.port1.close(); resolve(reply.data?.isApp === true); };
        client.postMessage({ type: "MGW_RUNTIME_QUERY" }, [channel.port2]);
      });
      if (!isApp) continue;
      try {
        await client.focus();
        client.postMessage({ type: "MGW_LAUNCH", launch: event.data.launch });
        opened = true;
      } catch { /* The browser can require a direct launch-link click. */ }
      break;
    }
    event.ports[0].postMessage({ opened });
  })());
});
