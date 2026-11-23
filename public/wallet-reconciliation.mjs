import {historyPoints} from './wallet-charts.mjs';
const TYPE='Expendable Fund Balance';
const numeric=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
export function walletReconciliation(rows,year){
 const categories=new Map();
 for(const r of rows){if(r.type!==TYPE||r.year!==year||!numeric(r.amount))continue;const label=String(r.classification||'Unclassified category').trim()||'Unclassified category';if(!categories.has(label))categories.set(label,{label,department:0,faculty:0,other:0});const key=r.admin==='DP'?'department':r.admin==='FC'?'faculty':'other';categories.get(label)[key]+=Math.round(Number(r.amount)*100);}
 const order=['Professorships','Department - general','Graduate student support','Department - faculty','Department - research','Department - other salary','Department - other restricted'],rank=label=>order.includes(label)?order.indexOf(label):order.length;
 const values=[...categories.values()].filter(r=>r.department!==0||r.faculty!==0||r.other!==0).sort((a,b)=>rank(a.label)-rank(b.label)||a.label.localeCompare(b.label));
 const totals={department:0,faculty:0,other:0,total:0};for(const r of values){r.total=r.department+r.faculty+r.other;for(const key of Object.keys(totals))totals[key]+=r[key];}
 return {year,categories:values.map(r=>({...r,...Object.fromEntries(Object.keys(totals).map(k=>[k,r[k]/100]))})),totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v/100]))};
}
export function renderWalletReconciliation(anchor,rows,{controller='Department'}={}){
 if(!anchor)return;const previous=document.getElementById('wallet-reconciliation');if(previous)previous.remove();
 const years=historyPoints(rows,TYPE).filter(p=>p.total!==null);if(!years.length)return;
 const section=node('section');section.id='wallet-reconciliation';section.className='card wallet-reconciliation';section.setAttribute('aria-labelledby','wallet-reconciliation-title');
 const title=node('h2','Expendable balances: Budget Office reconciliation');title.id='wallet-reconciliation-title';section.append(title,node('p','Each Budget Office category is split by who controls its accounts. A category named “Department” can include faculty-controlled accounts. The columns add to the same total shown in the history chart; no commitments or restrictions are deducted.'));
 const label=node('label','Fiscal year '),select=node('select');select.setAttribute('aria-label','Reconciliation fiscal year');for(const p of [...years].reverse())select.append(new Option('FY'+p.year+(p.projection?' · projected':''),p.year));select.value=String([...years].reverse().find(p=>!p.projection)?.year||years.at(-1).year);label.append(select);section.append(label);const content=node('div');section.append(content);anchor.insertAdjacentElement('afterend',section);
 const history=[...anchor.querySelectorAll('.wallet-history')].find(el=>el.querySelector('h2')?.textContent===TYPE+' history');if(history){const link=node('a','See how Budget Office categories reconcile');link.href='#wallet-reconciliation';history.append(link);}
 function render(){const result=walletReconciliation(rows,Number(select.value)),table=node('table');table.className='wallet-reconciliation-table';table.append(node('caption','FY'+result.year+' expendable balances · dollars, including cents'));
 const headings=['Budget Office category',controller+' controlled','Faculty controlled','Other / unclassified','Total'],keys=['department','faculty','other','total'],head=node('thead'),headRow=node('tr');for(const heading of headings){const th=node('th',heading);th.scope='col';headRow.append(th);}head.append(headRow);table.append(head);
 const tableRow=(r,total=false)=>{const tr=node('tr'),th=node('th',total?'Total fund balances':r.label);th.scope='row';tr.append(th);for(const [index,key]of keys.entries()){const td=node('td',money(r[key]));td.dataset.label=headings[index+1];tr.append(td);}return tr;};
 const body=node('tbody');for(const r of result.categories)body.append(tableRow(r));table.append(body);const foot=node('tfoot');foot.append(tableRow(result.totals,true));table.append(foot);content.replaceChildren(table);section.dataset.year=String(result.year);
 }
 select.addEventListener('change',render);render();
}
