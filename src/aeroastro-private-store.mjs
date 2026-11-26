import {qbRequest,seal,unseal,encryptionKey} from './nimbus-store.mjs';
import {PRIVATE_OWNER,validatePrivateOwner,PERSON_KEY,validateVault,validateEncryptedNote} from '../public/aeroastro-private-schema.mjs';
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function createPrivateNotesRepository({query=qbRequest,table=process.env.NIMBUS_SNAPSHOTS_TABLE,key=encryptionKey,now=()=>new Date(),add,owner=PRIVATE_OWNER}={}){
 validatePrivateOwner(owner);const SCOPE='aeroastro-private-'+owner,PREFIX='aeroastro-private:v1:'+owner+':';
 async function rows(id,prefix=false){if(!/^b[a-z0-9]+$/.test(table||'')||!id.startsWith(PREFIX)||!/^[a-z0-9:-]+$/.test(id))throw Error('Private notebook storage is unavailable.');const all=[];let total;
  for(let skip=0;skip<2000;skip+=200){const r=await query('records/query',{from:table,select:[3,6,7,8],where:`{7.EX.'${SCOPE}'}AND{6.${prefix?'CT':'EX'}.'${id}'}`,sortBy:[{fieldId:3,order:'ASC'}],options:{top:200,skip}});if(!Array.isArray(r.data)||!Number.isSafeInteger(r.metadata?.totalRecords)||total!==undefined&&total!==r.metadata.totalRecords)throw Error('Private notebook records changed. Please retry.');total=r.metadata.totalRecords;all.push(...r.data);if(all.length===total)return all;if(!r.data.length)break;}throw Error('The private notebook list is incomplete.');
 }
 function unpack(row){const id=row['6']?.value;if(row['7']?.value!==SCOPE||typeof id!=='string'||!id.startsWith(PREFIX))throw Error('Private notebook scope mismatch.');const v=unseal(row['8']?.value,key(),SCOPE+':'+id);if(v.owner!==owner||v.schema!==1||v.by!==owner||!Number.isFinite(Date.parse(v.at)))throw Error('Private notebook integrity check failed.');return v;}
 async function appendRecord(id,data){const cipher=seal(data,key(),SCOPE+':'+id);const body=`<field fid="6">${xml(id)}</field><field fid="7">${SCOPE}</field><field fid="8">${xml(cipher)}</field>`;
  if(add)await add(body);else{const r=await fetch('https://mit.quickbase.com/db/'+table,{method:'POST',headers:{'Content-Type':'application/xml','QUICKBASE-ACTION':'API_AddRecord'},body:'<qdbapi><usertoken>'+xml(process.env.NIMBUS_QB_TOKEN)+'</usertoken>'+body+'</qdbapi>',signal:AbortSignal.timeout(25000)});if(!r.ok||!/<errcode>\s*0\s*<\/errcode>/.test(await r.text()))throw Error('Private notebook could not be saved. Retry without replacing existing records.');}
  const saved=await rows(id);if(saved.length!==1||JSON.stringify(unpack(saved[0]))!==JSON.stringify(data))throw Error('Private notebook readback failed.');
 }
 async function vault(){const found=await rows(PREFIX+'vault');if(!found.length)return null;if(found.length!==1)throw Error('Ambiguous notebook.');const stored=unpack(found[0]);if(stored.kind!=='vault')throw Error('Invalid notebook.');return validateVault(stored.vault,owner);}
 return {vault,
  async create(input){const value=validateVault(input,owner),existing=await vault();if(existing)return JSON.stringify(existing)===JSON.stringify(value)?{status:200,vault:existing}:{status:409,error:'A notebook already exists. Unlock it with its original passphrase.'};
   await appendRecord(PREFIX+'vault',{schema:1,owner,kind:'vault',vault:value,by:owner,at:now().toISOString()});return {status:200,vault:value};},
  async list(person){if(!PERSON_KEY.test(person))throw Error('Invalid person.');const prefix=PREFIX+'note:'+person+':',found=await rows(prefix,true);return found.map(unpack).map(v=>{if(v.kind!=='note'||v.personKey!==person)throw Error('Private-note identity mismatch.');return {...validateEncryptedNote(v.note),personKey:person,by:v.by,at:v.at};}).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));},
  async append(person,input){if(!PERSON_KEY.test(person))throw Error('Invalid person.');const note=validateEncryptedNote(input),current=await vault();if(!current||current.vaultId!==note.vaultId)return {status:409,error:'Unlock the existing notebook before adding this note.'};const id=PREFIX+'note:'+person+':'+note.id,found=await rows(id);
   if(found.length){if(found.length!==1)throw Error('Ambiguous note.');const prior=unpack(found[0]);if(prior.personKey!==person||JSON.stringify(prior.note)!==JSON.stringify(note))return {status:409,error:'This private-note ID was already used.'};return {status:200,note:{...note,personKey:person,by:prior.by,at:prior.at}};}
   const stored={schema:1,kind:'note',owner,personKey:person,note,by:owner,at:now().toISOString()};await appendRecord(id,stored);return {status:200,note:{...note,personKey:person,by:stored.by,at:stored.at}};
  }
 };
}
