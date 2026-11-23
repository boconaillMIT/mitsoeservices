import {createReviewerDirectory} from './rct-reviewer-directory.mjs';
import {REVIEWER_DIRECTORY} from '../public/rct-reviewers.mjs';
import {randomUUID} from 'node:crypto';
import {createQbTransport} from './budget-hq-qb.mjs';
import config from './rct-tables.json' with {type:'json'};
import {ROUND,validateReview,fundingReview,sortProposals,syncRequestedAward} from './rct-model.mjs';
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const unxml=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function createRctStore({transport=createQbTransport(),table=config.reviews,uuid=randomUUID,now=()=>new Date()}={}){
 const directory=createReviewerDirectory({transport,table,uuid,now});
 let cached;
 async function fields(){if(cached)return cached;if(!/^[a-z0-9]{6,20}$/.test(table||''))throw Error('RCT review storage is not configured.');const list=await transport.rest('fields?tableId='+table,{method:'GET'});cached={};for(const label of ['Key','Round','Source JSON','Review JSON','Revision','Updated By','Updated At']){const f=list.find(x=>x.label===label);if(!f)throw Error('RCT review storage is incomplete.');cached[label]=f.id;}return cached;}
 const parse=(r,f)=>({rid:String(r['3'].value),id:r[String(f.Key)].value,source:JSON.parse(r[String(f['Source JSON'])].value),review:validateReview(JSON.parse(r[String(f['Review JSON'])].value)),revision:r[String(f.Revision)].value,updatedBy:r[String(f['Updated By'])]?.value||'',updatedAt:r[String(f['Updated At'])]?.value||null});
 async function list(){const f=await fields(),r=await transport.rest('records/query',{body:{from:table,select:[3,...Object.values(f)],where:`{${f.Round}.EX.'${ROUND}'}`,options:{top:1000}}});if((r.metadata?.totalRecords??r.data.length)!==r.data.length)throw Error('Incomplete proposal list.');return sortProposals(r.data.map(row=>parse(row,f)));}
 return {list,listReviewers:directory.list,addReviewer:directory.add,async save(id,review,revision,actor,{knownReviewerKeys=REVIEWER_DIRECTORY.map(p=>p.key)}={}){
  const f=await fields(),row=(await list()).find(r=>r.id===id);if(!row)return {missing:true};if(row.revision!==revision)return {conflict:true};
  const info=await transport.native(table,'API_GetRecordInfo',`<rid>${row.rid}</rid>`),updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/.exec(info)?.[1];
  const revisionField=[...info.matchAll(/<field\b[^>]*>([\s\S]*?)<\/field>/g)].find(m=>new RegExp(`<fid>\\s*${f.Revision}\\s*</fid>`).test(m[1]));
  const current=revisionField&&/<value>([\s\S]*?)<\/value>/.exec(revisionField[1])?.[1];if(!updateId||unxml(current||'')!==revision)return {conflict:true};
  const next=uuid(),at=now().toISOString();
  // Only authenticated server saves may set attribution; client stamps are ignored.
  if(Array.isArray(review.assignments)){const visible=new Set(knownReviewerKeys);review={...review,assignments:[...new Set([...review.assignments,...row.review.assignments.filter(key=>!visible.has(key))])]};}
  if(Array.isArray(review.reviewers)){const incoming=review.reviewers.map((v,i)=>row.review.reviewers[i]?.reviewerKey&&!v.reviewerKey?{...v,reviewerKey:row.review.reviewers[i].reviewerKey}:v);review={...review,reviewers:[...incoming,...row.review.reviewers.slice(incoming.length)]};}
  if(review.requested===row.source.requested)review={...review,requested:null};
  const modeProvided=Object.hasOwn(review,'awardMode'),awardChanged=Object.hasOwn(review,'award')&&review.award!==row.review.award;
  review=syncRequestedAward(row.review,validateReview({...row.review,...review,vpr:row.review.vpr,notesHistory:row.review.notesHistory,commentStamps:row.review.commentStamps,requestedHistory:row.review.requestedHistory}),row.source,{modeProvided,awardChanged});
  if(review.requested!==row.review.requested)review.requestedHistory.push({amount:review.requested,by:actor,at});
  const archive=(text,stamp)=>review.notesHistory.push({text,by:stamp?.by||'Earlier entry',at:stamp?.at||at});
  if(review.notes!==row.review.notes){if(row.review.notes)archive(row.review.notes,row.review.commentStamps.notes);review.commentStamps.notes={by:actor,at};}
  for(let i=0;i<review.reviewers.length;i++){const previous=row.review.reviewers[i]||{name:'',grade:'',comments:''},next=review.reviewers[i];if(previous.comments!==next.comments||previous.name!==next.name&&Boolean(previous.comments||next.comments)){if(previous.comments)archive(previous.name+': '+previous.comments,row.review.commentStamps.reviewers[i]);review.commentStamps.reviewers[i]={by:actor,at};}}
  review=fundingReview(review,row.source);
  const values={'Review JSON':JSON.stringify(validateReview(review)),Revision:next,'Updated By':actor,'Updated At':Date.parse(at)};
  try{await transport.native(table,'API_EditRecord',`<rid>${row.rid}</rid><update_id>${xml(updateId)}</update_id>`+Object.entries(values).map(([k,v])=>`<field fid="${f[k]}">${xml(v)}</field>`).join(''));}catch(e){if(e.qbCode)return {conflict:true};throw e;}
  return {row:{...row,review,revision:next,updatedBy:actor,updatedAt:at}};
 }};
}
