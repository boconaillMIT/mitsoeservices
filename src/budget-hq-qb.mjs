// QuickBase storage for SoE HQ budget work: decisions, Dean's briefing, documents-folder links
// and an append-only change log. Everything stays in MIT's QuickBase; the site keeps nothing.
// Tables are named in budget-hq-tables.json; fields are found by name (see FIELDS below).
// Concurrency: each row's version is its Date Modified (fid 2). A save re-reads the row with
// API_GetRecordInfo, refuses if the version moved, and edits with that update_id, so a change
// made in between is never overwritten. New rows carry a unique Key (cycle|unit|item), so two
// people creating the same row at once cannot both succeed.
import tables from './budget-hq-tables.json' with {type:'json'};

export const FIELDS=Object.freeze({
 decisions:['Key','Cycle','Unit','Request Record ID','Decision','Support %','SoE %','Note','Updated By','Updated At'],
 briefing:['Key','Cycle','Unit','Section','Text','Updated By','Updated At'],
 units:['Key','Cycle','Unit','Documents Folder URL'],
 log:['Cycle','Unit','Kind','Item','Change','Changed By','Changed At']
});
export const DECISION_LABEL={pending:'Pending',decline:'Decline',support:'Support'};
export const SECTION_LABEL={talking:'Talking points',background:'Background',questions:'Questions to ask',recommendation:'Recommendation'};
const fromLabel=map=>Object.fromEntries(Object.entries(map).map(([k,v])=>[v,k]));
const DECISION_KEY=fromLabel(DECISION_LABEL),SECTION_KEY=fromLabel(SECTION_LABEL);
const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const SAFE=/^[A-Za-z0-9|_.-]{1,80}$/;// cycle/unit/key values used in queries are validated upstream; enforce again here
const KIND={decisions:'decision',briefing:'briefing',units:'documents link'};

export function configured(t=tables){return ['decisions','briefing','units','log'].every(k=>/^[a-z0-9]{6,20}$/.test(t[k]||''));}

