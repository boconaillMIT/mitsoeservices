import {mapRecord,totals,groupForUnit,workbookSourceHtml} from './budget-model.mjs';
const root=document.querySelector('.budget-explorer');
if(root){
 const $=selector=>root.querySelector(selector),$$=selector=>[...root.querySelectorAll(selector)];
 const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const amount=value=>value===null?'—':money.format(value);
 const aggregate=value=>value.amount===null?'—':`${money.format(value.amount)}${value.recorded<value.total?' *':''}`;
 let records=[];
 const opts=(select,values,current)=>{select.innerHTML=values.map(value=>`<option value="${esc(value)}"${value===current?' selected':''}>${esc(value)}</option>`).join('');};
 const note='— means no amount was recorded. * Totals include recorded amounts only; blanks are not treated as zero. Declined amounts may be initial decisions where no final decision is recorded.';
 function visuals(unit,from,through){
  const panel=$('#budget-visuals');if(!panel)return;
  const scope=records.filter(r=>r.year>=from&&r.year<=through),peers=[...new Set(scope.filter(r=>groupForUnit(r.unit)==='Academic units').map(r=>r.unit))];
  const funded=rows=>{const t=totals(rows),values=[t.provost.amount,t.school.amount,t.scc.amount];return values.every(v=>v===null)?null:values.reduce((a,b)=>a+(b??0),0);};
  const fy=year=>`FY${String(year).slice(-2)}`;
  const rows=scope.filter(r=>r.unit===unit),isAcademic=groupForUnit(unit)==='Academic units';
  const ranking=peers.map(name=>({name,value:funded(scope.filter(r=>r.unit===name))})).filter(x=>x.value!==null).sort((a,b)=>b.value-a.value);
  const categories=[...new Set(rows.map(r=>r.category).filter(Boolean))].map(category=>({name:category,value:funded(rows.filter(r=>r.category===category))})).filter(x=>x.value!==null&&x.value>0).sort((a,b)=>b.value-a.value);
  const years=[...new Set(scope.map(r=>r.year))].sort((a,b)=>a-b);
  const medians=years.map(year=>{const amounts=peers.map(name=>funded(scope.filter(r=>r.unit===name&&r.year===year))).filter(x=>x!==null).sort((a,b)=>a-b);const median=amounts.length?(amounts[(amounts.length-1)>>1]+amounts[amounts.length>>1])/2:null;return {year,median,count:amounts.length,own:funded(rows.filter(r=>r.year===year))};});
  const mix=years.map(year=>{const t=totals(rows.filter(r=>r.year===year));return {year,recurring:t.provostBase.amount,provostOne:t.provostNon.amount,school:t.school.amount};}).filter(x=>x.recurring!==null||x.provostOne!==null||x.school!==null);
  const rankNote=isAcademic?'':` ${esc(unit)} is not an academic department, so it is not ranked here.`;
  const vsMedian=x=>x.own===null||x.median===null||x.median===0?'—':`${x.own>=x.median?'+':''}${Math.round((x.own/x.median-1)*100)}%`;
  panel.innerHTML=`<div class="budget-grid"><section class="budget-panel"><h2>Recorded support: department ranking</h2><p class="budget-status">Provost + School + SCC approvals for the nine academic departments, ${fy(from)}–${fy(through)}. Missing decisions and unattributed funding are excluded, so totals may be incomplete.${rankNote}</p><div class="budget-chart" id="budget-rank-chart"></div></section><section class="budget-panel"><h2>What recorded support paid for</h2><p class="budget-status">Provost + School + SCC approvals for ${esc(unit)} by request category. Uncategorized and unattributed amounts are excluded.</p><div class="budget-chart" id="budget-category-chart"></div></section></div>
<div class="budget-grid"><section class="budget-panel"><h2>Recorded support versus academic median</h2><p class="budget-status">The median uses only departments with recorded support in each year; missing data is not treated as zero.</p><div class="budget-table-wrap"><table class="budget-table"><thead><tr><th>FY</th><th class="number">${esc(unit)}</th><th class="number">Academic median</th><th class="number">vs median</th><th class="number">Depts recorded</th></tr></thead><tbody>${medians.map(x=>`<tr><td>${fy(x.year)}</td><td class="number">${amount(x.own)}</td><td class="number">${amount(x.median)}</td><td class="number">${vsMedian(x)}</td><td class="number">${x.count}</td></tr>`).join('')}</tbody></table></div></section><section class="budget-panel"><h2>Recurring versus one-time support</h2><div class="budget-legend"><span><i class="budget-key recurring"></i>Provost recurring (base)</span><span><i class="budget-key provost-one"></i>Provost one-time</span><span><i class="budget-key school"></i>School one-time</span></div><div class="budget-chart" id="budget-mix-chart"></div></section></div>
<section class="budget-panel"><h2>Requests and recorded decisions by year</h2><p class="budget-status">Totals include recorded amounts only (* = some asks have no amount recorded). Declined figures can include initial decisions; blanks do not establish approval or rejection.</p><div class="budget-table-wrap"><table class="budget-table"><thead><tr><th>FY</th><th class="number">Asks</th><th class="number">Requested</th><th class="number">Provost recurring</th><th class="number">Provost one-time</th><th class="number">School approved</th><th class="number">SCC approved</th><th class="number">Declined</th><th class="number">Funder unresolved</th></tr></thead><tbody>${years.map(year=>{const yr=rows.filter(r=>r.year===year);if(!yr.length)return '';const t=totals(yr);return `<tr><td>${fy(year)}</td><td class="number">${yr.length}</td><td class="number">${aggregate(t.requested)}</td><td class="number">${aggregate(t.provostBase)}</td><td class="number">${aggregate(t.provostNon)}</td><td class="number">${aggregate(t.school)}</td><td class="number">${aggregate(t.scc)}</td><td class="number">${aggregate(t.declined)}</td><td class="number">${aggregate(t.unresolved)}</td></tr>`;}).join('')||'<tr><td colspan="9" class="budget-empty">No requests for this selection.</td></tr>'}</tbody></table></div></section>`;
  function bars(target,items,highlight){
   const max=Math.max(1,...items.map(x=>x.value));
   target.innerHTML=items.length?items.map(x=>`<div class="budget-bar-row${x.name===highlight?' is-selected':''}"><strong title="${esc(x.name)}">${esc(x.name)}</strong><div class="budget-track"><div class="budget-request-bar"></div></div><span class="number">${amount(x.value)}</span></div>`).join(''):'<p class="budget-empty">No recorded approved amounts.</p>';
   target.querySelectorAll('.budget-bar-row').forEach((el,i)=>{el.querySelector('.budget-request-bar').style.width=`${Math.max(0,items[i].value)/max*100}%`;});
  }
  bars($('#budget-rank-chart'),ranking,unit);bars($('#budget-category-chart'),categories,null);
  const mixMax=Math.max(1,...mix.map(x=>(x.recurring??0)+(x.provostOne??0)+(x.school??0))),mixEl=$('#budget-mix-chart');
  mixEl.innerHTML=mix.length?mix.map(x=>{const total=(x.recurring??0)+(x.provostOne??0)+(x.school??0),seg=(v,cls,label)=>v?`<div class="budget-seg ${cls}" style="width:${Math.max(0,v)/mixMax*100}%" title="${label}: ${amount(v)}"></div>`:'';return `<div class="budget-year-row"><strong>${fy(x.year)}</strong><div class="budget-track budget-stack">${seg(x.recurring,'recurring','Provost recurring')}${seg(x.provostOne,'provost-one','Provost one-time')}${seg(x.school,'school','School one-time')}</div><span class="number">${amount(total)}</span></div>`;}).join(''):'<p class="budget-empty">No recorded approved amounts.</p>';
 }
 function setStats(rows){const t=totals(rows);for(const key of ['requested','provost','school','declined'])$('#stat-'+key).textContent=aggregate(t[key]);}
 function renderRows(target,rows,showYear){target.innerHTML=rows.length?rows.map(row=>`<tr><td>${esc(showYear?'FY'+String(row.year).slice(-2):row.unit)}</td><td>${esc(row.request||'(No description)')}${workbookSourceHtml(row.source)}</td><td>${esc(row.category||'—')}</td><td class="number">${amount(row.requested)}</td><td class="number">${amount(row.provost)}</td><td class="number">${amount(row.school)}</td><td class="number">${amount(row.scc)}</td><td class="number">${amount(row.declined)}${row.declinedIsInitial?' (initial)':''}</td><td>${esc(row.decision||'—')}${row.unresolved!==null?`<br>Unattributed allocation: ${amount(row.unresolved)}`:''}</td></tr>`).join(''):'<tr><td colspan="9" class="budget-empty">No matching requests.</td></tr>';}
 function history(){
  const unit=$('#history-unit').value,from=Number($('#history-from').value),through=Number($('#history-through').value),rows=records.filter(row=>row.unit===unit&&row.year>=from&&row.year<=through);
  setStats(rows);
  const annual=[...new Set(rows.map(row=>row.year))].sort((a,b)=>a-b).map(year=>({year,...totals(rows.filter(row=>row.year===year))}));
  const max=Math.max(1,...annual.flatMap(row=>[row.requested.amount??0,(row.provost.amount??0)+(row.school.amount??0)+(row.scc.amount??0)]));
  $('#history-chart').innerHTML=annual.length?annual.map(row=>`<div class="budget-year-row"><strong>FY${String(row.year).slice(-2)}</strong><div class="budget-track"><div class="budget-request-bar"></div><div class="budget-grant-bar"></div></div><span class="number">${aggregate(row.requested)}</span></div>`).join(''):'<p class="budget-empty">No requests for this selection.</p>';
  $$('#history-chart .budget-year-row').forEach((element,index)=>{const row=annual[index],grant=(row.provost.amount??0)+(row.school.amount??0)+(row.scc.amount??0);element.querySelector('.budget-request-bar').style.width=`${Math.max(0,row.requested.amount??0)/max*100}%`;element.querySelector('.budget-grant-bar').style.width=`${Math.max(0,grant)/max*100}%`;});
  visuals(unit,from,through);renderRows($('#history-rows'),rows.sort((a,b)=>b.year-a.year),true);$('#history-status').textContent=`${rows.length} asks for ${unit||'this unit'}. ${note}`;
 }
 function compare(){
  const year=Number($('#compare-year').value),category=$('#compare-category').value,group=$('#compare-group').value,selected=new Set($$('.budget-unit-choice input:checked').map(input=>input.value));
  let rows=records.filter(row=>row.year===year&&selected.has(row.unit));if(category!=='All categories')rows=rows.filter(row=>row.category===category);if(group!=='All units')rows=rows.filter(row=>groupForUnit(row.unit)===group);
  const byUnit=new Map();for(const row of rows){if(!byUnit.has(row.unit))byUnit.set(row.unit,[]);byUnit.get(row.unit).push(row);}const summaries=[...byUnit].map(([unit,items])=>({unit,items,...totals(items)})).sort((a,b)=>(b.requested.amount??-Infinity)-(a.requested.amount??-Infinity));
  $('#compare-summary').innerHTML=summaries.length?summaries.map(row=>`<tr><td><strong>${esc(row.unit)}</strong></td><td class="number">${row.items.length}</td><td class="number">${aggregate(row.requested)}</td><td class="number">${aggregate(row.provost)}</td><td class="number">${aggregate(row.school)}</td><td class="number">${aggregate(row.scc)}</td><td class="number">${aggregate(row.declined)}</td></tr>`).join(''):'<tr><td colspan="6" class="budget-empty">No matching units.</td></tr>';
  renderRows($('#compare-rows'),rows.sort((a,b)=>(b.requested??-Infinity)-(a.requested??-Infinity)),false);$('#compare-status').textContent=`${rows.length} asks across ${summaries.length} units. ${note}`;
 }
 function show(view){$$('.budget-tab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.view===view)));$$('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==view);if(view==='history')history();else compare();}
 async function start(){
  try{
   const response=await fetch('/.netlify/functions/budget-explorer',{credentials:'same-origin'});if(!response.ok)throw Error();const payload=await response.json();
   if(!Array.isArray(payload.rows)||!Array.isArray(payload.fields))throw Error();
   records=payload.rows.map(mapRecord).filter(row=>row.year&&row.unit&&!row.facultyHireSlot);
   const units=[...new Set(records.map(row=>row.unit))].sort((a,b)=>a.localeCompare(b)),years=[...new Set(records.map(row=>row.year))].sort((a,b)=>a-b),categories=[...new Set(records.map(row=>row.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
   if(!units.length||!years.length)throw Error();
   opts($('#history-unit'),units,units[0]);opts($('#history-from'),years,years[0]);opts($('#history-through'),years,years.at(-1));opts($('#compare-year'),[...years].reverse(),years.at(-1));opts($('#compare-category'),['All categories',...categories],'All categories');
   const group=$('#compare-group');group.insertAdjacentHTML('beforeend','<option>Combined or unclassified</option>');
   $('#unit-picker').innerHTML=units.map(unit=>`<label class="budget-unit-choice"><input type="checkbox" value="${esc(unit)}" checked> <span>${esc(unit)}</span></label>`).join('');
   const panel=document.createElement('div');panel.id='budget-visuals';$('#history-chart').closest('.budget-panel').after(panel);
   $('#budget-source').href=payload.sourceUrl;$('#budget-loading').hidden=true;$('#budget-content').hidden=false;show('history');
  }catch{$('#budget-loading').textContent='Budget data could not be loaded. Please try again or open the Quickbase source.';}
 }
 $$('.budget-tab').forEach(tab=>tab.addEventListener('click',()=>show(tab.dataset.view)));
 root.addEventListener('change',event=>{if(event.target.closest('[data-panel="history"]'))history();if(event.target.closest('[data-panel="compare"]'))compare();});
 start();
}
