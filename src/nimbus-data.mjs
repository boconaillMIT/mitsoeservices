import {createHash,randomUUID} from 'node:crypto';
import legacy from './nimbus-legacy-config.cjs';
import access from './access.cjs';
import units from './units.cjs';
import {qbRequest,createSnapshotRepository,pointerStore,unitAccounts} from './nimbus-store.mjs';
export const LABELS=['Transaction Key','Fiscal Year','Fiscal Period','Supervisor MIT ID','Approved Date Source Serial','Document Type','Document Type Code','Cost Collector ID','Cost Collector Name','GL Account ID','GL Account Name','Line Item Text','Public Comment','Submitted By','Approved By','Transaction Number','Transaction Line Number','Base Amount','Non Base Amount'];
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const searchIndices=[0,3,7,8,9,10,11,12,13,14,15];
const quote=v=>String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
function filters(params){const q=String(params.q||'').trim().slice(0,400),exclude=String(params.exclude||'').trim().slice(0,400),year=String(params.year||'');if(year&&!/^\d{4}$/.test(year))throw Error('Choose a valid fiscal year.');const tokens=q.split(/\s+/).filter(Boolean),omissions=exclude.split(/[,;\r\n]+/).map(v=>v.trim()).filter(Boolean);if(tokens.length+omissions.length>9)throw Error('Use up to nine search and exclusion terms.');const page=Number(params.page||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw Error('Invalid page.');return {q,tokens,omissions,year,page};}
export function validRows(rows,accounts,maxRows=500){
 if(!Array.isArray(rows)||!rows.length||rows.length>maxRows)throw Error('Invalid Nimbus batch size.');
 const allowed=accounts?new Set(accounts):null;
 return rows.map(row=>{
  if(!Array.isArray(row)||row.length!==19)throw Error('The export must contain the 19 Nimbus columns.');
  const clean=row.map(v=>v===null||v===undefined?'':String(v));
  if(clean.some(v=>v.length>20000)||!clean[0]||!/^\d{4}$/.test(clean[1])||!/^\d{7}$/.test(clean[7]))throw Error('Invalid Nimbus row or account.');
  if(allowed&&!allowed.has(clean[7]))throw Error('The export includes an account outside the trusted unit account list. No new dataset was published. Ask a school administrator to review the account mapping.');
  for(const index of [17,18])if(clean[index]&&!/^-?\d{1,15}(\.\d{1,2})?$/.test(clean[index]))throw Error('Invalid Nimbus amount.');
  return clean;
 });
}
async function legacySearch(f,query){
 const pf=legacy.imports.fields;
 const imported=await query('records/query',{from:legacy.imports.id,select:[pf['Import Status']],where:`{${pf['Source SHA256']}.EX.'${legacy.sha256}'}`,options:{top:2}});
 if(imported.data?.length!==1||imported.data[0][pf['Import Status']]?.value!=='Verified')throw Error('The original SoE import could not be verified.');
 const tables=legacy.partitions.filter(t=>!f.year||Number(f.year)>=Number(t.years[0])&&Number(f.year)<=Number(t.years[1]));
 const wheres=tables.map(t=>{const fields=t.fields,terms=[];if(f.year)terms.push(`{${fields['Fiscal Year']}.EX.'${f.year}'}`);for(const token of f.tokens)terms.push('('+searchIndices.map(i=>`{${fields[LABELS[i]]}.CT.'${quote(token)}'}`).join('OR')+')');for(const token of f.omissions)for(const i of searchIndices)terms.push(`{${fields[LABELS[i]]}.XCT.'${quote(token)}'}`);return terms.join('AND');});
 const counts=await Promise.all(tables.map((t,i)=>query('records/query',{from:t.id,select:[3],where:wheres[i],options:{top:1}}).then(r=>{if(!Number.isSafeInteger(r.metadata?.totalRecords))throw Error('Incomplete Nimbus result.');return r.metadata.totalRecords;})));
 const total=counts.reduce((a,b)=>a+b,0),pages=Math.max(1,Math.ceil(total/100)),page=Math.min(f.page,pages);let skip=(page-1)*100,left=100;const rows=[];
 for(let i=0;i<tables.length&&left;i++){if(skip>=counts[i]){skip-=counts[i];continue;}const t=tables[i],top=Math.min(left,counts[i]-skip),r=await query('records/query',{from:t.id,select:LABELS.map(label=>t.fields[label]),where:wheres[i],sortBy:[{fieldId:t.fields['Source Row'],order:'ASC'}],options:{skip,top}});if(r.metadata?.totalRecords!==counts[i]||r.data?.length!==top)throw Error('Nimbus records changed during search. Search again.');rows.push(...r.data.map(raw=>LABELS.map(label=>raw[t.fields[label]]?.value??'')));left-=top;skip=0;}
 return {source:'legacy',total,pages,page,rows,labels:LABELS,refreshed_at:null,note:'Original verified SoE-wide import. Refresh date was not recorded.'};
}
async function loadSnapshot(scope,head,repository){
 const m=await repository.get(scope,head.manifest);
 if(m.schema!==1||m.scope!==scope||m.run!==head.run||!Array.isArray(m.chunks)||m.chunks.length>4000||m.rows!==head.rows)throw Error('Invalid snapshot manifest.');
 const rows=[];
 for(let offset=0;offset<m.chunks.length;offset+=10){const group=await Promise.all(m.chunks.slice(offset,offset+10).map(async(c,j)=>{if(c.id!==scope+':'+head.run+':'+(offset+j))throw Error('Invalid snapshot chunk.');const chunk=await repository.get(scope,c.id);if(!Array.isArray(chunk)||digest(chunk)!==c.hash)throw Error('Snapshot integrity check failed.');return chunk;}));for(const chunk of group)rows.push(...chunk);}
 if(rows.length!==m.rows)throw Error('Incomplete snapshot.');return {rows,manifest:m};
}
export function createNimbusDataHandler({authorize=access.authorize,store=pointerStore,repository=()=>createSnapshotRepository(),accounts=unitAccounts,query=qbRequest,now=()=>new Date(),uuid=randomUUID}={}){return async event=>{
 const reply=(status,data)=>({statusCode:status,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
 const params=event.queryStringParameters||{},scope=params.unit||'school';
 if(scope!=='school'&&!Object.hasOwn(units.ALL_UNITS,scope))return reply(404,{error:'Unit not found.'});
 const auth=await authorize(event,{scope,minimum:scope==='school'?'admin':event.httpMethod==='POST'?'write':'read'});if(!auth.user)return auth;
 if(scope==='soe-fake'&&event.httpMethod==='POST')return reply(403,{error:'SOE Fake is a fictional test unit. Live Warehouse exports cannot be imported here.'});
 if(event.httpMethod==='POST'){
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!process.env.APP_ORIGIN||h.origin!==process.env.APP_ORIGIN||h['content-type']?.split(';')[0]!=='application/json')return reply(403,{error:'Same-origin JSON required.'});
  if(typeof event.body!=='string'||event.body.length>4000000)return reply(413,{error:'Upload batch too large.'});
  let body;try{body=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid JSON.'});}
  try{
   const s=await store(),r=repository();
   if(body.action==='begin'){
    if(!Number.isSafeInteger(body.rows)||body.rows<1||body.rows>100000||typeof body.filename!=='string'||body.filename.length>200||!/^[a-f0-9]{64}$/.test(body.sha256||''))return reply(400,{error:'Invalid source details.'});
    const current=await s.getWithMetadata('head:'+scope,{type:'json'}),run=uuid(),allow=await accounts(scope),pending={scope,run,owner:auth.kerberos,created:now().toISOString(),expected:body.rows,filename:body.filename,sha256:body.sha256,accounts:allow,headEtag:current?.etag||null,rows:0,chunks:[]};
    await s.setJSON('pending:'+scope+':'+run,pending,{onlyIfNew:true});return reply(200,{run});
   }
   if(!/^[a-f0-9-]{36}$/.test(body.run||''))return reply(400,{error:'Invalid refresh ID.'});
   const pendingKey='pending:'+scope+':'+body.run,p=await s.getWithMetadata(pendingKey,{type:'json'}),v=p?.data;
   if(!v||v.scope!==scope||v.owner!==auth.kerberos||now()-new Date(v.created)>86400000)return reply(403,{error:'This refresh is not available to your login.'});
   if(body.action==='batch'){
    if(body.index!==v.chunks.length)return reply(409,{error:'Refresh sequence changed. Start a new refresh.'});
    const rows=validRows(body.rows,v.accounts);if(v.rows+rows.length>v.expected)throw Error('Too many rows.');
    const id=scope+':'+v.run+':'+body.index;await r.put(scope,id,rows);
    v.rows+=rows.length;v.chunks.push({id,hash:digest(rows)});
    const updated=await s.setJSON(pendingKey,v,{onlyIfMatch:p.etag});if(!updated.modified)return reply(409,{error:'Refresh changed. Start a new refresh.'});return reply(200,{rows:v.rows});
   }
   if(body.action==='finish'){
    if(v.rows!==v.expected)throw Error('Incomplete export; the previous snapshot remains published.');
    const head={scope,run:v.run,rows:v.rows,manifest:scope+':'+v.run+':manifest',refreshed_at:now().toISOString(),refreshed_by:auth.kerberos,filename:v.filename,sha256:v.sha256};
    const manifest={schema:1,...head,chunks:v.chunks};await r.put(scope,head.manifest,manifest);
    const loaded=await loadSnapshot(scope,head,r),seen=new Set();
    for(const row of loaded.rows){const key=[row[1],row[0],row[7]].join('|');if(seen.has(key))throw Error('Duplicate Nimbus transaction lines need review.');seen.add(key);}
    const saved=await s.setJSON('head:'+scope,head,v.headEtag?{onlyIfMatch:v.headEtag}:{onlyIfNew:true});if(!saved.modified)return reply(409,{error:'A newer refresh was published. Your export has not replaced it.'});
    return reply(200,{rows:head.rows,refreshed_at:head.refreshed_at});
   }
   return reply(400,{error:'Unknown refresh action.'});
  }catch(e){return reply(400,{error:/trusted unit|outside the trusted|Invalid Nimbus|Duplicate Nimbus|Incomplete export|Too many rows|19 Nimbus/.test(e.message)?e.message:'The refresh could not be saved or verified. The previous saved dataset remains available.'});}
 }
 try{
  const s=await store(),head=await s.get('head:'+scope,{type:'json'});
  if(params.action==='status')return reply(200,{scope,canRefresh:scope==='school'||auth.canWrite,saved:head?{rows:head.rows,refreshed_at:head.refreshed_at,refreshed_by:head.refreshed_by,filename:head.filename}:null,legacyAvailable:scope==='school'});
  const f=filters(params);
  if(params.source==='legacy'){if(scope!=='school')return reply(403,{error:'The SoE-wide dataset is school-administrator-only.'});return reply(200,await legacySearch(f,query));}
  if(!head){if(scope==='school')return reply(200,await legacySearch(f,query));return reply(200,{source:'saved',total:0,pages:1,page:1,rows:[],labels:LABELS,note:'No Nimbus export has been published for this unit yet.'});}
  if(head.scope!==scope)throw Error('Invalid saved scope.');
  const saved=await loadSnapshot(scope,head,repository()),matches=saved.rows.filter(row=>{
   if(f.year&&row[1]!==f.year)return false;const values=searchIndices.map(i=>String(row[i]||'').toLowerCase());return f.tokens.every(t=>values.some(v=>v.includes(t.toLowerCase())))&&!f.omissions.some(t=>values.some(v=>v.includes(t.toLowerCase())));
  }),total=matches.length,pages=Math.max(1,Math.ceil(total/100)),page=Math.min(f.page,pages);
  return reply(200,{source:'saved',total,pages,page,rows:matches.slice((page-1)*100,page*100),labels:LABELS,refreshed_at:head.refreshed_at,refreshed_by:head.refreshed_by});
 }catch{return reply(503,{error:'Saved Nimbus data could not be verified or searched. No other unit or SoE-wide dataset has been substituted.'});}
};}
export const handler=createNimbusDataHandler();
