import {fundingName,decisionState} from './rct-model.mjs';
const units=[['cee','Civil & Environmental Engineering',1,/\bCEE\b|Civil/i],['meche','Mechanical Engineering',2,/MechE|Mechanical/i],['dmse','Materials Science & Engineering',3,/DMSE|Materials/i],['architecture','Architecture',4,/Architect/i],['eecs','EECS',6,/EECS|Electrical|Computer Science/i],['cheme','Chemical Engineering',10,/ChemE|Chemical/i],['aeroastro','Aeronautics & Astronautics',16,/AeroAstro|Aeronaut|Astronaut/i],['be','Biological Engineering',20,/\bBE\b|Biological/i],['nse','Nuclear Science & Engineering',22,/\bNSE\b|Nuclear/i],['imes','IMES',999,/\bIMES\b|Medical Engineering/i],['idss','IDSS',999,/\bIDSS\b|Data,? Systems/i]];
const normalized=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
const matched=s=>units.filter(u=>u[3].test(s)).map(([key,label,number])=>({key,label,number}));
const cents=v=>Math.round(v*100),sum=values=>values.reduce((a,v)=>a+cents(v),0)/100;
export function departmentCommitmentView(records,{includeDeclined=false,filter='all'}={}){
 if(!['all','needs','funded','zero'].includes(filter))throw Error('Invalid department filter.');
 const active=records.filter(r=>includeDeclined||decisionState(r.review.decision)!=='declined'),groups=new Map(),recorded=new Map();
 const entry=(unit,r)=>{if(!groups.has(unit.key))groups.set(unit.key,{...unit,entries:new Map()});const g=groups.get(unit.key);if(!g.entries.has(r.id))g.entries.set(r.id,{id:r.id,pi:r.source.pi,title:r.source.title||'',sources:[],shared:[],updatedBy:r.updatedBy,updatedAt:r.updatedAt});return g.entries.get(r.id);};
 for(const r of active){
  const source=String(r.source.department||'Department not specified'),primary=matched(source);if(!primary.length)primary.push({key:'source:'+normalized(source),label:source,number:999});
  for(const unit of primary)entry(unit,r);
  for(const slot of ['department','pi','other']){
   const label=fundingName(r.review,slot),amount=r.review[slot]??null;let targets=matched(label);
   if(slot==='department'&&!targets.length)targets=primary;
   if(!targets.length){const exact=primary.find(u=>normalized(u.label)===normalized(label));if(exact)targets=[exact];}
   if(!targets.length)continue;
   if(Number.isFinite(amount))recorded.set(r.id+'|'+slot,amount);
   for(const unit of targets){const e=entry(unit,r),value={slot,label,amount};if(targets.length>1)e.shared.push(value);else e.sources.push(value);}
  }
 }
 const statusLabels={missing:'No commitment entered',partial:'Some amounts missing',joint:'Joint amount entered — split missing',entered:'Commitments entered',zero:'Zero funding entered'};
 const departments=[...groups.values()].map(g=>{
  const entries=[...g.entries.values()].map(e=>{const known=e.sources.map(s=>s.amount).filter(Number.isFinite),shared=e.shared.filter(s=>Number.isFinite(s.amount));return {...e,amount:known.length?sum(known):shared.length&&shared.every(s=>s.amount===0)?0:null,hasAmount:known.length>0||shared.length>0,hasFunding:known.some(v=>v>0)||shared.some(s=>s.amount>0),unallocated:shared.some(s=>s.amount>0)};}).sort((a,b)=>a.pi.localeCompare(b.pi));
  const missing=entries.filter(e=>!e.hasAmount).length,shared=entries.filter(e=>e.unallocated).length,known=entries.map(e=>e.amount).filter(Number.isFinite),amount=known.length?sum(known):null,status=missing===entries.length?'missing':missing?'partial':shared?'joint':amount>0?'entered':'zero';
  return {key:g.key,label:g.label,number:g.number,entries,count:entries.length,missing,shared,received:entries.length-missing,amount,status,statusLabel:statusLabels[status],needs:missing>0||shared>0,hasFunding:entries.some(e=>e.hasFunding)};
 }).sort((a,b)=>({missing:0,partial:1,joint:2,zero:3,entered:4}[a.status]-{missing:0,partial:1,joint:2,zero:3,entered:4}[b.status])||a.number-b.number||a.label.localeCompare(b.label));
 return {departments,rows:departments.filter(g=>filter==='all'||filter==='needs'&&g.needs||filter==='funded'&&g.hasFunding||filter==='zero'&&g.status==='zero'),filter,proposals:active.length,excluded:records.length-active.length,amount:recorded.size?sum([...recorded.values()]):null,needs:departments.filter(g=>g.needs).length,funded:departments.filter(g=>g.hasFunding).length,zero:departments.filter(g=>g.status==='zero').length,shared:departments.some(g=>g.shared>0)};
}
const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null?'Not entered':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
export function renderDepartmentCommitments(view){
 const entryStatus=e=>!e.hasAmount?'No amount entered':e.unallocated?'Joint amount — allocation needed':e.amount===0?'Zero funding entered':'Commitment entered';
 return view.rows.length?'<table class="department-commitment-table"><caption>Department funding commitments from saved entries</caption><thead><tr><th>Department / unit</th><th>Status</th><th>Amount entered</th><th>Proposals with amounts</th><th>Proposal details — select a PI to update funding</th></tr></thead><tbody>'+view.rows.map(g=>'<tr><th scope="row">'+h(g.label)+'</th><td><span class="department-response '+g.status+'">'+h(g.statusLabel)+'</span></td><td>'+h(money(g.amount))+(g.shared?'<small>Joint allocation not included here</small>':'')+'</td><td>'+g.received+' of '+g.count+(g.missing?'<small>'+g.missing+' missing</small>':'')+'</td><td><ul class="department-proposals">'+g.entries.map(e=>'<li><a href="/soe-hq/rct-review?proposal='+encodeURIComponent(e.id)+'" data-department-proposal="'+h(e.id)+'">'+h(e.pi)+'</a><span class="department-entry-status">'+h(entryStatus(e))+(e.amount!==null?' · '+h(money(e.amount)):'')+'</span>'+e.sources.map(s=>'<small>'+h(s.label)+': '+h(money(s.amount))+'</small>').join('')+e.shared.map(s=>'<small>Joint source '+h(s.label)+': '+h(money(s.amount))+'; department split not recorded</small>').join('')+'</li>').join('')+'</ul></td></tr>').join('')+'</tbody></table>':'<p>No departments match this filter.</p>';
}
