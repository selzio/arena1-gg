(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.RespawnModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const f = Math.fround;
  function compute(spawns, position, ratio = 0.5, minimum = 64) {
    if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) throw new Error('Invalid position');
    const r = Math.max(0.1, Math.min(1, f(ratio)));
    const ranked = spawns.map((spawn, index) => ({ ...spawn, index,
      distance: Math.max(...spawn.origin.map((v, i) => Math.abs(f(f(v) - f(position[i])))))
    })).filter(s => s.distance > 0).sort((a, b) => b.distance - a.distance || a.index - b.index);
    const nominal = Math.min(ranked.length, 26, Math.max(3, Math.ceil(f(spawns.length * r))));
    let pool = ranked.slice(0, nominal).filter(s => s.distance >= Math.trunc(minimum));
    if (!pool.length && ranked.length) pool = ranked.slice(0, 1);
    const ids = new Set(pool.map(s => s.id));
    return { nominal, pool, ranked: ranked.map((s, i) => ({ ...s, rank: i + 1, inPool: ids.has(s.id) })) };
  }
  function grade(pool, selected) {
    const expected = new Set(pool.map(s => typeof s === 'string' ? s : s.id));
    const chosen = new Set(selected);
    const hits = [...chosen].filter(id => expected.has(id));
    const extra = [...chosen].filter(id => !expected.has(id));
    const missed = [...expected].filter(id => !chosen.has(id));
    return { hits, extra, missed, total: expected.size, perfect: !extra.length && !missed.length };
  }
  function draw(pool, random = Math.random) {
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))].id : null;
  }
  return { compute, grade, draw };
});
