// Browser-local HUD import. Imported cfg files are never executed verbatim.
export function safePath(path) {
  const p = path.replaceAll('\\', '/');
  if (!p || p.startsWith('/') || p.includes(':') || p.split('/').some(x => x === '..' || !x))
    throw new Error(`Invalid path: ${path}`);
  return p;
}

export function parseCfg(text) {
  const applied = [], ignored = [];
  // Commands may be separated by semicolons, except inside quoted values.
  const commands = text.replace(/\/\/[^\n]*/g, '').match(/(?:[^;\n"]|"[^"]*")+/g) || [];
  const allowed = /^(cg_(?!wh|freecam|fxthreads|camera|follow)[a-z0-9_]+|r_(?:picmip|vertexlight|fastsky|dynamiclight|gamma|intensity|mapoverbrightbits|overbrightbits|texturemode)|s_(?:volume|musicvolume))$/i;
  for (const raw of commands) {
    const match = raw.trim().match(/^(?:(?:set|seta|setu|sets)\s+)?([\w]+)\s+(?:"([^"\r\n]*)"|([^"\r\n]+))$/i);
    if (!match || !allowed.test(match[1])) {
      if (raw.trim()) ignored.push(raw.trim());
      continue;
    }
    const value = (match[2] ?? match[3]).trim();
    if (/[;\r\n]/.test(value) || value.length > 512) {
      ignored.push(raw.trim());
      continue;
    }
    applied.push({ name: match[1], value });
  }
  return { applied, ignored };
}

export function hudReferences(text) {
  return [...text.matchAll(/(?:#include|loadMenu|font|background)\s*(?:\{\s*)?"([^"]+)"/gi)]
    .map(m => m[1]);
}

export function normalizeHudEntries(entries) {
  let files = entries.map(([name, data]) => [safePath(name), data]);
  // A ZIP can have one outer directory, such as my-hud/ui/hud.menu.
  const roots = new Set(files.map(([name]) => name.split('/')[0]));
  if (roots.size === 1 && files.every(([name]) => name.includes('/')) &&
      !['ui', 'fonts', 'gfx', 'scripts', 'wcfonts'].includes([...roots][0])) {
    files = files.map(([name, data]) => [name.slice(name.indexOf('/') + 1), data]);
  }
  return files.map(([name, data]) => [name.endsWith('.menu') && !name.includes('/') ? `ui/${name}` : name, data]);
}
