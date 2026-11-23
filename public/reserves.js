import {reserveMetrics} from './reserve-metrics.mjs';
// Reserves vs. spending. Data: /.netlify/functions/reserves-data (school administrators only).
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fy=y=>'FY'+String(y).slice(-2);
const short=v=>{if(v===null||v===undefined||!Number.isFinite(v))return '—';const a=Math.abs(v),s=v<0?'-':'';return a>=1e6?s+'$'+(a/1e6).toFixed(a>=1e7?1:2)+'M':a>=1e3?s+'$'+Math.round(a/1e3)+'K':s+'$'+Math.round(a);};
const pct=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(v>0?'+':'')+Math.round(v*100)+'%';
const pctPlain=v=>v===null||v===undefined||!Number.isFinite(v)?'—':Math.round(v*100)+'%';
const mo=v=>v===null||v===undefined||!Number.isFinite(v)?'—':(Math.round(v*10)/10).toFixed(1);
const median=a=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const HOT='#c8572a',HOT_FILL='rgba(200,87,42,.62)',CALM='#7f9879',CALM_FILL='rgba(127,152,121,.45)';
const params=new URLSearchParams(location.search);
const state={group:['academic','other','all'].includes(params.get('group'))?params.get('group'):'academic',defn:'department',commit:'yes',high:12,year:null,focus:params.get('unit')||null,view:params.get('view')==='share'?'share':'full',sort:'months'};
const GROUP_LABEL={academic:'academic departments',other:'labs, centers & programs',all:'SoE units'};
const share=()=>state.view==='share';
const SEL='#1d4f8f',SEL_FILL='rgba(29,79,143,.85)',ANON='#9aa597',ANON_FILL='rgba(154,165,151,.38)';
let data=null;

async function load(){
 $('#rv-loading').hidden=false;$('#rv-loading').textContent='Loading unit statements, commitments and FY requests…';$('#rv-content').hidden=true;
 try{const r=await fetch('/.netlify/functions/reserves-data?group='+state.group,{credentials:'same-origin',cache:'no-store'});
  if(r.status===401){location.href='/.netlify/functions/auth-login?returnTo='+encodeURIComponent(location.pathname);return;}
  if(!r.ok)throw Error((await r.json().catch(()=>({}))).error||'Reserve data is unavailable.');
  data=await r.json();
 }catch(e){$('#rv-loading').textContent=e.message;$('#rv-loading').classList.add('error');return;}
 const years=[...new Set(data.units.flatMap(u=>u.years.map(y=>y.year)))].sort();
 if(!years.includes(state.year))state.year=years[years.length-1]??null;
 if(state.focus&&!data.units.some(u=>u.scope===state.focus))state.focus=null;
 $('#rv-loading').hidden=true;$('#rv-content').hidden=false;render();
}

function compute(){
 const latest=Math.max(...data.units.flatMap(u=>u.years.map(y=>y.year)));
 return data.units.map(u=>{
  const yr=u.years.find(y=>y.year===state.year),reserveOf=y=>y.reserve+(state.defn==='faculty'?y.faculty:0);
  if(!yr)return {...u,row:null};
  const metric=reserveMetrics(yr,{includeFaculty:state.defn==='faculty',unpaidSoeSupport:u.open_commitments}),commitments=state.commit==='yes'?metric.unpaidSoeSupport:null;
  const reserve=metric.balance,free=reserve,months=metric.months;
  const span=u.years.filter(y=>y.year<=state.year),first=span[0];
  const growth=first&&first.year<state.year&&yr.resources>0?(reserveOf(yr)-reserveOf(first))/(state.year-first.year)/yr.resources:null;
  const hot=months!==null&&months>state.high&&growth!==null&&growth>0;
  return {...u,row:{...yr,reserve_def:reserve,commitments,free,months,growth,from:first?.year,hot,askShare:u.ask&&free>0?u.ask/free:null}};
 });
}

function controls(){
 const years=[...new Set(data.units.flatMap(u=>u.years.map(y=>y.year)))].sort();
 const opt=(v,l,cur)=>`<option value="${v}"${String(v)===String(cur)?' selected':''}>${esc(l)}</option>`;
 $('#rv-year').innerHTML=years.map(y=>opt(y,fy(y)+' year-end',state.year)).join('');
 $('#rv-group').innerHTML=opt('academic','Academic departments',state.group)+opt('other','Labs, centers & programs',state.group)+opt('all','All SoE units',state.group);
 $('#rv-unit').innerHTML=opt('','— No unit selected —',state.focus||'')+[...data.units].sort((a,b)=>a.label.localeCompare(b.label)).map(u=>opt(u.scope,u.label+' — '+u.name,state.focus)).join('');
 $('#rv-view').innerHTML=opt('full','Full view (all names)',state.view)+opt('share','Share view (selected unit only)',state.view);
 $('#rv-defn').innerHTML=opt('department','Department general + GIB',state.defn)+opt('faculty','Department + faculty-controlled',state.defn);
 $('#rv-commit').innerHTML=opt('yes','Show unpaid SoE support',state.commit)+opt('no','Hide support column values',state.commit);
 $('#rv-high').innerHTML=[6,9,12,18,24].map(m=>opt(m,'Above '+m+' months',state.high)).join('');
}

