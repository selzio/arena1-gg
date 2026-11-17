(() => {
  'use strict';
  const data = window.TRAINER_DATA;
  const model = window.RespawnModel;
  const $ = id => document.getElementById(id);
  const storageKey = 'respawn-lab-v1';
  const blankStats = () => ({ rounds: 0, perfect: 0, hits: 0, possible: 0, aided: 0, favoriteRounds: 0, favoriteHits: 0 });
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (_) { /* session-only fallback */ }
  const state = { map: data.maps[stored.map] ? stored.map : 'toxicity', mode: stored.mode === 'predict' ? 'predict' : 'learn',
    scenario: 0, position: [0, 0, 0], selected: new Set(), checked: false, result: null, drawn: null,
    hintToggle: false, hintHeld: false, hintUsed: false, hover: null, custom: false,
    stats: { ...blankStats(), ...(stored.stats || {}) } };
  let transform = null, markers = [], renderFrame = null;
  const canvas = $('map-canvas'), ctx = canvas.getContext('2d');
  const map = () => data.maps[state.map];
  const prediction = () => model.compute(map().spawns, state.position, data.defaults.ratio, data.defaults.minimum);
  const reveal = () => state.mode === 'learn' || state.checked || state.hintToggle || state.hintHeld;
  const save = () => { try { localStorage.setItem(storageKey, JSON.stringify({ map: state.map, mode: state.mode, stats: state.stats })); } catch (_) {} };
  function announce(text) { $('announcement').textContent = text; }
  function progressMessage(text) { $('progress-message').textContent=text; $('progress-message').hidden=false; announce(text); }
  function exportProgress() {
    const content={app:'respawn-lab',version:1,exportedAt:new Date().toISOString(),map:state.map,mode:state.mode,stats:{...state.stats}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='respawn-lab-progress.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);progressMessage('Файл результатов сохранён. Его можно импортировать на другом компьютере.');
  }
  async function importProgress(event) {
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>100000)throw new Error('Слишком большой файл');
      const value=JSON.parse(await file.text());
      if(value.app!=='respawn-lab'||value.version!==1||!value.stats)throw new Error('Это не файл результатов Respawn Lab');
      const stats=blankStats();
      for(const key of Object.keys(stats)){
        if(!Number.isSafeInteger(value.stats[key])||value.stats[key]<0)throw new Error('Некорректная статистика');
        stats[key]=value.stats[key];
      }
      if(stats.perfect>stats.rounds||stats.hits>stats.possible||stats.favoriteHits>stats.favoriteRounds)throw new Error('Некорректная статистика');
      state.stats=stats;if(data.maps[value.map])state.map=value.map;
      if(['learn','predict'].includes(value.mode))state.mode=value.mode;
      populateMap();setScenario(0);save();progressMessage('Результаты загружены. Предыдущая статистика заменена данными из файла.');
    }catch(error){progressMessage('Не удалось загрузить результаты: '+error.message+'. Текущая статистика сохранена.');}
    finally{event.target.value='';}
  }
  function option(value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; }
  function resetRound() { Object.assign(state, { selected: new Set(), checked: false, result: null, drawn: null, hintToggle: false, hintHeld: false, hintUsed: false, hover: null }); $('single-guess').value = ''; }
  function setScenario(index) {
    state.scenario = index; state.position = map().scenarios[index].position.slice(); state.custom = false; resetRound(); render();
  }
  function populateMap() {
    $('scenario-select').replaceChildren(...map().scenarios.map((s, i) => option(i, s.label)));
    $('single-guess').replaceChildren(option('', 'Без одиночного прогноза'), ...map().spawns.map(s => option(s.id, s.id)));
    const zs = map().spawns.map(s => s.origin[2]);
    const extra = map().scenarios.map(s => s.position[2]);
    $('height-range').min = Math.floor(Math.min(...zs, ...extra) - 90);
    $('height-range').max = Math.ceil(Math.max(...zs, ...extra) + 90);
  }
  function setMode(mode) { state.mode = mode; resetRound(); save(); render(); }
  function next() {
    const count = map().scenarios.length;
    let index = Math.floor(Math.random() * (count - 1)); if (index >= state.scenario) index++;
    setScenario(Math.min(index, count - 1)); announce('Новая позиция. ' + (state.mode === 'predict' ? 'Отметь возможные респауны.' : 'Пул обновлён.'));
  }
  function togglePoint(id) {
    if (state.mode !== 'predict' || state.checked) return;
    const needed = prediction().pool.length;
    if (state.selected.has(id)) state.selected.delete(id);
    else if (state.selected.size < needed) state.selected.add(id);
    else { announce(`Уже выбрано ${needed} точек. Сними одну отметку.`); return; }
    render();
  }
  function setHint(value, held = false) {
    if (state.mode !== 'predict' || state.checked) return;
    state[held ? 'hintHeld' : 'hintToggle'] = value;
    if (value) state.hintUsed = true;
    render();
  }
  function check() {
    const p = prediction();
    if (state.mode === 'learn') { state.drawn = model.draw(p.pool); render(); return; }
    if (state.checked || state.selected.size !== p.pool.length) return;
    const result = model.grade(p.pool, state.selected);
    state.checked = true; state.result = result; state.drawn = model.draw(p.pool);
    if (state.hintUsed) state.stats.aided++;
    else { state.stats.rounds++; state.stats.perfect += Number(result.perfect); state.stats.hits += result.hits.length; state.stats.possible += result.total; }
    const favorite = $('single-guess').value;
    if (favorite && !state.hintUsed) { state.stats.favoriteRounds++; state.stats.favoriteHits += Number(favorite === state.drawn); }
    save(); render(); announce(`${result.hits.length} из ${result.total} верно. Выпала точка ${state.drawn}.`);
  }
  function pointStatus(id, p) {
    if (state.checked) {
      if (state.result.hits.includes(id)) return 'correct';
      if (state.result.extra.includes(id)) return 'extra';
      if (state.result.missed.includes(id)) return 'missed';
      return 'other';
    }
    if (reveal() && p.pool.some(s => s.id === id)) return 'pool';
    return state.selected.has(id) ? 'selected' : 'other';
  }
  function render() {
    const m = map(), p = prediction(), learn = state.mode === 'learn';
    $('map-select').value = state.map; $('map-title').textContent = m.name;
    $('point-count').textContent = m.spawns.length; $('pool-count').textContent = p.pool.length;
    $('mode-learn').setAttribute('aria-pressed', String(learn)); $('mode-predict').setAttribute('aria-pressed', String(!learn));
    $('mode-description').textContent = learn ? 'Меняй позицию и наблюдай, какие точки входят в пул.' : 'Отметь все возможные точки. Затем проверь свой прогноз.';
    $('scenario-select').value = state.custom ? '' : String(state.scenario);
    $('scenario-source').textContent = state.custom ? 'Свободная учебная позиция' : m.scenarios[state.scenario].source === 'demo' ? 'Реальная позиция из разобранной демки' : 'Учебная позиция у маркера карты';
    $('coordinates').replaceChildren(...state.position.map((v, i) => {
      const el = document.createElement('span'); el.className = 'coordinate'; const label = document.createElement('span'); label.textContent = ['X','Y','Z'][i]; el.append(label, String(Math.round(v))); return el;
    }));
    $('height-range').value = Math.round(state.position[2]); $('height-value').textContent = Math.round(state.position[2]); $('height-range').disabled = !learn;
    $('position-note').textContent = learn ? 'Клик по схеме меняет позицию. Стрелки — сдвиг точки.' : 'Для каждого задания позиция зафиксирована.';
    $('map-container').classList.toggle('is-learn', learn);
    $('single-guess-section').hidden = learn; $('single-guess').disabled = state.checked;
    $('hint-button').hidden = learn || state.checked; $('hint-button').setAttribute('aria-pressed', String(state.hintToggle || state.hintHeld));
    $('hint-button').textContent = state.hintToggle ? 'Скрыть подсказку · H' : 'Подсказка · H';
    $('check-button').disabled = !learn && (state.checked || state.selected.size !== p.pool.length);
    $('check-button').textContent = learn ? 'Показать пример появления' : state.checked ? 'Прогноз проверен' : 'Проверить прогноз';
    $('next-button').textContent = learn ? 'Другая позиция →' : 'Следующее задание →';
    $('round-label').textContent = learn ? 'Изучение позиций' : state.checked ? 'Разбор прогноза' : 'Отметь кандидатов до проверки';
    $('legend-pool').hidden = !reveal(); $('legend-selected').hidden = learn || state.checked;
    $('selection-count').textContent = learn ? `Пул: ${p.pool.map(s => s.id).join(', ')}` : state.checked ? '✓ верно · + пропущено · − лишнее' : `Выбрано ${state.selected.size} из ${p.pool.length}`;
    $('round-kicker').textContent = learn ? 'НАБЛЮДАЙ ЗА ПУЛОМ' : state.checked ? (state.hintUsed ? 'ПРОВЕРКА С ПОДСКАЗКОЙ' : 'РЕЗУЛЬТАТ ПРОГНОЗА') : 'СНАЧАЛА ТВОЙ ВЫБОР';
    $('round-title').textContent = learn ? `${p.pool.length} из ${m.spawns.length}: где может появиться соперник` : state.checked ? (state.result.perfect ? 'Весь пул определён правильно' : `${state.result.hits.length} из ${state.result.total} точек верно`) : `Где появится соперник? Выбери ${p.pool.length} точки`;
    const description = learn ? 'Состав группы меняется вместе с твоей позицией. Каждая выделенная точка — допустимый вариант.' : state.checked ?
      [state.result.missed.length ? `Пропущены: ${state.result.missed.join(', ')}.` : '', state.result.extra.length ? `Лишние: ${state.result.extra.join(', ')}.` : '', state.result.perfect ? 'Ты верно определил набор возможных появлений.' : '', state.hintUsed ? 'Этот раунд сохранён отдельно от самостоятельных ответов.' : ''].filter(Boolean).join(' ') : 'Отмечай точки на схеме или кнопками ниже. Текущая позиция во время ответа не меняется.';
    $('round-description').textContent = description;
    $('single-result').hidden = !state.drawn;
    const favorite = $('single-guess').value;
    $('single-result').textContent = state.drawn ? `Учебный жребий: ${state.drawn}.` + (!learn && favorite ? (favorite === state.drawn ? ' Одиночный прогноз совпал.' : ` Твой одиночный прогноз: ${favorite}.`) : '') : '';
    $('stat-perfect').textContent = `${state.stats.perfect} / ${state.stats.rounds}`;
    $('stat-points').textContent = state.stats.possible ? Math.round(100 * state.stats.hits / state.stats.possible) + '%' : '—';
    $('hint-stat').textContent = `С подсказкой: ${state.stats.aided}. Одиночных совпадений: ${state.stats.favoriteHits} / ${state.stats.favoriteRounds}.`;
    const focused = document.activeElement?.dataset?.spawn;
    $('spawn-buttons').replaceChildren(...m.spawns.map(s => {
      const button = document.createElement('button'); button.className = 'spawn-button'; const status = pointStatus(s.id, p);
      if (status !== 'other') button.classList.add('is-' + status);
      if (state.drawn === s.id) button.classList.add('is-drawn');
      const symbol = { correct:'✓ ',missed:'+ ',extra:'− ' }[status] || '';
      const id = document.createElement('span'); id.className = 'spawn-id'; id.textContent = symbol + s.id;
      const z = document.createElement('span'); z.className = 'spawn-z'; z.textContent = 'Z ' + s.origin[2];
      button.append(id, z); button.dataset.spawn = s.id;
      button.setAttribute('aria-pressed', String(state.selected.has(s.id))); button.setAttribute('aria-label', `${s.id}, высота ${s.origin[2]}${symbol ? ', ' + ({correct:'верно',missed:'пропущена',extra:'лишняя'}[status]) : ''}`);
      button.addEventListener('click', () => learn ? setScenario(m.scenarios.findIndex(sc => sc.id === 'spawn-' + s.id)) : togglePoint(s.id));
      button.addEventListener('focus', () => { state.hover = s.id; draw(); }); button.addEventListener('blur', () => { state.hover = null; draw(); });
      return button;
    }));
    if (focused) $('spawn-buttons').querySelector(`[data-spawn="${focused}"]`)?.focus({preventScroll:true});
    $('ranking-details').hidden = !reveal();
    if (!reveal()) { $('ranking-details').open = false; $('ranking-body').replaceChildren(); }
    else $('ranking-body').replaceChildren(...p.ranked.map(s => {
      const tr = document.createElement('tr'); for (const text of [s.rank, s.id, Math.round(s.distance), s.inPool ? 'Да' : '—']) { const td = document.createElement('td'); td.textContent = text; tr.append(td); } return tr;
    }));
    $('map-tooltip').hidden = true; draw();
  }
  function draw() {
    const box = canvas.getBoundingClientRect(); if (!box.width || !box.height) return;
    const width = box.width, height = box.height, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) { canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    const m = map(), p = prediction();
    const positions = [...m.spawns,...m.items].map(s => s.origin);
    const bounds = [0,1].map(i => [Math.min(...positions.map(x => x[i]))-210,Math.max(...positions.map(x => x[i]))+210]);
    const padding = width < 500 ? 29 : 42;
    const scale = Math.min((width-2*padding)/(bounds[0][1]-bounds[0][0]),(height-2*padding)/(bounds[1][1]-bounds[1][0]));
    const ox = (width-(bounds[0][1]-bounds[0][0])*scale)/2, oy = (height-(bounds[1][1]-bounds[1][0])*scale)/2;
    const project = pos => [ox+(pos[0]-bounds[0][0])*scale,height-oy-(pos[1]-bounds[1][0])*scale];
    transform = { project, unproject: (x,y) => [bounds[0][0]+(x-ox)/scale,bounds[1][0]+(height-oy-y)/scale], width, height, bounds };
    ctx.strokeStyle = '#18252f'; ctx.lineWidth = .6;
    for (let x=Math.ceil(bounds[0][0]/256)*256;x<=bounds[0][1];x+=256) { const a=project([x,bounds[1][0]]),b=project([x,bounds[1][1]]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke(); }
    for (let y=Math.ceil(bounds[1][0]/256)*256;y<=bounds[1][1];y+=256) { const a=project([bounds[0][0],y]),b=project([bounds[0][1],y]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke(); }
    const layer=$('layer-select').value, zs=m.spawns.map(s=>s.origin[2]),minZ=Math.min(...zs)-40,maxZ=Math.max(...zs)+40;
    if(layer!=='none') for(const triangle of m.floors){
      const z=triangle[0]; if(layer==='current'&&(z>state.position[2]+40||z<state.position[2]-145))continue;
      const t=Math.max(0,Math.min(1,(z-minZ)/(maxZ-minZ||1)));
      ctx.fillStyle=`rgb(${Math.round(26+t*20)},${Math.round(40+t*25)},${Math.round(49+t*27)})`;
      ctx.strokeStyle='#52687922';ctx.lineWidth=.45;
      ctx.beginPath();for(let i=1;i<7;i+=2){const v=project([triangle[i],triangle[i+1]]);i===1?ctx.moveTo(...v):ctx.lineTo(...v)}ctx.closePath();ctx.fill();ctx.stroke();
    }
    const labels=m.spawns.map(s=>{const [x,y]=project(s.origin);return[x-11,y-11,22,22]});
    {const [x,y]=project(state.position);labels.push([x-12,y-12,24,24]);}
    function label(position,text,color){
      const [x,y]=project(position);ctx.font='11px "Segoe UI", sans-serif';const w=ctx.measureText(text).width+4;
      const alternatives=[[16,-10],[16,19],[-w-15,-10],[-w-15,19],[16,-27],[-w-15,36]];
      let chosen=alternatives.find(([dx,dy])=>x+dx>=3&&x+dx+w<width-3&&y+dy>13&&y+dy<height-8&&labels.every(b=>x+dx+w<b[0]||b[0]+b[2]<x+dx||y+dy<b[1]||b[1]+b[3]<y+dy-12));
      chosen=chosen||alternatives[0]; labels.push([x+chosen[0],y+chosen[1]-12,w,15]);
      ctx.lineWidth=3;ctx.strokeStyle='#0c131ae6';ctx.strokeText(text,x+chosen[0],y+chosen[1]);ctx.fillStyle=color;ctx.fillText(text,x+chosen[0],y+chosen[1]);
    }
    const abbrev={item_armor_body:'RA',item_health_mega:'MH',item_armor_combat:'YA',weapon_rocketlauncher:'RL',weapon_lightning:'LG',weapon_railgun:'RG'};
    for(const item of m.items){if(width<500&&!['item_armor_body','item_health_mega'].includes(item.classname))continue;const [x,y]=project(item.origin);ctx.fillStyle='#9fb0b6';ctx.fillRect(x-2,y-2,4,4);label(item.origin,abbrev[item.classname],'#9fb0b6')}
    markers=[];
    for(const s of m.spawns){
      const [x,y]=project(s.origin),status=pointStatus(s.id,p);
      const colors={pool:'#71e4cf',correct:'#71e4cf',selected:'#83b7ff',missed:'#f1c578',extra:'#ff9297',other:'#7c8f9c'};
      const active=status!=='other',color=colors[status];
      ctx.beginPath();ctx.arc(x,y,active?8:6,0,Math.PI*2);ctx.fillStyle=active?color:'#344854';ctx.fill();ctx.lineWidth=active?1.6:1;ctx.strokeStyle=active?'#b4ffe757':'#788c9980';ctx.stroke();
      if(state.drawn===s.id){ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.strokeStyle='#f1c578';ctx.lineWidth=2.4;ctx.stroke()}
      if(state.hover===s.id){ctx.beginPath();ctx.arc(x,y,12,0,Math.PI*2);ctx.strokeStyle='#edf3f6';ctx.lineWidth=1;ctx.stroke()}
      label(s.origin,({correct:'✓ ',missed:'+ ',extra:'− '}[status]||'')+s.id,active?color:'#b1c1ca'); markers.push({id:s.id,x,y});
    }
    const [px,py]=project(state.position);
    ctx.beginPath();ctx.moveTo(px,py-9);ctx.lineTo(px+9,py);ctx.lineTo(px,py+9);ctx.lineTo(px-9,py);ctx.closePath();ctx.fillStyle='#ffd08c';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#0b1015';ctx.stroke();
    label(state.position,'ТЫ','#ffd08c');
  }
  function pointerPosition(event){const r=canvas.getBoundingClientRect();return[event.clientX-r.left,event.clientY-r.top]}
  function hitAt(x,y){return markers.map(m=>({...m,d:Math.hypot(m.x-x,m.y-y)})).filter(m=>m.d<19).sort((a,b)=>a.d-b.d)[0]}
  canvas.addEventListener('click',event=>{
    if(!transform)return;const [x,y]=pointerPosition(event),hit=hitAt(x,y);
    if(state.mode==='predict'){if(hit)togglePoint(hit.id);return}
    if(hit){const index=map().scenarios.findIndex(s=>s.id==='spawn-'+hit.id);setScenario(index);return}
    const [px,py]=transform.unproject(x,y);state.position=[px,py,state.position[2]];state.custom=true;resetRound();render();
  });
  canvas.addEventListener('pointermove',event=>{
    const [x,y]=pointerPosition(event),hit=hitAt(x,y);state.hover=hit?.id||null;const tip=$('map-tooltip');tip.hidden=!hit;
    if(hit){const s=map().spawns.find(s=>s.id===hit.id),entry=prediction().ranked.find(s=>s.id===hit.id);tip.textContent=`${hit.id} · высота ${s.origin[2]}`+(reveal()?` · ранг ${entry?.rank??'—'}, расстояние ${Math.round(entry?.distance??0)}`:'');tip.style.left=Math.min(transform.width-220,Math.max(8,x+15))+'px';tip.style.top=Math.max(8,y-43)+'px'}
    if(!renderFrame)renderFrame=requestAnimationFrame(()=>{renderFrame=null;draw()});
  });
  canvas.addEventListener('pointerleave',()=>{state.hover=null;$('map-tooltip').hidden=true;draw()});
  $('map-select').append(...Object.keys(data.maps).sort((a,b)=>a==='toxicity'?-1:b==='toxicity'?1:data.maps[a].name.localeCompare(data.maps[b].name)).map(key=>option(key,data.maps[key].name)));
  $('map-select').addEventListener('change',()=>{state.map=$('map-select').value;populateMap();setScenario(0);save()});
  $('scenario-select').addEventListener('change',()=>setScenario(Number($('scenario-select').value)));
  $('mode-learn').addEventListener('click',()=>setMode('learn'));$('mode-predict').addEventListener('click',()=>setMode('predict'));
  $('height-range').addEventListener('input',()=>{if(state.mode!=='learn')return;state.position[2]=Number($('height-range').value);state.custom=true;resetRound();render()});
  $('layer-select').addEventListener('change',draw);$('check-button').addEventListener('click',check);$('next-button').addEventListener('click',next);
  $('hint-button').addEventListener('click',()=>setHint(!state.hintToggle));
  $('reset-stats').addEventListener('click',()=>{state.stats=blankStats();save();render();announce('Результаты сброшены.')});
  $('export-progress').addEventListener('click',exportProgress);
  $('import-progress').addEventListener('click',()=>$('import-progress-file').click());
  $('import-progress-file').addEventListener('change',importProgress);
  $('help-open').addEventListener('click',()=>$('help-dialog').showModal());$('help-close').addEventListener('click',()=>$('help-dialog').close());
  document.addEventListener('keydown',event=>{
    if(event.target.matches('input,select,textarea')||$('help-dialog').open)return;
    if(event.code==='KeyH'&&!event.repeat){setHint(true,true);event.preventDefault()}
    if(event.code==='KeyN'&&!event.repeat){next();event.preventDefault()}
    if(state.mode==='learn'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)){
      event.preventDefault();const amount=event.shiftKey?10:65;
      const axis=['ArrowLeft','ArrowRight'].includes(event.code)?0:1;
      state.position[axis]+=amount*(['ArrowLeft','ArrowDown'].includes(event.code)?-1:1);
      if(transform)state.position[axis]=Math.max(transform.bounds[axis][0]+20,Math.min(transform.bounds[axis][1]-20,state.position[axis]));
      state.custom=true;resetRound();render();
    }
  });
  document.addEventListener('keyup',event=>{if(event.code==='KeyH')setHint(false,true)});
  window.addEventListener('blur',()=>{state.hintHeld=false;render()});
  new ResizeObserver(draw).observe($('map-container'));
  populateMap();setScenario(0);
  // Read-only state is useful for local verification and reproducing a training case.
  window.RespawnTrainer={snapshot:()=>({map:state.map,mode:state.mode,position:state.position.slice(),selected:[...state.selected],checked:state.checked,hintUsed:state.hintUsed,drawn:state.drawn,stats:{...state.stats},pool:prediction().pool.map(s=>s.id),markers:markers.map(m=>({...m}))})};
})();
