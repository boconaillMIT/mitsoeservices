import {createHash,randomUUID} from 'node:crypto';
import {createQbTransport} from './budget-hq-qb.mjs';import config from './rct-tables.json' with {type:'json'};
import {REVIEWER_DIRECTORY,MAX_RCT_REVIEWERS,reviewerContact} from '../public/rct-reviewers.mjs';
export const DIRECTORY_ROUND='RCT-REVIEWERS';
export function createReviewerDirectory({transport=createQbTransport(),table=config.reviews,now=()=>new Date(),uuid=randomUUID}={}){
 let cached;
 async function fields(){if(cached)return cached;const list=await transport.rest('fields?tableId='+table,{method:'GET'}),result={};for(const label of ['Key','Round','Source JSON','Review JSON','Revision','Updated By','Updated At']){const field=list.find(f=>f.label===label);if(!field)throw Error('Reviewer storage is unavailable.');result[label]=field.id;}return cached=result;}
 const keyFor=email=>'email-'+createHash('sha256').update(email).digest('hex').slice(0,24);
 async function list(){const f=await fields(),response=await transport.rest('records/query',{body:{from:table,select:[3,f.Key,f['Source JSON']],where:`{${f.Round}.EX.'${DIRECTORY_ROUND}'}`,options:{top:1000}}});if((response.metadata?.totalRecords??response.data.length)!==response.data.length)throw Error('The reviewer list is incomplete.');const people=[...REVIEWER_DIRECTORY];
  for(const row of response.data){const value=JSON.parse(row[String(f['Source JSON'])].value),contact=reviewerContact({email:value.email,name:value.name}),key=keyFor(contact.email);if(value.key!==key||row[String(f.Key)].value!=='RCT-REVIEWER|'+key)throw Error('The reviewer list could not be verified.');if(!people.some(p=>p.email.toLowerCase()===contact.email))people.push({...contact,key,aliases:[]});}
  if(people.length>MAX_RCT_REVIEWERS)throw Error('The reviewer list exceeds its limit.');return people;
 }
 return {list,async add(value,actor){const contact=reviewerContact(value),people=await list(),existing=people.find(p=>p.email.toLowerCase()===contact.email);if(existing)return {person:existing,created:false};if(people.length>=MAX_RCT_REVIEWERS)throw Error('Up to 100 reviewers can be listed.');const f=await fields(),person={...contact,key:keyFor(contact.email),aliases:[]},values={Key:'RCT-REVIEWER|'+person.key,Round:DIRECTORY_ROUND,'Source JSON':JSON.stringify(person),'Review JSON':'{}',Revision:uuid(),'Updated By':actor,'Updated At':now().toISOString()};
  try{const response=await transport.rest('records',{body:{to:table,data:[Object.fromEntries(Object.entries(values).map(([label,value])=>[f[label],{value}]))],fieldsToReturn:[3]}});if(response.metadata?.createdRecordIds?.length!==1)throw Error('Reviewer creation was not confirmed.');}catch(error){const duplicate=(await list()).find(p=>p.email.toLowerCase()===contact.email);if(duplicate)return {person:duplicate,created:false};throw error;}
  return {person,created:true};
 }};
}
