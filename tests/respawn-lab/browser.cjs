const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../public/respawn-lab/data.js'),'utf8'),ctx);
const data=ctx.window.TRAINER_DATA;
async function browserTests(){
 let playwright;
 try { playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
 catch(error){
  const bundled=path.join(require('os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  if(!fs.existsSync(bundled))throw new Error('Install browser-test dependencies: npm install; npx playwright install chromium');
  playwright=require(bundled);
 }
 const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']:
  process.platform==='win32'?['C:/Program Files/Google/Chrome/Application/chrome.exe']:['/usr/bin/google-chrome','/usr/bin/chromium'];
 const executablePath=process.env.BROWSER_EXECUTABLE || candidates.find(p=>fs.existsSync(p));
 const browser=await playwright.chromium.launch({...(executablePath?{executablePath}:{}),headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
 const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 // External networking is blocked; only the local site is allowed.
 const base=process.env.TRAINER_TEST_URL || 'http://127.0.0.1:4190';
 await page.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
 await page.goto(base+'/skill/respawn-lab');
 await page.frameLocator('iframe').locator('#map-title').waitFor();
 await page.waitForFunction(()=>{const f=document.querySelector('iframe');return Math.abs(f.clientHeight-f.contentDocument.querySelector('.app').getBoundingClientRect().height)<3});
 assert.equal(await page.locator('a[href="/skill/respawn-lab"]').count(),1);
 await page.getByRole('button',{name:'en',exact:true}).click();
 await page.getByRole('heading',{name:'Respawn prediction',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>{const f=document.querySelector('iframe');return Math.abs(f.clientHeight-f.contentDocument.querySelector('.app').getBoundingClientRect().height)<3});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(require('os').tmpdir(),'arena1-respawn-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1050});
 requests.length=0;errors.length=0;
 await page.goto(base+'/respawn-lab/index.html');
 await page.waitForFunction(()=>window.RespawnTrainer?.snapshot().markers.length===8);
 assert.equal(await page.locator('#map-title').textContent(),'Toxicity');
 assert.equal(await page.locator('.spawn-button.is-pool').count(),4);
 await page.screenshot({path:path.join(require('os').tmpdir(),'respawn-lab-preview-learning.png'),fullPage:true});
 await page.locator('#mode-predict').click();
 assert.equal(await page.locator('#ranking-details').isVisible(),false);
 assert.equal(await page.locator('.spawn-button.is-pool').count(),0);
 assert.equal(await page.locator('#check-button').isDisabled(),true);
 let state=await page.evaluate(()=>window.RespawnTrainer.snapshot());
 for(const id of state.pool)await page.locator(`[data-spawn="${id}"]`).click();
 await page.locator('#single-guess').selectOption(state.pool[0]);
 await page.locator('#check-button').click();
 assert.equal(await page.locator('#round-title').textContent(),'Весь пул определён правильно');
 state=await page.evaluate(()=>window.RespawnTrainer.snapshot());assert.equal(state.stats.perfect,1);assert.equal(state.stats.rounds,1);assert(state.pool.includes(state.drawn));
 await page.screenshot({path:path.join(require('os').tmpdir(),'respawn-lab-preview-result.png'),fullPage:true});
 await page.reload();await page.waitForFunction(()=>window.RespawnTrainer);
 assert.equal((await page.evaluate(()=>window.RespawnTrainer.snapshot())).stats.perfect,1);
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-progress').click()]);
 const progressPath=await download.path();const exported=JSON.parse(fs.readFileSync(progressPath,'utf8'));
 assert.equal(exported.stats.perfect,1);assert.equal(exported.app,'respawn-lab');
 await page.locator('#reset-stats').click();assert.equal((await page.evaluate(()=>window.RespawnTrainer.snapshot())).stats.rounds,0);
 await page.locator('#import-progress-file').setInputFiles({name:'progress.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
 await page.waitForFunction(()=>window.RespawnTrainer.snapshot().stats.perfect===1);
 await page.locator('#import-progress-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"app":"respawn-lab","version":1,"stats":{"rounds":-1}}')});
 await page.waitForFunction(()=>document.getElementById('progress-message').textContent.includes('Не удалось'));
 assert.equal((await page.evaluate(()=>window.RespawnTrainer.snapshot())).stats.perfect,1);
 await page.locator('#next-button').click();
 state=await page.evaluate(()=>window.RespawnTrainer.snapshot());
 const wrong=await page.evaluate(()=>window.TRAINER_DATA.maps.toxicity.spawns.map(s=>s.id).filter(id=>!window.RespawnTrainer.snapshot().pool.includes(id)));
 for(const id of wrong)await page.locator(`[data-spawn="${id}"]`).click();
 await page.locator('#check-button').click();
 assert.equal(await page.locator('.spawn-button.is-extra').count(),4);assert.equal(await page.locator('.spawn-button.is-missed').count(),4);
 await page.locator('#next-button').click();await page.locator('#hint-button').click();
 assert.equal(await page.locator('.spawn-button.is-pool').count(),4);
 await page.locator('#hint-button').click();assert.equal(await page.locator('.spawn-button.is-pool').count(),0);
 state=await page.evaluate(()=>window.RespawnTrainer.snapshot());for(const id of state.pool)await page.locator(`[data-spawn="${id}"]`).click();
 await page.locator('#check-button').click();state=await page.evaluate(()=>window.RespawnTrainer.snapshot());assert.equal(state.stats.aided,1);assert.equal(state.stats.rounds,2);
 await page.locator('#mode-learn').click();
 for(const name of Object.keys(data.maps)){
  await page.locator('#map-select').selectOption(name);
  const snapshot=await page.evaluate(()=>window.RespawnTrainer.snapshot());assert.equal(snapshot.map,name);assert.equal(snapshot.markers.length,data.maps[name].spawns.length);assert(snapshot.pool.length>0);
 }
 await page.locator('#map-select').selectOption('toxicity');
 await page.locator('#layer-select').selectOption('current');await page.locator('#layer-select').selectOption('none');await page.locator('#layer-select').selectOption('all');
 state=await page.evaluate(()=>window.RespawnTrainer.snapshot());
 await page.locator('#map-canvas').click({position:{x:state.markers[0].x,y:state.markers[0].y}});
 state=await page.evaluate(()=>window.RespawnTrainer.snapshot());assert.equal(Math.round(state.position[0]),data.maps.toxicity.spawns[0].origin[0]);
 await page.locator('#mode-predict').click();await page.keyboard.press('h');
 assert((await page.evaluate(()=>window.RespawnTrainer.snapshot())).hintUsed);
 await page.locator('#help-open').click();assert(await page.locator('#help-dialog').isVisible());await page.locator('#help-close').click();
 await page.setViewportSize({width:390,height:844});await page.locator('#mode-learn').click();
 await page.screenshot({path:path.join(require('os').tmpdir(),'respawn-lab-preview-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
 for(const b of await page.locator('button').all()) { if(await b.isVisible()){const box=await b.boundingBox();assert(box.x>=-1&&box.x+box.width<=391);} }
 assert.equal(errors.length,0,errors.join('\n'));assert.equal(requests.filter(r=>/^https?:/.test(r)&&new URL(r).origin!==new URL(base).origin).length,0);
 console.log('Browser: website embed, language, resize, HTTP launch, quiz, mistakes, hints, saved stats, all 15 maps, map clicks, keyboard, dialog, mobile layout passed. No external trainer requests.');
 await browser.close();
}
if(!process.argv.includes('--model-only'))browserTests().catch(error=>{console.error(error);process.exitCode=1});