function kpis(rows){
 const r=rows.filter(u=>u.row),hot=r.filter(u=>u.row.hot);
 const tile=(label,value,note)=>`<div class="bv-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`;
 if(share()){const u=r.find(x=>x.scope===state.focus);if(!u){$('#rv-kpis').innerHTML='';return;}
  const rank=[...r].filter(x=>x.row.months!==null).sort((a,b)=>b.row.months-a.row.months).findIndex(x=>x.scope===u.scope)+1;
  $('#rv-kpis').innerHTML=tile(esc(u.label)+' balance ratio',mo(u.row.months)+' mo','of annual discretionary resources, '+fy(state.year))+
   tile('Median of peers',mo(median(r.map(x=>x.row.months)))+' mo',r.length+' '+GROUP_LABEL[state.group])+
   tile('Change per year',pct(u.row.growth),'since '+fy(u.row.from)+', % of annual resources')+
   tile('Position',rank?rank+' of '+r.length:'—','1 = largest balance relative to resources');return;}
 $('#rv-kpis').innerHTML=
  tile('Units accumulating',hot.length+' of '+r.length,'above '+state.high+' months and growing')+
  tile('Median balance ratio',mo(median(r.map(u=>u.row.months)))+' mo','of annual discretionary resources')+
  tile('General + GIB balances',short(r.reduce((s,u)=>s+u.row.free,0)),fy(state.year)+' year-end · before department obligations')+
  tile((data.ask_year?fy(data.ask_year):'FY')+' asks from accumulating units',short(hot.reduce((s,u)=>s+(u.ask||0),0)),'requested from Provost/School');
}

