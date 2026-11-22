import {startWalletComparison} from './wallet-comparison.mjs';
import {startOptionalPurposeView} from './wallet-purpose-view.mjs';
import {walletDateSummary} from './report-dates.mjs';
import {walletRows,numericAmount,closedAccount} from './wallet-table.mjs';
import {renderWalletCharts} from './wallet-charts.mjs';
const $=selector=>document.querySelector(selector);
const scope=document.body.dataset.wallet;
const money=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v));
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
let data=null,page=1;
function card(title,primary,secondary,description,emphasis=false){const el=document.createElement('section');el.className='card'+(emphasis?' department-primary':'');el.append(text('h2',title),text('strong',money(primary)),text('p',secondary),text('p',description));return el;}
function populateYears(){const type=$('#resource-type').value;const years=[...new Set(data.rows.filter(r=>r.type===type).map(r=>r.year))].sort((a,b)=>b-a);$('#resource-year').replaceChildren(...years.map(y=>new Option('FY'+y,y)));}
function render(){
 const sort=$('#wallet-sort').value;
 const rows=walletRows(data.rows,{type:$('#resource-type').value,year:$('#resource-year').value,control:$('#resource-control').value,search:$('#account-search').value,costObject:$('#cost-object-filter').value,minimum:$('#amount-min').value,maximum:$('#amount-max').value,sort});
 for(const [field,id,label] of [['account','cost-object','Cost object'],['amount','amount','Amount']]){const active=sort.startsWith(field+'-'),ascending=sort.endsWith('-asc');$('#'+id+'-heading').setAttribute('aria-sort',active?(ascending?'ascending':'descending'):'none');$('#sort-'+id).textContent=label+' '+(active?(ascending?'↑':'↓'):'↕');}
 const pages=Math.max(1,Math.ceil(rows.length/100));page=Math.min(page,pages);
 $('#wallet-rows').replaceChildren(...rows.slice((page-1)*100,page*100).map(r=>{const tr=document.createElement('tr');for(const v of [r.account||'—',r.name||r.description||'—',r.admin==='DP'?'Department':r.admin==='FC'?'Faculty':'Other / unclassified',[r.period,r.status].filter(Boolean).join(' · '),money(r.amount)])tr.append(text('td',v));return tr;}));
 const numeric=rows.filter(r=>numericAmount(r.amount)!==null);
 const cents=numeric.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0);
 $('#wallet-total').textContent=money(rows.length&&!numeric.length?null:cents/100);
 const excluded=data.rows.filter(r=>r.type===$('#resource-type').value&&r.year===Number($('#resource-year').value)&&closedAccount(r)).length;
 $('#wallet-count').textContent=`${rows.length.toLocaleString()} matching records${excluded?` · ${excluded.toLocaleString()} closed-account records excluded`:``}${numeric.length<rows.length?' · '+(rows.length-numeric.length)+' unavailable amounts excluded from total':''}`;
 $('#wallet-page').textContent=`Page ${page} of ${pages}`;$('#wallet-prev').disabled=page===1;$('#wallet-next').disabled=page===pages;
}
async function load(){
 $('#wallet-content').hidden=true;data=null;
 try{
  const r=await fetch('/.netlify/functions/unit-data?unit='+encodeURIComponent(scope),{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error(r.status===401?'Your session has expired. Return Home and sign in again.':r.status===403?'Your account does not have access to this wallet.':'This wallet is currently unavailable. Please try again later.');
  const value=await r.json();if(value.scope!==scope||!Array.isArray(value.rows))throw Error('This wallet could not be verified.');data=value;
  renderWalletCharts($('#wallet-charts'),data.rows);
  const s=data.statement,c=data.controls;
  $('#wallet-cards').replaceChildren(
   card('Department-controlled nonrecurring',c.department_nonrecurring,'('+money(c.faculty_nonrecurring)+' faculty controlled)',`GIB carryforward into FY${s.carry_year} + expendable balances at FY${s.balance_year} close`,true),
   card('Department GIB carryforward',s.department_carry,'('+money(s.faculty_carry)+' faculty controlled)',`Carried into FY${s.carry_year}`),
   card('Department expendable balances',c.department_balance,'('+money(c.faculty_balance)+' faculty controlled)',`At FY${s.balance_year} close · other/unclassified: ${money(c.unclassified_balance)}`),
   card('Pool A payout · projected',s.payout,'Unit-wide estimate',`FY${s.payout_year} · ${(Number(s.growth)*100).toLocaleString('en-US',{maximumFractionDigits:2})}% growth assumption`));
  const types=[...new Set(data.rows.map(r=>r.type))].sort();$('#resource-type').replaceChildren(...types.map(t=>new Option(t,t)));if(types.includes('GIB Carryforward'))$('#resource-type').value='GIB Carryforward';populateYears();render();
  $('#wallet-status').textContent=walletDateSummary(data);
  $('#wallet-content').hidden=false;
  startOptionalPurposeView(data);
 }catch(e){data=null;$('#wallet-charts').replaceChildren();$('#wallet-cards').replaceChildren();$('#wallet-rows').replaceChildren();$('#wallet-status').textContent=e.message;}
}
$('#wallet-filters').addEventListener('submit',e=>e.preventDefault());
$('#resource-type').addEventListener('change',()=>{populateYears();page=1;render();});
for(const id of ['#resource-year','#resource-control','#account-search','#cost-object-filter','#amount-min','#amount-max','#wallet-sort'])$(id).addEventListener('input',()=>{page=1;if(data)render();});
for(const [id,field] of [['#sort-cost-object','account'],['#sort-amount','amount']])$(id).onclick=()=>{$('#wallet-sort').value=field+($('#wallet-sort').value===field+'-desc'?'-asc':'-desc');page=1;if(data)render();};
$('#wallet-clear').onclick=()=>{for(const id of ['#resource-control','#account-search','#cost-object-filter','#amount-min','#amount-max'])$(id).value='';$('#wallet-sort').value='amount-desc';page=1;if(data)render();};
$('#wallet-prev').onclick=()=>{page--;render();};$('#wallet-next').onclick=()=>{page++;render();};
startWalletComparison();
await load();
