// Local demo bytes and metadata remain in this browser, never in the app server.
const MAX_BYTES = 1024 ** 3;
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const complete = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('Library transaction failed.'));
});
export class DemoLibrary {
  constructor({indexedDB = globalThis.indexedDB, name = 'arena1-demo-library-v1'} = {}) {
    this.indexedDB = indexedDB; this.name = name;
  }
  async db() {
    if (!this.databasePromise) this.databasePromise = new Promise((resolve, reject) => {
      if (!this.indexedDB) return reject(Error('Local storage is not available in this browser.'));
      const request = this.indexedDB.open(this.name, 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('demos')) request.result.createObjectStore('demos', {keyPath: 'id'});
        if (!request.result.objectStoreNames.contains('files')) request.result.createObjectStore('files');
        if (!request.result.objectStoreNames.contains('connections')) request.result.createObjectStore('connections');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }
  async list() {
    const db = await this.db();
    const rows = await result(db.transaction('demos').objectStore('demos').getAll());
    return rows.sort((a,b) => b.lastOpened - a.lastOpened);
  }
  async save(file, bytes, origin = null) {
    const data = bytes || new Uint8Array(await file.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    const id = [...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
    const db = await this.db();
    const tx = db.transaction(['demos','files'], 'readwrite'); const done = complete(tx);
    const demos = tx.objectStore('demos');
    const rows = await result(demos.getAll()); const existing = rows.find(x=>x.id === id);
    if (!existing && rows.reduce((sum,x)=>sum+x.size,0) + file.size > MAX_BYTES) {
      tx.abort(); await done.catch(()=>{});
      throw Error('Your demo library is full (1 GiB). Remove a demo to save another.');
    }
    const row = {...existing, id, name: file.name, size: file.size,
      added: existing?.added || Date.now(), lastOpened: Date.now(), position: existing?.position || 0,
      origin: origin || existing?.origin || null};
    demos.put(row);
    if (!existing) tx.objectStore('files').put(file, id);
    await done; return row;
  }
  async file(id) {
    const db = await this.db(); const tx = db.transaction(['demos','files']);
    const [metadata, blob] = await Promise.all([result(tx.objectStore('demos').get(id)), result(tx.objectStore('files').get(id))]);
    if (!metadata || !blob) throw Error('This saved demo is no longer available.');
    return {metadata, file: new File([blob], metadata.name, {type:'application/octet-stream'})};
  }
  async position(id, position) {
    const db = await this.db(); const tx = db.transaction('demos','readwrite'); const done = complete(tx);
    const store = tx.objectStore('demos'); const row = await result(store.get(id));
    if (row) store.put({...row, position: Math.max(0,position), lastOpened:Date.now()});
    await done;
  }
  async connection(value) {
    const db = await this.db();
    if (value === undefined) return result(db.transaction('connections').objectStore('connections').get('proton-folder'));
    const tx = db.transaction('connections','readwrite'); const done = complete(tx);
    if (value === null) tx.objectStore('connections').delete('proton-folder');
    else tx.objectStore('connections').put(value,'proton-folder');
    await done;
  }
  async remove(id) {
    const db = await this.db(); const tx = db.transaction(['demos','files'],'readwrite'); const done = complete(tx);
    tx.objectStore('demos').delete(id); tx.objectStore('files').delete(id); await done;
  }
}
