// Browser-specific media behavior, kept outside the native demo engine.
export function createAudioUnlock({getEngine, host = globalThis, onState = () => {}}) {
  const contexts = new Set();
  const track = context => {
    if (!context || contexts.has(context)) return;
    contexts.add(context); context.addEventListener?.('statechange',()=>onState(context.state));
    onState(context.state);
  };
  // SDL2's embedded JS calls this Emscripten helper, but older SDL builds can
  // omit its implementation during linking. Supply it without replacing a
  // helper supplied by a newer engine build.
  if (typeof host.autoResumeAudioContext !== 'function') host.autoResumeAudioContext = track;
  const context = () => getEngine()?.SDL2?.audioContext;
  return {
    state() { return (context() || [...contexts][0])?.state || 'unavailable'; },
    async unlock() {
      try { if (host.navigator?.audioSession) host.navigator.audioSession.type = 'playback'; } catch {}
      track(context());
      const attempts=[];
      for (const ctx of contexts) {
        if (ctx.state === 'closed' || ctx.state === 'running') continue;
        // resume() must be invoked synchronously inside the user's event.
        try { attempts.push(Promise.resolve(ctx.resume()).catch(()=>{})); } catch {}
      }
      await Promise.all(attempts);
      const state = context()?.state || [...contexts][0]?.state || 'unavailable';
      onState(state); return state === 'running';
    }
  };
}

export function createFullscreen({screen, doc = document, host = window, onChange = () => {}}) {
  let expanded=false, previousBodyOverflow='', frameRestore=null;
  const nativeElement=()=>doc.fullscreenElement || doc.webkitFullscreenElement;
  const sync=()=>onChange(Boolean(nativeElement() || expanded));
  const restore=()=>{
    expanded=false;screen.classList.remove('viewport-fullscreen');
    doc.body.style.overflow=previousBodyOverflow;
    if (frameRestore) {
      const {frame,css,body,overflow}=frameRestore;
      frame.style.cssText=css;body.style.overflow=overflow;frameRestore=null;
    }
    sync();
  };
  const expand=()=>{
    previousBodyOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';
    // Same-origin embedded players must expand their iframe as well.
    try {
      const frame=host.frameElement;
      if (frame && frame.ownerDocument?.body) {
        const body=frame.ownerDocument.body;
        frameRestore={frame,css:frame.style.cssText,body,overflow:body.style.overflow};
        frame.style.cssText+=';position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;border:0;z-index:2147483647';
        body.style.overflow='hidden';
      }
    } catch { /* Cross-origin embeds can still expand inside their own viewport. */ }
    expanded=true;screen.classList.add('viewport-fullscreen');sync();
  };
  doc.addEventListener?.('fullscreenchange',sync);
  doc.addEventListener?.('webkitfullscreenchange',sync);
  host.addEventListener?.('keydown',event=>{if(event.key==='Escape' && expanded) restore();});
  return {
    async toggle() {
      if (expanded) {restore();return 'inline';}
      if (nativeElement()) {
        const exit=doc.exitFullscreen || doc.webkitExitFullscreen;
        try { await exit?.call(doc); } catch {}
        sync();return 'inline';
      }
      const request=screen.requestFullscreen || screen.webkitRequestFullscreen || screen.webkitRequestFullScreen;
      if (request) {
        try {
          const requested=request.call(screen);
          if (requested?.then) await requested;
          else await new Promise(resolve=>setTimeout(resolve,80));
          if (nativeElement()) {sync();return 'native';}
        } catch { /* Safari/iframe policy: expand instead. */ }
      }
      expand();return 'expanded';
    }
  };
}

export function brightnessValue(value) {
  const number=Number(value);
  return Number.isFinite(number) ? Math.min(200,Math.max(80,number)) : 135;
}
