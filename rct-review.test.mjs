import test from 'node:test';import assert from 'node:assert/strict';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {emptyReview,validateReview,fundingSummary} from './src/rct-model.mjs';
import {createRctHandler} from './src/rct-review.mjs';import {createRctStore} from './src/rct-store.mjs';
import {exportReviews} from './src/rct-export.mjs';import {dropboxLink,loadDropboxTemplate} from './src/rct-dropbox.mjs';import {createHash} from 'node:crypto';
import access from './src/access.cjs';import policy from './src/policy.cjs';import {mainNavigation} from './src/navigation.cjs';
const source={order:0,pi:'Example, Faculty',area:'Example School',department:'Example department',duration:'6 months',requested:120,budgetTotal:120,prior:'No',budgetDifference:0,sourceNotes:'Example source note',title:'Example project',proposalUrl:'https://www.dropbox.com/scl/fo/example/token/example.pdf?rlkey=test&dl=0',workbookUrl:'https://www.dropbox.com/scl/fo/example/token/example.xlsx?rlkey=test&dl=0',templateSha:'def'};
const row=()=>({id:'FY27-RCT2|example',source,review:emptyReview(),revision:'v1',updatedBy:'',updatedAt:null});
const event=(action='',method='GET',body)=>({path:'/soe-hq/rct-review'+(action?'/'+action:''),httpMethod:method,headers:{origin:'https://example.test','content-type':'application/json'},queryStringParameters:{},body:body&&JSON.stringify(body)});
const auth=async()=>({user:{},kerberos:'reviewer',canWrite:true,schoolAccess:true});
test('RCT money inputs preserve blanks and zero and reject invalid values',()=>{
 assert.deepEqual(validateReview(emptyReview()),emptyReview());assert.equal(validateReview({...emptyReview(),award:0}).award,0);
 for(const award of [-1,NaN,Infinity,'12',0.001,100000001])assert.throws(()=>validateReview({...emptyReview(),award}));
 assert.throws(()=>validateReview({...emptyReview(),notes:'x'.repeat(15001)}));assert.throws(()=>validateReview({...emptyReview(),unexpected:true}));
 assert.deepEqual(fundingSummary(emptyReview()),{assigned:null,local:null,central:null,unallocated:null,complete:false});
 const r={...emptyReview(),award:100,school:20,department:10,pi:5,provost:60,vpr:5,decision:'Support'};assert.deepEqual(fundingSummary(r),{assigned:100,local:35,central:65,unallocated:0,complete:true});
 assert.equal(fundingSummary({...r,award:105}).complete,false);assert.equal(fundingSummary({...emptyReview(),award:0,decision:'Decline'}).complete,true);
});
test('RCT school permissions protect pages, data, PDF, export and writes',async()=>{
 const data=policy.initialPolicy();for(const [username,scope,role]of [['unit_person','aeroastro','admin'],['hq_limited','school','limited_read'],['hq_reader','school','read'],['hq_writer','school','write']])data.grants.push({username,scope,role});
 for(const username of ['unit_person','hq_limited','hq_reader','hq_writer']){
  let touched=0;const authorize=(e,o)=>access.authorize(e,{...o,reader:async()=>({kerberos:username}),load:async()=>({data,etag:'x'}),loadFeatures:async()=>({data:{features:{}}})});
  const store={list:async()=>{touched++;return [row()];},save:async()=>{touched++;return {row:row()};}},handler=createRctHandler({authorize,store,template:async()=>Buffer.from('file'),exporter:()=>Buffer.from('xlsx')});
  for(const action of ['','data','proposal','source','export']){const e=event(action);e.queryStringParameters.id=row().id;const r=await handler(e);assert.equal(r.statusCode,['hq_reader','hq_writer'].includes(username)?['proposal','source'].includes(action)?302:200:403);}
  if(['unit_person','hq_limited'].includes(username))assert.equal(touched,0);
  const saved=await handler(event('data','POST',{id:row().id,revision:'v1',review:emptyReview()}));assert.equal(saved.statusCode,username==='hq_writer'?200:403);
 }
 assert.ok(mainNavigation({schoolAccess:true}).includes('/soe-hq/rct-review'));assert.ok(!mainNavigation().includes('/soe-hq/rct-review'));
});
test('RCT anonymous routes never open storage and page redirects to MIT sign-in',async()=>{
 const handler=createRctHandler({authorize:async()=>({statusCode:401,body:'Sign in'}),store:{list(){throw Error('Must not read');}}});
 assert.equal((await handler(event())).statusCode,302);for(const action of ['data','proposal','source','export'])assert.equal((await handler(event(action))).statusCode,401);
});
test('RCT writes enforce same-origin JSON, bounded fields and optimistic revision',async()=>{
 let saves=0;const handler=createRctHandler({authorize:auth,store:{save:async()=>{saves++;return {conflict:true};}}}),e=event('data','POST',{id:row().id,revision:'v1',review:emptyReview()});
 assert.equal((await handler({...e,headers:{...e.headers,origin:'https://foreign.test'}})).statusCode,403);
 assert.equal((await handler({...e,headers:{...e.headers,'content-type':'text/plain'}})).statusCode,403);assert.equal(saves,0);
 assert.equal((await handler({...e,body:'{bad'})).statusCode,400);assert.equal((await handler({...e,body:'x'.repeat(70001)})).statusCode,413);
 assert.equal((await handler(event('data','POST',{id:"bad'OR'1",revision:'v1',review:emptyReview()}))).statusCode,400);
 assert.equal((await handler(e)).statusCode,409);assert.equal(saves,1);
 const direct=await handler({...event('','DELETE'),path:'/.netlify/functions/rct-review',queryStringParameters:{action:'data'}});assert.equal(direct.statusCode,405);
});
test('RCT Dropbox redirects and Excel export require authorization and stay private',async()=>{
 const loaded=[],handler=createRctHandler({authorize:auth,store:{list:async()=>[row()]},template:async(source)=>{loaded.push(source);return Buffer.from('template');},exporter:()=>Buffer.from('excel')});
 const e=event('proposal');e.queryStringParameters.id=row().id;const pdf=await handler(e);assert.equal(pdf.statusCode,302);assert.equal(pdf.headers.Location,source.proposalUrl);assert.match(pdf.headers['Cache-Control'],/no-store/);assert.equal(loaded.length,0);
 e.queryStringParameters.id='../unknown';assert.equal((await handler(e)).statusCode,404);
 const original=await handler(event('source'));assert.equal(original.statusCode,302);assert.equal(original.headers.Location,source.workbookUrl);
 const xlsx=await handler(event('export'));assert.equal(xlsx.statusCode,200);assert.match(xlsx.headers['Content-Disposition'],/xlsx/);assert.match(xlsx.headers['Cache-Control'],/private/);assert.equal(loaded.length,1);
 const unsafe=createRctHandler({authorize:auth,store:{list:async()=>[{...row(),source:{...source,proposalUrl:'https://evil.test/file.pdf'}}]}});assert.equal((await unsafe({...event('proposal'),queryStringParameters:{id:row().id}})).statusCode,503);
});
test('RCT workbook download restricts redirects, sizes and the imported fingerprint',async()=>{
 const bytes=Buffer.from('PK example workbook'),sha=createHash('sha256').update(bytes).digest('hex'),s={...source,templateSha:sha},calls=[];
 const downloaded=await loadDropboxTemplate(s,{fetcher:async(url)=>{calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:'https://dl.dropboxusercontent.com/example.xlsx'}}):new Response(bytes);}});assert.deepEqual(downloaded,bytes);assert.match(calls[0],/dl=1/);
 for(const url of ['http://www.dropbox.com/scl/fo/a/b/file.pdf','https://evil.test/file.pdf','https://www.dropbox.com/scl/fo/a/b/file.xlsx'])assert.throws(()=>dropboxLink(url,'.pdf'));
 await assert.rejects(()=>loadDropboxTemplate(s,{fetcher:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}));
 await assert.rejects(()=>loadDropboxTemplate(s,{maxBytes:2,fetcher:async()=>new Response(bytes)}));
 await assert.rejects(()=>loadDropboxTemplate(s,{fetcher:async()=>new Response(Buffer.from('PK changed'))}));
});
function transportFixture(){const labels=['Key','Round','Source JSON','Review JSON','Revision','Updated By','Updated At'],fields=labels.map((label,i)=>({label,id:i+10}));let revision='v1',editCalls=0;return {fields,get editCalls(){return editCalls;},change:()=>{revision='other';},transport:{rest:async(path)=>path.startsWith('fields')?fields:{data:[{'3':{value:8},'10':{value:row().id},'11':{value:'FY27-RCT2'},'12':{value:JSON.stringify(source)},'13':{value:JSON.stringify(emptyReview())},'14':{value:revision},'15':{value:''},'16':{value:null}}],metadata:{totalRecords:1}},native:async(table,action,body)=>{if(action==='API_GetRecordInfo')return `<qdbapi><update_id>u1</update_id><field><fid>14</fid><value>${revision}</value></field></qdbapi>`;assert.match(body,/<update_id>u1<\/update_id>/);editCalls++;return '<qdbapi><errcode>0</errcode></qdbapi>';}}};}
test('RCT QuickBase revisions reject stale clients and use atomic update_id',async()=>{
 const f=transportFixture(),store=createRctStore({transport:f.transport,table:'exampletable',uuid:()=> 'v2',now:()=>new Date('2026-01-01')});
 assert.equal((await store.save(row().id,emptyReview(),'old','reviewer')).conflict,true);assert.equal(f.editCalls,0);
 const saved=await store.save(row().id,emptyReview(),'v1','reviewer');assert.equal(saved.row.revision,'v2');assert.equal(f.editCalls,1);
 const other=transportFixture(),original=other.transport.native;other.transport.native=async(...args)=>{if(args[1]==='API_GetRecordInfo')other.change();return original(...args);};assert.equal((await createRctStore({transport:other.transport,table:'exampletable'}).save(row().id,emptyReview(),'v1','reviewer')).conflict,true);assert.equal(other.editCalls,0);
});
function template(){const cells=(r)=>'ABCDEFGHIJKLMNOPQRSTUV'.split('').map(c=>`<c r="${c}${r}" s="2"/>`).join('');const data=`<sheetData><row r="3">${cells(3)}</row><row r="4">${cells(4)}</row><row r="5"><c r="B5" s="2"><v>1</v></c><c r="E5" s="2"><v/></c><c r="H5" s="2"><v>1</v></c></row><row r="7">${cells(7)}</row><row r="8">${cells(8)}</row><row r="18">${cells(18)}</row></sheetData>`;return zipSync(Object.fromEntries(Object.entries({'xl/worksheets/sheet1.xml':`<worksheet><dimension ref="A2:V18"/>${data}</worksheet>`,'xl/tables/table1.xml':'<table ref="A7:V17"><calculatedColumnFormula>[2]EXTERNAL</calculatedColumnFormula></table>','xl/workbook.xml':'<workbook><externalReferences><externalReference/></externalReferences><calcPr/></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Type="http://example/externalLink" Target="x"/></Relationships>','[Content_Types].xml':'<Types><Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="x"/></Types>','xl/externalLinks/externalLink1.xml':'external','xl/calcChain.xml':'chain','xl/styles.xml':'unchanged style'}).map(([k,v])=>[k,strToU8(v)])));}
test('RCT Excel maps all 11 proposals, preserves styles, removes links and recalculates local formulas',()=>{
 const rows=Array.from({length:11},(_,i)=>({...row(),id:'FY27-RCT2|fake-'+i,source:{...source,pi:'Example '+i,order:i},review:{...emptyReview(),award:i===0?0:100,school:i===0?null:40,provost:i===0?null:60,decision:'Support',notes:'=NOT_A_FORMULA & <text>'}}));
 const zip=unzipSync(exportReviews(template(),rows)),sheet=strFromU8(zip['xl/worksheets/sheet1.xml']);
 assert.match(sheet,/<dimension ref="A2:V19"/);assert.match(sheet,/<c r="B18"[^>]*t="inlineStr">[\s\S]*?Example 10/);assert.match(sheet,/<c r="G8"[^>]*><v>0<\/v>/);assert.match(sheet,/<c r="H8"[^>]*\/>/);
 assert.match(sheet,/IF\(G18="","",G18-SUM\(H18:M18\)\)/);assert.match(sheet,/COUNTA\(B8:B18\)/);assert.match(sheet,/=NOT_A_FORMULA &amp; &lt;text&gt;/);
 assert.equal(strFromU8(zip['xl/styles.xml']),'unchanged style');assert.ok(!Object.keys(zip).some(k=>k.includes('externalLinks')||k.includes('calcChain')));assert.ok(!strFromU8(zip['xl/tables/table1.xml']).includes('calculatedColumnFormula'));assert.match(strFromU8(zip['xl/tables/table1.xml']),/A7:V18/);
});
test.before(()=>{process.env.APP_ORIGIN='https://example.test';});
