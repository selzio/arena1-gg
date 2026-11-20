import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCfg, safePath, normalizeHudEntries } from '../public/hud.mjs';

test('visual cfg is imported without executing commands and changing X-Ray', () => {
  const result = parseCfg('seta cg_fov "105"; quit\nseta cg_wh "0"\nexec malicious.cfg\nseta r_gamma "1.2"\nseta cg_drawGun "1"');
  assert.deepEqual(result.applied.map(c => c.name), ['cg_fov','r_gamma','cg_drawGun']);
  assert.equal(result.ignored.length, 3);
});
test('a quoted semicolon cannot become a console command', () => {
  assert.equal(parseCfg('seta cg_enemyModel "keel; quit"').applied.length, 0);
});
test('ZIP path traversal cannot overwrite engine files', () => {
  for (const p of ['../default.cfg','ui/../../evil.cfg','/default.cfg','C:/evil.cfg']) assert.throws(() => safePath(p));
  assert.equal(safePath('ui\\custom.menu'), 'ui/custom.menu');
});
test('a HUD archive outer directory is removed, UI directory is preserved', () => {
  const data = new Uint8Array([1]);
  assert.equal(normalizeHudEntries([['my-hud/ui/custom.menu',data]])[0][0], 'ui/custom.menu');
  assert.equal(normalizeHudEntries([['ui/custom.menu',data]])[0][0], 'ui/custom.menu');
});
