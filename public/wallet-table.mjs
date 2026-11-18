export const numericAmount=value=>value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))?null:Number(value);
const bound=value=>String(value??'').trim()===''?null:numericAmount(value);
export const closedAccount=row=>Number(row.term_code)===3||String(row.is_closed??'').trim().toUpperCase()==='Y';
export function walletRows(source,{type,year,control='',search='',costObject='',minimum='',maximum='',sort='amount-desc'}={}){
 const q=search.trim().toLowerCase(),account=costObject.trim().toLowerCase(),min=bound(minimum),max=bound(maximum);
 const rows=source.filter(r=>{
  const amount=numericAmount(r.amount);
  return !closedAccount(r)&&r.type===type&&r.year===Number(year)&&(!control||(control==='other'?!['DP','FC'].includes(r.admin):r.admin===control))&&(!q||[r.account,r.name,r.description].some(v=>String(v??'').toLowerCase().includes(q)))&&(!account||String(r.account??'').toLowerCase().includes(account))&&(min===null||(amount!==null&&amount>=min))&&(max===null||(amount!==null&&amount<=max));
 });
 const accountCompare=(a,b)=>String(a.account??'').localeCompare(String(b.account??''),'en',{numeric:true});
 return rows.sort((a,b)=>{
  if(sort.startsWith('account-'))return (sort==='account-desc'?-1:1)*accountCompare(a,b);
  const x=numericAmount(a.amount),y=numericAmount(b.amount);
  if(x===null||y===null)return x===y?accountCompare(a,b):x===null?1:-1;
  return (sort==='amount-asc'?x-y:y-x)||accountCompare(a,b);
 });
}
