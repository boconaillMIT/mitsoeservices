import {mergePersonnelDetails} from './aeroastro-personnel-details.mjs';
import {randomUUID} from 'node:crypto';
import {qbRequest,seal,unseal,encryptionKey} from './nimbus-store.mjs';
import {validateFinanceSource} from './aeroastro-finance-source.mjs';
import {readUnit} from './unit-data.mjs';import {walletAccountReference} from './aeroastro-wallet-reference.mjs';
import {createQbTransport} from './budget-hq-qb.mjs';
const scope='aeroastro',PREFIX='aeroastro-finance:',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function createFinanceRepository({query=qbRequest,table=process.env.NIMBUS_SNAPSHOTS_TABLE,key=encryptionKey,now=()=>new Date(),uuid=randomUUID,add,native,readWallet=readUnit}={}){
 const check=()=>{if(!/^b[a-z0-9]+$/.test(table||''))throw Error('Finance storage unavailable');};
 async function rows(where){check();const all=[];let expected;for(let skip=0;skip<5000;skip+=500){const r=await query('records/query',{from:table,select:[3,6,7,8],where,sortBy:[{fieldId:3,order:'ASC'}],options:{top:500,skip}});if(!Array.isArray(r.data)||!Number.isSafeInteger(r.metadata?.totalRecords)||expected!==undefined&&expected!==r.metadata.totalRecords)throw Error('Incomplete finance data');expected=r.metadata.totalRecords;all.push(...r.data);if(all.length===expected)return all;if(!r.data.length)break;}throw Error('Incomplete finance data');}
 function unpack(r){const id=r['6']?.value;if(r['7']?.value!==scope||typeof id!=='string'||!id.startsWith(PREFIX))throw Error('Finance scope mismatch');return unseal(r['8']?.value,key(),scope+':'+id);}
 return {
  async walletReference(){return walletAccountReference(await readWallet('aeroastro'));},
  async snapshot(kind){if(!['accounts','people'].includes(kind))throw Error('Invalid source');const found=await rows(`{6.EX.'${PREFIX+kind}:current'}AND{7.EX.'${scope}'}`);if(!found.length)return null;if(found.length!==1)throw Error('Ambiguous finance source');return validateFinanceSource(unpack(found[0]),kind,now());},
  async refreshAccounts(previous,candidate){
   validateFinanceSource(candidate,'accounts',now());
   if(!UUID.test(candidate.importId||'')||!candidate.publishedBy||!candidate.sourceHash)throw Error('Refresh audit metadata required');
   const id=PREFIX+'accounts:current',where=`{6.EX.'${id}'}AND{7.EX.'${scope}'}`;
   const first=await rows(where);if(first.length!==1||JSON.stringify(unpack(first[0]))!==JSON.stringify(previous))return {conflict:true};
   const rid=first[0]['3']?.value;if(!Number.isSafeInteger(rid)||rid<1)throw Error('Invalid source record');
   const call=native||createQbTransport().native;
   const info=await call(table,'API_GetRecordInfo',`<rid>${rid}</rid>`),updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/i.exec(info)?.[1];
   if(!updateId)throw Error('Source version unavailable');
   const latest=await rows(where);if(latest.length!==1||latest[0]['8'].value!==first[0]['8'].value)return {conflict:true};
   const archive=PREFIX+'accounts:refresh:'+candidate.importId;
   await call(table,'API_AddRecord',`<field fid="6">${xml(archive)}</field><field fid="7">${scope}</field><field fid="8">${xml(seal(candidate,key(),scope+':'+archive))}</field>`);
   try{await call(table,'API_EditRecord',`<rid>${rid}</rid><update_id>${xml(updateId)}</update_id><field fid="8">${xml(seal(candidate,key(),scope+':'+id))}</field>`);}catch(e){if(e.qbCode)return {conflict:true};throw e;}
   const saved=await rows(where);if(saved.length!==1||JSON.stringify(unpack(saved[0]))!==JSON.stringify(candidate))throw Error('Refresh readback failed');return {saved:true};
  },
  async refreshPeople(previous,candidate){
   validateFinanceSource(candidate,'people',now());if(candidate.rosterFormat!=='complete-v2'||validatePersonKeys(candidate,candidate.personIdentities).size!==candidate.rows.length)throw Error('Complete roster and identities required');
   if(!UUID.test(candidate.importId||'')||!candidate.publishedBy||!candidate.sourceHash)throw Error('Refresh audit metadata required');
   const id=PREFIX+'people:current',where=`{6.EX.'${id}'}AND{7.EX.'${scope}'}`;
   const first=await rows(where);if(first.length!==1||JSON.stringify(unpack(first[0]))!==JSON.stringify(previous))return {conflict:true};
   const rid=first[0]['3']?.value;if(!Number.isSafeInteger(rid)||rid<1)throw Error('Invalid source record');
   const call=native||createQbTransport().native;
   const info=await call(table,'API_GetRecordInfo',`<rid>${rid}</rid>`),updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/i.exec(info)?.[1];
   if(!updateId)throw Error('Source version unavailable');
   const latest=await rows(where);if(latest.length!==1||latest[0]['8'].value!==first[0]['8'].value)return {conflict:true};
   const archive=PREFIX+'people:refresh:'+candidate.importId;
   await call(table,'API_AddRecord',`<field fid="6">${xml(archive)}</field><field fid="7">${scope}</field><field fid="8">${xml(seal(candidate,key(),scope+':'+archive))}</field>`);
   try{await call(table,'API_EditRecord',`<rid>${rid}</rid><update_id>${xml(updateId)}</update_id><field fid="8">${xml(seal(candidate,key(),scope+':'+id))}</field>`);}catch(e){if(e.qbCode)return {conflict:true};throw e;}
   const saved=await rows(where);if(saved.length!==1||JSON.stringify(unpack(saved[0]))!==JSON.stringify(candidate))throw Error('Refresh readback failed');return {saved:true};
  },
  async peopleDetails(source){if(!source)return source;if(source.rosterFormat==='complete-v2')return validateFinanceSource(source,'people',now());const found=await rows(`{6.EX.'${PREFIX}people-details:current'}AND{7.EX.'${scope}'}`);if(!found.length)return source;if(found.length!==1)throw Error('Ambiguous personnel details');return validateFinanceSource(mergePersonnelDetails(source,unpack(found[0])),'people',now());},
  async personKeys(source){
   if(source?.kind!=='people'||source.unit!==scope||!/^[a-f0-9]{64}$/.test(source.sourceHash||''))return new Map();
   if(source.rosterFormat==='complete-v2')return validatePersonKeys(source,source.personIdentities);
   const found=await rows(`{6.EX.'${PREFIX}person-identities:current'}AND{7.EX.'${scope}'}`);if(!found.length)return new Map();if(found.length!==1)throw Error('Ambiguous people identities');const value=unpack(found[0]);
   if(value.schema!==1||value.unit!==scope||value.sourceHash!==source.sourceHash||!Array.isArray(value.rows)||value.rows.length!==source.rows.length)return new Map();
   const allowed=new Set(source.rows.map(r=>r.id)),keys=new Map();for(const r of value.rows){if(!allowed.has(r.appointmentId)||keys.has(r.appointmentId)||!/^[a-f0-9]{64}$/.test(r.personKey||''))throw Error('People identity mismatch');keys.set(r.appointmentId,r.personKey);}return keys;
  },
  async notes(){const found=await rows(`{7.EX.'${scope}'}AND{6.CT.'${PREFIX}note:'}`);return found.map(unpack).map(n=>{if(n.unit!==scope||!/^\d{7}$/.test(n.account||'')||!UUID.test(n.id||'')||typeof n.text!=='string'||typeof n.by!=='string'||!Number.isFinite(Date.parse(n.at)))throw Error('Invalid finance note');return n;}).sort((a,b)=>a.at.localeCompare(b.at));},
  async append(account,actor,body){check();const id=body.operationId||uuid();if(!UUID.test(id))throw Error('Invalid note ID');const recordKey=PREFIX+'note:'+id;const previous=await rows(`{6.EX.'${recordKey}'}AND{7.EX.'${scope}'}`);
   if(previous.length){const note=unpack(previous[0]);return note.account===account&&note.by===actor&&note.text===body.text&&note.source===(body.source||'')?{status:200,note}:{status:409,error:'This note ID was already used.'};}
   const note={schema:1,unit:scope,id,account,text:body.text,source:body.source||'',by:actor,at:now().toISOString()};
   const cipher=seal(note,key(),scope+':'+recordKey);
   // Each note is a new record. API_AddRecord fails on a duplicate unique key,
   // so simultaneous submissions cannot replace an existing note.
   const native=add|| (async body=>{const r=await fetch('https://mit.quickbase.com/db/'+table,{method:'POST',headers:{'Content-Type':'application/xml','QUICKBASE-ACTION':'API_AddRecord'},body:'<qdbapi><usertoken>'+xml(process.env.NIMBUS_QB_TOKEN)+'</usertoken>'+body+'</qdbapi>',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Note save unavailable');const t=await r.text();if(!/<errcode>\s*0\s*<\/errcode>/.test(t))throw Error('Note could not be appended');});
   await native(`<field fid="6">${xml(recordKey)}</field><field fid="7">${scope}</field><field fid="8">${xml(cipher)}</field>`);
   const saved=await rows(`{6.EX.'${recordKey}'}AND{7.EX.'${scope}'}`);if(saved.length!==1||JSON.stringify(unpack(saved[0]))!==JSON.stringify(note))throw Error('Note readback failed');return {status:200,note};
  }
 };
}

export function validatePersonKeys(source,value){
 if(!value||value.schema!==1||value.unit!=='aeroastro'||value.sourceHash!==source.sourceHash||!Array.isArray(value.rows)||value.rows.length!==source.rows.length)throw Error('Roster identity map mismatch');
 const allowed=new Map(source.rows.map(r=>[r.id,r.employeeId])),keys=new Map(),people=new Map();for(const r of value.rows){if(!allowed.has(r.appointmentId)||keys.has(r.appointmentId)||!/^[a-f0-9]{64}$/.test(r.personKey||''))throw Error('Roster identity mismatch');const person=allowed.get(r.appointmentId);if(people.has(person)&&people.get(person)!==r.personKey)throw Error('Conflicting person identities');people.set(person,r.personKey);keys.set(r.appointmentId,r.personKey);}return keys;
}
