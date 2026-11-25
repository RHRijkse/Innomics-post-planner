// No external dependencies. Requires Node 22+ and Microsoft Edge on Windows.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, '.test-work');
fs.mkdirSync(scratch, { recursive: true });
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  let file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html','media-storage.js'].includes(file)) { res.writeHead(404); res.end(); return; }
  let content = fs.readFileSync(path.join(root,file),'utf8');
  if (file === 'index.html') content = content.replace('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
    '<script>'+fs.readFileSync(path.join(__dirname,'mock-supabase.js'),'utf8')+'</script>');
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(content);
});
const delay = ms => new Promise(r=>setTimeout(r,ms));
let edge, ws;
const calls = new Map();
let seq = 0;
let testCount = 0;
async function test(name,fn) { await fn(); console.log('PASS '+name); testCount++; }
async function main() {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const edgePath = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  edge = spawn(edgePath,['--headless=new','--disable-gpu','--no-first-run',
    '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--user-data-dir='+path.join(scratch,'edge-'+Date.now()), 'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let port;
  let output='';
  edge.stderr.on('data',chunk => { output += chunk; const m=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if(m)port=m[1]; });
  for(let i=0;i<150&&!port;i++) await delay(100);
  if(!port) throw Error('Edge debugger did not start: '+output.slice(-1000));
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  ws = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage = ({data}) => {const m=JSON.parse(data); if(m.id&&calls.has(m.id)){const {resolve,reject}=calls.get(m.id); calls.delete(m.id); m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}};
  function cdp(method,params={}) { return new Promise((resolve,reject)=>{const id=++seq;calls.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));}); }
  async function evaluate(expression) {
    const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  }
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.navigate',{url});
  for(let i=0;i<100;i++){if(await evaluate('typeof remoteReady !== "undefined" && remoteReady'))break; await delay(50);}
  assert.equal(await evaluate('remoteReady'),true);

  await test('compresses a 3200×1800 image to 1600×900; preserves transparency', async()=>{
    const r=await evaluate(`(async()=>{
      const c=document.createElement('canvas'); c.width=3200;c.height=1800;
      const ctx=c.getContext('2d');ctx.fillStyle='rgba(10,90,200,.4)';ctx.fillRect(0,0,3200,1800);
      const blob=await new Promise(r=>c.toBlob(r,'image/png'));
      window.testFile=new File([blob],'foto.png',{type:'image/png'});
      const prepared=await PlannerMedia.compress(testFile);
      const bitmap=await createImageBitmap(prepared.blob);const sample=document.createElement('canvas'); sample.width=sample.height=1;
      sample.getContext('2d').drawImage(bitmap,0,0,1,1);
      return {width:prepared.width,height:prepared.height,alpha:sample.getContext('2d').getImageData(0,0,1,1).data[3],size:prepared.blob.size};
    })()`);
    assert.equal(r.width,1600); assert.equal(r.height,900); assert(r.alpha>70&&r.alpha<160); assert(r.size<650*1024);
  });
  await test('never upscales small images', async()=>{
    assert.deepEqual(await evaluate(`(async()=>{const c=document.createElement('canvas');c.width=80;c.height=40;const b=await new Promise(r=>c.toBlob(r));const v=await PlannerMedia.compress(new File([b],'small.png',{type:b.type}));return [v.width,v.height];})()`),[80,40]);
  });
  await test('uploads binary data and stores references without base64 or signed URLs', async()=>{
    const r=await evaluate(`(async()=>{window.uploaded=await PlannerMedia.upload(testFile);return {reference:uploaded,uploaded:mock.uploads.length,src:PlannerMedia.source(uploaded),blob:mock.uploads[0].body instanceof Blob};})()`);
    assert(r.blob); assert.equal(r.uploaded,1); assert(r.reference.storagePath.startsWith('planner/'));
    assert(!('dataUrl' in r.reference));assert(!('url' in r.reference));assert(r.src.startsWith('blob:'));
  });
  await test('rejects oversize, empty and unreadable files before any upload', async()=>{
    const r=await evaluate(`(async()=>{const before=mock.uploads.length;let errors=0;for(const file of [new File([new Uint8Array(10*1024*1024+1)],'big.jpg',{type:'image/jpeg'}),new File([],'empty.jpg',{type:'image/jpeg'}),new File(['broken'],'bad.png',{type:'image/png'})]){try{await PlannerMedia.upload(file);}catch(e){errors++;}}return [errors,mock.uploads.length-before];})()`);
    assert.deepEqual(r,[3,0]);
  });
  await test('post saves online despite full browser cache',async()=>{
    const r=await evaluate(`(async()=>{
      openEditor({date:toDateInput(new Date())});currentAttachment=uploaded;setMedia('foto');
      document.getElementById('postTitle').value='Testfoto';document.getElementById('postText').value='Met foto';
      window.originalSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key===storageKey)throw new DOMException('Vol','QuotaExceededError');return originalSetItem.call(this,key,value);};
      await savePost(); Storage.prototype.setItem=originalSetItem;
      return {rows:mock.rows.length,attachment:mock.rows[0].attachment,closed:!drawer.classList.contains('open'),status:document.getElementById('mediaStatus').textContent};
    })()`);
    assert.equal(r.rows,1);assert(r.attachment.storagePath);assert(r.closed);assert(r.status.includes('browseropslag vol'));
  });
  await test('remote reload restores and renders stored photo references',async()=>{
    const r=await evaluate(`(async()=>{posts=[];await loadRemotePosts();return {path:posts[0].attachment.storagePath,img:document.querySelector('.post-media img')?.src};})()`);
    assert(r.path);assert(r.img?.startsWith('blob:'));
  });
  await test('database failure preserves open draft and previous saved post',async()=>{
    const r=await evaluate(`(async()=>{openEditor(posts[0]);document.getElementById('postTitle').value='Moet open blijven';mock.failWrite=true;await savePost();mock.failWrite=false;return {open:drawer.classList.contains('open'),draft:document.getElementById('postTitle').value,saved:posts[0].title,remote:mock.rows[0].title};})()`);
    assert(r.open);assert.equal(r.draft,'Moet open blijven');assert.equal(r.saved,'Testfoto');assert.equal(r.remote,'Testfoto');
  });
  await test('upload failure preserves the previous attachment and unlocks the editor',async()=>{
    const r=await evaluate(`(async()=>{const previous=currentAttachment;mock.failUpload=true;await handleFileSelection({files:[testFile],value:''},'foto');mock.failUpload=false;return {same:previous===currentAttachment,busy:mediaBusy,disabled:document.getElementById('saveBtn').disabled,alert:mock.alerts.at(-1)};})()`);
    assert(r.same);assert.equal(r.busy,false);assert.equal(r.disabled,false);assert(r.alert.includes('Upload mislukt'));
  });
  await test('migration keeps old bytes on database error and creates a backup',async()=>{
    const r=await evaluate(`(async()=>{
      closeEditor();const canvas=document.createElement('canvas');canvas.width=100;canvas.height=60;
      window.legacyAttachment={name:'oud.png',type:'image/png',size:200,dataUrl:canvas.toDataURL()};
      const post={...posts[0],id:crypto.randomUUID(),title:'Oude foto',attachment:legacyAttachment};
      posts.push(post);mock.rows.push(postToRow(post));mock.failWrite=true;
      await migrateStoredMedia();mock.failWrite=false;
      return {kept:post.attachment.dataUrl===legacyAttachment.dataUrl,remoteKept:!!mock.rows.find(r=>r.id===post.id).attachment.dataUrl,downloads:mock.downloads};
    })()`);
    assert(r.kept);assert(r.remoteKept);assert(r.downloads>=1);
  });
  await test('migration converts post and idea photos, frees local bytes and is repeatable',async()=>{
    const r=await evaluate(`(async()=>{
      const idea={id:crypto.randomUUID(),title:'Ideefoto',folder:'Algemeen',tags:[],sourceUrl:'',content:'',images:[{...legacyAttachment,id:crypto.randomUUID()}],order:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      ideaDocuments.push(idea);mock.rows.push(ideaToRow(idea));await migrateStoredMedia();
      const before=mock.uploads.length;await migrateStoredMedia();
      return {remaining:allMedia().filter(PlannerMedia.legacy).length,post:posts.at(-1).attachment,idea:idea.images[0],repeatUploads:mock.uploads.length-before,cache:localStorage.getItem(storageKey)+localStorage.getItem(ideasStorageKey)};
    })()`);
    assert.equal(r.remaining,0);assert(r.post.storagePath);assert(r.idea.storagePath);assert(r.idea.id);
    assert.equal(r.repeatUploads,0);assert(!r.cache.includes('data:image'));
  });
  await test('concurrent database changes prevent migration from overwriting attachments',async()=>{
    const r=await evaluate(`(async()=>{const p={...posts[0],id:crypto.randomUUID(),attachment:legacyAttachment};posts.push(p);mock.rows.push(postToRow(p));mock.conflict=true;await migrateStoredMedia();mock.conflict=false;return [!!p.attachment.dataUrl,!!mock.rows.at(-1).attachment.dataUrl];})()`);
    assert.deepEqual(r,[true,true]);
  });
  await test('document uploads also use binary Storage references',async()=>{
    const r=await evaluate(`(async()=>{const ref=await PlannerMedia.upload(new File(['pdf fixture'],'document.pdf',{type:'application/pdf'}),{image:false});return ref;})()`);
    assert.equal(r.type,'application/pdf');assert(r.storagePath);assert(!r.dataUrl);
  });
  await test('signing failure keeps a valid uploaded reference for retry',async()=>{
    const r=await evaluate(`(async()=>{mock.failSign=true;const ref=await PlannerMedia.upload(testFile);const before=PlannerMedia.source(ref);mock.failSign=false;await PlannerMedia.resolveAll([ref]);return [!!ref.storagePath,before,PlannerMedia.source(ref)];})()`);
    assert.equal(r[0],true);assert.equal(r[1],'');assert(r[2].startsWith('blob:'));
  });
  await test('idea photos save online with full cache and survive an upload failure',async()=>{
    const r=await evaluate(`(async()=>{
      setAppPage('ideas');createIdeaDocument();await Promise.all(pendingIdeaWrites.values());
      const doc=ideaDocuments.find(item=>item.id===activeIdeaId);
      const transfer=new DataTransfer();transfer.items.add(testFile);ideaImageInput.files=transfer.files;
      Storage.prototype.setItem=function(key,value){if(key===ideasStorageKey)throw new DOMException('Vol','QuotaExceededError');return originalSetItem.call(this,key,value);};
      await handleIdeaImageSelection();Storage.prototype.setItem=originalSetItem;
      const count=doc.images.length;mock.failUpload=true;ideaImageInput.files=transfer.files;
      await handleIdeaImageSelection();mock.failUpload=false;
      return {count,after:doc.images.length,remote:mock.rows.find(row=>row.id===doc.id).attachment.images,disabled:document.getElementById('addIdeaImagesBtn').disabled};
    })()`);
    assert.equal(r.count,1);assert.equal(r.after,1);assert(r.remote[0].storagePath);assert(!r.remote[0].dataUrl);assert.equal(r.disabled,false);
  });
  await test('migration detects changes made before its database snapshot',async()=>{
    const r=await evaluate(`(async()=>{setAppPage('planner');const p={...posts[0],id:crypto.randomUUID(),attachment:legacyAttachment};posts.push(p);const row=postToRow(p);row.attachment={...legacyAttachment,name:'Elders gewijzigd.png'};mock.rows.push(row);await migrateStoredMedia();return [!!p.attachment.dataUrl,mock.rows.at(-1).attachment.name];})()`);
    assert.deepEqual(r,[true,'Elders gewijzigd.png']);
  });
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate(`document.getElementById('mediaStatus').textContent='Online opgeslagen';render();`);
  const screenshot=await cdp('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(scratch,'planner.png'),Buffer.from(screenshot.data,'base64'));
  console.log(`${testCount} tests passed. Live Supabase not contacted.`);
  await cdp('Browser.close');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(ws)ws.close();if(edge&&!edge.killed)edge.kill();server.close();});
