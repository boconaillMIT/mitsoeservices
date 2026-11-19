// Budget Explorer (comparison view). Reads the same Quickbase rows as the legacy explorer.
// "Approved" = Provost (recurring + one-time) + School + historical allocations whose funder is unresolved.
// Blank amounts stay blank: they are never counted as zero in medians or approval rates.
import {mapRecord,groupForUnit,workbookSourceHtml} from './budget-model.mjs';

const $=s=>document.querySelector(s);
const root=$('#bv');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fy=y=>'FY'+String(y).slice(-2);
const money=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v<0?'-$':'$')+Math.round(Math.abs(v)).toLocaleString('en-US');
const short=v=>{if(v===null||!Number.isFinite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+'$'+(a/1e6).toFixed(a>=1e7?1:2)+'M':a>=1e3?s+'$'+Math.round(a/1e3)+'K':s+'$'+Math.round(a);};
const pct=v=>v===null||!Number.isFinite(v)?'—':v>0&&v<.1?(v*100).toFixed(1)+'%':Math.round(v*100)+'%';
const sum=a=>a.reduce((x,y)=>x+y,0);
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};

const MEASURES={
 approved:{label:'Approved (all funders)',get:t=>t.approved},
 provost:{label:'Provost approved',get:t=>t.provost},
 school:{label:'School (SoE) approved',get:t=>t.school},
 scc:{label:'SCC approved',get:t=>t.scc},
 requested:{label:'Requested',get:t=>t.requested},
 declined:{label:'Declined',get:t=>t.declined}
};
const SEG=[['provost','Provost','#1f5a41'],['school','School (SoE)','#c39a2b'],['scc','SCC','#750014'],['unresolved','Funder unresolved','#9fb5a6']];

let records=[],units=[],years=[];
const state={focus:'EECS',measure:'approved',peers:'academic',from:null,through:null,reqYear:null};

// Sum one set of records; each component is null only if no row records it.
function agg(rows){
 const pick=k=>{const v=rows.map(r=>r[k]).filter(x=>x!==null);return v.length?sum(v):null;};
 const provost=pick('provost'),school=pick('school'),scc=pick('scc'),unresolved=pick('unresolved'),requested=pick('requested'),declined=pick('declined');
 const parts=[provost,school,scc,unresolved].filter(x=>x!==null);
 return {provost,school,scc,unresolved,requested,declined,approved:parts.length?sum(parts):null,asks:rows.length};
}
const inRange=r=>r.year>=state.from&&r.year<=state.through;
const peerList=()=>units.filter(u=>state.peers==='all'||groupForUnit(u)==='Academic units');
const cache=new Map();
function cell(unit,year){const k=unit+'|'+year;if(!cache.has(k))cache.set(k,agg(records.filter(r=>r.unit===unit&&(year==='all'?inRange(r):r.year===year))));return cache.get(k);}
const val=(unit,year)=>MEASURES[state.measure].get(cell(unit,year));

function select(id,options,value){const el=$(id);el.innerHTML=options.map(([v,l])=>`<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`).join('');}
function controls(){
 const peers=peerList();if(!peers.includes(state.focus))state.focus=peers[0]||units[0];
 select('#bv-unit',units.filter(u=>state.peers==='all'||groupForUnit(u)==='Academic units').map(u=>[u,u]),state.focus);
 select('#bv-measure',Object.entries(MEASURES).map(([k,m])=>[k,m.label]),state.measure);
 select('#bv-peers',[['academic','Academic departments'],['all','All units']],state.peers);
 select('#bv-from',years.map(y=>[y,fy(y)]),state.from);select('#bv-through',years.map(y=>[y,fy(y)]),state.through);
}

