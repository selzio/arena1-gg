import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAudioUnlock,createFullscreen,brightnessValue} from '../public/player-platform.mjs';

test('missing SDL helper is supplied and audio resumes inside the gesture',async()=>{
  const context={state:'suspended',addEventListener(){},resume(){assert.equal(inGesture,true);this.state='running';return Promise.resolve();}};
  const host={navigator:{audioSession:{type:'auto'}}};
  const audio=createAudioUnlock({host,getEngine:()=>({SDL2:{audioContext:context}})});
  assert.equal(typeof host.autoResumeAudioContext,'function');
  host.autoResumeAudioContext(context);
  let inGesture=true; const unlocked=audio.unlock(); inGesture=false;
  assert.equal(await unlocked,true); assert.equal(audio.state(),'running');
  assert.equal(host.navigator.audioSession.type,'playback');
});
test('blocked audio remains retryable without breaking the player',async()=>{
  const context={state:'interrupted',resume:()=>Promise.reject(Error('gesture required'))};
  const audio=createAudioUnlock({host:{},getEngine:()=>({SDL2:{audioContext:context}})});
  assert.equal(await audio.unlock(),false); assert.equal(audio.state(),'interrupted');
});
test('a newer Emscripten audio helper is not overwritten',()=>{
  const original=()=>{};const host={autoResumeAudioContext:original};
  createAudioUnlock({host,getEngine:()=>null});assert.equal(host.autoResumeAudioContext,original);
});
function elements(){
 const classes=new Set(); const screen={classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
 const doc={body:{style:{overflow:'auto'}},addEventListener(){}};
 const host={addEventListener(){}};
 return {screen,doc,host,classes};
}
test('native fullscreen is requested synchronously and can be exited',async()=>{
 const x=elements();let gesture=true;
 x.screen.requestFullscreen=()=>{assert.equal(gesture,true);x.doc.fullscreenElement=x.screen;return Promise.resolve();};
 x.doc.exitFullscreen=async()=>{x.doc.fullscreenElement=null;};
 const fs=createFullscreen(x);const result=fs.toggle();gesture=false;
 assert.equal(await result,'native');assert.equal(await fs.toggle(),'inline');
});
test('Safari-prefixed fullscreen API is used when available',async()=>{
 const x=elements();x.screen.webkitRequestFullscreen=()=>{x.doc.webkitFullscreenElement=x.screen;return Promise.resolve();};
 const fs=createFullscreen(x);assert.equal(await fs.toggle(),'native');
});
test('fullscreen rejection expands iframe and restores the prior layout on exit',async()=>{
 const x=elements();x.screen.requestFullscreen=()=>Promise.reject(Error('disabled by embed'));
 const body={style:{overflow:'scroll'}}; const frame={style:{cssText:'width:100%'},ownerDocument:{body}};x.host.frameElement=frame;
 const fs=createFullscreen(x);assert.equal(await fs.toggle(),'expanded');
 assert.equal(x.classes.has('viewport-fullscreen'),true);assert.match(frame.style.cssText,/position:fixed/);
 assert.equal(body.style.overflow,'hidden');assert.equal(await fs.toggle(),'inline');
 assert.equal(frame.style.cssText,'width:100%');assert.equal(body.style.overflow,'scroll');assert.equal(x.doc.body.style.overflow,'auto');
});
test('brightness is bounded and has a brighter default',()=>{
 assert.equal(brightnessValue('invalid'),135);assert.equal(brightnessValue(500),200);
 assert.equal(brightnessValue(-5),80);assert.equal(brightnessValue(145),145);
});
