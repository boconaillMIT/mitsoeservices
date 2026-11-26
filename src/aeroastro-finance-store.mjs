import {randomUUID} from 'node:crypto';
import {qbRequest,createSnapshotRepository,seal,unseal,encryptionKey} from './nimbus-store.mjs';
import {validateFinanceSource} from './aeroastro-finance-source.mjs';
const scope='aeroastro',PREFIX='aeroastro-finance:',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function createFinanceRepository({query=qbRequest,table=process.env.NIMBUS_SNAPSHOTS_TABLE,key=encryptionKey,snapshots=()=>createSnapshotRepository(),now=()=>new Date(),uuid=randomUUID,add}={}){
 const check=()=>{if(!/^b[a-z0-9]+$/.test(table||''))throw Error('Finance storage unavailable');};
 async function rows(where){check();const all=[];let expected;for(let skip=0;skip<5000;skip+=500){const r=await query('records/query',{from:table,select:[3,6,7,8],where,sortBy:[{fieldId:3,order:'ASC'}],options:{top:500,skip}});if(!Array.isArray(r.data)||!Number.isSafeInteger(r.metadata?.totalRecords)||expected!==undefined&&expected!==r.metadata.totalRecords)throw Error('Incomplete finance data');expected=r.metadata.totalRecords;all.push(...r.data);if(all.length===expected)return all;if(!r.data.length)break;}throw Error('Incomplete finance data');}
 function unpack(r){const id=r['6']?.value;if(r['7']?.value!==scope||typeof id!=='string'||!id.startsWith(PREFIX))throw Error('Finance scope mismatch');return unseal(r['8']?.value,key(),scope+':'+id);}
 return {
  async snapshot(kind){if(!['accounts','people'].includes(kind))throw Error('Invalid source');const found=await rows(`{6.EX.'${PREFIX+kind}:current'}AND{7.EX.'${scope}'}`);if(!found.length)return null;if(found.length!==1)throw Error('Ambiguous finance source');return validateFinanceSource(unpack(found[0]),kind,now());},
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
