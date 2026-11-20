# Arena1 Demo Viewer

Local browser player built from the user's existing WolfcamQL, QVA HUD/X-Ray
and arena1.gg source. Demos stay in the visitor's browser. The Python resource
server reuses the installed stock Quake Live packages and downloads missing
Workshop maps through the same SteamCMD mechanism used by Wolfcam.

Run `python3 server.py`, then open `http://127.0.0.1:8766/demo-viewer/`.
`Start Demo Viewer.command` runs the same server on macOS.

- Engine source: `engine/` (GPL; upstream credits and COPYING included).
- Browser application: `public/`.
- Resources: `~/Quake Bank/Arena1 Demo Viewer/` (outside iCloud).
- Engine build: `scripts/build_engine.sh`, using project-local Emscripten SDK.
- Tests: `npm test` and `python3 -m unittest discover -s tests -p 'test_*.py' -v`.
- Stock profile: original Quake Live default.cfg and ui/hud.txt / ui/hud.menu,
  copied byte-for-byte from pak00.pk3. Browser overrides live separately in
  arena-viewer.cfg: X-Ray, no blood/gibs, no lagometer or UPS indicator.
  Stock materials include alternate image extensions and Wolfcam support shaders;
  standalone banner/skin/FX packs are excluded. The desktop/video profile is not changed.
- Site integration: `../arena1-public-source`, route `/skill/demos`.
- Public reverse proxy/tunnel examples: `deploy/` and `scripts/reverse-tunnel.sh`.
  Public deployment has not been completed; the documented VPS SSH check timed out.

The durable product description, implementation report, acceptance evidence and
canonical task status are in the existing Arena1 project in the user's Obsidian
vault, under `02-product` and `04-tech`.

Full arbitrary cfg compatibility is not claimed: the importer accepts visual
settings, reports skipped commands and keeps the player controls outside cfg
execution. Private HUD actions/scripts are currently rejected explicitly.

Loading now uses a 69.2 MiB shared pack with player models loaded on demand.
The immutable packs are kept in Cache Storage (bounded to 384 MiB); interrupted
packs are not saved. The stock profile is a single 3.9 MiB pack. Engine requests
use a build version, and progress distinguishes local demos from game downloads.

The player Library stores selected demos in IndexedDB, with content-based dedup,
a 1 GiB limit, search, Play/Resume, download and removal. Clearing site data can
remove these copies; browser storage is not an archive. Autosave can be disabled.

Proton integration currently connects a user-selected folder synchronized by the
Proton Drive desktop app in browsers supporting the File System Access API. It
lists demos and saves copies without overwriting originals. It is not Proton
account OAuth or a server-side cloud connector, and no Proton password is collected.

The published service is tracked in selzio/arena1-gg under services/demo-viewer.
After a clean commit and push, run scripts/deploy-demo-viewer-mac.py from that
repository on this Mac. It backs up changed files, restarts only the existing
com.selzio.arena1.demo-viewer service and verifies the engine version. CI builds
and packages releases; it no longer attempts SSH deployment to the retired VPS.