function chart(rows){
 const r=rows.filter(u=>u.row&&u.row.months!==null&&u.row.growth!==null);
 if(share()&&!state.focus){$('#rv-chart').innerHTML='<p class="bv-status">Choose a unit to share.</p>';$('#rv-chart-note').textContent='';return;}
 if(!r.length){$('#rv-chart').innerHTML='<p class="bv-status">Not enough statement years to plot.</p>';return;}
 const W=900,H=460,L=64,R=24,T=24,B=54,iw=W-L-R,ih=H-T-B;
 const xs=r.map(u=>u.row.months),ys=r.map(u=>u.row.growth);
 const xmax=Math.max(state.high*1.6,Math.max(...xs)*1.12),xmin=Math.min(0,Math.min(...xs)*1.12);
 const ylo=Math.min(-.15,Math.min(...ys)*1.25),yhi=Math.max(.15,Math.max(...ys)*1.25);
 const X=v=>L+(v-xmin)/(xmax-xmin)*iw,Y=v=>T+(yhi-v)/(yhi-ylo)*ih;
 const maxAsk=Math.max(1,...r.map(u=>u.ask||0)),rad=u=>share()?(u.scope===state.focus?11:8):7+Math.sqrt((u.ask||0)/maxAsk)*26;
 const step=xmax>40?10:xmax>20?5:3,ticksX=[];for(let v=Math.ceil(xmin/step)*step;v<=xmax;v+=step)ticksX.push(v);
 const yStep=(yhi-ylo)>.8?.2:.1,ticksY=[];for(let v=Math.ceil(ylo/yStep)*yStep;v<=yhi+1e-9;v+=yStep)ticksY.push(Math.round(v*100)/100);
 let s=`<svg viewBox="0 0 ${W} ${H}" class="rv-svg" role="img" aria-label="Units plotted by balance in months of annual resources and yearly change in reserve; bubble size is the latest budget request.">`;
 s+=`<rect x="${X(state.high)}" y="${T}" width="${L+iw-X(state.high)}" height="${Y(0)-T}" fill="rgba(200,87,42,.07)"/>`;
 s+=`<rect x="${X(Math.max(xmin,3))}" y="${T}" width="${X(Math.min(state.high,xmax))-X(Math.max(xmin,3))}" height="${ih}" fill="rgba(127,152,121,.06)"/>`;
 for(const v of ticksY)s+=`<line x1="${L}" x2="${L+iw}" y1="${Y(v)}" y2="${Y(v)}" class="rv-grid"/><text x="${L-8}" y="${Y(v)+4}" class="rv-tick" text-anchor="end">${pct(v)}</text>`;
 for(const v of ticksX)s+=`<text x="${X(v)}" y="${T+ih+18}" class="rv-tick" text-anchor="middle">${v}</text>`;
 s+=`<line x1="${L}" x2="${L+iw}" y1="${Y(0)}" y2="${Y(0)}" class="rv-ref"/><line x1="${X(state.high)}" x2="${X(state.high)}" y1="${T}" y2="${T+ih}" class="rv-ref"/>`;
 if(3>xmin)s+=`<line x1="${X(3)}" x2="${X(3)}" y1="${T}" y2="${T+ih}" class="rv-ref thin"/>`;
 s+=`<text x="${L+iw-8}" y="${T+16}" class="rv-zone hot" text-anchor="end">Accumulating</text><text x="${L+iw-8}" y="${T+ih-8}" class="rv-zone" text-anchor="end">Large reserve, drawing down</text>`;
 s+=`<text x="${L+8}" y="${T+16}" class="rv-zone">Building</text><text x="${L+8}" y="${T+ih-8}" class="rv-zone">Thin and falling</text>`;
 s+=`<text x="${X((Math.max(xmin,3)+Math.min(state.high,xmax))/2)}" y="${T+ih-8}" class="rv-zone" text-anchor="middle">Healthy band</text>`;
 s+=`<text x="${L+iw/2}" y="${H-8}" class="rv-axis" text-anchor="middle">Balance in months of annual resources (${fy(state.year)} year-end)</text>`;
 s+=`<text transform="translate(16 ${T+ih/2}) rotate(-90)" class="rv-axis" text-anchor="middle">Change in reserve per year, % of annual resources</text>`;
 const order=[...r].sort((a,b)=>(a.scope===state.focus)-(b.scope===state.focus)||rad(b)-rad(a));
 for(const u of order){const x=X(u.row.months),y=Y(u.row.growth),rr=rad(u),sel=u.scope===state.focus;
  if(share()&&!sel){s+=`<g class="rv-anon" aria-hidden="true"><circle cx="${x}" cy="${y}" r="${rr}" fill="${ANON_FILL}" stroke="${ANON}" stroke-width="1"/></g>`;continue;}
  const fill=sel?SEL_FILL:u.row.hot?HOT_FILL:CALM_FILL,stroke=sel?SEL:u.row.hot?HOT:CALM,dim=state.focus&&!sel?' rv-dim':'';
  s+=`<g class="rv-dot${dim}${sel?' rv-sel':''}" data-unit="${esc(u.scope)}" tabindex="0" role="button" aria-label="${esc(u.label)}"><title>${esc(u.label)}: ${mo(u.row.months)} months; ${pct(u.row.growth)} per year since ${fy(u.row.from)}${share()?'':'; '+(data.ask_year?fy(data.ask_year)+' ask ':'ask ')+short(u.ask)}</title><circle cx="${x}" cy="${y}" r="${rr}" fill="${fill}" stroke="${stroke}" stroke-width="${sel?2.5:1}"/><text x="${x}" y="${y-rr-5}" class="rv-label${sel?' sel':''}" text-anchor="middle">${esc(u.label)}</text></g>`;}
 $('#rv-chart').innerHTML=s+'</svg>';
 const missing=rows.filter(u=>!u.row||u.row.months===null||u.row.growth===null).map(u=>u.label);
 const me=rows.find(u=>u.scope===state.focus);
 $('#rv-chart-note').textContent=share()?(me?`Each dot is one of ${r.length} ${GROUP_LABEL[state.group]}; only ${me.label} is named.`+(r.includes(me)?'':` ${me.label} has too few statement years to plot.`):'Choose a unit to share.')
  :(missing.length?'Not plotted (no statement or too few years): '+missing.join(', ')+'. ':'')+'Bubble size = '+(data.ask_year?fy(data.ask_year)+' ':'')+'request. Click a unit to highlight it.';
}

