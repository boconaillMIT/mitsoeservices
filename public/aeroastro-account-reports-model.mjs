import {forecast,matching,accountTotals} from './aeroastro-finance-model.mjs';
export function accountReport(source,reference,{view='dhc',method='run-rate',group='',...filters}={}){
 const membership=(view==='dhc'?[{id:'dhc',label:'DHC HQ GIB accounts',accounts:reference.dhcAccounts}]:reference.groups).filter(g=>!group||g.id===group);
 const listed=new Set(membership.flatMap(g=>g.accounts)),inventory=new Map(source.rows.map(r=>[r.account,r]));
 const available=[...listed].filter(a=>inventory.has(a)).map(a=>({...inventory.get(a),...forecast(inventory.get(a),source.asOf,method)}));
 const filtered=matching(available,filters),byAccount=new Map(filtered.map(r=>[r.account,r]));
 const groups=membership.map(g=>{const rows=g.accounts.filter(a=>byAccount.has(a)).map(a=>byAccount.get(a)),ordered=matching(rows,filters);return {...g,rows:ordered,totals:accountTotals(rows),unavailable:g.accounts.filter(a=>!inventory.has(a)&&!filters.status&&!filters.profitCenter&&!filters.fundCenter&&(!filters.search||a.includes(filters.search.trim())))};});
 return {rows:filtered,groups,totals:accountTotals(filtered),listed:listed.size,matched:available.length,unavailable:[...listed].filter(a=>!inventory.has(a)),overlap:membership.reduce((n,g)=>n+g.accounts.length,0)-listed.size};
}