export function createQbTransport({token=()=>process.env.NIMBUS_QB_TOKEN,fetcher=fetch}={}){
 const tok=()=>{const t=token();if(!t)throw Error('QuickBase is not configured.');return t;};
 return {
  async rest(path,{method='POST',body}={}){const r=await fetcher('https://api.quickbase.com/v1/'+path,{method,headers:{'QB-Realm-Hostname':'mit.quickbase.com',Authorization:'QB-USER-TOKEN '+tok(),'Content-Type':'application/json'},body:body&&JSON.stringify(body),signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Object.assign(Error('QuickBase request failed.'),{status:r.status});return r.json();},
  async native(table,action,inner){const r=await fetcher('https://mit.quickbase.com/db/'+table,{method:'POST',headers:{'Content-Type':'application/xml','QUICKBASE-ACTION':action},body:'<qdbapi><usertoken>'+xml(tok())+'</usertoken>'+inner+'</qdbapi>',signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('QuickBase request failed.');const text=await r.text(),code=/<errcode>\s*(\d+)\s*<\/errcode>/i.exec(text)?.[1];if(code!=='0')throw Object.assign(Error('QuickBase rejected the change.'),{qbCode:code});return text;}
 };
}

export function createBudgetHqStore({transport=createQbTransport(),config=tables,now=()=>new Date(),cacheMs=10*60*1000}={}){
 const fieldCache=new Map();
 async function fieldsOf(kind){
  const table=config[kind],hit=fieldCache.get(table);if(hit&&Date.now()-hit.at<cacheMs)return hit.ids;
  const list=await transport.rest('fields?tableId='+encodeURIComponent(table),{method:'GET'}),arr=Array.isArray(list)?list:list.fields||[];
  const ids={};for(const label of FIELDS[kind]){const f=arr.find(x=>x.label===label);if(!f||!Number.isInteger(f.id))throw Error(`QuickBase table for ${kind} is missing the field "${label}".`);ids[label]=f.id;}
  fieldCache.set(table,{at:Date.now(),ids});return ids;
 }
 async function query(kind,where){
  const f=await fieldsOf(kind),select=[2,3,...Object.values(f)],rows=[];let total;
  for(let page=0;page<40;page++){const r=await transport.rest('records/query',{body:{from:config[kind],select,where:where(f),options:{top:1000,skip:rows.length}}});
   total=r.metadata?.totalRecords;rows.push(...(r.data||[]));if(!Number.isInteger(total)||rows.length>=total||!r.data?.length)break;}
  if(Number.isInteger(total)&&rows.length<total)throw Error('QuickBase results were incomplete.');
  return rows.map(r=>{const o={rid:String(r['3']?.value),version:String(Date.parse(r['2']?.value)||'')};for(const [label,id]of Object.entries(f))o[label]=r[String(id)]?.value??null;return o;});
 }
 const eq=(id,v)=>{if(!SAFE.test(v))throw Error('Invalid value.');return `{${id}.EX.'${v}'}`;};
 const CY=c=>c.toUpperCase();
 async function log(cycle,unit,kind,item,change,actor){
  try{const f=await fieldsOf('log'),vals={Cycle:CY(cycle),Unit:unit,Kind:kind,Item:item,Change:change,'Changed By':actor,'Changed At':now().getTime()};
   await transport.native(config.log,'API_AddRecord',Object.entries(vals).map(([k,v])=>`<field fid="${f[k]}">${xml(v)}</field>`).join(''));}
  catch(e){console.error('Budget HQ change log:',e.message);}
 }
 // Upsert one row identified by Key, with optimistic concurrency on its version (Date Modified).
 async function upsert(kind,key,expectedVersion,values){
  const f=await fieldsOf(kind),fields=Object.entries(values).map(([k,v])=>`<field fid="${f[k]}">${xml(v??'')}</field>`).join('');
  const existing=(await query(kind,ff=>eq(ff.Key,key)))[0];
  if(!existing){
   if(expectedVersion)return {conflict:true};
   try{await transport.native(config[kind],'API_AddRecord',`<field fid="${f.Key}">${xml(key)}</field>`+fields);}
   catch(e){if((await query(kind,ff=>eq(ff.Key,key))).length)return {conflict:true};throw e;}
  }else{
   if(String(expectedVersion||'')!==existing.version)return {conflict:true};
   const info=await transport.native(config[kind],'API_GetRecordInfo',`<rid>${existing.rid}</rid>`);
   const updateId=/<update_id>\s*([^<\s]+)\s*<\/update_id>/i.exec(info)?.[1],modified=/<field>\s*<fid>2<\/fid>[\s\S]*?<value>\s*(\d+)\s*<\/value>/i.exec(info)?.[1];
   if(!updateId||String(modified)!==existing.version)return {conflict:true};
   try{await transport.native(config[kind],'API_EditRecord',`<rid>${existing.rid}</rid><update_id>${xml(updateId)}</update_id>`+fields);}
   catch(e){if(e.qbCode)return {conflict:true};throw e;}
  }
  const saved=(await query(kind,ff=>eq(ff.Key,key)))[0];return {row:saved,previous:existing||null};
 }
 const decisionOf=r=>({decision:DECISION_KEY[r.Decision]||'pending',support_pct:r['Support %']??null,soe_pct:r['SoE %']??null,note:r.Note||'',updated_by:r['Updated By']||null,updated_at:r['Updated At']||null,version:r.version});
 const describe=d=>d.decision==='support'?`Support ${d.support_pct}% (SoE ${d.soe_pct}%)`:DECISION_LABEL[d.decision]||'Pending';
 return {
  configured:()=>configured(config),
  async cycleDecisions(cycle){const rows=await query('decisions',f=>eq(f.Cycle,CY(cycle)));const out={};for(const r of rows){(out[r.Unit]||={})[String(r['Request Record ID'])]=decisionOf(r);}return out;},
  async unit(cycle,unit){
   const where=f=>eq(f.Cycle,CY(cycle))+'AND'+eq(f.Unit,unit);
   const [d,b,u,l]=await Promise.all([query('decisions',where),query('briefing',where),query('units',where),query('log',where)]);
   const decisions={};for(const r of d)decisions[String(r['Request Record ID'])]=decisionOf(r);
   const sections={};for(const [k,label]of Object.entries(SECTION_LABEL)){const r=b.find(x=>x.Section===label);sections[k]=r?{text:r.Text||'',updated_by:r['Updated By'],updated_at:r['Updated At'],version:r.version}:{text:'',updated_by:null,updated_at:null,version:null};}
   const link=u[0]?{url:u[0]['Documents Folder URL']||'',version:u[0].version}:{url:'',version:null};
   const log=l.map(r=>({at:r['Changed At'],by:r['Changed By'],kind:r.Kind,item:r.Item,change:r.Change})).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,25);
   return {decisions,sections,link,log};
  },
  async saveDecision(cycle,unit,recordId,value,version,actor,itemLabel){
   const before=(await query('decisions',f=>eq(f.Key,`${CY(cycle)}|${unit}|${recordId}`)))[0];
   const r=await upsert('decisions',`${CY(cycle)}|${unit}|${recordId}`,version,{Cycle:CY(cycle),Unit:unit,'Request Record ID':recordId,Decision:DECISION_LABEL[value.decision],'Support %':value.support_pct??'','SoE %':value.soe_pct??'',Note:value.note,'Updated By':actor,'Updated At':now().getTime()});
   if(r.conflict)return r;const prev=before?decisionOf(before):{decision:'pending'},next=decisionOf(r.row);
   await log(cycle,unit,KIND.decisions,itemLabel,`${describe(prev)} → ${describe(next)}${(prev.note||'')!==next.note?' · note updated':''}`,actor);return {decision:next};
  },
  async saveBriefing(cycle,unit,section,text,version,actor){
   const r=await upsert('briefing',`${CY(cycle)}|${unit}|${section}`,version,{Cycle:CY(cycle),Unit:unit,Section:SECTION_LABEL[section],Text:text,'Updated By':actor,'Updated At':now().getTime()});
   if(r.conflict)return r;await log(cycle,unit,KIND.briefing,SECTION_LABEL[section],`Edited (${text.length} characters)`,actor);
   return {section:{text:r.row.Text||'',updated_by:r.row['Updated By'],updated_at:r.row['Updated At'],version:r.row.version}};
  },
  async saveLink(cycle,unit,url,version,actor){
   const r=await upsert('units',`${CY(cycle)}|${unit}`,version,{Cycle:CY(cycle),Unit:unit,'Documents Folder URL':url});
   if(r.conflict)return r;await log(cycle,unit,KIND.units,'Documents folder',url?'Folder link set':'Folder link removed',actor);
   return {link:{url:r.row['Documents Folder URL']||'',version:r.row.version}};
  }
 };
}
