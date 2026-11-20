import test from 'node:test';import assert from 'node:assert/strict';
import {validateAttachment,createRctAttachments} from './src/rct-attachments.mjs';
import {createRctVersions} from './src/rct-versions.mjs';
import {createRctHandler} from './src/rct-review.mjs';
import {emptyReview} from './src/rct-model.mjs';
process.env.APP_ORIGIN='https://example.test';
const id='FY27-RCT2|example',fileId='00000000-0000-4000-8000-000000000001';
const file={id,filename:'Support.eml',content:Buffer.from('From: example@example.test\r\nSubject: Support\r\n\r\nExample support.').toString('base64')};
const event=(action,method='GET',body)=>({path:'/soe-hq/rct-review/'+action,httpMethod:method,headers:{origin:'https://example.test','content-type':'application/json'},queryStringParameters:{id,version:fileId},body:body&&JSON.stringify(body)});
test('supporting file validation bounds types, paths, payloads and signatures',()=>{
 assert(validateAttachment(file).length>0);
 for(const patch of [{filename:'../Support.eml'},{filename:'Support.exe'},{filename:'Support.html'},{filename:'Support.pdf'},{content:'bad base64'},{content:Buffer.from('<html>not mail</html>').toString('base64')},{content:'a'.repeat(4200000)},{id:'bad\'key'}])assert.throws(()=>validateAttachment({...file,...patch}));
 assert(validateAttachment({...file,filename:'Support.msg',content:Buffer.from('d0cf11e0a1b11ae1','hex').toString('base64')}));
});
test('support files use a separate storage namespace and retain upload attribution',async()=>{
 const fields=['Key','Proposal Key','File','Uploaded By','Uploaded At'].map((label,i)=>({label,id:i+10})),rows=[];
 const transport={rest:async(path,options)=>{if(path.startsWith('fields'))return fields;if(path==='records'){const value=options.body.data[0];assert.equal(value['11'].value,'support|'+id);assert.equal(value['13'].value,'editor');rows.push({'3':{value:8},...value,'12':{value:{versions:[{versionNumber:1,fileName:'Support.eml'}]}}});return {metadata:{createdRecordIds:[8]}};}const match=options.body.where.includes("support|"+id+"'");return {data:match?rows:[],metadata:{totalRecords:match?rows.length:0}};}};
 const options={transport,table:'exampletable',uuid:()=>fileId,now:()=>new Date('2026-11-20T15:00:00Z'),token:()=> 'fake',fetcher:async()=>new Response(file.content)},attachments=createRctAttachments(options);
 await attachments.upload(file,'editor');assert.equal((await attachments.list(id))[0].by,'editor');assert.equal((await createRctVersions(options).list(id)).length,0);
 const downloaded=await attachments.download(id,fileId);assert.equal(downloaded.contentType,'message/rfc822');assert.equal(downloaded.filename,'Support.eml');assert.equal(await attachments.download('FY27-RCT2|other',fileId),null);
});
test('attachments require RCT read/write access, same origin and the correct proposal',async()=>{
 const record={id,review:emptyReview(),source:{requested:120},revision:'one'},store={list:async()=>[record]},attachments={list:async()=>[{id:fileId,rid:'8',filename:'Support.eml',by:'editor',at:'2026-11-20T15:00:00Z'}],upload:async()=>({id:fileId}),download:async()=>({filename:'Support.eml',contentType:'message/rfc822',bytes:Buffer.from('Example')})};
 const authorize=async(e,o)=>o.minimum==='write'?{statusCode:403}:{user:{},canWrite:false};const reader=createRctHandler({authorize,store,attachments});assert.equal((await reader(event('attachments'))).statusCode,200);assert.equal((await reader(event('attachments','POST',file))).statusCode,403);
 const writer=createRctHandler({authorize:async()=>({user:{},kerberos:'editor',canWrite:true}),store,attachments,versions:{list:async()=>[]}});assert.equal((await writer(event('attachments','POST',file))).statusCode,201);assert.equal((await writer({...event('attachments','POST',file),headers:{origin:'https://foreign.test','content-type':'application/json'}})).statusCode,403);
 assert.equal((await writer(event('data','POST',{id,revision:'one',review:{...emptyReview(),finalVersion:fileId}}))).statusCode,400,'Supporting files cannot be selected as final proposals');
 const download=await writer(event('attachment'));assert.equal(download.statusCode,200);assert.equal(download.headers['Content-Type'],'message/rfc822');assert.match(download.headers['Content-Disposition'],/^attachment/);assert.match(download.headers['Content-Security-Policy'],/sandbox/);assert(!JSON.parse((await writer(event('attachments'))).body).attachments[0].rid);
 assert.equal((await writer({...event('attachment'),queryStringParameters:{id:'FY27-RCT2|missing',version:fileId}})).statusCode,404);
 const denied=createRctHandler({authorize:async()=>({statusCode:401}),store:{list(){throw Error('Must not read');}}});for(const action of ['attachments','attachment'])assert.equal((await denied(event(action))).statusCode,401);
});
