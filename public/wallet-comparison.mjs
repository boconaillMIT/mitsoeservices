import {RESOURCE_TYPES,points,combinedPoints,trendComparison} from './wallet-comparison-model.mjs';
const money=v=>v===null||v===undefined?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(v);
const node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(cls)el.className=cls;return el;};
const percentage=v=>v===null?'not comparable from a zero baseline':(v>0?'+':'')+v.toFixed(1)+'%';
function graph(hq,series,label){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 360 160');svg.setAttribute('class','wallet-comparison-chart');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' resource history compared with HQ');
 const all=[...hq,...series].filter(p=>p.amount!==null),years=[...new Set(all.map(p=>p.year))].sort(),max=Math.max(...all.map(p=>Math.abs(p.amount)),1);
 for(const [data,color]of [[hq,'#758592'],[series,'#a31f34']]){let previous=null;for(const p of data){if(p.amount===null){previous=null;continue;}const x=20+years.indexOf(p.year)*320/Math.max(1,years.length-1),y=80-p.amount/max*60,circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',x);circle.setAttribute('cy',y);circle.setAttribute('r','4');circle.setAttribute('fill',color);const title=document.createElementNS(ns,'title');title.textContent='FY'+p.year+': '+money(p.amount);circle.append(title);if(previous){const line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:previous.x,y1:previous.y,x2:x,y2:y,stroke:color,'stroke-width':2}))line.setAttribute(k,v);svg.append(line);}svg.append(circle);previous={x,y};}}
 for(const [i,year]of years.entries()){const text=document.createElementNS(ns,'text');text.setAttribute('x',20+i*320/Math.max(1,years.length-1));text.setAttribute('y','150');text.setAttribute('text-anchor','middle');text.setAttribute('font-size','12');text.textContent='FY'+year;svg.append(text);}return svg;
}
export function startWalletComparison(){
 const button=document.querySelector('#wallet-compare');if(!button)return;
 const panel=document.querySelector('#wallet-comparison');let data=null;
 button.addEventListener('click',async()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(panel.hidden||data)return;const status=panel.querySelector('[role=status]');try{const response=await fetch('/.netlify/functions/unit-data?unit=school&action=compare',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('The comparison could not be loaded. Please try again.');data=await response.json();renderControls();render();status.textContent='';}catch(error){status.textContent=error.message;}});
 function renderControls(){const choices=panel.querySelector('.wallet-unit-choices');for(const unit of data.units){const label=node('label'),input=document.createElement('input');input.type='checkbox';input.value=unit.scope;input.addEventListener('change',render);label.append(input,document.createTextNode(unit.label));choices.append(label);}panel.querySelector('#comparison-mode').addEventListener('change',render);panel.querySelector('#comparison-resource').replaceChildren(...RESOURCE_TYPES.map(t=>new Option(t,t)));panel.querySelector('#comparison-resource').addEventListener('change',render);}
 function render(){
  const mode=panel.querySelector('#comparison-mode').value,type=panel.querySelector('#comparison-resource').value,hq=data.wallets.find(w=>w.scope==='school'),target=panel.querySelector('#comparison-results');target.replaceChildren();
  if(!hq){target.append(node('p','The HQ wallet is unavailable; comparison is paused.'));return;}
  const basis=type==='Pool A Payout'?'Unit-wide payout':'Dept. controlled',headquarters=points(hq,type),selected=[...panel.querySelectorAll('input:checked')].map(el=>el.value),academic=data.wallets.filter(w=>w.scope!=='school');
  const entries=mode==='combined'?[{label:'All academic units combined',series:combinedPoints(academic,type,data.units.length)}]:selected.map(scope=>({label:data.units.find(u=>u.scope===scope).label,series:data.wallets.some(w=>w.scope===scope)?points(data.wallets.find(w=>w.scope===scope),type):[]}));
  panel.querySelector('.wallet-unit-choices').hidden=mode!=='individual';
  const stronger=academic.filter(wallet=>trendComparison(headquarters,points(wallet,type))?.stronger===true).map(wallet=>data.units.find(unit=>unit.scope===wallet.scope).label);
  if(stronger.length)target.append(node('p','Units to discuss for '+type+': '+stronger.join(', ')+'. These '+(type==='Pool A Payout'?'unit-wide payouts':'department-controlled balances')+' are improving more than HQ over matched actual periods.','comparison-attention'));
  const grid=node('div',undefined,'wallet-comparison-grid');
  for(const entry of [{label:'SoE HQ',series:headquarters,hq:true},...entries]){
   const card=node('article',undefined,'card'),series=entry.series;card.append(node('h3',entry.label));
   const sources=entry.hq?[hq]:mode==='combined'?academic:data.wallets.filter(w=>data.units.find(u=>u.scope===w.scope)?.label===entry.label);
   card.append(node('p','Published cycles: '+[...new Set(sources.map(w=>'FY'+w.cycle))].join(', '),'small'));
   const complete=mode!=='combined'||entry.hq||sources.length===data.units.length;
   const summary=document.createElement('dl');summary.className='comparison-snapshot';
   for(const [key,label]of [['nonrecurring',entry.hq?'School nonrecurring':'Dept. nonrecurring'],['carry','GIB carryforward'],['balance','Expendable balance']]){const compatible=complete&&sources.length&&new Set(sources.map(w=>JSON.stringify([w.cycle,w.snapshot?.carryYear,w.snapshot?.balanceYear]))).size===1&&sources.every(w=>w.snapshot?.[key]!==null&&w.snapshot?.[key]!==undefined&&Number.isFinite(Number(w.snapshot[key])));summary.append(node('dt',label),node('dd',money(compatible?sources.reduce((n,w)=>n+Math.round(Number(w.snapshot[key])*100),0)/100:null)));}
   card.append(summary);
   if(sources[0]?.snapshot)card.append(node('p','Carry into FY'+sources[0].snapshot.carryYear+' · expendable balance at FY'+sources[0].snapshot.balanceYear+' close','small'));
   if(sources.some(w=>w.cycle!==hq.cycle))card.append(node('p','Publication cycles differ; compare the matching historical periods with care.'));
   if(!series.length){card.append(node('p','A complete verified wallet is unavailable.'));grid.append(card);continue;}
   card.append(graph(entry.hq?[]:headquarters,series,entry.label),node('p',entry.hq?'HQ balances':'Red: selected wallet · Gray: HQ','small'));
   const table=node('table',undefined,'comparison-history'),head=node('tr');for(const title of ['Year',entry.hq&&type!=='Pool A Payout'?'School controlled':basis,'Period / basis'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
   for(const p of series){const row=node('tr');row.append(node('td','FY'+p.year),node('td',money(p.amount)),node('td',(p.periods.filter(Boolean).join(', ')||'Published annual basis')+(p.projection?' · projected':'')+(p.walletZero?' · wallet summary total':p.blanks?' · '+p.blanks+' source blanks excluded':'')));body.append(row);}table.append(body);card.append(table);
   if(!entry.hq){const trend=trendComparison(headquarters,series);if(trend){card.append(node('p',`FY${trend.from}–FY${trend.to}: ${entry.label} ${percentage(trend.unit.percent)} (${money(trend.unit.dollars)}); HQ ${percentage(trend.hq.percent)} (${money(trend.hq.dollars)}).`));if(trend.stronger)card.append(node('p','Discuss: this resource is trending more positively than HQ. Ask about existing commitments, restrictions and capacity to contribute.','comparison-attention'));else card.append(node('p',trend.stronger===null?'A percentage comparison needs nonzero starting balances.':'This resource is not trending more positively than HQ over the matched period.'));}else card.append(node('p','At least two matching, non-projected fiscal years and reporting periods are needed to compare trends.'));}
   grid.append(card);
  }
  target.append(grid);if(mode==='individual'&&!entries.length)target.append(node('p','Select one or more academic units above.'));
  if(data.unavailable.length)target.append(node('p','Unavailable wallets: '+data.unavailable.map(scope=>data.units.find(u=>u.scope===scope)?.label||'SoE HQ').join(', ')+'. Combined totals require every academic unit.'));
 }
}
