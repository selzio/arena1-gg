import { parseCfg, safePath, normalizeHudEntries, hudReferences } from './hud.mjs';
import { unzipSync } from './vendor/fflate.mjs';
import { ResourceCache, mib } from './resource-cache.mjs';
import { createLibraryUI } from './library-ui.mjs';
import { PlaybackEndTracker } from './playback-end.mjs';
import { createAudioUnlock, createFullscreen, brightnessValue } from './player-platform.mjs';

const $ = id => document.getElementById(id);
const BASE = '/demo-viewer';
if (new URLSearchParams(location.search).get('embed') === '1') {
  document.querySelector('.heading').hidden = true;
}
const decoder = new TextDecoder();
let engine, starting = false, busy = false, demoFile, profileFiles = [], customCommands = [];
let xray = true, lastState = {}, lastPoll = 0, loadedResources = new Set(), pendingFailure = false;
let reportedProfile = false;
const endTracker = new PlaybackEndTracker();
let currentLibraryId = null, pendingResume = 0, lastPositionSave = 0;
const demoLibrary = createLibraryUI(openDemo);
const originalHudFiles = new Map();
const session = crypto.randomUUID();
const logs = [];
const controls = ['pause','back','forward','seek','speed','volume'];

function log(text) {
  logs.push(String(text));
  if (logs.length > 1000) logs.shift();
  $('log').textContent = logs.join('\n');
  const plain = String(text).replace(/\x1b\[[0-9;]*m/g, '');
  if (!pendingFailure && /Com_Error\(\):|Hunk_Alloc failed|Z_Malloc.*failed/i.test(plain)) {
    error(`Engine error: ${plain}`);
  }
}
function error(text) {
  pendingFailure = true;
  $('message').textContent = String(text);
  $('message').hidden = false;
  $('loading').hidden = true;
  busy = false;
  controls.forEach(id => $(id).disabled = true);
  log(text);
}
function status(text, percent = null) {
  $('loading').hidden = false;
  const separator = text.indexOf(' · ');
  $('status').textContent = separator < 0 ? text : text.slice(0,separator);
  $('asset-progress').textContent = separator < 0 ? '' : `Game resources: ${text.slice(separator+3)}`;
  if (percent === null) $('progress').removeAttribute('value');
  else $('progress').value = percent;
}
async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Server error: ${response.status}`;
    try { message = (await response.json()).message || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}
const resourceCache = new ResourceCache({report: log});
function writeFile(module, path, data) {
  module.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')));
  module.FS.writeFile(path, data);
}
async function loadResource(module, file, label) {
  if (loadedResources.has(file.src)) return false;
  const bytes = await resourceCache.read(file.src, {size: file.size, label, progress: status});
  writeFile(module, file.dst, bytes);
  loadedResources.add(file.src);
  return true;
}
const knownPlayers = new Set();
async function ensurePlayers(model, head) {
  const names = [...new Set([model, head].map(n => n.replace(/^\*/, '').replace(/^heads\//, '').split('/')[0].toLowerCase())
    .filter(n => /^[a-z0-9_-]{1,64}$/.test(n) && !knownPlayers.has(n)))];
  if (!names.length) return 0;
  const wasBusy = busy; busy = true;
  try {
    const {files} = await request(`${BASE}/api/players/prepare`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({models: names})
    });
    let changed = false;
    for (const file of files) changed = await loadResource(engine, file, 'player models') || changed;
    names.forEach(n => knownPlayers.add(n));
    return changed ? 1 : 0;
  } finally { busy = wasBusy; }
}
async function ensureMap(name, workshops) {
  busy = true;
  status(`Checking map ${name}`);
  let job = await request(`${BASE}/api/maps/prepare`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({map: name, workshops})
  });
  const deadline = Date.now() + 300000;
  while (job.state !== 'ready') {
    if (job.state === 'error') throw new Error(job.message);
    if (Date.now() > deadline) throw new Error('Map preparation took more than five minutes. Try opening the demo again.');
    status(`${job.message} · ${name}`);
    await new Promise(resolve => setTimeout(resolve, 600));
    job = await request(`${BASE}/api/jobs/${job.id}`);
  }
  let changed = false;
  for (const file of job.files) changed = await loadResource(engine, file, `Map ${name}`) || changed;
  status('Starting demo');
  setTimeout(() => { busy = false; }, 250);
  return changed ? 1 : 0;
}
function command(text) {
  if (!engine || busy || starting) return;
  engine.ccall('arena_command', null, ['string'], [text]);
}
function profileCommand() {
  return ['exec default.cfg', 'exec arena-viewer.cfg', ...customCommands.map(c => `seta ${c.name} "${c.value}"`),
    `set cg_wh ${xray ? 4 : 0}`, 'set cg_fxThreads 0', 'set cg_freecam 0',
    'set s_sdlCapture 0', 'set s_alCapture 0', 'set cl_voip 0'].join('\n');
}
function mountCustom(module) {
  for (const [name, data] of profileFiles) {
    const path = `/baseq3/${name}`;
    if (!originalHudFiles.has(path)) originalHudFiles.set(path,
      module.FS.analyzePath(path).exists ? module.FS.readFile(path).slice() : null);
    writeFile(module, path, data);
  }
  writeFile(module, '/baseq3/visitor-profile.cfg', new TextEncoder().encode(profileCommand()));
}
function restoreHudFiles() {
  if (!engine) return;
  for (const [path, data] of originalHudFiles) {
    if (data === null) { try { engine.FS.unlink(path); } catch {} }
    else writeFile(engine, path, data);
  }
  originalHudFiles.clear();
}
async function openDemo(file, options = {}) {
  if (!file || starting || busy) return;
  if (!/\.dm_(68|73|90|91)$/i.test(file.name)) return error('Choose a Quake Live / Quake III demo in a supported format.');
  if (file.size > 256 * 1024**2) return error('The demo exceeds 256 MB.');
  if (file.size < 12) return error('The demo file is empty or corrupt.');
  $('message').hidden = true; pendingFailure = false;
  endTracker.reset(); lastState = {};
  $('demo-ended').hidden = true; $('screen').classList.remove('demo-ended');
  $('empty').hidden = true; controls.forEach(id => $(id).disabled = true);
  $('filename').textContent = file.name;
  demoFile = file;
  currentLibraryId = options.libraryId || null; pendingResume = options.resumeMs || 0;
  reportedProfile = false;
  starting = true;
  status('Preparing player');
  $('demo-load-size').textContent = mib(file.size);
  $('loading-note').textContent = 'The larger download below is the player’s game assets, not your demo. Assets are saved for reuse when browser storage is available.';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = file.name.match(/\.dm_\d+$/i)[0].toLowerCase();
    const filename = `visitor${extension}`;
    if (engine) {
      // Disconnect first, then replace the old file while no demo handle is open.
      engine.ccall('arena_command', null, ['string'], ['disconnect']);
      await new Promise(resolve => setTimeout(resolve, 150));
      writeFile(engine, `/baseq3/demos/${filename}`, bytes);
      mountCustom(engine);
      engine.ccall('arena_command', null, ['string'], [`set cl_freezeDemo 0\nset timescale 1\nexec visitor-profile.cfg\ndemo ${filename}`]);
    } else {
      const manifest = await request(`${BASE}/api/manifest`);
      if (!manifest.engineReady) throw new Error('The browser player build is not installed on the server yet.');
      const factory = (await import(`./engine/arena-wolfcam_opengl2.js?v=${manifest.engineVersion}`)).default;
      engine = await factory({
        canvas: $('canvas'),
        arguments: ['+set','fs_basepath','/','+set','fs_homepath','/',
          '+set','fs_homestatepath','/','+set','com_basegame','baseq3',
          '+set','net_enabled','0','+set','sv_pure','0',
          // Demo playback never needs an input device. Set before sound initialization.
          '+set','s_sdlCapture','0','+set','s_alCapture','0','+set','cl_voip','0',
          '+set','com_hunkMegs','512','+set','com_zoneMegs','128',
          '+set','r_mode','-1','+set','r_customwidth','1280','+set','r_customheight','720',
          '+set','r_fullscreen','0','+set','cl_downloadWorkshops','0',
          '+exec','visitor-profile.cfg','+demo',filename],
        locateFile: name => `${BASE}/engine/${name}?v=${manifest.engineVersion}`,
        print: log, printErr: text => {
          log(text);
          if (/program exited \(with status: [1-9]|Aborted\(/.test(String(text))) error(`Engine error: ${text}`);
        },
        onAbort: text => error(`Player stopped: ${text}`),
        arenaError: error,
        arenaEnsureMap: ensureMap,
        arenaEnsurePlayers: ensurePlayers,
        preRun: [module => {
          // Set the instance before C calls the asynchronous resource callback.
          engine = module;
          module.addRunDependency('arena-files');
          (async () => {
            try {
              for (const resource of manifest.files) await loadResource(module, resource, 'shared files');
              for (const resource of await request(manifest.profile)) await loadResource(module, resource, 'default HUD');
              writeFile(module, `/baseq3/demos/${filename}`, bytes);
              mountCustom(module);
            } catch (err) { error(err.message); throw err; }
            finally { module.removeRunDependency('arena-files'); }
          })();
        }]
      });
    }
    if (!pendingFailure && !currentLibraryId) {
      const row = await demoLibrary.save(file, bytes, options.origin);
      currentLibraryId = row?.id || null;
    }
    log(`Opened locally: ${file.name} (${file.size} bytes). Session ${session}`);
  } catch (err) { error(err.message); }
  finally { starting = false; }
}

async function importHud(files) {
  if (!files.length || busy || starting) return;
  try {
    let entries = [];
    for (const file of files) {
      if (file.size > 32 * 1024**2) throw new Error('The HUD bundle exceeds 32 MB.');
      const data = new Uint8Array(await file.arrayBuffer());
      if (/\.zip$/i.test(file.name)) {
        let expanded = 0;
        const unpacked = unzipSync(data, { filter: info => {
          expanded += info.originalSize;
          if (expanded > 64 * 1024**2) throw new Error('The extracted HUD exceeds 64 MB.');
          return !info.name.endsWith('/');
        }});
        entries.push(...Object.entries(unpacked));
      } else entries.push([file.name, data]);
    }
    entries = normalizeHudEntries(entries);
    if (entries.length > 512) throw new Error('The HUD bundle contains more than 512 files.');
    const commands = [], ignored = [], staged = [];
    for (const [name, data] of entries) {
      safePath(name);
      if (/\.cfg$/i.test(name) && !/^ui\//i.test(name) && !/loadMenu\s*\{/i.test(decoder.decode(data))) {
        const result = parseCfg(decoder.decode(data));
        commands.push(...result.applied); ignored.push(...result.ignored);
      } else if (/\.(menu|cfg|h|ttf|otf|tga|jpg|jpeg|png)$/i.test(name)) {
        if (/\.(menu|cfg)$/i.test(name) && /\b(?:onOpen|onClose|onESC|action|run)\s*\{/i.test(decoder.decode(data)))
          throw new Error('This HUD contains executable menu actions. Importing this version is not supported yet.');
        staged.push([name, data]);
      } else ignored.push(name);
    }
    const menuFiles = staged.filter(([name]) => name.endsWith('.menu'));
    if (menuFiles.length && !commands.some(c => c.name.toLowerCase() === 'cg_hudfiles')) {
      const menuCfg = staged.find(([name]) => name.endsWith('.cfg'));
      if (menuCfg) commands.push({name: 'cg_hudFiles', value: menuCfg[0]});
      else {
        staged.push(['ui/visitor.cfg', new TextEncoder().encode(`{ loadMenu { ${menuFiles.map(([name]) => `"${name}"`).join(' ')} } }`)]);
        commands.push({name:'cg_hudFiles',value:'ui/visitor.cfg'});
      }
    }
    const missing = [];
    const names = new Set(staged.map(([name]) => name.toLowerCase()));
    for (const [name, data] of staged.filter(([name]) => /\.(cfg|menu)$/i.test(name))) {
      for (const ref of hudReferences(decoder.decode(data))) {
        if (/\.(menu|ttf|otf)$/i.test(ref) && !names.has(ref.toLowerCase()) &&
            !(engine && engine.FS.analyzePath('/baseq3/'+ref).exists) && !/^(fonts|wcfonts)\//i.test(ref)) missing.push(`${name} → ${ref}`);
      }
    }
    if (missing.length) throw new Error(`Missing HUD files:\n${missing.join('\n')}`);
    if (!staged.length && !commands.length) throw new Error('No supported settings or HUD files found.');
    const resetPrevious = customCommands.map(c => `reset ${c.name}`).join('\n');
    restoreHudFiles();
    profileFiles = staged; customCommands = commands;
    if (engine) {
      mountCustom(engine);
      command(resetPrevious + '\nexec visitor-profile.cfg\nloadhud');
    }
    $('profile-name').textContent = 'Custom profile';
    $('profile-description').textContent = files.map(f => f.name).join(', ');
    $('profile-badge').textContent = 'SELECTED';
    $('reset-hud').hidden = false;
    $('hud-report').hidden = false;
    $('hud-report-content').textContent = `Settings: ${commands.length}. Files: ${staged.length}. Skipped: ${ignored.length}.` + (ignored.length ? `\n${ignored.slice(0,30).join('\n')}` : '');
    $('hud-report-content').style.whiteSpace = 'pre-wrap';
    $('message').hidden = true;
  } catch (err) {
    $('message').textContent = `Profile import: ${err.message}`; $('message').hidden = false;
  } finally { $('hud').value = ''; }
}

for (const id of ['demo','demo-next','demo-ended-file']) $(id).addEventListener('change', event => {
  const file=event.target.files[0]; event.target.value=''; openDemo(file);
});
$('demo-replay').addEventListener('click',()=>{
  if (demoFile) openDemo(demoFile,{libraryId:currentLibraryId,resumeMs:0});
});
$('demo-ended-library').addEventListener('click',()=>{
  if ($('library-panel').hidden) $('library-toggle').click();
});
$('screen').addEventListener('dragover', event => { event.preventDefault(); $('screen').classList.add('drag'); });
$('screen').addEventListener('dragleave', () => $('screen').classList.remove('drag'));
$('screen').addEventListener('drop', event => { event.preventDefault(); $('screen').classList.remove('drag'); openDemo(event.dataTransfer.files[0]); });
$('hud').addEventListener('change', event => importHud([...event.target.files]));
$('reset-hud').addEventListener('click', () => {
  const resetPrevious = customCommands.map(c => `reset ${c.name}`).join('\n');
  restoreHudFiles();
  profileFiles = []; customCommands = [];
  $('profile-name').textContent = 'Default'; $('profile-description').textContent = 'Quake Live · stock HUD';
  $('profile-badge').textContent = 'ACTIVE'; $('reset-hud').hidden = true; $('hud-report').hidden = true;
  command(resetPrevious + '\n' + profileCommand() + '\nloadhud');
});
$('xray').addEventListener('click', () => {
  xray = !xray; $('xray').classList.toggle('on', xray); $('xray').setAttribute('aria-checked', xray);
  command(`set cg_wh ${xray ? 4 : 0}`);
});
$('pause').addEventListener('click', togglePause);
$('speed').addEventListener('change', event => command(`timescale ${Number(event.target.value)}`));
let previousVolume=Number($('volume').value) || 60;
function updateAudioState() {
  const running=audio.state()==='running';
  const active=Boolean(lastState.active && !pendingFailure);
  $('audio-unlock').hidden=!active || running || Number($('volume').value)===0;
  $('sound-toggle').classList.toggle('sound-blocked',active && !running);
  const label=!running ? 'Enable sound' : Number($('volume').value)===0 ? 'Unmute' : 'Mute';
  $('sound-toggle').setAttribute('aria-label',label);$('sound-toggle').title=label;
}
const audio=createAudioUnlock({getEngine:()=>engine,onState:()=>updateAudioState()});
// Do not await unlock before requesting fullscreen: Safari needs the original gesture.
$('screen').addEventListener('pointerdown',event=>{
  // The sound button decides between unlock and mute on click; do not change
  // its state in pointerdown first, or the first tap could immediately mute.
  if (event.target?.closest?.('#sound-toggle, #audio-unlock')) return;
  audio.unlock().catch(log);
},{capture:true});
$('audio-unlock').addEventListener('click',()=>{audio.unlock().catch(log);});
$('sound-toggle').addEventListener('click',()=>{
  if (audio.state()!=='running') {audio.unlock().catch(log);return;}
  const volume=Number($('volume').value);
  if (volume>0) {previousVolume=volume;$('volume').value='0';}
  else $('volume').value=String(previousVolume);
  command(`s_volume ${Number($('volume').value)/100}`);updateAudioState();
});
$('volume').addEventListener('input',event=>{
  audio.unlock().catch(log);command(`s_volume ${Number(event.target.value)/100}`);updateAudioState();
});
function applyBrightness(value) {
  const level=brightnessValue(value);$('brightness').value=String(level);
  $('brightness-value').textContent=`${level}%`; $('canvas').style.filter=`brightness(${level/100})`;
}
let storedBrightness=135;
try {storedBrightness=localStorage.getItem('arena1-brightness') || 135;} catch {}
applyBrightness(storedBrightness);
$('brightness').addEventListener('input',event=>{
  applyBrightness(event.target.value);
  try {localStorage.setItem('arena1-brightness',String(brightnessValue(event.target.value)));} catch {}
});
function seek(ms) {
  const target = Math.max(lastState.start, Math.min(ms, lastState.end - 1));
  command(`seek ${(target - lastState.start) / 1000}`);
}
$('back').addEventListener('click', () => skip(-10));
$('forward').addEventListener('click', () => skip(10));
$('seek').addEventListener('change', event => seek(lastState.start + (lastState.end-lastState.start) * Number(event.target.value) / 1000));
const fullscreenController=createFullscreen({screen:$('screen'),onChange:active=>{
  $('fullscreen').setAttribute('aria-label',active ? 'Exit fullscreen' : 'Fullscreen');
  $('fullscreen').title=active ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
  $('fullscreen').setAttribute('aria-pressed',String(active));
}});
function fullscreen() { return fullscreenController.toggle().catch(log); }
$('fullscreen').addEventListener('click', fullscreen);
function settings(open) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  $('screen').classList.toggle('settings-open', open);
}
$('settings-toggle').addEventListener('click', () => settings($('settings').hidden));
$('settings-close').addEventListener('click', () => settings(false));
let feedbackTimer, clickTimer, idleTimer, lastTap = {time:0, side:0};
function showControls() {
  $('screen').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (lastState.active && !lastState.paused && $('settings').hidden) $('screen').classList.add('idle');
  }, 2500);
}
function skip(seconds) {
  if (!lastState.active || busy) return;
  command(`${seconds < 0 ? 'rewind' : 'fastforward'} ${Math.abs(seconds)}`);
  $('seek-feedback').textContent = `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)} seconds`;
  $('seek-feedback').classList.toggle('left', seconds < 0);
  $('seek-feedback').hidden = false;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => $('seek-feedback').hidden = true, 650);
  showControls();
}
function togglePause() {
  if (lastState.active) command('pause');
  showControls();
}
$('screen').addEventListener('pointermove', showControls);
$('screen').addEventListener('focusin', showControls);
$('gestures').addEventListener('click', event => {
  if (!lastState.active) return;
  settings(false);
  $('screen').focus({preventScroll:true});
  showControls();
  const bounds = $('gestures').getBoundingClientRect();
  const side = (event.clientX - bounds.left) / bounds.width < .35 ? -1 :
    (event.clientX - bounds.left) / bounds.width > .65 ? 1 : 0;
  const now = Date.now();
  clearTimeout(clickTimer);
  if (now - lastTap.time < 300 && side === lastTap.side) {
    if (side) skip(side * 10);
    else fullscreen();
    lastTap = {time:0,side:0};
  } else {
    lastTap = {time:now,side};
    clickTimer = setTimeout(togglePause, 300);
  }
});
window.addEventListener('keydown', event => {
  if (!lastState.active || event.altKey || event.ctrlKey || event.metaKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return;
  const key = event.key.toLowerCase();
  if (!$('library-panel').hidden) { if (key === 'escape') $('library-close').click(); return; }
  const actions = {arrowleft:()=>skip(-5),arrowright:()=>skip(5),j:()=>skip(-10),l:()=>skip(10),
    ' ':togglePause,k:togglePause,f:fullscreen,escape:()=>settings(false)};
  if (!actions[key]) return;
  event.preventDefault(); event.stopImmediatePropagation(); actions[key]();
}, true);
function showDemoEnd(result) {
  $('loading').hidden=true; $('empty').hidden=true; $('audio-unlock').hidden=true;
  $('settings').hidden=true; $('screen').classList.remove('settings-open','idle');
  $('settings-toggle').setAttribute('aria-expanded','false');
  $('demo-ended-title').textContent=result.completed ? 'Demo finished' : 'Playback stopped';
  $('demo-ended-name').textContent=demoFile?.name || '';
  $('demo-ended').hidden=false; $('screen').classList.add('demo-ended');
  controls.forEach(id=>$(id).disabled=true);
  if (result.completed) {
    $('seek').value='1000';
    $('time').textContent=`${clock(result.duration)} / ${clock(result.duration)}`;
    if (currentLibraryId) demoLibrary.position(currentLibraryId,0);
  }
  showControls(); $('demo-replay').focus({preventScroll:true});
}
const clock = ms => { const s = Math.max(0,Math.floor(ms/1000)); return `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`; };
setInterval(() => {
  if (!engine || starting || busy || pendingFailure) return;
  try {
    const state = JSON.parse(engine.ccall('arena_state', 'string', [], []));
    const ended=endTracker.observe(state);
    lastState = state;
    if (ended) {showDemoEnd(ended);return;}
    updateAudioState();
    if (state.active && pendingResume > 0) {
      const offset = Math.min(pendingResume, Math.max(0,state.end-state.start-1000));
      pendingResume = 0; if (offset > 0) command(`fastforward ${offset / 1000}`);
    }
    if (state.active && currentLibraryId && Date.now() - lastPositionSave > 5000) {
      lastPositionSave = Date.now(); demoLibrary.position(currentLibraryId, state.time-state.start);
    }
    if (state.active && !pendingFailure) {
      if (!reportedProfile) {
        reportedProfile = true;
        command('cg_hudFiles\ncg_lagometer\ncg_drawSpeed\ncg_drawCrosshair\ncg_crosshairAlpha');
      }
      $('empty').hidden = true; $('loading').hidden = true;
      controls.forEach(id => $(id).disabled = false);
      $('pause').textContent = state.paused ? '▶' : 'Ⅱ';
      $('pause').setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
      $('screen').classList.toggle('paused', !!state.paused);
      $('speed').value = String(state.speed);
      $('time').textContent = `${clock(state.time-state.start)} / ${clock(state.end-state.start)}`;
      if (document.activeElement !== $('seek')) $('seek').value = (state.time-state.start)/Math.max(1,state.end-state.start)*1000;
    }
  } catch (err) { if (Date.now()-lastPoll > 5000) { log(err.message); lastPoll = Date.now(); } }
}, 250);
