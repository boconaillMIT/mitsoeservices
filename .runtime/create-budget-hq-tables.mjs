// One-time setup: creates the four SoE HQ budget tables in the QuickBase app that holds the
// budget requests (br8deedpt). Safe to re-run: existing tables and fields are reused, never changed
// (except making Key unique). Creates no records and reads none.
// Run from the netlify-space folder:  node .runtime/create-budget-hq-tables.mjs
import fs from 'node:fs';
import {dpapi} from './deployment-transfer.mjs';
const APP='br8deedpt';
const env=JSON.parse(dpapi(fs.readFileSync('.secrets/deployment-env.bin'),true).toString()).env;
const headers={'QB-Realm-Hostname':'mit.quickbase.com',Authorization:'QB-USER-TOKEN '+env.NIMBUS_QB_TOKEN,'Content-Type':'application/json'};
async function qb(method,path,body){
 const r=await fetch('https://api.quickbase.com/v1/'+path,{method,headers,body:body&&JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const j=await r.json().catch(()=>({}));
 if(!r.ok){const why=j.description||j.message||r.statusText;throw Error(`${method} ${path.split('?')[0]} failed (${r.status}): ${why}${r.status===401||r.status===403?'\n  The QuickBase user behind the site token needs app admin rights in '+APP+' to create tables.':''}`);}
 return j;
}
const text=label=>({label,fieldType:'text'}),multi=label=>({label,fieldType:'text-multi-line'}),num=label=>({label,fieldType:'numeric'}),when=label=>({label,fieldType:'timestamp'});
const choice=(label,choices)=>({label,fieldType:'text-multiple-choice',properties:{choices,allowNewChoices:false,sortAsGiven:true}});
const TABLES=[
 {key:'decisions',name:'HQ Budget Decisions',single:'Decision',plural:'Decisions',description:'SoE HQ decisions per budget request line (written by MITSOEServices).',
  fields:[text('Key'),text('Cycle'),text('Unit'),num('Request Record ID'),choice('Decision',['Pending','Decline','Support']),num('Support %'),num('SoE %'),multi('Note'),text('Updated By'),when('Updated At')]},
 {key:'briefing',name:'HQ Dean Briefing',single:'Briefing section',plural:'Briefing sections',description:'Dean’s briefing notes per unit and section (written by MITSOEServices).',
  fields:[text('Key'),text('Cycle'),text('Unit'),choice('Section',['Talking points','Background','Questions to ask','Recommendation']),multi('Text'),text('Updated By'),when('Updated At')]},
 {key:'units',name:'HQ Budget Units',single:'Unit',plural:'Units',description:'Per-unit budget cycle settings, including the Google Drive documents folder (written by MITSOEServices).',
  fields:[text('Key'),text('Cycle'),text('Unit'),{label:'Documents Folder URL',fieldType:'url'}]},
 {key:'log',name:'HQ Budget Change Log',single:'Change',plural:'Changes',description:'Append-only log of changes made through MITSOEServices.',
  fields:[text('Cycle'),text('Unit'),text('Kind'),text('Item'),multi('Change'),text('Changed By'),when('Changed At')]}
];
const existing=await qb('GET','tables?appId='+APP),ids={};
for(const t of TABLES){
 let table=existing.find(x=>x.name===t.name);
 if(table)console.log(`• ${t.name}: already exists (${table.id})`);
 else{table=await qb('POST','tables?appId='+APP,{name:t.name,description:t.description,singleRecordName:t.single,pluralRecordName:t.plural});console.log(`• ${t.name}: created (${table.id})`);}
 ids[t.key]=table.id;
 const have=await qb('GET','fields?tableId='+table.id);
 for(const f of t.fields){
  let field=have.find(x=>x.label===f.label);
  if(field){if(field.fieldType!==f.fieldType)console.log(`  ! "${f.label}" exists as ${field.fieldType}, expected ${f.fieldType}. Please check it.`);}
  else{field=await qb('POST','fields?tableId='+table.id,{...f,addToForms:true});console.log(`  + ${f.label}`);}
  if(f.label==='Key'&&!field.unique){await qb('POST',`fields/${field.id}?tableId=${table.id}`,{unique:true,required:true});console.log('  + Key set to unique');}
 }
}
console.log('\nDone. Send these table IDs to Claude (they are not secret):');
console.log(JSON.stringify(ids,null,1));
