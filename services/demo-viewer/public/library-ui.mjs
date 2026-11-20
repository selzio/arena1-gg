import {DemoLibrary} from './demo-library.mjs';
import {listFolderDemos, saveToFolder} from './proton-folder.mjs';
import {mib} from './resource-cache.mjs';
const $ = id => document.getElementById(id);
export function createLibraryUI(openDemo) {
  const library = new DemoLibrary(); let rows = []; let protonFolder = null;
  let autosave = true;
  try { autosave = localStorage.getItem('arena1-save-demos') !== 'false'; } catch {}
  $('library-autosave').checked = autosave;
  const notice = message => { $('library-notice').textContent = message; };
  const toggle = async visible => {
    $('library-panel').hidden = !visible;
    $('library-toggle').setAttribute('aria-expanded', String(visible));
    $('screen').classList.toggle('library-open', visible);
    if (visible) { await refresh(); $('library-close').focus(); }
  };
  async function play(row, resume) {
    try {
      const {file} = await library.file(row.id);
      await toggle(false);
      await openDemo(file, {libraryId:row.id, resumeMs:resume ? row.position : 0});
    } catch (error) { notice(error.message); }
  }
  function render() {
    const filter = $('library-search').value.toLowerCase();
    const list = $('library-list'); list.replaceChildren();
    for (const row of rows.filter(row=>row.name.toLowerCase().includes(filter))) {
      const item = document.createElement('div'); item.className = 'library-item';
      const info = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = row.name;
      const meta = document.createElement('small'); meta.textContent = `${mib(row.size)} · ${new Date(row.added).toLocaleDateString('en-GB')}${row.origin ? ` · ${row.origin.provider}` : ''}`;
      info.append(name,meta); item.append(info);
      const button = (label, action) => { const b=document.createElement('button'); b.type='button'; b.className='text-button'; b.textContent=label; b.addEventListener('click',action); item.append(b); };
      button('Play',()=>play(row,false));
      if (row.position > 5000) button('Resume',()=>play(row,true));
      button('Download',async()=>{
        try {
          const {file} = await library.file(row.id); const url=URL.createObjectURL(file);
          const a=document.createElement('a'); a.href=url; a.download=row.name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
        } catch(error) { notice(error.message); }
      });
      if (protonFolder) button('Save to Proton folder',async()=>{
        try {
          if (await protonFolder.requestPermission({mode:'readwrite'}) !== 'granted') throw Error('Folder access was not granted.');
          const {file}=await library.file(row.id); const saved=await saveToFolder(protonFolder,file,row.id);
          notice(saved.alreadySaved ? 'This demo is already in the Proton Drive folder.' : 'Saved to your Proton Drive folder. The Proton Drive app handles cloud sync.');
          await refreshCloud();
        } catch(error) { notice(error.message); }
      });
      button('Remove',async()=>{
        if (!confirm(`Remove ${row.name} from this browser library? Your original file will not be changed.`)) return;
        await library.remove(row.id); await refresh();
      });
      list.append(item);
    }
    $('library-empty').hidden = rows.length > 0;
    $('library-count').textContent = `${rows.length} demos · ${mib(rows.reduce((sum,row)=>sum+row.size,0))} / 1 GiB`;
  }
  async function refresh() {
    try { rows=await library.list(); render(); } catch(error) { notice(`Library unavailable: ${error.message}`); }
  }
  $('library-toggle').addEventListener('click',()=>toggle($('library-panel').hidden));
  $('library-close').addEventListener('click',()=>toggle(false));
  $('library-search').addEventListener('input',render);
  $('library-autosave').addEventListener('change',()=>{
    autosave=$('library-autosave').checked;
    try { localStorage.setItem('arena1-save-demos',String(autosave)); } catch {}
  });
  async function refreshCloud() {
    const list=$('cloud-list'); list.replaceChildren();
    if (!protonFolder) return;
    $('cloud-folder-name').textContent=protonFolder.name;
    $('cloud-disconnect').hidden=false; $('cloud-refresh').hidden=false;
    try {
      const files=await listFolderDemos(protonFolder);
      for (const item of files) {
        const button=document.createElement('button'); button.type='button'; button.className='cloud-file text-button';
        button.textContent=`${item.name} · ${mib(item.size)}`;
        button.addEventListener('click',async()=>{
          try { const file=await item.handle.getFile(); await toggle(false); await openDemo(file,{origin:{provider:'Proton Drive folder'}}); }
          catch(error) { notice(error.message); }
        }); list.append(button);
      }
      if (!files.length) list.textContent='No supported demos in this folder.';
    } catch(error) { notice(`Folder unavailable: ${error.message}`); }
    render();
  }
  $('cloud-connect').addEventListener('click',async()=>{
    try {
      if (!window.showDirectoryPicker) throw Error('Folder access is unavailable here. Use a supported desktop browser, or download from Proton Drive and choose Open demo.');
      if (protonFolder) {
        if (await protonFolder.requestPermission({mode:'readwrite'}) !== 'granted') return;
      } else protonFolder=await window.showDirectoryPicker({id:'arena1-proton-folder',mode:'readwrite'});
      await library.connection(protonFolder); await refreshCloud();
    } catch(error) { if (error.name !== 'AbortError') notice(error.message); }
  });
  $('cloud-refresh').addEventListener('click',refreshCloud);
  $('cloud-disconnect').addEventListener('click',async()=>{
    protonFolder=null; await library.connection(null); $('cloud-folder-name').textContent='Not connected';
    $('cloud-list').replaceChildren(); $('cloud-disconnect').hidden=true; $('cloud-refresh').hidden=true; render();
  });
  library.connection().then(async folder=>{
    if (!folder) return;
    protonFolder=folder;
    if (await folder.queryPermission({mode:'readwrite'}) === 'granted') await refreshCloud();
    else { $('cloud-folder-name').textContent='Reconnect to access your Proton Drive folder'; }
  }).catch(()=>{});
  refresh();
  return {
    async save(file, bytes, origin) {
      if (!autosave) return null;
      try { const row=await library.save(file,bytes,origin); await refresh(); return row; }
      catch(error) { notice(`Demo opened, but could not be saved: ${error.message}`); return null; }
    },
    position(id, position) { library.position(id,position).catch(error=>notice(error.message)); },
    notice, refresh
  };
}
