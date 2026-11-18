import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import policy from './src/policy.cjs';import access from './src/access.cjs';import units from './src/units.cjs';
import {createUnitFilesHandler,MAX_FILE_BYTES,validFilename} from './src/unit-files.mjs';import {createUnitHandler} from './src/unit-page.mjs';import {responseFrom} from './src/http.mjs';
process.env.APP_ORIGIN='https://mitsoeservices.netlify.app';
function fixture(){
 const data=policy.initialPolicy(),entries=new Map(),key=randomBytes(32);let version=0,reads=0,blobs=0,uuid=0;
 for(const [username,scope,role]of [['admin','aeroastro','admin'],['writer','aeroastro','write'],['reader','aeroastro','read'],['junior','aeroastro','limited_write'],['limited','aeroastro','limited_read'],['other','be','admin']])data.grants.push({username,scope,role});
 const s={async getWithMetadata(k){reads++;return structuredClone(entries.get(k))||null;},async get(k){blobs++;return entries.get(k)?.data||null;},async set(k,value,conditions={}){const old=entries.get(k);if(conditions.onlyIfNew&&old||conditions.onlyIfMatch&&conditions.onlyIfMatch!==old?.etag)return {modified:false};entries.set(k,{data:structuredClone(value),etag:String(++version)});return {modified:true};},async setJSON(k,v,c){return this.set(k,v,c);}};
 const authorize=username=>(event,options)=>access.authorize(event,{...options,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>username?{kerberos:username,name:username==='writer'?'Unit Writer':''}:null,load:async()=>({data,etag:'policy'})});
 const handler=username=>createUnitFilesHandler({authorize:authorize(username),store:async()=>s,key:()=>key,now:()=>new Date('2026-10-26T20:05:00Z'),uuid:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`});
 return {data,entries,authorize,handler,s,reads:()=>reads,blobs:()=>blobs};
}
const get=(unit='aeroastro',audience='full',extra={})=>({httpMethod:'GET',queryStringParameters:{unit,audience,...extra}});
const upload=(audience='full',filename='Budget.xlsx',content=Buffer.from('synthetic test file').toString('base64'),unit='aeroastro')=>({httpMethod:'POST',queryStringParameters:{unit,audience},headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({filename,content})});
const decode=r=>JSON.parse(r.body);
test('uploads preserve each version and record server-trusted uploader, name and time',async()=>{
 const f=fixture(),a=await f.handler('writer')(upload()),b=await f.handler('writer')(upload());assert.equal(a.statusCode,201);assert.equal(b.statusCode,201);
 const files=decode(await f.handler('reader')(get())).files;assert.equal(files.length,2);assert.notEqual(files[0].id,files[1].id);assert.equal(files[0].uploaded_by,'writer');assert.equal(files[0].uploader_name,'Unit Writer');assert.equal(files[0].uploaded_at,'2026-10-26T20:05:00.000Z');
 assert.ok(!Buffer.from(f.entries.get('file:aeroastro:full:'+files[0].id).data).includes(Buffer.from('synthetic test file')));
 const spoof=upload();const body=JSON.parse(spoof.body);body.uploaded_by='oconaill';spoof.body=JSON.stringify(body);assert.equal((await f.handler('writer')(spoof)).statusCode,400);
});
test('every unit and permission level enforces its own full and limited file lists and upload rights',async()=>{
 for(const unit of Object.keys(units.ALL_UNITS))for(const role of Object.keys(policy.ROLES)){
  const f=fixture();f.data.grants.push({username:'testuser',scope:unit,role});
  for(const audience of ['full','limited']){
   const limited=role.startsWith('limited_'),canView=audience==='limited'||!limited,canWrite=canView&&['limited_write','write','admin'].includes(role),event=get(unit,audience);
   assert.equal((await f.handler('testuser')(event)).statusCode,canView?200:403);
   assert.equal((await f.handler('testuser')(upload(audience,'Test.txt',Buffer.from('test').toString('base64'),unit))).statusCode,canWrite?201:403);
  }
 }
});
test('school administrators can upload to both audiences; unit users cannot access another unit',async()=>{
 const f=fixture();for(const unit of ['aeroastro','be','ctl'])for(const audience of ['limited','full'])assert.equal((await f.handler('juliekuk')(upload(audience,'Test.txt',Buffer.from('test').toString('base64'),unit))).statusCode,201);
 const before=f.reads();assert.equal((await f.handler('admin')(get('be'))).statusCode,403);assert.equal((await f.handler('admin')(upload('full','Test.txt',Buffer.from('test').toString('base64'),'be'))).statusCode,403);assert.equal(f.reads(),before);
 assert.equal((await f.handler(null)(get())).statusCode,401);
});
test('limited users cannot download full files by guessing IDs or changing the audience',async()=>{
 const f=fixture(),full=decode(await f.handler('writer')(upload())).file,limited=decode(await f.handler('junior')(upload('limited','Staff.txt'))).file;
 assert.equal((await f.handler('limited')(get('aeroastro','full',{action:'download',id:full.id}))).statusCode,403);
 const before=f.blobs();assert.equal((await f.handler('limited')(get('aeroastro','limited',{action:'download',id:full.id}))).statusCode,404);assert.equal(f.blobs(),before);
 assert.equal(decode(await f.handler('reader')(get())).files.length,1);assert.equal(decode(await f.handler('reader')(get('aeroastro','limited'))).files.length,1);
 assert.equal((await f.handler('other')(get('aeroastro','limited',{action:'download',id:limited.id}))).statusCode,403);
});
test('downloads return exact bytes as private attachments and recheck access after revocation',async()=>{
 const f=fixture(),bytes=Buffer.from([0,255,10,13,128,65]),file=decode(await f.handler('writer')(upload('full','Report café.txt',bytes.toString('base64')))).file;
 const result=await f.handler('reader')(get('aeroastro','full',{action:'download',id:file.id}));assert.equal(result.statusCode,200);assert.deepEqual(Buffer.from(await responseFrom(result).arrayBuffer()),bytes);assert.match(result.headers['Content-Disposition'],/^attachment;/);assert.match(result.headers['Content-Disposition'],/filename\*=UTF-8/);assert.match(result.headers['Cache-Control'],/no-store/);assert.equal(result.headers['Content-Type'],'application/octet-stream');
 f.data.grants=f.data.grants.filter(g=>g.username!=='reader');const before=f.blobs();assert.equal((await f.handler('reader')(get('aeroastro','full',{action:'download',id:file.id}))).statusCode,403);assert.equal(f.blobs(),before);
});
test('foreign origins, invalid JSON, unsafe names, unknown scope and oversize uploads are rejected',async()=>{
 const f=fixture(),foreign=upload();foreign.headers.origin='https://evil.example';assert.equal((await f.handler('writer')(foreign)).statusCode,403);
 const type=upload();type.headers['content-type']='text/plain';assert.equal((await f.handler('writer')(type)).statusCode,403);
 for(const name of ['../secret.txt','script.html','run.exe','bad\r\nname.txt','.hidden.txt','file\u202etxt.pdf']){assert.equal(validFilename(name),false);assert.equal((await f.handler('writer')(upload('full',name))).statusCode,400);}
 for(const content of ['not base64','====','AB=='])assert.equal((await f.handler('writer')(upload('full','Test.txt',content))).statusCode,400);
 assert.equal((await f.handler('writer')(upload('full','Test.txt',Buffer.alloc(MAX_FILE_BYTES+1).toString('base64')))).statusCode,413);
 for(const [unit,audience]of [['school','full'],['__proto__','full'],['archaeology','full'],['aeroastro','wallet']])assert.equal((await f.handler('oconaill')(get(unit,audience))).statusCode,404);
 assert.equal((await f.handler('writer')({...upload(),body:'{'})).statusCode,400);
});
test('tampered metadata, ciphertext and cross-audience indexes fail closed',async()=>{
 const f=fixture(),file=decode(await f.handler('writer')(upload())).file,key='file:aeroastro:full:'+file.id;
 const cipher=f.entries.get(key).data;cipher[cipher.length-1]^=1;assert.equal((await f.handler('reader')(get('aeroastro','full',{action:'download',id:file.id}))).statusCode,503);
 const entry=f.entries.get('index:aeroastro');entry.data.files[0].audience='limited';assert.equal((await f.handler('reader')(get())).statusCode,503);
 f.entries.set('index:aeroastro',entry);assert.equal((await f.handler('junior')(get('aeroastro','limited'))).statusCode,503);
});
test('concurrent uploads do not overwrite one another',async()=>{
 const f=fixture(),results=await Promise.all([f.handler('writer')(upload('full','One.txt')),f.handler('writer')(upload('full','Two.txt'))]);assert.ok(results.every(r=>r.statusCode===201));assert.deepEqual(decode(await f.handler('reader')(get())).files.map(f=>f.filename).sort(),['One.txt','Two.txt']);
});
test('mixed school read and unit limited-write grants do not allow full uploads',async()=>{
 const f=fixture();f.data.grants.push({username:'mixed',scope:'school',role:'read'},{username:'mixed',scope:'aeroastro',role:'limited_write'});
 assert.equal((await f.handler('mixed')(upload('limited','Staff.txt'))).statusCode,201);assert.equal((await f.handler('mixed')(upload('full','Budget.txt'))).statusCode,403);
 assert.equal(decode(await f.handler('mixed')(get('aeroastro','full'))).canUpload,false);assert.equal(decode(await f.handler('mixed')(get('aeroastro','limited'))).canUpload,true);
});
test('unit pages expose separate file areas and upload forms only to their permitted writers',async()=>{
 const f=fixture();for(const user of ['reader','writer','junior','limited','admin','oconaill'])for(const audience of ['full','limited']){
  const result=await createUnitHandler(f.authorize(user))({httpMethod:'GET',path:'/units/aeroastro/'+audience});if(result.statusCode!==200)continue;
  assert.ok(result.body.includes('data-file-audience="'+audience+'"'));assert.ok(result.body.includes('Uploaded by'));assert.ok(result.body.includes('Uploaded (Eastern Time)'));
  const canWrite=['writer','admin','oconaill'].includes(user)||user==='junior'&&audience==='limited';assert.equal(result.body.includes('id="unit-file-upload"'),canWrite);
  if(audience==='full')assert.ok(result.body.includes('href="/units/aeroastro/wallet"'));
 }
});

const move=(file,to,audience='full',unit='aeroastro',version=file.access_version||file.id)=>({...get(unit,audience),httpMethod:'POST',headers:{origin:process.env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({action:'move',id:file.id,to,version})});
test('a unit admin can move another uploader file atomically while retaining upload attribution and audit',async()=>{
 const f=fixture(),original=decode(await f.handler('writer')(upload())).file;
 const result=await f.handler('admin')(move(original,'limited'));assert.equal(result.statusCode,200);const changed=decode(result).file;
 assert.equal(changed.uploaded_by,'writer');assert.equal(changed.uploaded_at,original.uploaded_at);assert.equal(changed.access_history.at(-1).by,'admin');
 assert.equal(decode(await f.handler('reader')(get())).files.length,0);assert.equal(decode(await f.handler('limited')(get('aeroastro','limited'))).files[0].id,original.id);
 assert.equal((await f.handler('reader')(get('aeroastro','full',{action:'download',id:original.id}))).statusCode,404);
 assert.equal((await f.handler('limited')(get('aeroastro','limited',{action:'download',id:original.id}))).statusCode,200);
 assert.equal((await f.handler('admin')(move(changed,'full','limited'))).statusCode,200);
 assert.equal((await f.handler('limited')(get('aeroastro','limited',{action:'download',id:original.id}))).statusCode,404);
 assert.equal((await f.handler('limited')(get('aeroastro','full',{action:'download',id:original.id}))).statusCode,403);
});
test('moving files cannot cross units or bypass write permissions or original-uploader restrictions',async()=>{
 const f=fixture(),file=decode(await f.handler('writer')(upload())).file;
 for(const user of ['reader','other','limited'])assert.equal((await f.handler(user)(move(file,'limited'))).statusCode,403);
 f.data.grants.push({username:'anotherwriter',scope:'aeroastro',role:'write'});assert.equal((await f.handler('anotherwriter')(move(file,'limited'))).statusCode,403);
 assert.equal((await f.handler('writer')(move(file,'limited'))).statusCode,200);
 const junior=decode(await f.handler('junior')(upload('limited','Junior.txt'))).file;assert.equal((await f.handler('junior')(move(junior,'full','limited'))).statusCode,403);
 assert.equal((await f.handler('admin')(move(junior,'be','limited'))).statusCode,400);
});
test('legacy two-list indexes migrate without changing who can download existing files',async()=>{
 const f=fixture(),file=decode(await f.handler('writer')(upload())).file;
 f.entries.delete('index:aeroastro');f.entries.set('index:aeroastro:full',{data:{schema:1,unit:'aeroastro',audience:'full',files:[file]},etag:'legacy'});
 const result=await f.handler('reader')(get());assert.equal(result.statusCode,200);assert.equal(decode(result).files[0].id,file.id);
 assert.equal((await f.handler('reader')(get('aeroastro','full',{action:'download',id:file.id}))).statusCode,200);
 assert.equal((await f.handler('limited')(get('aeroastro','limited',{action:'download',id:file.id}))).statusCode,404);
 assert.equal((await f.handler('admin')(move(file,'limited'))).statusCode,200);
});
test('two concurrent moves cannot publish one file in both audiences',async()=>{
 const f=fixture(),file=decode(await f.handler('writer')(upload())).file;
 const results=await Promise.all([f.handler('admin')(move(file,'limited')),f.handler('writer')(move(file,'limited'))]);assert.equal(results.filter(r=>r.statusCode===200).length,1);
 const full=decode(await f.handler('reader')(get())).files,limited=decode(await f.handler('limited')(get('aeroastro','limited'))).files;assert.equal(full.length,0);assert.equal(limited.length,1);
});
