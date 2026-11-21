const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number.isFinite(v)?'$'+Math.round(v).toLocaleString('en-US'):'Not recorded';
const payers=[['SoE / Dean','school'],['Provost','provost'],['SCC','scc'],['Funder unresolved','unresolved']];
const normal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/[^\p{L}\p{N}.]+/gu,' ').trim();
export function requestFamily(request,unitKey='',year=''){
 const description=request.description||'',n=normal(description);
 // Match clear request families. Keep original source lines and scope in every cell.
 if(!n||/^tba$/.test(n))return {key:'unknown|'+year+'|'+(request.record_id||n),label:(description||'Unspecified request')+' · FY'+String(year).slice(-2)};
 if(/\b(?:tas?|teaching assistants?)\b/.test(n))return {key:'teaching-assistants',label:'Teaching assistants'};
 if(/\blecturers?\b/.test(n)&&!(/\b(?:senior|recurring)\b/.test(n)))return {key:'lecturers',label:'Lecturers'};
 if(/^(?:grad|graduate) (?:office staff|academic admin(?:strator|istrator))$/.test(n))return {key:'graduate-office',label:'Graduate office staff'};
 if(/^(?:undergrad|undergraduate) (?:office staff|academic administrator(?: repeat request)?)$/.test(n))return {key:'undergraduate-office',label:'Undergraduate office staff'};
 if(/\bhr (?:admin|administrator)\b/.test(n)&&!n.includes('critical staff'))return {key:'hr-administrator',label:'HR administration'};
 if(unitKey==='meche'){
  if(/^(?:ug|first year) exploratory$/.test(n))return {key:'exploratory',label:'First-year exploratory teaching'};
  if(/^(?:financial officer|sra fo)$/.test(n))return {key:'finance-research-admin',label:'Finance / research administration'};
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
 return `<article class="bh-history-year bh-history-current" aria-label="FY${String(y.year).slice(-2)} current requests and recommendations"><div class="bh-history-head"><h4>FY${String(y.year).slice(-2)} · Current</h4><p class="bh-history-label">Current asks${y.unpriced?' · incomplete':''}</p><p class="bh-history-amount">${money(y.requested)}</p><p class="bh-history-label">${y.lines} request line${y.lines===1?'':'s'} · ${y.pending} awaiting recommendation</p></div>${y.lines?`<dl class="bh-history-totals"><dt>Recommended support</dt><dd><strong>${recMoney(y.supported)}</strong></dd><dt>Proposed SoE share</dt><dd>${recMoney(y.school)}</dd><dt>Proposed Provost share</dt><dd>${recMoney(y.provost)}</dd><dt>Recommended declines</dt><dd>${recMoney(y.declined)}</dd></dl><ul class="bh-history-requests">${y.requests.map(r=>{const supported=r.decision==='support',declined=r.decision==='decline',asks=askLabels.filter(([,k])=>Number.isFinite(r.request_funding?.[k])).map(([label,k])=>'Asked of '+label+' '+money(r.request_funding[k]));return `<li><p class="bh-history-name">${esc(r.description)}</p><span class="bh-history-status ${supported?'partial':declined?'initial':'unknown'}">${supported?'Recommended support':declined?'Recommended decline':'Awaiting recommendation'}</span><p class="bh-history-detail">Asked ${money(r.requested)}${asks.length?'<br>'+asks.join('<br>'):''}${supported?'<br>Recommended '+money(r.supported)+'<br>Proposed SoE '+money(r.soe)+'<br>Proposed Provost '+money(r.provost):''}</p></li>`;}).join('')}</ul>`:'<p class="bh-history-empty">No current request recorded for this year.</p>'}</article>`;
}
export function historicalStatus(r){
 if(r.approved>0)return {kind:r.requested!==null&&r.approved<r.requested?'partial':'full',label:r.requested!==null&&r.approved<r.requested?'Part funded':'Funded'};
 if(r.declined>0)return {kind:'declined',label:r.status==='Rejected'?'Rejected':'Partly rejected'};
 if(r.initial_declined>0)return {kind:'initial',label:r.recorded_status==='Removed'?'Removed · initial decline recorded':'Declined · initial'};
 if(r.status==='Removed')return {kind:'unknown',label:'Removed'};
 return {kind:'unknown',label:r.status==='Approved (initial)'?'Approved · initial / amount unknown':'Outcome unclear'};
}
function alignedEntry(r,current){
 const supported=r.decision==='support',declined=r.decision==='decline';
 const status=current?{kind:supported?'partial':declined?'initial':'unknown',label:supported?'Recommended support':declined?'Recommended decline':'Awaiting recommendation'}:historicalStatus(r);
 const amounts=current?[['SoE / Dean','dean'],['Provost','provost'],['SCC','scc'],['Unassigned','unassigned']].filter(([,k])=>Number.isFinite(r.request_funding?.[k])&&r.request_funding[k]!==0).map(([label,k])=>'Asked of '+label+' '+money(r.request_funding[k])):payers.filter(([,k])=>r[k]>0).map(([label,k])=>label+' '+money(r[k]));
 return `<div class="bh-aligned-entry"><p class="bh-history-name">${esc(r.description)}</p><p class="bh-aligned-ask">Asked ${money(r.requested)}</p><span class="bh-history-status ${status.kind}">${status.label}</span><p class="bh-history-detail">${current?amounts.join('<br>'):amounts.length?amounts.join('<br>'):'Funding amount '+money(r.approved)}${current&&supported?'<br>Recommended '+money(r.supported)+'<br>Proposed SoE '+money(r.soe)+'<br>Proposed Provost '+money(r.provost):''}${!current&&r.initial_declined>0?'<br>Initial decline '+money(r.initial_declined):''}${!current&&r.declined>0?'<br>Final decline '+money(r.declined):''}</p></div>`;
}
export function renderBudgetHistory(years=[],{unitKey=''}={}){
 const groups=alignBudgetRequests(years,unitKey),fy=y=>'FY'+String(y).slice(-2);
 return `<div class="bh-recent bh-aligned-history"><h3>This year and previous two years: asks and decisions</h3><p class="bv-status bh-history-guide">Matching asks are aligned by purpose. Original descriptions and separate request lines remain visible where scope or quantities differ. The current year shows recommendations, not final awards; prior years show funding recorded, not verified transfers. Initial declines remain separate from final rejections.</p><table class="bh-ask-table"><caption class="bh-history-caption">Requests, outcomes and funding sources by year</caption><thead><tr><th scope="col">Ask / purpose</th>${years.map(y=>`<th scope="col"><h4>${fy(y.year)}${y.current?' · Current':''}</h4><p class="bh-history-label">${y.current?'Current':'Recorded'} asks${y.unpriced?' · incomplete':''}</p><p class="bh-aligned-total">${money(y.requested)}</p><p class="bh-history-label">${y.current?'Recommended support':'Funding recorded'}: ${y.current&&y.supported===null?'Not yet decided':money(y.current?y.supported:y.approved)}</p></th>`).join('')}</tr></thead><tbody>${groups.map(g=>`<tr><th scope="row">${esc(g.label)}${Object.values(g.cells).some(rs=>rs.length>1)?'<p class="bh-history-label">Separate lines within this purpose</p>':''}</th>${years.map((y,index)=>{const requests=g.cells[y.year],previous=index?g.cells[years[index-1].year]:[],difference=requests.length===1&&previous.length===1&&Number.isFinite(requests[0].requested)&&Number.isFinite(previous[0].requested)?requests[0].requested-previous[0].requested:null;return `<td data-year="${fy(y.year)}${y.current?' · Current':''}">${requests.length?requests.map(r=>alignedEntry(r,y.current)).join(''):'<p class="bh-history-empty">No matching request recorded.</p>'}${difference!==null?`<p class="bh-ask-change">${difference===0?'Ask amount unchanged':'Ask '+(difference>0?'+':'−')+money(Math.abs(difference))} vs ${fy(years[index-1].year)}</p>`:''}</td>`;}).join('')}</tr>`).join('')||`<tr><td colspan="${years.length+1}">No request or funding outcome recorded for these years.</td></tr>`}</tbody></table><p class="bv-status bh-history-guide">A blank match means no corresponding request is recorded, rather than a zero-dollar request or rejection. Unknown “TBA” entries stay separate.</p><details class="bh-aligned-totals"><summary>Year totals and funding breakdown</summary>${renderYearCards(years)}</details></div>`;
}
function renderYearCards(years=[]){return `<div class="bh-recent"><h3>This year and previous two years: asks and decisions</h3><p class="bv-status bh-history-guide">The current year shows HQ recommendations, not final awards. Prior years show approved funding recorded, rather than verified cash transfers. Initial declines and removals are separate from final rejections. Missing amounts remain unknown.</p><div class="bh-history-grid">${years.map(y=>y.current?renderCurrent(y):`<article class="bh-history-year" aria-label="FY${String(y.year).slice(-2)} asks and decisions"><div class="bh-history-head"><h4>FY${String(y.year).slice(-2)}</h4><p class="bh-history-label">Recorded asks${y.unpriced?' · incomplete':''}</p><p class="bh-history-amount">${money(y.requested)}</p><p class="bh-history-label">${y.lines} request line${y.lines===1?'':'s'} · ${esc(y.outcome)}</p></div>${y.lines?`<dl class="bh-history-totals"><dt>Funding recorded</dt><dd><strong>${money(y.approved)}</strong></dd>${payers.filter(([,key])=>['school','provost'].includes(key)||y[key]!==null&&y[key]!==undefined).map(([label,key])=>`<dt>${label}</dt><dd>${money(y[key])}</dd>`).join('')}<dt>Declined · initial</dt><dd>${money(y.initial_declined)}</dd><dt>Declined · final</dt><dd>${money(y.declined)}</dd></dl><ul class="bh-history-requests">${(y.requests||[]).map(r=>{const s=historicalStatus(r),paid=payers.filter(([,key])=>r[key]>0).map(([label,key])=>`${label} ${money(r[key])}`);return `<li><p class="bh-history-name">${esc(r.description)}</p><span class="bh-history-status ${s.kind}">${s.label}</span><p class="bh-history-detail">Asked ${money(r.requested)}<br>${paid.length?paid.join('<br>'):'Funding amount '+money(r.approved)}${r.initial_declined>0?'<br>Initial decline '+money(r.initial_declined):''}${r.declined>0?'<br>Final decline '+money(r.declined):''}</p></li>`;}).join('')}</ul>`:'<p class="bh-history-empty">No request or funding outcome recorded for this year.</p>'}</article>`).join('')}</div></div>`;}
