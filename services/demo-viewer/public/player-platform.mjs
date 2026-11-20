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
  const viewportSize=view=>{
    const v=view?.visualViewport;
    return {width:v?.width || view?.innerWidth,height:v?.height || view?.innerHeight,
      left:v?.offsetLeft || 0,top:v?.offsetTop || 0};
  };
  const fitViewport=()=>{
    if (!expanded) return;
    const v=viewportSize(host);
    for (const [key,value] of Object.entries(v)) {
      if (Number.isFinite(value)) screen.style?.setProperty(`--player-${key}`,`${value}px`);
    }
    if (frameRestore) {
      const {frame,css}=frameRestore;
      const parent=viewportSize(frame.ownerDocument.defaultView);
      frame.style.cssText=css+`;position:fixed!important;left:${parent.left}px!important;top:${parent.top}px!important;right:auto!important;bottom:auto!important;width:${parent.width ? parent.width+'px' : '100vw'}!important;height:${parent.height ? parent.height+'px' : '100dvh'}!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;border:0!important;z-index:2147483647!important`;
    }
  };
  const nativeElement=()=>doc.fullscreenElement || doc.webkitFullscreenElement;
  const sync=()=>onChange(Boolean(nativeElement() || expanded));
  const restore=()=>{
    expanded=false;screen.classList.remove('viewport-fullscreen');
    for (const key of ['width','height','left','top']) screen.style?.removeProperty(`--player-${key}`);
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
        body.style.overflow='hidden';
      }
    } catch { /* Cross-origin embeds can still expand inside their own viewport. */ }
    expanded=true;screen.classList.add('viewport-fullscreen');fitViewport();sync();
  };
  for (const view of new Set([host,host.frameElement?.ownerDocument?.defaultView].filter(Boolean))) {
    view.addEventListener?.('resize',fitViewport);
    view.visualViewport?.addEventListener?.('resize',fitViewport);
    view.visualViewport?.addEventListener?.('scroll',fitViewport);
  }
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
