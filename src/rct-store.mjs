import {randomUUID} from 'node:crypto';
import {createQbTransport} from './budget-hq-qb.mjs';
import config from './rct-tables.json' with {type:'json'};
import {ROUND,validateReview,centralThirds,sortProposals} from './rct-model.mjs';
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function createRctStore({transport=createQbTransport(),table=config.reviews,uuid=randomUUID,now=()=>new Date()}={}){
 let cached;
 async function fields(){if(cached)return cached;if(!/^[a-z0-9]{6,20}$/.test(table||''))throw Error('RCT review storage is not configured.');const list=await transport.rest('fields?tableId='+table,{method:'GET'});cached={};for(const label of ['Key','Round','Source JSON','Review JSON','Revision','Updated By','Updated At']){const f=list.find(x=>x.label===label);if(!f)throw Error('RCT review storage is incomplete.');cached[label]=f.id;}return cached;}
 const parse=(r,f)=>({rid:String(r['3'].value),id:r[String(f.Key)].value,source:JSON.parse(r[String(f['Source JSON'])].value),review:validateReview(JSON.parse(r[String(f['Review JSON'])].value)),revision:r[String(f.Revision)].value,updatedBy:r[String(f['Updated By'])]?.value||'',updatedAt:r[String(f['Updated At'])]?.value||null});
 async function list(){const f=await fields(),r=await transport.rest('records/query',{body:{from:table,select:[3,...Object.values(f)],where:`{${f.Round}.EX.'${ROUND}'}`,options:{top:1000}}});if((r.metadata?.totalRecords??r.data.length)!==r.data.length)throw Error('Incomplete proposal list.');return sortProposals(r.data.map(row=>parse(row,f)));}
 return {list,async save(id,review,revision,actor){
  const f=await fields(),row=(await list()).find(r=>r.id===id);if(!row)return {missing:true};if(row.revision!==revision)return {conflict:true};
  const info=await transport.native(table,'API_GetRecordInfo',`<rid>${row.rid}</rid>`),updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/.exec(info)?.[1];
  const revisionField=[...info.matchAll(/<field\b[^>]*>([\s\S]*?)<\/field>/g)].find(m=>new RegExp(`<fid>\\s*${f.Revision}\\s*</fid>`).test(m[1]));
  const current=revisionField&&/<value>([\s\S]*?)<\/value>/.exec(revisionField[1])?.[1];if(!updateId||unxml(current||'')!==revision)return {conflict:true};
  const next=uuid(),at=now().toISOString();
  review=validateReview({...row.review,...review,notesHistory:row.review.notesHistory});
  if(review.notes!==row.review.notes&&row.review.notes)review.notesHistory.push({text:row.review.notes,by:row.updatedBy||'Previous review',at:row.updatedAt?new Date(row.updatedAt).toISOString():at});
  for(let i=0;i<6;i++){const previous=row.review.reviewers[i],next=review.reviewers[i];if(previous.comments&&previous.comments!==next.comments)review.notesHistory.push({text:previous.name+': '+previous.comments,by:row.updatedBy||'Previous review',at:row.updatedAt?new Date(row.updatedAt).toISOString():at});}
  if(review.autoCentral&&review.award!==null){const thirds=centralThirds(review.award);review.provost=thirds.provost;review.evpt=thirds.evpt;}
  const values={'Review JSON':JSON.stringify(validateReview(review)),Revision:next,'Updated By':actor,'Updated At':Date.parse(at)};
  try{await transport.native(table,'API_EditRecord',`<rid>${row.rid}</rid><update_id>${xml(updateId)}</update_id>`+Object.entries(values).map(([k,v])=>`<field fid="${f[k]}">${xml(v)}</field>`).join(''));}catch(e){if(e.qbCode)return {conflict:true};throw e;}
  return {row:{...row,review,revision:next,updatedBy:actor,updatedAt:at}};
 }};
}
