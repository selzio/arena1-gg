import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visualSettings,visualCommands,fovCommands} from '../public/visual-settings.mjs';
const values = text => Object.fromEntries(text.split('\n').map(line=>{
  const match=line.match(/^set (\w+) (.*)$/);return [match[1],match[2].replace(/^"|"$/g,'')];
}));
test('visual preferences bound renderer values and reject injected commands',()=>{
 assert.deepEqual(visualSettings(),{picmip:1,fov:105,vertexLight:false,models:'uniform'});
 assert.equal(visualSettings({picmip:-1,fov:999}).picmip,0);
 assert.equal(visualSettings({picmip:99,fov:-1}).picmip,6);
 assert.equal(visualSettings({fov:999}).fov,160);
 assert.equal(visualSettings({fov:-1}).fov,60);
 const commands=visualCommands({picmip:'0;quit',fov:'90\nquit',models:'custom;quit',vertexLight:'1'});
 assert.ok(!commands.includes('quit'));
 assert.equal(values(commands).r_vertexLight,'0');
 for(let picmip=0;picmip<=6;picmip++) assert.equal(values(visualCommands({picmip})).r_picmip,String(picmip));
});
test('original models clear overrides for bodies, heads, skins and team colors',()=>{
 const uniform=values(visualCommands({models:'uniform'}));
 assert.equal(uniform.cg_enemyModel,'keel/bright');assert.equal(uniform.cg_teamHeadModel,'keel/bright');
 const original={...uniform,...values(visualCommands({models:'original'}))};
 assert.equal(original.cg_forceModel,'0');assert.equal(original.cg_forcePovModel,'0');
 assert.equal(original.cg_useCustomRedBlueModels,'0');assert.equal(original.cg_useDefaultTeamSkins,'0');
 for(const group of ['enemy','team','redTeam','blueTeam']) {
  assert.equal(original[`cg_${group}Model`],'');assert.equal(original[`cg_${group}HeadModel`],'');
  for(const part of ['Head','Torso','Legs']) {
   assert.equal(original[`cg_${group}${part}Skin`],'');assert.equal(original[`cg_${group}${part}Color`],'');
  }
 }
});
test('FOV can be changed without restarting textures; vertex lighting can be enabled and disabled',()=>{
 const commands=fovCommands({fov:120});assert.equal(values(commands).cg_fov,'120');
 assert.equal(values(commands).cg_useDemoFov,'0');assert.ok(!commands.includes('vid_restart'));
 assert.equal(values(visualCommands({vertexLight:true})).r_vertexLight,'1');
 assert.equal(values(visualCommands({vertexLight:false})).r_vertexLight,'0');
});
