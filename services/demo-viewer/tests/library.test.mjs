import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {DemoLibrary} from '../public/demo-library.mjs';
import {listFolderDemos, saveToFolder} from '../public/proton-folder.mjs';

test('saved demos reopen after a new library instance without duplicate copies', async()=>{
  const indexedDB=new IDBFactory(); const first=new DemoLibrary({indexedDB});
  const file=new File(['real demo bytes'],'match.dm_91');
  const a=await first.save(file); const b=await first.save(new File(['real demo bytes'],'copy.dm_91'));
  assert.equal(a.id,b.id); assert.equal((await first.list()).length,1);
  await first.position(a.id,12345);
  const second=new DemoLibrary({indexedDB}); const saved=await second.file(a.id);
  assert.equal(await saved.file.text(),'real demo bytes'); assert.equal(saved.metadata.position,12345);
  await second.remove(a.id); assert.equal((await second.list()).length,0);
  await assert.rejects(second.file(a.id),/no longer available/);
});
test('storage capacity failure leaves the existing library intact', async()=>{
  const library=new DemoLibrary({indexedDB:new IDBFactory()}); const db=await library.db();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction('demos','readwrite');tx.objectStore('demos').put({id:'existing',size:1024**3,lastOpened:1});
    tx.oncomplete=resolve;tx.onerror=reject;
  });
  await assert.rejects(library.save(new File(['new'],'new.dm_91')),/library is full/);
  assert.equal((await library.list()).length,1);
});
test('folder listing filters demos and never reads file contents', async()=>{
  const directory={async *entries(){
    yield ['match.dm_91',{kind:'file',getFile:async()=>({size:234})}];
    yield ['photo.jpg',{kind:'file',getFile:async()=>{throw Error('Must not open non-demo');}}];
    yield ['folder',{kind:'directory'}];
  }};
  assert.deepEqual((await listFolderDemos(directory)).map(x=>x.name),['match.dm_91']);
});
test('saving to Proton folder does not overwrite a conflicting existing file', async()=>{
  const file=new File(['demo'],'match.dm_91');
  const id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
  let writes=0;
  const directory={getFileHandle:async()=>({getFile:async()=>new File(['different'],'other.dm_91'),createWritable:async()=>{writes++;}})};
  await assert.rejects(saveToFolder(directory,file,id),/no file was overwritten/);
  assert.equal(writes,0);
});
test('identical demo already in Proton folder is not uploaded again', async()=>{
  const file=new File(['demo'],'match.dm_91');
  const id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const directory={getFileHandle:async()=>({getFile:async()=>file})};
  assert.equal((await saveToFolder(directory,file,id)).alreadySaved,true);
});