const COLS=[
 ['label','Unit',u=>esc(u.label),u=>u.label],
 ['reserve','General + GIB balance',u=>short(u.row.reserve_def),u=>u.row.reserve_def,1],
 ['commit','Unpaid SoE support (today)',u=>state.commit==='yes'&&u.row.commitments?short(u.row.commitments)+(u.incomplete_commitments?'<sup title="Some SoE support amounts are incomplete">*</sup>':''):'—',u=>u.row.commitments,1],
 ['resources','Annual resources',u=>short(u.row.resources),u=>u.row.resources,1],
 ['months','Months',u=>`<strong>${mo(u.row.months)}</strong>`,u=>u.row.months??-1e9,1],
 ['growth','Change / yr',u=>pct(u.row.growth),u=>u.row.growth??-1e9,1],
 ['gib','GIB used',u=>pctPlain(u.row.gib_use_rate),u=>u.row.gib_use_rate??-1,1],
 ['faculty','Faculty-controlled',u=>short(u.row.faculty),u=>u.row.faculty,1],
 ['restricted','Restricted dept.',u=>short(u.row.restricted),u=>u.row.restricted,1],
 ['ask','Ask',u=>short(u.ask),u=>u.ask??-1,1],
 ['share','Ask ÷ balance',u=>pctPlain(u.row.askShare),u=>u.row.askShare??-1,1]
];
function shareTable(rows){
 const r=rows.filter(u=>u.row),me=r.find(u=>u.scope===state.focus);
 if(!me){$('#rv-table').innerHTML=state.focus?'<p class="bv-status">No verified statement for this unit for '+fy(state.year)+'.</p>':'';return;}
 const cols=COLS.filter(c=>!['commit','ask','share'].includes(c[0])||c[0]==='commit');
 const med=c=>{const v=median(r.map(c[3]).filter(x=>Number.isFinite(x)&&x>-1e8));return v;};
 const fmt={reserve:short,commit:short,free:short,resources:short,months:mo,growth:pct,gib:pctPlain,faculty:short,restricted:short};
 const head=cols.map(c=>`<th class="${c[4]?'n':''}">${c[0]==='label'?'':c[1]}</th>`).join('');
 const mine=cols.map((c,i)=>i===0?`<td><strong>${esc(me.label)}</strong></td>`:`<td class="n">${c[2](me)}</td>`).join('');
 const mid=cols.map((c,i)=>i===0?`<td>Median of ${r.length} ${GROUP_LABEL[state.group]}</td>`:`<td class="n">${(fmt[c[0]]||short)(med(c))}</td>`).join('');
 $('#rv-table').innerHTML=`<table class="bv-table"><thead><tr>${head}</tr></thead><tbody><tr class="rv-focus">${mine}</tr><tr>${mid}</tr></tbody></table><p class="bv-status">Other units are not shown individually in this view.</p>`;
}
function table(rows){
 if(share()){$('#rv-table-title').textContent='Compared with peers';$('#rv-table-help').textContent='The selected unit against the median of its peer group.';shareTable(rows);return;}
 $('#rv-table-title').textContent='All units';$('#rv-table-help').textContent='Click a column to sort. Shaded rows are accumulating: above the flag level and growing.';
 const col=COLS.find(c=>c[0]===state.sort)||COLS[5],list=rows.filter(u=>u.row).sort((a,b)=>col[0]==='label'?String(a.label).localeCompare(b.label):col[3](b)-col[3](a));
 const head=COLS.map(c=>`<th class="${c[4]?'n':''}"><button type="button" class="rv-sort${c[0]===state.sort?' on':''}" data-sort="${c[0]}">${c[0]==='ask'&&data.ask_year?fy(data.ask_year)+' ask':c[1]}</button></th>`).join('');
 const body=list.map(u=>`<tr class="${u.row.hot?'rv-hot':''}${u.scope===state.focus?' rv-focus':''}">${COLS.map((c,i)=>i===0?`<td><button type="button" class="bv-link" data-unit="${esc(u.scope)}">${c[2](u)}</button>${u.row.hot?' <span class="rv-flag">accumulating</span>':''}</td>`:`<td class="n">${c[2](u)}</td>`).join('')}</tr>`).join('');
 const none=rows.filter(u=>!u.row).map(u=>esc(u.label));
 $('#rv-table').innerHTML=`<table class="bv-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`+(none.length?`<p class="bv-status">No verified statement for ${fy(state.year)}: ${none.join(', ')}.</p>`:'');
}

