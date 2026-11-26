import {randomUUID,createHash} from 'node:crypto';
import access from './access.cjs';
import policy from './policy.cjs';
import {createDrStore} from './dr-store.mjs';
import {drPage} from './dr-page.mjs';
import {ID,EDITABLE,cleanRequest,applyAction,visibleRecord,fail,text} from '../public/dr-model.mjs';
import {validateAttachment,ATTACHMENT_TYPES} from './rct-attachments.mjs';
const headers={...access.noStore,'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const json=(statusCode,data)=>({statusCode,headers,body:JSON.stringify(data)});
export function createDrHandler({authorize=access.authorize,store=createDrStore(),uuid=randomUUID,now=()=>new Date().toISOString(),origin=()=>process.env.APP_ORIGIN}={}){return async event=>{
 const path=event.path||'',route=path.startsWith('/donation-requests/')?path.slice('/donation-requests/'.length):event.queryStringParameters?.action||'page',requesterView=route==='request'||event.queryStringParameters?.view==='requester',action=route==='request'?'page':route;
 if(!['page','data','attachment'].includes(action))return json(404,{error:'Page not found.'});
 if(!['GET','POST'].includes(event.httpMethod)||event.httpMethod==='POST'&&action!=='data')return {...json(405,{error:'Method not allowed.'}),headers:{...headers,Allow:action==='data'?'GET, POST':'GET'}};
 const auth=await authorize(event,{scope:'dr-requester'});
 if(!auth.user){if(auth.statusCode===401&&action==='page')return {statusCode:302,headers:{...access.noStore,Location:'/.netlify/functions/auth-login?returnTo='+encodeURIComponent(requesterView?'/donation-requests/request':'/donation-requests')},body:''};return auth;}
 const kerberos=policy.normalizeLogin(auth.user.kerberos);if(!kerberos)return json(403,{error:'A valid MIT Kerberos login is required.'});
 const role=policy.effectiveRole(auth.policy.data,kerberos,'dr'),staff=!requesterView&&Boolean(role),actor={kerberos,canWrite:staff&&(policy.CAPABILITIES[role]||0)>=2,identity:{name:auth.user.name||kerberos,email:auth.user.email||kerberos+'@mit.edu',department:auth.user.department||''}};
 if(auth.testView)return json(403,{error:'Donation Requests is unavailable in the restricted unit test view.'});
 if(action==='page')return {statusCode:200,headers:{...access.noStore,'Content-Type':'text/html; charset=utf-8'},body:drPage({...auth,drStaff:staff})};
 const scope=staff?{}:{owner:kerberos};
 const allowed=record=>record&&(staff||record.owner===kerberos);
 try{
  if(event.httpMethod==='GET'){
   if(action==='data'){
    const records=await store.list(scope),organizations=staff?await store.organizations():[...new Map(records.filter(r=>r.organizationId).map(r=>[r.organizationId,{id:r.organizationId,name:r.request.organization}])).values()];
    return json(200,{records:records.map(r=>visibleRecord(r,staff)),organizations,staff,canWrite:actor.canWrite,viewer:{kerberos,name:auth.user.name||kerberos,email:auth.user.email||kerberos+'@mit.edu',department:auth.user.department||''}});
   }
   const {id,file}=event.queryStringParameters||{},record=await store.get(id);if(!allowed(record))return json(404,{error:'Attachment not found.'});
   const metadata=record.files.find(f=>f.id===file&&(staff||f.kind!=='correspondence'));if(!metadata)return json(404,{error:'Attachment not found.'});
   const downloaded=await store.download(id,file);if(!downloaded)return json(404,{error:'Attachment not found.'});
   const bytes=validateAttachment({id:'FY27-RCT2|donation',filename:downloaded.filename,content:downloaded.content});
   if(downloaded.filename!==metadata.filename||createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)throw Error('Attachment fingerprint differs.');
   return {statusCode:200,headers:{...access.noStore,'Content-Type':ATTACHMENT_TYPES[metadata.filename.split('.').pop().toLowerCase()],'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(metadata.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()),'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'},body:bytes};
  }
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!origin()||h.origin!==origin()||!/^application\/json(?:\s*;|$)/i.test(h['content-type']||''))return json(403,{error:'Use the secure same-origin request form.'});
  if(typeof event.body!=='string'||Buffer.byteLength(event.body)>4300000)return json(413,{error:'Request is too large.'});
  let command;try{command=JSON.parse(event.body);}catch{return json(400,{error:'Invalid request.'});}
  if(!command||typeof command!=='object'||Array.isArray(command)||!ID.test(command.id||''))fail('Invalid request identifier.');
  if(command.action==='create'){
   const existing=await store.get(command.id);if(existing){if(!allowed(existing))return json(404,{error:'Request not found.'});if(existing.createdBy!==kerberos)return json(409,{error:'Request identifier already exists.'});return json(200,{record:visibleRecord(existing,staff)});}
   let owner=kerberos;if(command.owner){if(!actor.canWrite)fail('Only DR writers may enter requests on behalf of others.',403);owner=policy.normalizeLogin(command.owner);if(!owner)fail('Enter the requester’s MIT Kerberos login.');}
   const own=owner===kerberos,request=cleanRequest({requesterName:own?auth.user.name||kerberos:'',requesterEmail:own?auth.user.email||kerberos+'@mit.edu':owner+'@mit.edu',department:own?auth.user.department||'':''}),at=now();
   const record={id:command.id,revision:uuid(),owner,createdBy:kerberos,departmentSource:own&&auth.user.department?'directory':'self-reported',organizationId:null,status:own?'draft':'inquiry',request,validity:null,finance:null,files:[],history:[{action:'create',by:kerberos,at,status:own?'draft':'inquiry',message:own?'':'Entered on behalf of '+owner}],createdAt:at,updatedAt:at};
   return json(201,{record:visibleRecord(await store.create(record),staff)});
  }
  const record=await store.get(command.id);if(!allowed(record))return json(404,{error:'Request not found.'});
  if(record.owner!==kerberos&&!actor.canWrite)fail('Donation Requests Write access is required.',403);
  if(command.revision!==record.revision)fail('This request changed. Reload before saving.',409);
  let attachment;
  if(command.action==='attach'){
   if(!EDITABLE.includes(record.status))fail('Reopen the request before adding attachments.',409);
   if(!['budget','supporting','correspondence'].includes(command.kind))fail('Choose an attachment category.');
   if(command.kind==='correspondence'&&!actor.canWrite)fail('Staff access is required.',403);
   if(record.files.length>=40)fail('This request has reached its attachment limit.');
   let bytes;try{bytes=validateAttachment({id:'FY27-RCT2|donation',filename:command.filename,content:command.content});}catch(error){fail(error.message);}
   if(command.kind==='budget'&&!/\.(pdf|xlsx|docx)$/i.test(command.filename))fail('Attach the itemized budget as PDF, Excel or Word.');
   const fileId=await store.upload(record.id,{filename:command.filename,content:command.content},kerberos);
   attachment={id:fileId,filename:command.filename,kind:command.kind,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),by:kerberos,at:now()};
  }
  let next=applyAction(record,command,actor,{uuid,now,attachment});
  if(command.action==='save'&&next.request.organization){
   if(command.organizationId&&!staff&&!(await store.list(scope)).some(r=>r.organizationId===command.organizationId))fail('Choose an organization from your own prior requests.',403);
   const organization=await store.organization(text(next.request.organization,4000),command.organizationId||null);next.organizationId=organization.id;next.request.organization=organization.name;
   next.history.at(-1).snapshot.request=structuredClone(next.request);
  }
  next=await store.save(next,record.revision);return json(200,{record:visibleRecord(next,staff)});
 }catch(error){if([400,403,404,409,413].includes(error.status))return json(error.status,{error:error.message});console.error('Donation Requests failed:',error.code||error.name||'UNKNOWN');return json(503,{error:'Donation Requests is temporarily unavailable. Your last confirmed save is retained. Please retry or refresh.'});}
};}
export const handler=createDrHandler();
