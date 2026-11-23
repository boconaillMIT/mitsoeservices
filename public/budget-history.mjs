import {isFacultyHireSlot} from './budget-model.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isFinite(v)?'$'+Math.round(v).toLocaleString('en-US'):'Not recorded';
const payers=[['SoE / Dean','school'],['Provost','provost'],['SCC','scc'],['Funder unresolved','unresolved']];
export function setBudgetPerspective(root,perspective){
 const years=perspective==='years';root.dataset.historyPerspective=years?'years':'lines';
 root.querySelector('[data-history-panel="lines"]').hidden=years;root.querySelector('[data-history-panel="years"]').hidden=!years;
 const button=root.querySelector('[data-history-switch]');button.textContent=years?'‹ Line-item comparison':'Year view ›';button.setAttribute('aria-label',years?'Switch to line-item comparison':'Switch to year scorecards');
 root.querySelector('[data-history-view-label]').textContent=years?'Year scorecards':'Line-item comparison';
}
export function bindBudgetPerspective(container){
 const onClick=event=>{const button=event.target.closest('[data-history-switch]');if(!button||!container.contains(button))return;const root=button.closest('[data-history-perspective]');setBudgetPerspective(root,root.dataset.historyPerspective==='years'?'lines':'years');};
 container.addEventListener('click',onClick);return ()=>container.removeEventListener('click',onClick);
}
export function requestBreakdown(request,unitKey,year){
 const b=request.source?.request_breakdown;
 if(!b||b.schema!==1||b.unit!==unitKey||b.year!==year||!/^\d{4}-\d{2}-\d{2}$/.test(b.date||'')||typeof b.document!=='string'||b.document.length>200||(!Number.isFinite(request.requested)||request.requested<=0)||!Array.isArray(b.items)||b.items.length<2||b.items.length>10)return [];
 if(!b.items.every(i=>i&&typeof i.description==='string'&&i.description.length>0&&i.description.length<=200&&Number.isFinite(i.amount)&&i.amount>=0))return [];
 if(b.items.reduce((n,i)=>n+Math.round(i.amount*100),0)!==Math.round(request.requested*100))return [];
 return b.items;
}
export function requestBreakdownHtml(request,unitKey,year){
 const items=requestBreakdown(request,unitKey,year);return items.length?`<ul class="bh-request-breakdown">${items.map(i=>`<li>${esc(i.description)}: <strong>${money(i.amount)}</strong></li>`).join('')}</ul>`:'';
}
export function comparisonRequests(request,unitKey,year){
 const items=requestBreakdown(request,unitKey,year);if(!items.length)return [request];
 const allocate=value=>{if(!Number.isFinite(value))return items.map(()=>null);const total=Math.round(value*100),parts=items.map(i=>Math.floor(total*i.amount/request.requested));let remaining=total-parts.reduce((n,v)=>n+v,0);for(let i=0;remaining>0;i=(i+1)%parts.length,remaining--)parts[i]++;return parts.map(n=>n/100);};
 const fields=['supported','soe','provost','approved','school','scc','unresolved','declined','initial_declined'],allocated=Object.fromEntries(fields.map(k=>[k,allocate(request[k])]));
 const funding=Object.fromEntries(Object.entries(request.request_funding||{}).map(([k,v])=>[k,allocate(v)]));
 return items.map((item,index)=>({...request,description:item.description,requested:item.amount,component_parent:request.description,source:null,...Object.fromEntries(fields.map(k=>[k,allocated[k][index]])),request_funding:Object.fromEntries(Object.entries(funding).map(([k,v])=>[k,v[index]]))}));
}
export function taSummary(years){
 const summaries=[];
 for(const y of years){const requests=(y.requests||[]).filter(r=>requestFamily(r).key==='teaching-assistants');if(!requests.length)continue;let requestedCount=0,fundedCount=0,requested=0,approved=0,valid=true,unconfirmed=false;const segments=new Map();
 const add=(key,label,count,amount)=>{if(!y.current&&key==='school')label='SoE (award letter)';if(Math.abs(count-Math.round(count))<0.000001)count=Math.round(count);const previous=segments.get(key)||{key,label,count:0,amount:0};previous.count+=count;previous.amount+=amount;segments.set(key,previous);};
 for(const r of requests){const g=r.history_group,match=/^(\d+)\s+TAs?\b/i.exec(r.description||''),count=g?.requested_count??(match?Number(match[1]):null);if(!Number.isInteger(count)||!Number.isFinite(r.requested)||r.requested<=0){valid=false;break;}requestedCount+=count;requested+=r.requested;
 if(y.current){const f=r.request_funding||{},joint=(f.dean||0)>0&&(f.scc||0)>0;for(const [key,label,amount]of [['provost','Provost',f.provost],...(joint?[['joint','SoE / SCC together',(f.dean||0)+(f.scc||0)]]:[['school','SoE / Dean',f.dean],['scc','SCC',f.scc]])])if(amount>0)add(key,label,count*amount/r.requested,amount);if(joint&&(r.source?.sources||[]).some(s=>/assumption|unconfirmed/i.test((s.notes||'')+' '+(s.issues||[]).join(' '))))unconfirmed=true;
 }else{if(!Number.isFinite(r.approved)){valid=false;break;}const funded=g?.funded_count??count*r.approved/r.requested;if(Math.abs(funded-Math.round(funded))>0.000001){valid=false;break;}fundedCount+=funded;approved+=r.approved;for(const [label,key]of payers)if(r[key]>0)add(key,label,g?.funder_counts?.[key]??count*r[key]/r.requested,r[key]);}
 }
 const segmentValues=[...segments.values()];if(Math.abs(segmentValues.reduce((n,s)=>n+s.amount,0)-(y.current?requested:approved))>.011||Math.abs(segmentValues.reduce((n,s)=>n+s.count,0)-(y.current?requestedCount:fundedCount))>.000001)valid=false;
 if(valid&&segments.size)summaries.push({year:y.year,current:Boolean(y.current),requestedCount,fundedCount:y.current?null:fundedCount,requested,approved:y.current?null:approved,segments:segmentValues.sort((a,b)=>['provost','school','scc','joint','unresolved'].indexOf(a.key)-['provost','school','scc','joint','unresolved'].indexOf(b.key)),note:requests.find(r=>r.history_group)?.history_group.note||'',unconfirmed});
 }return summaries;
}
function renderTaSummary(years,unitKey){
 if(unitKey!=='eecs'||!years.some(y=>(y.requests||[]).some(r=>r.history_group)))return '';const summaries=taSummary(years),colors={provost:'#2e648b',school:'#a31f34',scc:'#795399',joint:'#795399',unresolved:'#687982'},quantity=v=>Number.isInteger(v)?String(v):v.toFixed(1);
 return `<section class="bh-ta-summary" aria-label="Teaching assistant funding summary"><h3>Teaching assistant support: requests and funded outcomes</h3><div class="bh-ta-grid">${summaries.map(y=>`<article class="bh-ta-card"><h4>FY${String(y.year).slice(-2)}${y.current?' · Request':''}</h4><p class="bh-ta-count">${quantity(y.current?y.requestedCount:y.fundedCount)} TAs ${y.current?'requested':'funded'}</p><p>${y.current?'Awaiting final award':quantity(y.requestedCount)+' originally requested'}</p><div class="bh-ta-bar${y.current?' bh-ta-proposed':''}" aria-hidden="true">${y.segments.map(s=>`<i style="width:${100*s.count/(y.current?y.requestedCount:y.fundedCount)}%;background:${colors[s.key]||'#687982'}"></i>`).join('')}</div>${y.segments.map(s=>`<p class="bh-ta-funder"><span>${esc(s.label)}<br><strong>${quantity(s.count)} TAs</strong></span><span>${money(s.amount)}</span></p>`).join('')}<p class="bh-ta-total">${y.current?'Total requested':'Total funded'}<br><strong>${money(y.current?y.requested:y.approved)}</strong></p></article>`).join('')}</div><p class="bh-history-label">Historical funding offices follow the final award letters.</p>${summaries.filter(y=>y.note||y.unconfirmed).map(y=>`<p class="bh-ta-note"><strong>FY${String(y.year).slice(-2)}:</strong> ${y.note?esc(y.note):'The division of the joint SoE/SCC request remains to be agreed.'}</p>`).join('')}</section>`;
}
export function combineLecturerRequests(requests,current=false){
 const lecturers=requests.filter(r=>requestFamily(r).key==='lecturers');if(lecturers.length<2)return requests;
 const sum=key=>{const values=lecturers.map(r=>r[key]).filter(Number.isFinite);return values.length?values.reduce((n,v)=>n+Math.round(v*100),0)/100:null;},combined={...lecturers[0],description:'Lecturer support (combined)',source:null,lecturer_components:lecturers,record_id:'lecturers-'+lecturers.map(r=>r.record_id||'').join('-')};
 for(const key of ['requested','approved','school','provost','scc','unresolved','declined','initial_declined','supported','soe'])combined[key]=sum(key);
 if(lecturers.some(r=>!Number.isFinite(r.requested)))combined.requested=null;
 combined.request_funding=Object.fromEntries(['dean','provost','scc','unassigned','assigned','total'].map(k=>{const values=lecturers.map(r=>r.request_funding?.[k]).filter(Number.isFinite);return [k,values.length?values.reduce((n,v)=>n+Math.round(v*100),0)/100:null];}));
 const decisions=new Set(lecturers.map(r=>r.decision||'pending'));combined.decision=decisions.size===1?[...decisions][0]:'mixed';
 const statuses=new Set(lecturers.map(r=>historicalStatus(r).label));combined.lecturer_mixed=!current&&(statuses.size>1||lecturers.some(r=>!Number.isFinite(r.approved)&&!(r.declined>0)));
 let inserted=false;return requests.flatMap(r=>{if(!lecturers.includes(r))return [r];if(inserted)return [];inserted=true;return [combined];});
}
function lecturerComponentsHtml(r,current){
 if(!r.lecturer_components)return '';const showStatus=current?r.decision==='mixed':r.lecturer_mixed;
 return `<div class="bh-lecturer-components"><span>Includes:</span><ul>${r.lecturer_components.map(c=>`<li>${esc(c.description)} — ${money(c.requested)}${showStatus?' · '+esc(current?(c.decision==='support'?'Recommended support':c.decision==='decline'?'Recommended decline':'Awaiting recommendation'):historicalStatus(c).label):''}</li>`).join('')}</ul></div>`;
}
export function renderBudgetHistory(years=[],{unitKey='',perspective='lines'}={}){
 years=years.map(y=>({...y,requests:combineLecturerRequests((y.requests||[]).filter(r=>!isFacultyHireSlot(r)).flatMap(r=>comparisonRequests(r,unitKey,y.year)),y.current)}));
 const showYears=perspective==='years';
 return `<div class="bh-perspectives" data-history-perspective="${showYears?'years':'lines'}">${renderTaSummary(years,unitKey)}<div class="bh-perspective-toolbar bh-noprint"><strong data-history-view-label aria-live="polite">${showYears?'Year scorecards':'Line-item comparison'}</strong><button type="button" data-history-switch aria-controls="bh-perspective-lines bh-perspective-years" aria-label="${showYears?'Switch to line-item comparison':'Switch to year scorecards'}">${showYears?'‹ Line-item comparison':'Year view ›'}</button></div><section id="bh-perspective-lines" data-history-panel="lines"${showYears?' hidden':''}>${renderAlignedHistory(years,{unitKey})}</section><section id="bh-perspective-years" data-history-panel="years"${showYears?'':' hidden'}>${renderYearCards(years)}</section></div>`;
}
const normal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}.]+/gu,' ').trim();
export function requestFamily(request,unitKey='',year=''){
 const description=request.description||'',n=normal(description);
 // Match clear request families. Keep original source lines and scope in every cell.
 if(!n)return {key:'unknown|'+year+'|'+(request.record_id||n),label:(description||'Unspecified request')+' · FY'+String(year).slice(-2)};
 if(/\b(?:tas?|teaching assistants?)\b/.test(n))return {key:'teaching-assistants',label:'Teaching assistants'};
 if(/\blecturers?\b/.test(n))return {key:'lecturers',label:'Lecturers'};
 if(/^(?:grad|graduate) (?:office staff|academic admin(?:strator|istrator))$/.test(n))return {key:'graduate-office',label:'Graduate office staff'};
 if(/^(?:undergrad|undergraduate) (?:office staff|academic administrator(?: repeat request)?)$/.test(n))return {key:'undergraduate-office',label:'Undergraduate office staff'};
 if(/\bhr (?:admin|administrator)\b/.test(n)&&!n.includes('critical staff'))return {key:'hr-administrator',label:'HR administration'};
 if(unitKey==='meche'){
  if(/^hr representative\b/.test(n))return {key:'hr-administrator',label:'HR administration'};
  if(/^(?:senior|sr) technical instructor\b/.test(n))return {key:'senior-technical-instructor',label:'Senior technical instructor'};
  if(/^(?:ug|first year) exploratory$/.test(n))return {key:'exploratory',label:'First-year exploratory teaching'};
  if(/^(?:financial officer|sra fo)$/.test(n)||/^senior research administrator\b/.test(n))return {key:'finance-research-admin',label:'Finance / research administration'};
 }
 if(unitKey==='aeroastro'&&/^(?:non faculty teaching|teaching course development support)/.test(n))return {key:'teaching-support',label:'Teaching / course support'};
 if(unitKey==='nse'&&/^(?:replacement teaching|teaching support)/.test(n))return {key:'teaching-support',label:'Teaching support'};
 if(unitKey==='idss'&&/\bfellowships?\b/.test(n))return {key:'fellowships',label:'Fellowships'};
 if(unitKey==='dmse'&&(/\bcareer fair\b/.test(n)||/\burop\b/.test(n)))return {key:'career-fair-urop',label:'Career fair / UROP'};
 return {key:'description|'+n,label:description};
}
export function alignBudgetRequests(years,unitKey=''){
 const groups=new Map();
 for(const y of years)for(const [index,r]of (y.requests||[]).entries()){
  if(isFacultyHireSlot(r))continue;
  const family=requestFamily(r,unitKey,y.year),key=family.key.startsWith('unknown|')?family.key+'|'+index:family.key;
  if(!groups.has(key))groups.set(key,{key,label:family.label,cells:Object.fromEntries(years.map(y=>[y.year,[]]))});
  groups.get(key).cells[y.year].push(r);
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
export function budgetComparison(history,lines,year){
 const sum=(rows,key)=>{const ns=rows.map(r=>r[key]).filter(Number.isFinite);return ns.length?Math.round(ns.reduce((a,b)=>a+b,0)):null;};
 const past=[year-2,year-1].map(y=>history.find(h=>h.year===y)||{year:y,lines:0,requested:null,requests:[],outcome:'No record'});
 const recommended=lines.filter(r=>r.decision==='support'),declined=lines.filter(r=>r.decision==='decline'),pending=lines.filter(r=>!['support','decline'].includes(r.decision));
 const current={year,current:true,lines:lines.length,requests:lines,requested:sum(lines,'requested'),unpriced:lines.filter(r=>!Number.isFinite(r.requested)).length,pending:pending.length,supported:recommended.length?sum(recommended,'supported'):declined.length&&!pending.length?0:null,school:recommended.length?sum(recommended,'soe'):null,provost:recommended.length?sum(recommended,'provost'):null,declined:sum(declined,'requested')};
 return [...past,current];
}
function renderCurrent(y){
 const recMoney=v=>Number.isFinite(v)?money(v):'Not yet decided';
 const askLabels=[['SoE / Dean','dean'],['Provost','provost'],['SCC','scc'],['Unassigned','unassigned']];
 return `<article class="bh-history-year bh-history-current" aria-label="FY${String(y.year).slice(-2)} current requests and recommendations"><div class="bh-history-head"><h4>FY${String(y.year).slice(-2)} · Current</h4><p class="bh-history-label">Current asks${y.unpriced?' · incomplete':''}</p><p class="bh-history-amount">${money(y.requested)}</p><p class="bh-history-label">${y.lines} request line${y.lines===1?'':'s'} · ${y.pending} awaiting recommendation</p></div>${y.lines?`<dl class="bh-history-totals"><dt>Recommended support</dt><dd><strong>${recMoney(y.supported)}</strong></dd><dt>Proposed SoE share</dt><dd>${recMoney(y.school)}</dd><dt>Proposed Provost share</dt><dd>${recMoney(y.provost)}</dd><dt>Recommended declines</dt><dd>${recMoney(y.declined)}</dd></dl><ul class="bh-history-requests">${y.requests.map(r=>{const supported=r.decision==='support',declined=r.decision==='decline',asks=askLabels.filter(([,k])=>Number.isFinite(r.request_funding?.[k])).map(([label,k])=>'Asked of '+label+' '+money(r.request_funding[k]));return `<li><p class="bh-history-name">${esc(r.description)}</p>${lecturerComponentsHtml(r,true)}<span class="bh-history-status ${supported?'partial':declined?'initial':'unknown'}">${r.decision==='mixed'?'Mixed recommendations — see breakdown':supported?'Recommended support':declined?'Recommended decline':'Awaiting recommendation'}</span><p class="bh-history-detail">${r.component_parent?`Part of ${esc(r.component_parent)}.<br>`:''}Asked ${money(r.requested)}${asks.length?'<br>'+asks.join('<br>'):''}${supported?'<br>Recommended '+money(r.supported)+'<br>Proposed SoE '+money(r.soe)+'<br>Proposed Provost '+money(r.provost):''}</p></li>`;}).join('')}</ul>`:'<p class="bh-history-empty">No current request recorded for this year.</p>'}</article>`;
}
export function historicalStatus(r){
 if(r.lecturer_mixed)return {kind:'unknown',label:'Mixed outcomes — see breakdown'};
 if(r.history_group)return {kind:r.history_group.funded_count<r.history_group.requested_count?'partial':'full',label:r.history_group.funded_count+' TAs funded'};
 if(r.approved>0)return {kind:r.requested!==null&&r.approved<r.requested?'partial':'full',label:r.requested!==null&&r.approved<r.requested?'Part funded':'Funded'};
 if(r.declined>0)return {kind:'declined',label:r.status==='Rejected'?'Rejected':'Partly rejected'};
 if(r.initial_declined>0)return {kind:'initial',label:r.recorded_status==='Removed'?'Removed · initial decline recorded':'Declined · initial'};
 if(r.status==='Removed')return {kind:'unknown',label:'Removed'};
 return {kind:'unknown',label:r.status==='Approved (initial)'?'Approved · initial / amount unknown':'Outcome unclear'};
}
function alignedEntry(r,current){
 const supported=r.decision==='support',declined=r.decision==='decline';
 const status=current&&r.decision==='mixed'?{kind:'unknown',label:'Mixed recommendations — see breakdown'}:current?{kind:supported?'partial':declined?'initial':'unknown',label:supported?'Recommended support':declined?'Recommended decline':'Awaiting recommendation'}:historicalStatus(r);
 const amounts=current?[['SoE / Dean','dean'],['Provost','provost'],['SCC','scc'],['Unassigned','unassigned']].filter(([,k])=>Number.isFinite(r.request_funding?.[k])&&r.request_funding[k]!==0).map(([label,k])=>'Asked of '+label+' '+money(r.request_funding[k])):payers.filter(([,k])=>r[k]>0).map(([label,k])=>label+(r.history_group?.funder_counts?.[k]?' \u00b7 '+r.history_group.funder_counts[k]+' TAs':'')+' '+money(r[k]));
 return `<div class="bh-aligned-entry"><p class="bh-history-name">${esc(r.description)}</p><p class="bh-aligned-ask">Asked ${money(r.requested)}</p>${lecturerComponentsHtml(r,current)}${r.history_group?`<p class="bh-history-detail">${esc(r.history_group.note)}</p>`:''}${r.component_parent?`<p class="bh-history-label">Part of ${esc(r.component_parent)}; recommendation applies to the combined request.</p>`:''}<span class="bh-history-status ${status.kind}">${status.label}</span><p class="bh-history-detail">${current?amounts.join('<br>'):amounts.length?amounts.join('<br>'):'Funding amount '+money(r.approved)}${current&&supported?'<br>Recommended '+money(r.supported)+'<br>Proposed SoE '+money(r.soe)+'<br>Proposed Provost '+money(r.provost):''}${!current&&r.initial_declined>0?'<br>Initial decline '+money(r.initial_declined):''}${!current&&r.declined>0?'<br>Final decline '+money(r.declined):''}</p></div>`;
}
function renderAlignedHistory(years=[],{unitKey=''}={}){
 const groups=alignBudgetRequests(years,unitKey),fy=y=>'FY'+String(y).slice(-2);
 return `<div class="bh-recent bh-aligned-history"><h3>This year and previous two years: asks and decisions</h3><p class="bv-status bh-history-guide">Matching asks are aligned by purpose. Original descriptions and separate request lines remain visible where scope or quantities differ. The current year shows recommendations, not final awards; prior years show funding recorded, not verified transfers. Initial declines remain separate from final rejections.</p><table class="bh-ask-table"><caption class="bh-history-caption">Requests, outcomes and funding sources by year</caption><thead><tr><th scope="col">Ask / purpose</th>${years.map(y=>`<th scope="col"><h4>${fy(y.year)}${y.current?' · Current':''}</h4><p class="bh-history-label">${y.current?'Current':'Recorded'} asks${y.unpriced?' · incomplete':''}</p><p class="bh-aligned-total">${money(y.requested)}</p><p class="bh-history-label">${y.current?'Recommended support':'Funding recorded'}: ${y.current&&y.supported===null?'Not yet decided':money(y.current?y.supported:y.approved)}</p></th>`).join('')}</tr></thead><tbody>${groups.map(g=>`<tr><th scope="row">${esc(g.label)}${Object.values(g.cells).some(rs=>rs.length>1)?'<p class="bh-history-label">Separate lines within this purpose</p>':''}</th>${years.map((y,index)=>{const requests=g.cells[y.year],previous=index?g.cells[years[index-1].year]:[],difference=requests.length===1&&previous.length===1&&Number.isFinite(requests[0].requested)&&Number.isFinite(previous[0].requested)?requests[0].requested-previous[0].requested:null;return `<td data-year="${fy(y.year)}${y.current?' · Current':''}">${requests.length?requests.map(r=>alignedEntry(r,y.current)).join(''):'<p class="bh-history-empty">No matching request recorded.</p>'}${difference!==null?`<p class="bh-ask-change">${difference===0?'Ask amount unchanged':'Ask '+(difference>0?'+':'−')+money(Math.abs(difference))} vs ${fy(years[index-1].year)}</p>`:''}</td>`;}).join('')}</tr>`).join('')||`<tr><td colspan="${years.length+1}">No request or funding outcome recorded for these years.</td></tr>`}</tbody></table><p class="bv-status bh-history-guide">A blank match means no corresponding request is recorded, rather than a zero-dollar request or rejection.</p></div>`;
}
function renderYearCards(years=[]){return `<div class="bh-recent"><h3>This year and previous two years: asks and decisions</h3><p class="bv-status bh-history-guide">The current year shows HQ recommendations, not final awards. Prior years show approved funding recorded, rather than verified cash transfers. Initial declines and removals are separate from final rejections. Missing amounts remain unknown.</p><div class="bh-history-grid">${years.map(y=>y.current?renderCurrent(y):`<article class="bh-history-year" aria-label="FY${String(y.year).slice(-2)} asks and decisions"><div class="bh-history-head"><h4>FY${String(y.year).slice(-2)}</h4><p class="bh-history-label">Recorded asks${y.unpriced?' · incomplete':''}</p><p class="bh-history-amount">${money(y.requested)}</p><p class="bh-history-label">${y.lines} request line${y.lines===1?'':'s'} · ${esc(y.outcome)}</p></div>${y.lines?`<dl class="bh-history-totals"><dt>Funding recorded</dt><dd><strong>${money(y.approved)}</strong></dd>${payers.filter(([,key])=>['school','provost'].includes(key)||y[key]!==null&&y[key]!==undefined).map(([label,key])=>`<dt>${label}</dt><dd>${money(y[key])}</dd>`).join('')}<dt>Declined · initial</dt><dd>${money(y.initial_declined)}</dd><dt>Declined · final</dt><dd>${money(y.declined)}</dd></dl><ul class="bh-history-requests">${(y.requests||[]).map(r=>{const s=historicalStatus(r),paid=payers.filter(([,key])=>r[key]>0).map(([label,key])=>`${label}${r.history_group?.funder_counts?.[key]?' \u00b7 '+r.history_group.funder_counts[key]+' TAs':''} ${money(r[key])}`);return `<li><p class="bh-history-name">${esc(r.description)}</p>${lecturerComponentsHtml(r,false)}<span class="bh-history-status ${s.kind}">${s.label}</span><p class="bh-history-detail">Asked ${money(r.requested)}<br>${r.history_group?esc(r.history_group.note)+'<br>':''}${paid.length?paid.join('<br>'):'Funding amount '+money(r.approved)}${r.initial_declined>0?'<br>Initial decline '+money(r.initial_declined):''}${r.declined>0?'<br>Final decline '+money(r.declined):''}</p></li>`;}).join('')}</ul>`:'<p class="bh-history-empty">No request or funding outcome recorded for this year.</p>'}</article>`).join('')}</div></div>`;}
