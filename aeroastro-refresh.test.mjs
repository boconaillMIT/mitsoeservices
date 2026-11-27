import test from 'node:test';import assert from 'node:assert/strict';
import {prepareAccountRefresh,readReportCsv,decodeReportBytes,MAX_REPORT_BYTES} from './public/aeroastro-refresh-model.mjs';
import {createAccountRefreshHandler} from './src/aeroastro-account-refresh.mjs';
import {createFinanceHandler,financeHtml} from './src/aeroastro-finance.mjs';
import {createFinanceRepository} from './src/aeroastro-finance-store.mjs';
import {seal,unseal} from './src/nimbus-store.mjs';
const row={account:'9900001',name:'Fictional account',profitCenter:'P061000',status:'Open',currentBalance:100,ytdExpenses:50,commitments:20};
const source=()=>({schema:1,unit:'aeroastro',kind:'accounts',asOf:'2026-11-01',sourceHash:'a'.repeat(64),publishedAt:'2026-11-01T12:00:00Z',label:'Fictional source',rows:[{...row}]});
const header='Supervisor,Cost Collector ID,Unexpended Balance,FYTD Expenses,Total SAP Financial Commitments,Uncommitted Balance';
const csv=header+'\r\n"Example, Person",9900001,200,80,30,170\r\n';
const auth={user:{kerberos:'example'},kerberos:'example',canWrite:true,navigation:{}};
const event=b=>({httpMethod:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(b)});
test('Native Cognos UTF-16LE tab-delimited CSV is decoded without changing account IDs or amounts',()=>{
 const tsv=header.replaceAll(',','\t')+'\r\nExample "Author"\t9900001\t200\t80\t30\t170\r\n';
 const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from(tsv,'utf16le')]);const decoded=decodeReportBytes(bytes);
 assert.equal(prepareAccountRefresh(decoded,source(),'2026-11-27').summary.currentBalance,200);
 assert.equal(prepareAccountRefresh(header.replaceAll(',',';')+'\nExample;9900001;200;80;30;170',source(),'2026-11-27').summary.commitments,30);
 assert.throws(()=>decodeReportBytes(Uint8Array.from([255,255,255])));assert.throws(()=>readReportCsv('a\0b'));
});
test('Report CSV handles quoted fields and reconciles balances without accepting arbitrary account ownership',()=>{
 assert.equal(readReportCsv('"a\nb",c\r\n')[0][0],'a\nb');const p=prepareAccountRefresh(csv,source(),'2026-11-27');assert.equal(p.summary.currentBalance,200);assert.equal(p.summary.changed,1);assert.equal(p.rows[0].profitCenter,'P061000');
 for(const bad of [csv.replace('9900001','9900002'),csv+'"Example",9900001,100,50,20,80\n',csv.replace(',170',',160'),header+'\n',csv.replace(',200',',oops'),csv.replace(',200',',"=1+2"'),csv.replace(',200',',"200,50"')])assert.throws(()=>prepareAccountRefresh(bad,source(),'2026-11-27'));
 assert.throws(()=>prepareAccountRefresh(csv,source(),'2026-10-01'));assert.throws(()=>prepareAccountRefresh(csv,source(),'2026-02-31'));assert.throws(()=>readReportCsv('x'.repeat(MAX_REPORT_BYTES+1)));
 assert.throws(()=>prepareAccountRefresh(csv+'Overall - Total,,201,80,30,171\n',source(),'2026-11-27'),/total/);
 const credit=prepareAccountRefresh(csv.replace(',200,80,30,170',',-20,-5,30,-50'),source(),'2026-11-27');assert.equal(credit.rows[0].currentBalance,-20);
});
test('Refresh preview is read-only; confirmation binds actor, source version, file, date and expiry',async()=>{
 const before=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.test';let current=source(),writes=0,time=new Date('2026-11-27T12:00:00Z');const repo={snapshot:async()=>current,refreshAccounts:async(prev,next)=>{assert.equal(prev,current);writes++;current=next;return {saved:true};}};
 const h=createAccountRefreshHandler({key:()=>Buffer.alloc(32,1),now:()=>time,uuid:()=> '11111111-1111-4111-8111-111111111111'}),base={csv,asOf:'2026-11-27'};
 const preview=async()=>JSON.parse((await h(event({...base,operation:'preview'}),auth,repo)).body);
 try{
  const p=await preview();assert.equal(writes,0);const commit={...base,operation:'commit',issued:p.issued,confirmation:p.confirmation};
  assert.equal((await h(event(commit),{...auth,kerberos:'other'},repo)).statusCode,409);
  assert.equal((await h(event({...commit,csv:csv.replace(',200,80,30,170',',201,80,30,171')}),auth,repo)).statusCode,409);
  assert.equal((await h(event({...commit,asOf:'2026-11-26'}),auth,repo)).statusCode,409);
  current={...current,publishedAt:'2026-11-02T12:00:00Z'};assert.equal((await h(event(commit),auth,repo)).statusCode,409);current=source();
  time=new Date('2026-11-27T12:11:00Z');assert.equal((await h(event(commit),auth,repo)).statusCode,409);time=new Date('2026-11-27T12:00:00Z');
  assert.equal((await h(event(commit),{...auth,canWrite:false},repo)).statusCode,403);assert.equal((await h({...event(commit),headers:{Origin:'https://wrong.test','Content-Type':'application/json'}},auth,repo)).statusCode,403);
  assert.equal((await h(event({...base,operation:'preview',asOf:'2099-01-01'}),auth,repo)).statusCode,400);
  assert.equal((await h(event(commit),auth,repo)).statusCode,200);assert.equal(writes,1);assert.equal(current.rows[0].currentBalance,200);assert.equal(current.publishedBy,'example');assert.equal(current.publishedAt,time.toISOString());
 }finally{if(before===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=before;}
});
test('Refresh routes require finance write authorization and the upload controls are absent for readers and personnel pages',async()=>{
 assert.match(financeHtml('accounts',auth),/Update account data/);assert.doesNotMatch(financeHtml('accounts',{...auth,canWrite:false}),/finance-update-toggle/);assert.doesNotMatch(financeHtml('people',auth),/finance-update-toggle/);
 let touched=false;const h=createFinanceHandler({authorize:async(e,options)=>{assert.equal(options.scope,'finance:aeroastro');assert.equal(options.minimum,'write');return {statusCode:403};},repository:()=>{touched=true;}});
 assert.equal((await h({...event({}),path:'/units/aeroastro/finance/refresh'})).statusCode,403);assert.equal(touched,false);
});
test('Account refresh uses an immutable encrypted archive and atomic current-record version check, preserving other records',async()=>{
 const key=Buffer.alloc(32,2),id='aeroastro-finance:accounts:current',current=source(),encoded=seal(current,key,'aeroastro:'+id),entries=[{'3':{value:1},'6':{value:id},'7':{value:'aeroastro'},'8':{value:encoded}}];let edits=0,conflict=false;
 const query=async(p,b)=>{const found=entries.filter(e=>b.where.includes(e['6'].value));return {data:structuredClone(found),metadata:{totalRecords:found.length}};};
 const native=async(table,action,body)=>{if(action==='API_GetRecordInfo')return '<update_id>v1</update_id>';const field=n=>new RegExp('<field fid="'+n+'">([^<]*)</field>').exec(body)?.[1];if(action==='API_AddRecord'){entries.push({'3':{value:entries.length+1},'6':{value:field(6)},'7':{value:field(7)},'8':{value:field(8)}});return '<errcode>0</errcode>';}assert.match(body,/<update_id>v1<\/update_id>/);if(conflict)throw Object.assign(Error(),{qbCode:'record_changed'});edits++;entries[0]['8'].value=field(8);return '<errcode>0</errcode>';};
 const repo=createFinanceRepository({table:'bexample',key:()=>key,query,native,now:()=>new Date('2026-11-27')}),candidate={...current,publishedBy:'example',importId:'11111111-1111-4111-8111-111111111111',rows:[{...row,currentBalance:200}]};
 assert.deepEqual(await repo.refreshAccounts({...current,label:'stale'},candidate),{conflict:true});assert.equal(edits,0);
 conflict=true;assert.deepEqual(await repo.refreshAccounts(current,candidate),{conflict:true});assert.equal(entries[0]['8'].value,encoded);conflict=false;entries.pop();
 assert.deepEqual(await repo.refreshAccounts(current,candidate),{saved:true});assert.equal(edits,1);assert.equal(entries.length,2);assert.deepEqual(unseal(entries[1]['8'].value,key,'aeroastro:'+entries[1]['6'].value),candidate);assert.deepEqual(await repo.snapshot('accounts'),candidate);
});
