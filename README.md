# MiniGameWorld

MiniGameWorld is a browser game collection with a Windows desktop installer wrapper.

## Web Version

### Skin Studio

Skin Studio has a canvas workspace with pencil, fill, eyedropper, accessory eraser, mirrored brushes, undo/redo, flips, rotation, zoom, and PNG export. A lazy-loaded Three.js cube displays the actual indexed texture and selected accessory. Its preview renders on demand; optional rotation stops when Studio is hidden. Devices without WebGL retain a flat preview and the drawing tools.

Skins remain opaque 64x64 indexed textures, including when editing on a 16x16 or 32x32 brush grid. Accessories remain 16x16 with optional transparency; custom accessory editing and saving still require VIP/Premium. Existing account storage and game appearance formats are unchanged. Guest drafts survive moving between hub sections during the session; account saves require signing in. Failed saves keep drafts and failed equips do not change the local appearance.

Open the web app from the deployed site or GitHub Pages/Vercel deployment for this repo.

### Music

Both music selectors use these display names for the supplied Coin Slot Reaper / Treblo and minigamesworld phonks / Treblo files:

- **Neon Afterburn** (default): Neon Cartridge
- **Midnight Jackpot**: Neon Coin Slot
- **Final Credit**: Continue? 9... 8... 7...
- **Phantom Seas**: Blox Fruits Drift
- **Chaos Engine**: SKIBIDI DRIFT
- **Arcade Overdrive**: Neon Arcade Drift

Only display names change; audio, file metadata, track IDs, and saved selections stay unchanged. The duplicate `Neon Cartridge (1)` download is included only once. Original files are stored in `assets/music/` and copied by both web and desktop build scripts.

**None** still disables music without muting game sounds and stays selected after reload. Track selections are also saved. Selecting a track stops the current custom/local selection without deleting saved music entries. Tracks loop, follow the existing volume control, and are cached individually on first play for offline web-app playback, including seeking. Desktop builds bundle all six tracks; no installer configuration changes are needed.

## Windows App

This repo includes a Tauri v2 wrapper that packages the current static web files into a Windows desktop app.

### Build Locally

Install Node.js 20+, Rust, and the Tauri prerequisites for Windows, then run:

```powershell
npm install
npm run build:desktop
```

The installers will be created under:

```text
src-tauri/target/release/bundle/
```

### GitHub Release Build

Push a version tag to build installers with GitHub Actions:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

The workflow uploads `.msi` and `.exe` installers to the GitHub Release.

### Notes

MiniGameWorld uses Firebase and online features, so the desktop app still needs internet access for accounts, leaderboard, rooms, and online games.

## Battle Pass and Friend Rooms

- Battle Pass rewards scroll together horizontally using the scrollbar, mouse wheel, touch, or arrow buttons. Focus the rewards area to use Left/Right, Home, and End.
- In Social, Refresh Friends shows friends currently in online rooms. Join Room sends a two-minute request; it does not join immediately.
- The friend receives Accept/Decline buttons while in the room. Acceptance joins only if both players are still friends, the recipient is still present, and the room has fewer than five players. Private rooms support this flow too.
- Requests can be canceled and expire automatically. Normal room-code and public-room joining are unchanged. The existing app-only gameplay restriction still applies.

Join requests use `rooms/{code}/joinRequests/{requesterPlayerId}` and the existing Firebase room transactions/listeners. Production database rules must permit the intended reads and transactions; this repository does not include deployed rules. Client-side checks are not a replacement for server-side authorization.

Run regression checks with `npm test`. `npm run build` prepares the web files, and `npm run prepare:tauri` copies the shared UI into the desktop frontend without rebuilding an installer.

## Profile Pictures and Friends Strip

- Profile has Choose Picture, Save Picture, Remove Picture, and Cancel controls. PNG, JPG, and WebP uploads up to 5 MB are center-cropped to a 192-pixel square and saved as a small JPEG, without the original image metadata. Avatars appear in the header, Profile, Social, and friends strip.
- Games has a horizontally scrollable friends strip above the featured game. It shows actual friends, online status, and current game; clicking a friend opens a quick profile with the existing approval-based Join Room action.
- The strip subscribes to `users/{friend}/publicProfile`, containing the display name, bounded picture data, and per-session presence. Heartbeats run every 30 seconds, expire after two minutes, and use Firebase `onDisconnect` cleanup. Separate session IDs keep one device logging out from hiding another active device.
- Existing Firebase rules must allow the appropriate profile reads and owner writes. No database security rules or installer configuration are changed. Browser checks use isolated mock data, not live player accounts.

## Crystal Isles 3D