function kpis(){
 const peers=peerList(),f=cell(state.focus,'all'),m=MEASURES[state.measure];
 const totals=peers.map(u=>({u,v:val(u,'all')})).filter(x=>x.v!==null).sort((a,b)=>b.v-a.v);
 const all=sum(totals.map(x=>x.v)),mine=m.get(f),rank=totals.findIndex(x=>x.u===state.focus)+1;
 // Approval rate only over years where this unit has any recorded decline.
 const decYears=years.filter(y=>y>=state.from&&y<=state.through&&cell(state.focus,y).declined!==null);
 const ap=sum(decYears.map(y=>cell(state.focus,y).approved??0)),de=sum(decYears.map(y=>cell(state.focus,y).declined??0));
 const tile=(label,value,note)=>`<div class="bv-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
 $('#bv-kpis').innerHTML=
  tile(esc(m.label),money(mine),`${esc(state.focus)}, ${fy(state.from)}–${fy(state.through)}`)+
  tile('Share of group',all&&mine!==null?pct(mine/all):'—',`of ${short(all)} across ${totals.length} ${state.peers==='academic'?'academic departments':'units'}`)+
  tile('Rank in group',rank?`${rank} of ${totals.length}`:'—','by the selected measure')+
  tile('Approval rate',ap+de?pct(ap/(ap+de)):'—',decYears.length?`approved ÷ (approved + declined), ${decYears.map(fy).join(', ')}`:'no declines recorded in this range');
}

function matrix(){
 const ys=years.filter(y=>y>=state.from&&y<=state.through),peers=peerList();
 const rows=peers.map(u=>({u,vals:ys.map(y=>val(u,y)),total:val(u,'all')})).sort((a,b)=>(b.total??-1)-(a.total??-1));
 const med=ys.map((y,i)=>median(rows.map(r=>r.vals[i])));
 const max=Math.max(1,...rows.flatMap(r=>r.vals).filter(Number.isFinite));
 const shade=v=>v===null?'':`style="background:rgba(31,90,65,${(0.08+0.62*Math.sqrt(Math.max(0,v)/max)).toFixed(3)});color:${Math.sqrt(Math.max(0,v)/max)>.55?'#fff':'#233c31'}"`;
 $('#bv-matrix').innerHTML=`<table class="bv-table bv-heat"><thead><tr><th>Unit</th>${ys.map(y=>`<th class="n">${fy(y)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.u===state.focus?'is-focus':''}" data-unit="${esc(r.u)}"><th><button type="button" class="bv-link" data-unit="${esc(r.u)}">${esc(r.u)}</button></th>${r.vals.map(v=>`<td class="n" ${shade(v)}>${short(v)}</td>`).join('')}<td class="n"><strong>${short(r.total)}</strong></td></tr>`).join('')}</tbody><tfoot><tr><th>Median</th>${med.map(v=>`<td class="n">${short(v)}</td>`).join('')}<td class="n">${short(median(rows.map(r=>r.total)))}</td></tr></tfoot></table>`;
 $('#bv-matrix-note').textContent=`${MEASURES[state.measure].label}. Click a unit to focus on it. Blank (—) means nothing recorded, not zero; medians use only recorded values.`;
}

function history(){
 const ys=years.filter(y=>y>=state.from&&y<=state.through),peers=peerList().filter(u=>u!==state.focus);
 const stacked=state.measure==='approved';
 const data=ys.map(y=>{const c=cell(state.focus,y);return {y,c,v:MEASURES[state.measure].get(c),med:median(peers.map(u=>val(u,y)))};});
 const W=760,H=270,L=58,R=12,T=14,B=30,max=Math.max(1,...data.flatMap(d=>[d.v,d.med]).filter(Number.isFinite))*1.08;
 const bw=(W-L-R)/Math.max(1,data.length),y=v=>T+(H-T-B)*(1-v/max);
 const ticks=[0,.25,.5,.75,1].map(t=>t*max);
 let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(state.focus)} by year with peer median">`;
 svg+=ticks.map(t=>`<line x1="${L}" x2="${W-R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L-6}" y="${y(t)+4}" class="ax" text-anchor="end">${short(t)}</text>`).join('');
 data.forEach((d,i)=>{const x=L+i*bw+bw*.18,w=bw*.64;
  if(stacked){let acc=0;for(const [k,label,color] of SEG){const v=d.c[k];if(!v)continue;svg+=`<rect x="${x}" y="${y(acc+v)}" width="${w}" height="${y(acc)-y(acc+v)}" fill="${color}"><title>${fy(d.y)} ${label}: ${money(v)}</title></rect>`;acc+=v;}}
  else if(d.v!==null)svg+=`<rect x="${x}" y="${y(d.v)}" width="${w}" height="${y(0)-y(d.v)}" fill="#1f5a41"><title>${fy(d.y)}: ${money(d.v)}</title></rect>`;
  svg+=`<text x="${x+w/2}" y="${H-10}" class="ax" text-anchor="middle">${fy(d.y)}</text>`;});
 const pts=data.map((d,i)=>d.med===null?null:[L+i*bw+bw/2,y(d.med)]);
 let path='';pts.forEach((p,i)=>{if(p)path+=(path&&pts[i-1]?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);});
 svg+=`<path d="${path}" class="med"/>`+pts.map((p,i)=>p?`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="med-dot"><title>${fy(data[i].y)} peer median: ${money(data[i].med)}</title></circle>`:'').join('')+'</svg>';
 $('#bv-history').innerHTML=svg;
 $('#bv-history-title').textContent=`${state.focus}: ${MEASURES[state.measure].label.toLowerCase()} by year`;
 $('#bv-history-legend').innerHTML=(stacked?SEG.map(([,l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join(''):`<span><i style="background:#1f5a41"></i>${esc(state.focus)}</span>`)+`<span><i class="line"></i>Median of other ${state.peers==='academic'?'academic departments':'units'}</span>`;
}

function split(){
 const rows=peerList().map(u=>({u,c:cell(u,'all')})).filter(r=>r.c.approved).sort((a,b)=>b.c.approved-a.c.approved);
 $('#bv-split').innerHTML=rows.length?rows.map(r=>`<div class="bv-row${r.u===state.focus?' is-focus':''}"><span class="bv-name">${esc(r.u)}</span><div class="bv-stack">${SEG.map(([k,l,c])=>r.c[k]?`<div style="width:${(r.c[k]/r.c.approved*100).toFixed(2)}%;background:${c}" title="${l}: ${money(r.c[k])} (${pct(r.c[k]/r.c.approved)})"></div>`:'').join('')}</div><span class="n">${pct((r.c.provost??0)/r.c.approved)} Provost</span></div>`).join(''):'<p class="bv-empty">No approved amounts recorded in this range.</p>';
 $('#bv-split-legend').innerHTML=SEG.map(([,l,c])=>`<span><i style="background:${c}"></i>${l}</span>`).join('');
}

function categories(){
 const pick=rs=>{const m=new Map();for(const r of rs){const a=[r.provost,r.school,r.scc,r.unresolved].filter(x=>x!==null);if(!a.length)continue;const k=r.category||'Uncategorized';m.set(k,(m.get(k)||0)+sum(a));}return m;};
 const mine=pick(records.filter(r=>r.unit===state.focus&&inRange(r)));
 const peers=pick(records.filter(r=>r.unit!==state.focus&&inRange(r)&&peerList().includes(r.unit)));
 const mt=sum([...mine.values()]),pt=sum([...peers.values()]);
 const cats=[...new Set([...mine.keys(),...peers.keys()])].map(k=>({k,m:mine.get(k)||0,p:peers.get(k)||0})).filter(c=>c.m||c.p).sort((a,b)=>b.m-a.m||b.p-a.p);
 const bar=(v,t,cls)=>`<div class="bv-track"><div class="${cls}" style="width:${t?(v/t*100).toFixed(2):0}%"></div></div>`;
 $('#bv-cats').innerHTML=cats.length?`<table class="bv-table bv-cats"><thead><tr><th>Category</th><th>${esc(state.focus)} share</th><th class="n">${esc(state.focus)}</th><th>Other ${state.peers==='academic'?'academic':'units'} share</th></tr></thead><tbody>${cats.map(c=>`<tr><td>${esc(c.k)}</td><td>${bar(c.m,mt,'bv-fill')}<small>${pct(mt?c.m/mt:null)}</small></td><td class="n">${short(c.m)}</td><td>${bar(c.p,pt,'bv-fill peer')}<small>${pct(pt?c.p/pt:null)}</small></td></tr>`).join('')}</tbody></table>`:'<p class="bv-empty">No approved amounts recorded in this range.</p>';
}

function requests(){
 const ys=years.filter(y=>y>=state.from&&y<=state.through);
 if(state.reqYear===null||(state.reqYear!=='all'&&!ys.includes(Number(state.reqYear))))state.reqYear=String(ys.at(-1)??'all');
 select('#bv-req-year',[['all','All years in range'],...ys.slice().reverse().map(y=>[y,fy(y)])],state.reqYear);
 const rows=records.filter(r=>r.unit===state.focus&&inRange(r)&&(state.reqYear==='all'||r.year===Number(state.reqYear))).sort((a,b)=>b.year-a.year||(b.requested??0)-(a.requested??0));
 const t=agg(rows);
 $('#bv-requests').innerHTML=`<table class="bv-table"><thead><tr><th>FY</th><th>Request</th><th>Category</th><th class="n">Requested</th><th class="n">Provost</th><th class="n">School</th><th class="n">SCC</th><th class="n">Unresolved</th><th class="n">Declined</th><th>Decision</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fy(r.year)}</td><td>${esc(r.request)||'—'}${workbookSourceHtml(r.source)}</td><td>${esc(r.category)||'—'}</td><td class="n">${money(r.requested)}</td><td class="n">${money(r.provost)}</td><td class="n">${money(r.school)}</td><td class="n">${money(r.scc)}</td><td class="n">${money(r.unresolved)}</td><td class="n">${money(r.declined)}${r.declinedIsInitial?'<sup title="Initial decision; no final decision recorded">i</sup>':''}</td><td>${esc(r.decision)||'—'}</td></tr>`).join('')||'<tr><td colspan="10" class="bv-empty">No requests recorded.</td></tr>'}</tbody><tfoot><tr><th colspan="3">${rows.length} asks</th><td class="n">${money(t.requested)}</td><td class="n">${money(t.provost)}</td><td class="n">${money(t.school)}</td><td class="n">${money(t.scc)}</td><td class="n">${money(t.unresolved)}</td><td class="n">${money(t.declined)}</td><td></td></tr></tfoot></table>`;
}

function render(){cache.clear();controls();kpis();matrix();history();split();categories();requests();}

root.addEventListener('change',e=>{
 const id=e.target.id,v=e.target.value;
 if(id==='bv-unit')state.focus=v;else if(id==='bv-measure')state.measure=v;else if(id==='bv-peers')state.peers=v;else if(id==='bv-req-year')state.reqYear=v;
 else if(id==='bv-from'){state.from=Number(v);if(state.through<state.from)state.through=state.from;}
 else if(id==='bv-through'){state.through=Number(v);if(state.from>state.through)state.from=state.through;}
 else return;
 render();
});
root.addEventListener('click',e=>{const b=e.target.closest('[data-unit]');if(b&&b.tagName==='BUTTON'){state.focus=b.dataset.unit;render();$('#bv-kpis').scrollIntoView({behavior:'smooth',block:'start'});}});

fetch('/.netlify/functions/budget-explorer',{credentials:'same-origin'}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Budget data is temporarily unavailable.');return d;}).then(data=>{
 records=data.rows.map(mapRecord).filter(r=>r.year&&r.unit);
 units=[...new Set(records.map(r=>r.unit))].sort((a,b)=>a.localeCompare(b));
 years=[...new Set(records.map(r=>r.year))].sort((a,b)=>a-b);
 if(!records.length)throw Error('No budget records were returned.');
 // Default to the last ten fiscal years that have any approvals recorded.
 const funded=years.filter(y=>records.some(r=>r.year===y&&[r.provost,r.school,r.unresolved].some(x=>x)));
 state.through=(funded.length?funded:years).at(-1);state.from=Math.max(years[0],state.through-9);
 if(!units.includes(state.focus))state.focus=units.find(u=>groupForUnit(u)==='Academic units')||units[0];
 $('#bv-count').textContent=`${records.length.toLocaleString('en-US')} Quickbase records, ${fy(years[0])}–${fy(years.at(-1))}.`;
 if(data.sourceUrl)$('#bv-source').href=data.sourceUrl;
 $('#bv-loading').hidden=true;$('#bv-content').hidden=false;render();
}).catch(err=>{$('#bv-loading').textContent=err.message;$('#bv-loading').classList.add('error');});
