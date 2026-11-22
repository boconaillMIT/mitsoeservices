export const RESOURCE_TYPES=['GIB Carryforward','Expendable Fund Balance','GIB Base','Pool A Payout'];
const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
export function points(wallet,type){
 const rows=wallet.rows.filter(r=>r.type===type),years=[...new Set(rows.map(r=>Number(r.year)))].sort((a,b)=>a-b);
 return years.map(year=>{
  const annual=rows.filter(r=>Number(r.year)===year),selected=annual.filter(r=>type==='Pool A Payout'||r.admin==='DP'),numeric=selected.filter(r=>known(r.amount));
  // The source wallet's carryforward SUMIFS returns zero for a present group
  // of blank account entries. An absent group is still unavailable.
  const walletZero=type==='GIB Carryforward'&&selected.length>0&&numeric.length===0;
  return {year,amount:numeric.length||walletZero?numeric.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100:null,walletZero,blanks:selected.length-numeric.length,periods:[...new Set(annual.map(r=>String(r.period||'')))].sort(),projection:annual.some(r=>[true,1,'1'].includes(r.projection))};
 });
}
const periodKey=p=>p.periods.join('|');
export function combinedPoints(wallets,type,expectedCount){
 if(wallets.length!==expectedCount||new Set(wallets.map(w=>w.cycle)).size!==1)return [];
 const series=wallets.map(w=>points(w,type));
 return (series[0]||[]).map(p=>{const group=series.map(s=>s.find(v=>v.year===p.year));return {...p,walletZero:group.every(v=>v?.walletZero===true),blanks:group.reduce((n,v)=>n+(v?.blanks||0),0),amount:group.every(v=>v&&known(v.amount)&&periodKey(v)===periodKey(p)&&v.projection===p.projection)?group.reduce((n,v)=>n+Math.round(v.amount*100),0)/100:null};});
}
export function trendComparison(hq,unit){
 const matched=hq.flatMap(h=>{const u=unit.find(p=>p.year===h.year);return u&&known(h.amount)&&known(u.amount)&&!h.projection&&!u.projection&&periodKey(h)===periodKey(u)?[{hq:h,unit:u}]:[];});
 if(matched.length<2)return null;
 const first=matched[0],last=matched.at(-1),change=(a,b)=>({dollars:b.amount-a.amount,percent:a.amount===0?null:100*(b.amount-a.amount)/Math.abs(a.amount)}),school=change(first.hq,last.hq),department=change(first.unit,last.unit);
 return {from:first.hq.year,to:last.hq.year,hq:school,unit:department,stronger:school.percent===null||department.percent===null?null:department.percent>school.percent+.01};
}