- A separate solo game in Games, using Three.js rendering and Rapier collision physics. Existing games are unchanged. Four courses are available: Emerald Haven (8 crystals), Sunstone Steps (10), Frostline Peaks (11), and Twilight Crown (12). Routes become narrower and climb higher. Collect every crystal, then return to the portal. Each crystal saves a checkpoint; three falls end the round.
- Move with WASD or arrow keys, jump with Space, hold the right mouse button and drag to rotate the camera, and scroll to zoom. Left-drag no longer rotates. Releasing the button or pausing stops camera dragging. Escape pauses. The HUD provides camera reset, fullscreen, pause, restart, and Return to Games.
- Clear a course to use Next Level, or choose any course in the pause/results menu. Restart resets only the current course. Your last selected level and cleared courses are saved on this device, separately for each account and for guests; this progress is not cloud-synced. Each course starts with three lives and fresh crystals.
- Your equipped color or custom pixel skin appears on the cube. Graphics quality controls pixel density and shadows. Switching tabs pauses the game; exiting releases its WebGL and physics resources.
- Best scores are saved locally and written to the signed-in account's `bestScores/crystal-isles-3d` using a maximum-value transaction. No new currency rewards are granted. Live cloud writes still depend on the existing Firebase rules.
- The existing computer/app-only gameplay restriction applies. The 3D bundle loads on demand and is cached after first play for installed web apps. Desktop builds include the bundle locally, without CDN dependencies.

Run `npm install`, then `npm run dev` for a local preview. `npm run build` and `npm run prepare:tauri` compile and copy the 3D assets as well as the shared UI. The latter updates the desktop frontend build input, not an already-installed native app or its installer configuration.

`npm test` includes completing all four courses through real movement and jumps, collision/grounding, normalized movement, checkpoints, lives, portal locking, progress validation, and cleanup. Browser QA covers the full-window scene, narrow layouts, right-drag camera/release/focus loss, level selection and completion, saved-level restore, pause/restart, graphics failure, load cancellation/timeout, and the existing web/phone gates. Browser Firebase checks use mocks; completion-screen checks also use an isolated QA-only bundle to place the real physics simulation at its end state. Native Tauri and live Firebase are not part of those checks.

## Dead Route 3D

An original solo zombie-survival RPG, inspired by the bus-and-scavenging premise of Last Stop, not a Roblox port. Three.js renders the survivor, drivable bus, buildings, loot, roadside forest, and infected. Rapier handles movement, collisions and shooting raycasts; PathFinding.js supplies zombie navigation. All models are original procedural geometry. No Roblox assets or accounts are used.

- Clear Service Station, Pinewood Town and Quarantine Crossing, secure the fuel cache at each stop, then drive to Safe Haven. The final encounter includes a larger, tougher infected boss. The route remains closed until its infected are defeated and fuel is secured.
- On foot: WASD/arrow keys move relative to the camera, mouse aims, left click shoots, Space uses melee, E collects loot or boards/exits the bus, R reloads, and H uses a medkit. Hold the right mouse button to orbit and scroll to zoom. In the bus: W/S accelerate/brake/reverse and A/D steer. Stop before exiting. Escape pauses; Tab opens inventory/workshop. HUD controls have tooltips with their shortcuts.
- Defeating infected earns XP, levels, health increases and scrap. At the bus, scrap buys repairs, armor, a carbine upgrade, fuel and ammo. Scrap is only an in-game resource for this journey, not Flame Coins or a paid currency. Melee remains available without ammunition.
- Checkpoints save at the start of each stop, separately per signed-in account or guest on this device. Retry Stop restores that checkpoint, including resources, and resets that stop's enemies and loot; mid-stop progress is not saved. New Journey requires confirmation. Checkpoints are local, not cloud-synced.
- Best scores use the existing local storage and account maximum-value transaction. Cloud writes require the existing Firebase rules; no new rules, account systems, installer or Tauri configuration are introduced. The computer/app-only restriction remains.
- The separate `assets/zombie-game.js` bundle loads only when selected. Both existing build flows include it, its third-party licenses, and a thumbnail captured from the actual scene. Existing installed native apps still need a release/update to receive the new frontend.

### World and Sound Update

- The route now has 12 enterable ground-floor buildings with distinct facades and interiors: garage, diner, motel, salvage workshop, market, ranger outpost, bakery, residence, clinic, security post, relief depot and radio station. Ten background buildings, upper-floor facades, fences, layered trees, streetlights and textured ground fill out the settlements. Roofs hide when entering a building. The new side buildings contain optional, single-use parts and ammo caches.
- The bus has an animated door, window reflections, roof rack, rear ladder, and visible armor upgrades. Characters have rounded block details, boots, varied infected clothing and a boss helmet. Shooting adds a brief muzzle flash and bounded impact particles; defeated infected fall, and the running bus emits small exhaust puffs. Static bus trim and scenery use instancing; low quality reduces trees and particle capacity.
- Original offline Web Audio effects cover gunshots, reloads, footsteps, nearby infected, impacts, doors, loot, upgrades and healing, plus wind and a speed-responsive engine. Infected sounds are distance-attenuated and stereo-positioned. Effects honor the global volume; the speaker button or M toggles a device-saved game mute. Pause/tab switching suspends audio, and leaving closes its context. Sample buffers are reused and simultaneous effect voices are capped at 16. No new background music or external audio downloads are added.

Tests also cover new doors/walls, single-use bonus loot, sample bounds, positional audio, voice limits, mute, pause/resume, failed startup recovery and disposal. Browser audio checks measure the real Web Audio signal in an isolated test context; native Tauri and live Firebase remain outside local QA.

`npm test` covers checkpoint validation, all encounters, collection limits, collision and wall-blocked bullets, shooting/reloading/melee, upgrades, zombie attacks, boarding/exit restrictions, locked routes, and a complete three-stop drive with checkpoint recovery. Combat fixtures use controlled positioning with real Rapier raycasts and AI. Browser checks use mock Firebase and an isolated app-runtime test context, never live player data.
