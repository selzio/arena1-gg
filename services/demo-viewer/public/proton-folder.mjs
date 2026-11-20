// Integrates a user-selected local folder synced by Proton Drive's desktop app.
// It does not request Proton credentials or pretend to be an account API client.
const DEMO = /\.dm_(68|73|90|91)$/i;
export async function listFolderDemos(directory) {
  const rows = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !DEMO.test(name)) continue;
    const file = await handle.getFile();
    if (file.size > 0 && file.size <= 256 * 1024**2) rows.push({name, size:file.size, handle});
    if (rows.length >= 500) break;
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
export async function saveToFolder(directory, file, id) {
  // A content-derived name avoids replacing any original demo in the folder.
  const safe = file.name.replace(/[\\/]/g,'_');
  if (!DEMO.test(safe) || !/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid demo file.');
  const name = safe.replace(DEMO, `-${id.slice(0,12)}$&`);
  let existing;
  try { existing = await directory.getFileHandle(name); }
  catch(error) { if (error.name !== 'NotFoundError') throw error; }
  if (existing) {
    const bytes = await (await existing.getFile()).arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if (digest === id) return {name, alreadySaved:true};
    throw Error('A different file already uses this name. Rename it before saving; no file was overwritten.');
  }
  const handle = await directory.getFileHandle(name,{create:true});
  const writable = await handle.createWritable();
  try { await writable.write(file); await writable.close(); }
  catch(error) { await writable.abort().catch(()=>{}); throw error; }
  return {name, alreadySaved:false};
}
