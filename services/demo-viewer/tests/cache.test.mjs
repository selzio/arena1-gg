import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResourceCache} from '../public/resource-cache.mjs';

function storage() {
  const items = new Map();
  const cache = {
    match: async key => items.get(key)?.clone(),
    put: async (key, response) => items.set(key, response.clone()),
    delete: async key => items.delete(key),
    keys: async () => [...items.keys()]
  };
  return {open: async () => cache};
}
test('complete packs survive a new cache client without another download', async () => {
  const disk = storage(); let downloads = 0;
  const fetcher = async () => { downloads++; return new Response(new Uint8Array([1,2,3])); };
  const first = new ResourceCache({storage: disk, fetcher});
  assert.deepEqual([...await first.read('/pack.pk3', {size: 3})], [1,2,3]);
  const messages = [];
  const second = new ResourceCache({storage: disk, fetcher});
  assert.deepEqual([...await second.read('/pack.pk3', {size: 3, progress: text => messages.push(text)})], [1,2,3]);
  assert.equal(downloads, 1);
  assert.match(messages[0], /Loading saved/);
});
test('incomplete downloads are rejected and never saved', async () => {
  const disk = storage();
  const cache = new ResourceCache({storage: disk, fetcher: async () => new Response(new Uint8Array([1]))});
  await assert.rejects(cache.read('/broken.pk3', {size: 3}), /Incomplete download/);
  assert.equal(await (await disk.open()).match('/broken.pk3'), undefined);
});
test('unavailable browser storage does not block playback', async () => {
  const cache = new ResourceCache({storage: {open: async () => { throw Error('private mode'); }},
    fetcher: async () => new Response(new Uint8Array([7]))});
  assert.deepEqual([...await cache.read('/pack.pk3', {size: 1})], [7]);
});
test('content-addressed updates are downloaded separately from older packs', async () => {
  const disk = storage(); let downloads = 0;
  const cache = new ResourceCache({storage: disk, fetcher: async () => { downloads++; return new Response('new'); }});
  await cache.read('/pack-old.pk3'); await cache.read('/pack-new.pk3'); await cache.read('/pack-new.pk3');
  assert.equal(downloads, 2);
});
