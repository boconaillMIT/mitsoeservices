export const moneyNumber=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const DAY=86400000;
export function forecast(row,asOf,method='run-rate'){
 if(row.status==='Closed')return {remaining:null,projected:null,annual:null};
 const d=/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')?new Date(asOf+'T00:00:00Z'):new Date(NaN);
 if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==asOf)return {remaining:null,projected:null,annual:null};
 const y=d.getUTCFullYear(),fy=y+(d.getUTCMonth()>=6?1:0),start=Date.UTC(fy-1,6,1),end=Date.UTC(fy,6,1),elapsed=(+d+DAY-start)/DAY,days=(end-start)/DAY,left=Math.max(0,days-elapsed);
 const current=moneyNumber(row.currentBalance),spent=moneyNumber(row.ytdExpenses),history=(row.history||[]).map(h=>moneyNumber(h.expenses)).filter(v=>v!==null&&v!==0);
 let annual=method==='history'?(history.length?history.reduce((a,b)=>a+b,0)/history.length:null):(spent===null||elapsed<=0?null:spent*days/elapsed);
 // Net credits do not establish a positive future expense estimate.
 if(annual!==null)annual=Math.max(0,annual);
 const remaining=annual===null?null:Math.round(annual*left/days*100)/100;
 return {annual,remaining,projected:current===null||remaining===null?null:Math.round((current-remaining)*100)/100,fy,elapsed,days,left};
}
export function centerInfo(row,field){
 const profit=field==='profitCenter',id=String(profit?row.profitCenter||'':row.fundCenterId||'').trim().replace(profit?/^P(?=\d{6}$)/:/^$/,''),name=String(profit?row.profitCenterName||'':row.fundCenter||'').trim();
 return {key:id?'id:'+id:name?'name:'+name:'missing',label:id&&name&&id!==name?id+' · '+name:id||name||'Not provided',missing:!id&&!name};
}
export function accountTotals(rows){return Object.fromEntries(['currentBalance','ytdExpenses','remaining','projected','commitments'].map(field=>{const values=rows.map(r=>moneyNumber(r[field])).filter(v=>v!==null);return [field,{amount:values.length?values.reduce((a,b)=>a+b,0):null,known:values.length,count:rows.length}];}));}
export function groupAccounts(rows,by=''){
 const fields=by==='profitFund'?['profitCenter','fundCenter']:['profitCenter','fundCenter'].includes(by)?[by]:[];
 if(!fields.length)return [{key:'all',label:'All matching accounts',rows,totals:accountTotals(rows)}];
 const groups=new Map();for(const row of rows){const centers=fields.map(f=>centerInfo(row,f)),key=JSON.stringify(centers.map(c=>c.key));if(!groups.has(key))groups.set(key,{key,label:centers.map((c,i)=>(fields[i]==='profitCenter'?'Profit center: ':'Fund center: ')+c.label).join(' / '),centers,rows:[]});groups.get(key).rows.push(row);}
 return [...groups.values()].sort((a,b)=>{for(let i=0;i<fields.length;i++){const x=a.centers[i],y=b.centers[i],order=x.missing!==y.missing?x.missing?1:-1:x.label.localeCompare(y.label,undefined,{numeric:true,sensitivity:'base'});if(order)return order;}return a.key.localeCompare(b.key);}).map(g=>({...g,totals:accountTotals(g.rows)}));
}
export function matching(rows,{search='',control='',status='',category='',profitCenter='',fundCenter='',sort='account',direction=1}={}){
 const term=search.trim().toLocaleLowerCase();
 return rows.filter(r=>(!term||Object.values(r).filter(v=>typeof v==='string').join(' ').toLocaleLowerCase().includes(term))&&(!control||r.control===control)&&(!status||r.status===status)&&(!category||r.category===category)&&(!profitCenter||centerInfo(r,'profitCenter').key===profitCenter)&&(!fundCenter||centerInfo(r,'fundCenter').key===fundCenter)).sort((a,b)=>{
  const value=r=>['profitCenter','fundCenter'].includes(sort)?(centerInfo(r,sort).missing?null:centerInfo(r,sort).label):r[sort];
  const x=value(a),y=value(b),xn=moneyNumber(x),yn=moneyNumber(y),empty=v=>v===null||v===undefined||v==='';
  if(empty(x)||empty(y))return empty(x)===empty(y)?String(a.account||a.name).localeCompare(String(b.account||b.name)):empty(x)?1:-1;
  return (typeof x==='number'||typeof y==='number'?xn-yn:String(x).localeCompare(String(y),undefined,{numeric:true,sensitivity:'base'}))*direction;
 });
}
