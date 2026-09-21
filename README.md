# MiniGameWorld

MiniGameWorld is a browser game collection with a Windows desktop installer wrapper.

## Web Version

Open the web app from the deployed site or GitHub Pages/Vercel deployment for this repo.

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

- A separate solo game in Games, using Three.js rendering and Rapier collision physics. Existing games are unchanged. Collect eight crystals across floating islands, then return to the portal. Each crystal saves a checkpoint; three falls end the round.
- Move with WASD or arrow keys, jump with Space, drag to orbit the camera, and scroll to zoom. Escape pauses. The HUD provides camera reset, fullscreen, pause, restart, and Return to Games.
- Your equipped color or custom pixel skin appears on the cube. Graphics quality controls pixel density and shadows. Switching tabs pauses the game; exiting releases its WebGL and physics resources.
- Best scores are saved locally and written to the signed-in account's `bestScores/crystal-isles-3d` using a maximum-value transaction. No new currency rewards are granted. Live cloud writes still depend on the existing Firebase rules.
- The existing computer/app-only gameplay restriction applies. The 3D bundle loads on demand and is cached after first play for installed web apps. Desktop builds include the bundle locally, without CDN dependencies.

Run `npm install`, then `npm run dev` for a local preview. `npm run build` and `npm run prepare:tauri` compile and copy the 3D assets as well as the shared UI. The latter updates the desktop frontend build input, not an already-installed native app or its installer configuration.

`npm test` includes course completion through real movement and jumps, collision/grounding, normalized movement, checkpoints, lives, portal locking, and cleanup. Browser QA covers the full-window scene, narrow layouts, movement, camera, pause/restart, graphics failure, load cancellation/timeout, and the existing web/phone gates. Browser Firebase checks use mocks; native Tauri and live Firebase are not part of those checks.
