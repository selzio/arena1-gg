const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const {pathToFileURL}=require('url');
const assets=path.join(__dirname,'..','..','public','respawn-lab');
const modelContext={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(assets,'spawn-model.js'),'utf8'),modelContext);const model=modelContext.module.exports;
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(assets,'data.js'),'utf8'),ctx);
const data=ctx.window.TRAINER_DATA;
const checks=JSON.parse(fs.readFileSync(path.join(__dirname,'maps-emulation-results.json'),'utf8'));
for(const check of checks){const result=model.compute(data.maps[check.map].spawns,check.position);assert.deepEqual(new Set(result.pool.map(p=>p.id)),new Set(check.expected_pool));}
const demo=JSON.parse(fs.readFileSync(path.join(__dirname,'demo-respawn-results.json'),'utf8'));
for(const r of demo.respawns.filter(r=>r.status==='ranked'))assert.deepEqual(new Set(model.compute(data.maps.toxicity.spawns,r.killer_position).pool.map(p=>p.id)),new Set(r.pool));
const synthetic=[100,200,300,400].map((x,i)=>({id:'R'+(i+1),origin:[x,0,0]}));
assert.deepEqual(model.compute(synthetic,[0,0,0]).pool.map(p=>p.id),['R4','R3','R2']);
assert.equal(model.grade(['R1','R2'],['R2','R3']).hits.length,1);
assert.equal(model.grade(['R1','R2'],['R1','R2']).perfect,true);
assert.equal(model.draw([{id:'R1'},{id:'R2'}],()=>0),'R1');
assert.equal(model.draw([{id:'R1'},{id:'R2'}],()=>.9999),'R2');
console.log('Model: 45 emulator cases, 8 demo cases, small-pool and grading checks passed.');