function detail(rows){
 const u=rows.find(x=>x.scope===state.focus)||(share()?null:rows.filter(x=>x.row).sort((a,b)=>(b.row.months??0)-(a.row.months??0))[0]);
 if(!u){$('#rv-detail-title').textContent='Unit detail';$('#rv-detail').innerHTML='';return;}
 $('#rv-detail-title').textContent=u.name+' by year';
 const max=Math.max(1,...u.years.map(y=>y.general+y.gib_carry+(state.defn==='faculty'?y.faculty:0)));
 const bar=y=>{const segs=[[y.gib_carry,'#2f6f5a','GIB carried forward'],[y.general,'#86b49f','Department general funds']];if(state.defn==='faculty')segs.push([y.faculty,'#d7c08a','Faculty-controlled']);
  return `<div class="rv-bar">${segs.map(([v,c,l])=>`<i style="width:${Math.max(0,v)/max*100}%;background:${c}" title="${l}: ${short(v)}"></i>`).join('')}</div>`;};
 $('#rv-detail').innerHTML=`<div class="bv-legend"><span><i style="background:#2f6f5a"></i>GIB carried forward</span><span><i style="background:#86b49f"></i>Department general funds</span>${state.defn==='faculty'?'<span><i style="background:#d7c08a"></i>Faculty-controlled</span>':''}</div>
 <table class="bv-table"><thead><tr><th>Year-end</th><th style="width:34%">Reserve</th><th class="n">Reserve</th><th class="n">GIB base</th><th class="n">Payout (general)</th><th class="n">Months</th><th class="n">GIB used</th><th class="n">Restricted dept.</th><th class="n">Faculty-controlled</th></tr></thead><tbody>${u.years.map(y=>{const res=y.reserve+(state.defn==='faculty'?y.faculty:0);return `<tr><td>${fy(y.year)}</td><td>${bar(y)}</td><td class="n">${short(res)}</td><td class="n">${short(y.gib_base)}</td><td class="n">${short(y.payout_general)}</td><td class="n">${mo(y.resources>0?res/(y.resources/12):null)}</td><td class="n">${pctPlain(y.gib_use_rate)}</td><td class="n">${short(y.restricted)}</td><td class="n">${short(y.faculty)}</td></tr>`;}).join('')}</tbody></table>
 <p class="bv-status">Unpaid SoE support today: ${u.open_commitments===null?'unavailable':short(u.open_commitments)+' across '+u.open_commitment_count+' commitment'+(u.open_commitment_count===1?'':'s')}${u.incomplete_commitments?' ('+u.incomplete_commitments+' with incomplete amounts)':''}. ${data.ask_year?fy(data.ask_year):'Latest'} request: ${short(u.ask)}. Statement published ${u.statement_published_at?new Date(u.statement_published_at).toLocaleDateString():'—'}.</p>`;
}

function notes(){
 const d=data.definitions;
 $('#rv-method').innerHTML=`<ul>${[['Reserve',d.reserve],['Annual resources',d.resources],['Months',d.months],['Change per year',d.trend],['GIB used',d.gib_use_rate],['Not counted',d.excluded],['Unpaid SoE support','These are outstanding School commitments to units, shown separately. They are neither deducted from nor added to unit balances. Department obligations and restrictions have not been reconciled to establish uncommitted funds.']].map(([k,v])=>`<li><strong>${k}:</strong> ${esc(v)}</li>`).join('')}</ul>${data.notes.length&&!share()?'<p class="bv-status">'+data.notes.map(esc).join(' ')+'</p>':''}<p class="bv-status">Generated ${new Date(data.generated_at).toLocaleString()}.</p>`;
}

function syncUrl(){const q=new URLSearchParams();if(state.group!=='academic')q.set('group',state.group);if(state.focus)q.set('unit',state.focus);if(state.view==='share')q.set('view','share');history.replaceState(null,'',location.pathname+(q.size?'?'+q:''));}
function render(){controls();const rows=compute();document.getElementById('rv').classList.toggle('rv-sharing',share());kpis(rows);chart(rows);table(rows);detail(rows);notes();syncUrl();}
document.addEventListener('change',e=>{const id=e.target.id;if(!id?.startsWith('rv-'))return;
 const v=e.target.value;if(id==='rv-group'){state.group=v;load();return;}
 if(id==='rv-unit')state.focus=v||null;if(id==='rv-view')state.view=v;
 if(id==='rv-year')state.year=Number(v);if(id==='rv-defn')state.defn=v;if(id==='rv-commit')state.commit=v;if(id==='rv-high')state.high=Number(v);render();});
document.addEventListener('click',e=>{const s=e.target.closest('[data-sort]');if(s){state.sort=s.dataset.sort;render();return;}
 const u=e.target.closest('[data-unit]');if(u&&$('#rv').contains(u)){if(share())return;state.focus=state.focus===u.dataset.unit&&u.tagName!=='BUTTON'?null:u.dataset.unit;render();$('#rv-detail-panel').scrollIntoView({behavior:'smooth',block:'start'});}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.classList?.contains('rv-dot')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
load();
