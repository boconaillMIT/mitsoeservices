import {startBudgetWalletExtract} from './budget-wallet-extract.mjs';
import {submissionHtml,submissionLineHtml} from '/budget-submission.mjs';
import {workbookSourceHtml,sumRequestFunding} from '/budget-model.mjs';
import {renderBudgetHistory,budgetComparison,bindBudgetPerspective,requestBreakdownHtml} from '/budget-history.mjs';
// SoE HQ → Budget: cycle roll-up and unit pages. Data: /.netlify/functions/budget-hq-data
const $=s=>document.querySelector(s);
const root=$('#bh'),view=root.dataset.view,cycle=root.dataset.cycle,unitKey=root.dataset.unit;
bindBudgetPerspective(root);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fy=y=>'FY'+String(y).slice(-2);
const money=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v<0?'-':'')+'$'+Math.round(Math.abs(v)).toLocaleString();
const short=v=>{if(v===null||v===undefined||!Number.isFinite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+'$'+(a/1e6).toFixed(a>=1e7?1:2)+'M':a>=1e3?s+'$'+Math.round(a/1e3)+'K':s+'$'+Math.round(a);};
const pct=v=>v===null||v===undefined||!Number.isFinite(v)?'—':Math.round(v*100)+'%';
const signed=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>0?'+':'')+Math.round(v*100)+'%';
const mo=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(Math.round(v*10)/10).toFixed(1);
const tile=(label,value,note='')=>`<div class="bv-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
const SOE='#2f6f5a',PROV='#3b6ea8',REQ='#d9dfd5';
const API='/.netlify/functions/budget-hq-data';
let data=null;

async function get(url){const r=await fetch(url,{credentials:'same-origin',cache:'no-store'});
 if(r.status===401){location.href='/.netlify/functions/auth-login?returnTo='+encodeURIComponent(location.pathname);return null;}
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'This page’s data is unavailable.');return j;}
async function load(){
 try{data=await get(API+'?cycle='+cycle+(view==='unit'?'&unit='+encodeURIComponent(unitKey):''));if(!data)return;}
 catch(e){$('#bh-loading').textContent=e.message;$('#bh-loading').classList.add('error');return;}
 $('#bh-loading').hidden=true;$('#bh-content').hidden=false;view==='unit'?renderUnit():renderCycle();
}

// ---------- requested funding offices ----------
function fundingCards(t){const f=t.request_funding||{};return '<div class="bv-kpis bh-ask-kpis">'+tile('Asked of the Dean / SoE',money(f.dean),'School share of the working requests')+tile('Asked of the Provost',money(f.provost),'Provost share of the working requests')+tile('Asked of SCC',money(f.scc),'SCC share of the working requests')+tile('All-funder request total',money(t.requested),t.lines+' request lines'+(t.unpriced?' · '+t.unpriced+' unpriced':''))+'</div>'+(f.unassigned?'<p class="bv-status bh-funding-gap">'+money(f.unassigned)+' of the workbook total is outside these three funder asks. Unassigned and workbook Reject amounts are not added to the Dean’s ask.</p>':'');}
function deanBar(value,max){return '<div class="bh-bar" title="Asked of the Dean: '+money(value)+'"><i class="dean" style="width:'+Math.max(0,(value||0)/max*100)+'%"></i></div>';}
// ---------- cycle page ----------
function renderCycle(){
 if(data.restricted){$('#bh-content').innerHTML='<section class="bv-panel"><h2>Your departments</h2><p>Read-only budget access. Select a department to view its requests, history, briefing notes and documents.</p><div class="bh-sections">'+data.units.map(u=>'<section><h3>'+esc(u.label)+'</h3><a class="desktop" href="/soe-hq/budget/'+cycle+'/'+encodeURIComponent(u.key)+'">Open budget briefing →</a></section>').join('')+'</div></section>';return;}

 const t=data.totals,f=t.request_funding||{},list=[...data.units].sort((a,b)=>(b.request_funding?.dean??-1)-(a.request_funding?.dean??-1)||a.label.localeCompare(b.label)),max=Math.max(1,...list.map(u=>u.request_funding?.dean||0));
 $('#bh-content').innerHTML=fundingCards(t)+
 '<p class="bv-status">Working requests by funding office. Source assumptions remain subject to review; these amounts are separate from saved HQ support decisions.</p>'+
 (t.source_documents?.length?'<p class="bv-status">Latest submission revisions: '+t.source_documents.map(esc).join(', ')+'.</p>':'')+
 (t.source_workbooks?.length?'<p class="bv-status">Source: '+t.source_workbooks.map(esc).join(', ')+'.</p>':'')+
 '<section class="bv-panel"><div class="bh-head"><h2>Requests by unit</h2><a class="desktop" href="'+API+'?cycle='+cycle+'&format=csv">Download all lines (CSV)</a></div><p class="bv-status">Sorted by the amount asked of the Dean.</p><div class="bv-scroll"><table class="bv-table bh-units"><thead><tr><th>Unit</th><th style="width:18%">Dean ask</th><th class="n">Dean / SoE ask</th><th class="n">Provost ask</th><th class="n">SCC ask</th><th class="n">Unassigned</th><th class="n">Total ask</th><th class="n">Lines</th><th>HQ review</th></tr></thead><tbody>'+
 list.map(u=>{const x=u.request_funding||{};return '<tr class="'+(u.lines?'':'bh-none')+'"><td><a href="/soe-hq/budget/'+cycle+'/'+encodeURIComponent(u.key)+'">'+esc(u.label)+'</a></td><td>'+(u.lines?deanBar(x.dean,max):'<span class="bv-status">No requests</span>')+'</td><td class="n bh-dean">'+money(x.dean)+'</td><td class="n">'+money(x.provost)+'</td><td class="n">'+money(x.scc)+'</td><td class="n">'+money(x.unassigned)+'</td><td class="n">'+money(u.requested)+'</td><td class="n">'+u.lines+'</td><td>'+u.pending+' pending · '+u.supported_count+' supported</td></tr>';}).join('')+
 '<tr class="bh-total"><td>Total</td><td></td><td class="n bh-dean">'+money(f.dean)+'</td><td class="n">'+money(f.provost)+'</td><td class="n">'+money(f.scc)+'</td><td class="n">'+money(f.unassigned)+'</td><td class="n">'+money(t.requested)+'</td><td class="n">'+t.lines+'</td><td>'+t.pending+' pending</td></tr></tbody></table></div><p class="bv-status">HQ decisions so far: '+money(t.supported)+' supported, including '+money(t.soe)+' SoE and '+money(t.provost)+' Provost. '+t.declined_count+' declined. '+(data.can_edit?'':'Read-only access.')+'</p></section>';
}

// ---------- unit page ----------
function renderUnit(){
 const u=data.unit,t=data.totals,h=data.history,r=data.reserves;
 const last3=h.slice(-3),rate=last3.reduce((s,y)=>s+(y.requested||0),0)?last3.reduce((s,y)=>s+(y.approved||0),0)/last3.reduce((s,y)=>s+(y.requested||0),0):null;
 const prev=h[h.length-1],ry=r?.unit?.years?.[r.unit.years.length-1];
 $('#bh-content').innerHTML=`
 <div class="bh-head bh-noprint"><div class="bh-chips">${chip(t)}</div><button type="button" id="bh-print">Print briefing</button></div>
 ${fundingCards(t)}
 <div class="bv-kpis">${tile(fy(data.year)+' request',short(t.requested),`${short(t.recurring)} recurring · ${short(t.onetime)} one-time${t.unpriced?` · ${t.unpriced} amount not specified`:''}`)
  +tile('HQ support so far',short(t.supported),t.supported?`SoE ${short(t.soe)} · Provost ${short(t.provost)}`:t.pending+' lines pending')
  +tile(prev?fy(prev.year)+' approved':'Last approved',short(prev?.approved),prev?'of '+short(prev.requested)+' requested':'')
  +tile('3-year approval rate',pct(rate),last3.length?fy(last3[0].year)+'–'+fy(last3[last3.length-1].year):'')
  +(r?tile('Months of reserve',mo(r.unit.point?.months),'after open commitments, '+(ry?fy(ry.year):'')):'')
  +(r?tile('GIB used',pct(ry?.gib_use_rate),ry?fy(ry.year):''):'')
  +(r?tile('Open commitments',short(r.unit.open_commitments),(r.unit.open_commitment_count??0)+' commitments'):'')}</div>
 ${data.storage_ready?'':'<p class="bv-status error bh-noprint">HQ decisions, the briefing and the documents link are read-only until the QuickBase tables are connected.</p>'}
 <section class="bv-panel bh-brief"><div class="bh-head"><h2>Dean’s briefing</h2><span class="bv-status bh-noprint">${data.can_edit?'Use Edit to update a section; each section saves on its own.':'Prepared by SoE HQ.'}</span></div>${data.wallet_extract_allowed?`<section class="bh-wallet-extract" aria-label="Published wallet extract"><div class="bh-head"><h3>Published wallet extract</h3><a class="bh-noprint" href="${unitKey==='school'?'/soe-wallet':(u.academic?'/units/':'/other-units/')+encodeURIComponent(unitKey)+'/wallet'}">Open full wallet →</a></div><p class="bv-status" role="status" data-wallet-status>Loading the published wallet extract…</p><div class="wallet-history-grid bh-wallet-charts" data-wallet-charts></div><button type="button" class="bh-noprint" data-wallet-retry hidden>Retry wallet extract</button></section>`:''}${recentOutcomes()}<div id="bh-notes"></div></section>
 <section class="bv-panel"><h2>${fy(data.year)} requests and HQ decisions</h2>${data.can_edit?'<p class="bv-status bh-noprint">Set each line to decline or support. Support level is the share of the request supported. SoE share is the part the School funds, and the rest goes to the Provost as cost share. Save each line.</p>':'<p class="bv-status">Read-only.</p>'}
  <div class="bv-scroll" id="bh-lines"></div></section>
 <div class="${data.restricted?'':'bh-two'}">
  <section class="bv-panel"><h2>Requests vs. approvals</h2><div id="bh-history"></div></section>
  ${data.restricted?'':'<section class="bv-panel"><h2>Reserve position</h2><div id="bh-position"></div></section>'}
 </div>
 ${data.restricted?'':'<section class="bv-panel"><h2>Wallet snapshot</h2><div class="bv-scroll" id="bh-wallet"></div></section>'}
 <section class="bv-panel bh-noprint"><div class="bh-head"><h2>Documents</h2><a class="desktop" href="${API}?cycle=${cycle}&amp;unit=${encodeURIComponent(unitKey)}&amp;format=csv">Download this department’s requests (CSV)</a></div><div id="bh-files"></div></section>
 <section class="bv-panel bh-noprint"><h2>Change history</h2><div id="bh-audit"></div></section>`;
 if(data.submission)$('#bh-files').closest('section').insertAdjacentHTML('beforebegin','<section class="bv-panel">'+submissionHtml(data.submission)+'</section>');const walletReady=startBudgetWalletExtract(root.querySelector('.bh-wallet-extract'),unitKey,{controller:unitKey==='school'?'School':'Department'});notes();files();lines();history();if(!data.restricted){position();wallet();}audit();
 $('#bh-print').addEventListener('click',async()=>{await walletReady;window.print();});
}
function chip(t){const s=!t.lines?['none','No requests']:t.pending===t.lines?['open','Not started']:t.pending?['review','In review · '+t.pending+' pending']:['done','All lines decided'];return `<span class="bh-chip ${s[0]}">${s[1]}</span>`;}

const LEVELS=[100,75,50,25];
function lineRow(l){
 const edit=data.can_edit,sup=l.decision==='support',custom=sup&&!LEVELS.includes(l.support_pct);
 const desc=`${l.requested===null?'<p class="bv-status error">Amount not specified — excluded from dollar totals.</p>':''}<div class="bh-desc">${esc(l.description||'(no description)')}</div>${requestBreakdownHtml(l,unitKey,data.year)}${l.revised&&l.original&&l.revised!==l.original?`<details class="bh-noprint"><summary>Original request</summary>${esc(l.original)}</details>`:''}<div class="bv-status">${esc(l.category||'Uncategorised')}${l.qb_status?' · QuickBase status: '+esc(l.qb_status):''}</div>`;
 const sourceContext=workbookSourceHtml(l.source);
 const amounts=`<td class="n bh-dean">${money(l.request_funding?.dean)}</td><td class="n">${money(l.request_funding?.provost)}</td><td class="n">${money(l.request_funding?.scc)}</td><td class="n"><strong>${money(l.requested)}</strong></td>`;
 const result=`<td class="n" data-out="supported">${l.decision==='pending'?'—':money(l.supported)}</td><td class="n" data-out="soe">${sup?money(l.soe):'—'}</td><td class="n" data-out="provost">${sup?money(l.provost):'—'}</td>`;
 if(!edit)return `<tr class="bh-${l.decision}"><td>${desc}${sourceContext}</td>${amounts}<td>${label(l)}${l.note?'<div class="bh-note">'+esc(l.note)+'</div>':''}</td>${result}</tr>`;
 return `<tr class="bh-${l.decision}" data-id="${esc(l.record_id)}"><td>${desc}${submissionLineHtml(l.source)}</td>${amounts}
 <td class="bh-edit"><span class="bh-printonly">${label(l)}${l.note?' — '+esc(l.note):''}</span><select data-f="decision" aria-label="Decision">${['pending','decline','support'].map(d=>`<option value="${d}"${l.decision===d?' selected':''}>${{pending:'Pending',decline:'Decline',support:'Support'}[d]}</option>`).join('')}</select>
  <span class="bh-sup"${sup?'':' hidden'}><label>Level <select data-f="level">${LEVELS.map(v=>`<option value="${v}"${sup&&l.support_pct===v?' selected':''}>${v}%</option>`).join('')}<option value="custom"${custom?' selected':''}>Other…</option></select></label>
  <input data-f="custom" type="number" min="0.1" max="100" step="0.1" value="${custom?l.support_pct:''}" aria-label="Support %"${custom?'':' hidden'}>
  <label>SoE <input data-f="soe" type="number" min="0" max="100" step="0.1" value="${sup?l.soe_pct:100}" aria-label="SoE share %">%</label> <span class="bv-status" data-out="prov-pct">Provost ${sup?l.provost_pct:0}%</span></span>
  <div class="bh-save"><textarea data-f="note" rows="1" maxlength="1000" placeholder="Note (optional)">${esc(l.note)}</textarea><button type="button" data-save>Save</button></div>
  <div class="bh-saved"><span class="bv-status" data-msg>${l.updated_by?'Saved by '+esc(l.updated_by)+' '+new Date(l.updated_at).toLocaleString():''}</span></div></td>${result}</tr>`;
}
const label=l=>l.decision==='support'?`Support ${l.support_pct}% · SoE ${l.soe_pct}% / Provost ${l.provost_pct}%`:l.decision==='decline'?'Declined':'Pending';
function lines(){
 const t=data.totals;
 $('#bh-lines').innerHTML=data.lines.length?`<table class="bv-table bh-lines"><thead><tr><th>Request</th><th class="n">Dean / SoE ask</th><th class="n">Provost ask</th><th class="n">SCC ask</th><th class="n">All funders</th><th>Decision</th><th class="n">Supported</th><th class="n">SoE</th><th class="n">Provost</th></tr></thead><tbody>${data.lines.map(lineRow).join('')}
 <tr class="bh-total"><td>Total (${t.lines} lines${t.pending?', '+t.pending+' pending':''})</td><td class="n">${money(t.request_funding?.dean)}</td><td class="n">${money(t.request_funding?.provost)}</td><td class="n">${money(t.request_funding?.scc)}</td><td class="n">${money(t.requested)}</td><td></td><td class="n">${money(t.supported)}</td><td class="n">${money(t.soe)}</td><td class="n">${money(t.provost)}</td></tr></tbody></table>`:'<p class="bv-status">No requests recorded in QuickBase for this unit and cycle.</p>';
}
function readRow(tr){const f=n=>tr.querySelector(`[data-f="${n}"]`),decision=f('decision').value,level=f('level').value;
 return {decision,support_pct:decision==='support'?Number(level==='custom'?f('custom').value:level):null,soe_pct:decision==='support'?Number(f('soe').value):null,note:f('note').value.trim()};}
function preview(tr){const l=data.lines.find(x=>x.record_id===tr.dataset.id),v=readRow(tr),sup=v.decision==='support';
 tr.querySelector('.bh-sup').hidden=!sup;tr.querySelector('[data-f="custom"]').hidden=tr.querySelector('[data-f="level"]').value!=='custom';
 const s=sup?(l.requested||0)*(v.support_pct||0)/100:v.decision==='decline'?0:null,soe=sup?s*(v.soe_pct||0)/100:null;
 tr.querySelector('[data-out="supported"]').textContent=s===null?'—':money(s);tr.querySelector('[data-out="soe"]').textContent=sup?money(soe):'—';tr.querySelector('[data-out="provost"]').textContent=sup?money(s-soe):'—';
 tr.querySelector('[data-out="prov-pct"]').textContent='Provost '+(sup&&Number.isFinite(v.soe_pct)?Math.round((100-v.soe_pct)*10)/10:0)+'%';
 tr.querySelector('[data-msg]').textContent='Unsaved changes';tr.classList.add('bh-dirty');}
async function save(tr){
 const v=readRow(tr),msg=tr.querySelector('[data-msg]'),btn=tr.querySelector('[data-save]');
 if(v.decision==='support'&&!(v.support_pct>0&&v.support_pct<=100)){msg.textContent='Enter a support level between 0.1 and 100%.';msg.classList.add('error');return;}
 if(v.decision==='support'&&!(v.soe_pct>=0&&v.soe_pct<=100)){msg.textContent='Enter an SoE share between 0 and 100%.';msg.classList.add('error');return;}
 msg.classList.remove('error');btn.disabled=true;msg.textContent='Saving…';
 try{const r=await fetch(API,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycle,unit:unitKey,record_id:tr.dataset.id,...v,version:data.lines.find(x=>x.record_id===tr.dataset.id)?.version||null})});
  const j=await r.json().catch(()=>({}));
  if(r.status===409){msg.textContent=j.error+' ';msg.classList.add('error');const a=document.createElement('button');a.type='button';a.textContent='Reload';a.onclick=()=>location.reload();msg.append(a);return;}
  if(!r.ok)throw Error(j.error||'Not saved.');
  const i=data.lines.findIndex(x=>x.record_id===j.line.record_id);data.lines[i]=j.line;logLocal('decision',j.line.description,label(j.line));
  data.totals=recalc(data.lines);renderUnit();
 }catch(e){msg.textContent=e.message;msg.classList.add('error');}finally{btn.disabled=false;}
}
function recalc(ls){const s=k=>ls.reduce((a,l)=>a+(l[k]??0),0),c=d=>ls.filter(l=>l.decision===d).length;
 return {lines:ls.length,request_funding:sumRequestFunding(ls),unpriced:ls.filter(l=>l.requested===null).length,source_workbooks:[...new Set(ls.flatMap(l=>l.source?.sources?.map(s=>s.workbook)||[]))],source_documents:[...new Set(ls.flatMap(l=>l.source?.submissions?.map(s=>s.document)||[]))],requested:ls.length&&ls.every(l=>l.requested===null)?null:s('requested'),recurring:s('recurring'),onetime:s('onetime'),supported:s('supported'),soe:s('soe'),provost:s('provost'),declined_requested:ls.filter(l=>l.decision==='decline').reduce((a,l)=>a+(l.requested??0),0),pending:c('pending'),supported_count:c('support'),declined_count:c('decline')};}

function history(){
 const h=data.history;if(!h.length){$('#bh-history').innerHTML='<p class="bv-status">No earlier requests on record.</p>';return;}
 const W=520,H=200,L=52,B=26,T=10,iw=W-L-10,ih=H-T-B,max=Math.max(1,...h.map(y=>Math.max(y.requested||0,y.approved||0))),bw=iw/h.length;
 const Y=v=>T+ih-(v/max)*ih;let s=`<svg viewBox="0 0 ${W} ${H}" class="bh-svg" role="img" aria-label="Requested and approved by year">`;
 for(let i=0;i<=4;i++){const v=max*i/4;s+=`<line x1="${L}" x2="${W-10}" y1="${Y(v)}" y2="${Y(v)}" class="rv-grid"/><text x="${L-6}" y="${Y(v)+4}" class="rv-tick" text-anchor="end">${short(v)}</text>`;}
 h.forEach((y,i)=>{const x=L+i*bw;s+=`<g><title>${fy(y.year)}: requested ${money(y.requested)}, approved ${money(y.approved)} (Provost ${money(y.provost)}, SoE ${money(y.school)}, SCC ${money(y.scc)})</title><rect x="${x+bw*.12}" y="${Y(y.requested||0)}" width="${bw*.36}" height="${ih-(Y(y.requested||0)-T)}" fill="${REQ}" rx="2"/><rect x="${x+bw*.5}" y="${Y(y.approved||0)}" width="${bw*.36}" height="${ih-(Y(y.approved||0)-T)}" fill="${SOE}" rx="2"/><text x="${x+bw/2}" y="${H-8}" class="rv-tick" text-anchor="middle">${fy(y.year)}</text></g>`;});
 $('#bh-history').innerHTML=`<div class="bv-legend"><span><i style="background:${REQ}"></i>Requested</span><span><i style="background:${SOE}"></i>Approved (all recorded funders)</span></div>`+s+'</svg>'+h.map(y=>y.sources?.length?`<details><summary>${fy(y.year)} request source notes</summary>${y.sources.map(a=>`<p><strong>${esc(a.description)}</strong></p>${workbookSourceHtml(a.source)}`).join('')}</details>`:'').join('');
}
function position(){
 const r=data.reserves;if(!r){$('#bh-position').innerHTML=`<p class="bv-status">${data.unit.has_wallet?'Reserve data is not available for this unit.':'This request group is not mapped to a site unit with a wallet.'}</p>`;return;}
 const me=r.unit.point;if(!me||me.months===null){$('#bh-position').innerHTML='<p class="bv-status">Not enough statement years to place this unit.</p>';return;}
 const pts=[...r.peers,me],W=520,H=230,L=48,R=10,T=10,B=34,iw=W-L-R,ih=H-T-B;
 const xmax=Math.max(18,...pts.map(p=>p.months))*1.1,ylo=Math.min(-.15,...pts.map(p=>p.growth))*1.2,yhi=Math.max(.15,...pts.map(p=>p.growth))*1.2;
 const X=v=>L+v/xmax*iw,Y=v=>T+(yhi-v)/(yhi-ylo)*ih;
 let s=`<svg viewBox="0 0 ${W} ${H}" class="bh-svg" role="img" aria-label="${esc(data.unit.label)} among ${r.peers.length} unnamed peers by months of reserve and yearly change"><rect x="${X(12)}" y="${T}" width="${L+iw-X(12)}" height="${Y(0)-T}" fill="rgba(200,87,42,.07)"/>`;
 s+=`<line x1="${L}" x2="${L+iw}" y1="${Y(0)}" y2="${Y(0)}" class="rv-ref"/><line x1="${X(12)}" x2="${X(12)}" y1="${T}" y2="${T+ih}" class="rv-ref"/>`;
 for(const v of [0,6,12,18,24,30,36].filter(v=>v<=xmax))s+=`<text x="${X(v)}" y="${T+ih+14}" class="rv-tick" text-anchor="middle">${v}</text>`;
 s+=`<text x="${L+iw/2}" y="${H-4}" class="rv-tick" text-anchor="middle">Months of discretionary reserve after open commitments</text><text x="${L-6}" y="${Y(0)+4}" class="rv-tick" text-anchor="end">0%</text>`;
 for(const p of r.peers)s+=`<circle cx="${X(p.months)}" cy="${Y(p.growth)}" r="7" fill="rgba(154,165,151,.38)" stroke="#9aa597"/>`;
 s+=`<g><title>${esc(data.unit.label)}: ${mo(me.months)} months, ${signed(me.growth)} per year</title><circle cx="${X(me.months)}" cy="${Y(me.growth)}" r="10" fill="rgba(29,79,143,.85)" stroke="#1d4f8f" stroke-width="2"/><text x="${X(me.months)}" y="${Y(me.growth)-15}" class="rv-label sel" text-anchor="middle">${esc(data.unit.label)}</text></g>`;
 $('#bh-position').innerHTML=s+`</svg><p class="bv-status">${mo(me.months)} months of reserve, ${signed(me.growth)} per year, among ${r.peers.length} ${r.group==='academic'?'academic departments':'other units'} (not named). Shaded corner is above 12 months and growing.</p>`;
}
function wallet(){
 const r=data.reserves;if(!r||!r.unit.years.length){$('#bh-wallet').innerHTML='<p class="bv-status">No verified wallet statement is available for this unit.</p>';return;}
 const ys=r.unit.years,max=Math.max(1,...ys.map(y=>y.general+y.gib_carry));
 $('#bh-wallet').innerHTML=`<div class="bv-legend"><span><i style="background:#2f6f5a"></i>GIB carried forward</span><span><i style="background:#86b49f"></i>Department general funds</span></div>
 <table class="bv-table"><thead><tr><th>Year-end</th><th style="width:30%">Discretionary reserve</th><th class="n">Reserve</th><th class="n">GIB base</th><th class="n">Payout (general)</th><th class="n">Months</th><th class="n">GIB used</th><th class="n">Restricted dept.</th><th class="n">Faculty-controlled</th></tr></thead><tbody>
 ${ys.map(y=>`<tr><td>${fy(y.year)}</td><td><div class="rv-bar"><i style="width:${y.gib_carry/max*100}%;background:#2f6f5a"></i><i style="width:${y.general/max*100}%;background:#86b49f"></i></div></td><td class="n">${short(y.reserve)}</td><td class="n">${short(y.gib_base)}</td><td class="n">${short(y.payout_general)}</td><td class="n">${mo(y.months)}</td><td class="n">${pct(y.gib_use_rate)}</td><td class="n">${short(y.restricted)}</td><td class="n">${short(y.faculty)}</td></tr>`).join('')}</tbody></table>
 <p class="bv-status">From the unit’s verified wallet statement${r.unit.statement_published_at?' (published '+new Date(r.unit.statement_published_at).toLocaleDateString()+')':''}. Months shown here are before commitments.</p>`;
}
function logLocal(kind,item,change){(data.log||=[]).unshift({at:new Date().toISOString(),by:'you',kind,item,change});}
function audit(){
 const a=data.log||[];$('#bh-audit').innerHTML=a.length?`<ul class="bh-audit">${a.map(e=>`<li><span class="bv-status">${e.at?new Date(e.at).toLocaleString():''} · ${esc(e.by)}</span> ${esc(e.kind)} · ${esc(String(e.item||'').slice(0,80))}: ${esc(e.change)}</li>`).join('')}</ul>`:'<p class="bv-status">No changes recorded yet.</p>';
}

// ---------- Dean's briefing ----------
function recentOutcomes(){const perspective=root.querySelector('[data-history-perspective]')?.dataset.historyPerspective||'lines';return renderBudgetHistory(budgetComparison(data.recent_budget_outcomes||[],data.lines||[],data.year),{unitKey,perspective});}
function inlineRich(text){return esc(text).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
function rich(text){if(!text.trim())return '<p class="bv-status">Nothing written yet.</p>';const out=[];let list=null;
 for(const raw of text.split('\n')){const line=raw.trimEnd(),m=/^\s*[-*•]\s+(.*)$/.exec(line);
  if(m){if(!list){list=[];out.push(list);}list.push(m[1]);continue;}list=null;if(line.trim())out.push(line);else out.push('');}
 return out.map(x=>Array.isArray(x)?'<ul>'+x.map(i=>'<li>'+inlineRich(i)+'</li>').join('')+'</ul>':x?'<p>'+inlineRich(x)+'</p>':'').join('');}
function notes(){
 const n=data.notes,secs=data.note_sections;
 $('#bh-notes').innerHTML=`<div class="bh-sections">${Object.entries(secs).map(([k,title])=>{const sec=n.sections[k],when=sec.updated_by?`${esc(sec.updated_by)} · ${new Date(sec.updated_at).toLocaleString()}`:'';
  return `<div class="bh-section" data-section="${k}"><h3>${title}</h3><div class="bh-rich" data-note-view="${k}">${rich(sec.text)}</div>${data.can_edit?`<button type="button" class="bh-noprint" data-note-edit="${k}" aria-expanded="false">Edit ${esc(title)}</button><div class="bh-noprint" data-note-editor="${k}" hidden><textarea rows="1" maxlength="10000" data-note="${k}" aria-label="${title}">${esc(sec.text)}</textarea><div class="bh-save"><button type="button" data-note-save="${k}">Save</button><span class="bv-status" data-note-msg="${k}">${when?'Saved by '+when:''}</span></div></div>`:when?`<p class="bv-status">Updated by ${when}</p>`:''}</div>`;}).join('')}</div>`;
}
function growNote(ta){ta.style.height='auto';ta.style.height=(ta.scrollHeight+2)+'px';}
function editNote(k){const editor=document.querySelector(`[data-note-editor="${k}"]`),ta=editor.querySelector('textarea');editor.hidden=false;document.querySelector(`[data-note-view="${k}"]`).hidden=true;const button=document.querySelector(`[data-note-edit="${k}"]`);button.hidden=true;button.setAttribute('aria-expanded','true');growNote(ta);ta.focus();}
async function saveNote(k){
 const ta=document.querySelector(`[data-note="${k}"]`),msg=document.querySelector(`[data-note-msg="${k}"]`),btn=document.querySelector(`[data-note-save="${k}"]`);
 btn.disabled=true;msg.classList.remove('error');msg.textContent='Saving…';
 try{const j=await send('PUT',{action:'notes',section:k,text:ta.value,version:data.notes.sections[k].version});data.notes.sections[k]=j.section;ta.classList.remove('bh-dirty');logLocal('briefing',data.note_sections[k],'Edited ('+j.section.text.length+' characters)');audit();
  const sec=j.section;msg.textContent='Saved by '+sec.updated_by+' · '+new Date(sec.updated_at).toLocaleString();
  const view=document.querySelector(`[data-note-view="${k}"]`);view.innerHTML=rich(sec.text);view.hidden=false;document.querySelector(`[data-note-editor="${k}"]`).hidden=true;const edit=document.querySelector(`[data-note-edit="${k}"]`);edit.hidden=false;edit.setAttribute('aria-expanded','false');}
 catch(e){msg.textContent=e.message;msg.classList.add('error');}finally{btn.disabled=false;}
}
// ---------- documents folder (MIT Google Shared Drive) ----------
function files(){
 const f=data.folder||{url:''};
 $('#bh-files').innerHTML=(f.url?`<p><a class="desktop" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open this unit’s documents folder in Google Drive →</a></p><p class="bv-status">Documents are kept in the MIT Shared Drive. Google Drive sharing controls who can open them.</p>`:'<p class="bv-status">No documents folder linked yet.</p>')
 +(data.can_edit?`<div class="bh-upload"><input type="url" id="bh-folder" maxlength="300" placeholder="https://drive.google.com/drive/folders/…" value="${esc(f.url)}" aria-label="Google Drive folder link"><button type="button" id="bh-folder-save">Save link</button><span class="bv-status" id="bh-folder-msg"></span></div>`:'');
 const b=$('#bh-folder-save');if(b)b.addEventListener('click',saveFolder);
}
async function saveFolder(){
 const msg=$('#bh-folder-msg'),url=$('#bh-folder').value.trim();msg.classList.remove('error');msg.textContent='Saving…';
 try{const j=await send('PUT',{action:'folder',url,version:data.folder?.version||null});data.folder=j.link;files();logLocal('documents link','Documents folder',j.link.url?'Folder link set':'Folder link removed');audit();}
 catch(e){msg.textContent=e.message;msg.classList.add('error');}
}
async function send(method,payload){
 const r=await fetch(API,{method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycle,unit:unitKey,...payload})});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Error((j.error||'Not saved.')+(r.status===409?' (Reload the page.)':''));return j;
}

document.addEventListener('change',e=>{const tr=e.target.closest('tr[data-id]');if(tr&&e.target.dataset.f)preview(tr);});
document.addEventListener('input',e=>{const tr=e.target.closest('tr[data-id]');if(tr&&['custom','soe','note'].includes(e.target.dataset.f))preview(tr);});
document.addEventListener('click',e=>{const edit=e.target.closest('[data-note-edit]');if(edit){editNote(edit.dataset.noteEdit);return;}const b=e.target.closest('[data-save]');if(b){save(b.closest('tr'));return;}const n=e.target.closest('[data-note-save]');if(n){saveNote(n.dataset.noteSave);return;}});
document.addEventListener('input',e=>{if(e.target.dataset?.note){growNote(e.target);e.target.classList.add('bh-dirty');const m=document.querySelector(`[data-note-msg="${e.target.dataset.note}"]`);if(m)m.textContent='Unsaved changes';}});
window.addEventListener('resize',()=>document.querySelectorAll('[data-note-editor]:not([hidden]) textarea').forEach(growNote));
window.addEventListener('beforeunload',e=>{if(document.querySelector('.bh-dirty')){e.preventDefault();e.returnValue='';}});
load();
