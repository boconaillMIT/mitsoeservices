import {validPayload} from './unit-data.mjs';
export function walletAccountReference(wallet){
 if(!wallet)return null;if(!validPayload(wallet,'aeroastro'))throw Error('Unverified AeroAstro wallet');
 const {statement}=wallet;if(!Number.isInteger(statement.carry_year)||!Number.isInteger(statement.balance_year))throw Error('Wallet dates unavailable');
 const accounts=new Map();
 for(const row of wallet.rows){const type=row.type==='GIB Carryforward'&&row.year===statement.carry_year?'walletCarry':row.type==='Expendable Fund Balance'&&row.year===statement.balance_year?'walletBalance':null;if(!type||row.amount===null||row.amount===undefined||row.amount==='')continue;
  if(!/^\d{7}$/.test(row.account||'')||typeof row.amount!=='number'||!Number.isFinite(row.amount)||typeof row.name!=='string'||row.name.length>500||!['DP','FC',''].includes(row.admin||''))throw Error('Invalid wallet account');
  if(!accounts.has(row.account))accounts.set(row.account,{account:row.account,name:row.name,control:row.admin||'',pool:row.pool||'',classification:row.classification||'',status:row.is_closed==='Y'?'Closed':row.is_closed==='N'?'Open':'',currentBalance:null,ytdExpenses:null,commitments:null,walletCarry:null,walletBalance:null});
  const account=accounts.get(row.account);if(account[type]!==null||account.control!==(row.admin||''))throw Error('Ambiguous wallet account');account[type]=row.amount;
 }
 const rows=[...accounts.values()];if(!rows.length)return null;const total=(field,control)=>{const known=rows.filter(r=>r.control===control&&r[field]!==null);return known.length?known.reduce((s,r)=>s+r[field],0):null;};
 return {source:{cycle:statement.cycle,updated:statement.updated||'',publishedAt:wallet.published_at,carryYear:statement.carry_year,balanceYear:statement.balance_year,coverage:'AeroAstro department wallet; profit and fund centers not supplied'},totals:{departmentCarry:total('walletCarry','DP'),departmentBalance:total('walletBalance','DP'),facultyCarry:total('walletCarry','FC'),facultyBalance:total('walletBalance','FC')},rows};
}
