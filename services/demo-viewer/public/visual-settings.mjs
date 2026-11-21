// Explicit player controls override visual values imported from a profile.
const bounded = (value, fallback, min, max) => {
  if (value === null || value === undefined || value === '') return fallback;
  const number=Number(value);
  return Number.isFinite(number) ? Math.max(min,Math.min(max,Math.round(number))) : fallback;
};
export function visualSettings(value = {}) {
  value=value || {};
  return {picmip:bounded(value.picmip,1,0,6),fov:bounded(value.fov,105,60,160),
    vertexLight:value.vertexLight === true,models:value.models === 'original' ? 'original' : 'uniform'};
}
export function fovCommands(value) {
  return `set cg_useDemoFov 0\nset cg_fovStyle 0\nset cg_fov ${visualSettings(value).fov}`;
}
export function visualCommands(value) {
  const {picmip,models,vertexLight} = visualSettings(value);
  const original = models === 'original';
  const commands = [`set r_picmip ${picmip}`, `set r_vertexLight ${vertexLight ? 1 : 0}`, fovCommands(value), 'set cg_forceModel 0',
    `set cg_forcePovModel ${original ? 0 : 1}`, 'set cg_useDefaultTeamSkins 0', 'set cg_useCustomRedBlueModels 0'];
  for (const group of ['enemy','team','redTeam','blueTeam']) {
    const model = !original && ['enemy','team'].includes(group) ? 'keel/bright' : '';
    commands.push(`set cg_${group}Model "${model}"`, `set cg_${group}HeadModel "${model}"`);
    for (const part of ['Head','Torso','Legs']) {
      commands.push(`set cg_${group}${part}Skin ""`);
      commands.push(`set cg_${group}${part}Color "${!original && group === 'enemy' ? '0x2a8000' : ''}"`);
    }
  }
  if (!original) commands.push('set model "keel/bright"','set headmodel "keel/bright"');
  return commands.join('\n');
}
