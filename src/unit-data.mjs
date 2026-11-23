import {loadSubmissionOutlooks} from './budget-submissions.mjs';
import access from './access.cjs';
import units from './units.cjs';
import policy from './policy.cjs';
import {wallet} from './fake-unit.mjs';
export async function readUnit(scope){
 const {getStore}=await import('@netlify/blobs');
 return getStore({name:'mitsoeservices-wallets-'+policy.deploymentName(),consistency:'strong'}).get(scope,{type:'json'});
}
export function validPayload(data,scope){
 const unit=units.WALLETS[scope];
 return !!unit&&data?.schema===1&&data.scope===scope&&data.statement?.unit===unit.source&&data.statement?.status==='Verified'&&Array.isArray(data.rows)&&data.rows.every(r=>String(r.statement_id)===String(data.statement.id)&&r.unit===unit.source&&r.cycle===data.statement.cycle);
}
export function createUnitDataHandler({authorize=access.authorize,read=readUnit,submissions=loadSubmissionOutlooks}={}){return async event=>{
 if(event.httpMethod!=='GET')return {statusCode:405,headers:access.noStore,body:'GET required'};
 const scope=units.unitScope(event);
 if(!scope)return {statusCode:404,headers:access.noStore,body:'Wallet not found.'};
 const comparison=event.queryStringParameters?.action==='compare';
 if(comparison&&scope!=='school')return {statusCode:403,headers:access.noStore,body:'School-wide wallet access required.'};
 const result=await authorize(event,{scope:units.permissionScope(scope)});
 if(!result.user)return result;
 if(units.walletBlocked(scope))return {statusCode:403,headers:access.noStore,body:'Academic unit wallets are currently blocked.'};
 try{
  if(event.queryStringParameters?.action==='submission'){const outlooks=await submissions();return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify({scope,submission:outlooks[scope]||null})};}
  if(comparison){
   let outlooks={};try{outlooks=await submissions();}catch{}
   const academic=Object.entries(units.UNITS).filter(([,u])=>!u.testOnly).map(([scope,u])=>({scope,label:u.label})),unavailable=[];
   const wallets=(await Promise.all(['school',...academic.map(u=>u.scope)].map(async key=>{try{const wallet=await read(key);if(!validPayload(wallet,key))throw Error('Invalid wallet');return {scope:key,submission:outlooks[key]||null,cycle:wallet.statement.cycle,published_at:wallet.published_at,snapshot:{carryYear:wallet.statement.carry_year,balanceYear:wallet.statement.balance_year,carry:wallet.statement.department_carry,balance:wallet.controls?.department_balance,nonrecurring:wallet.controls?.department_nonrecurring},rows:wallet.rows.filter(r=>['GIB Carryforward','Expendable Fund Balance','GIB Base','Pool A Payout'].includes(r.type)).map(({type,year,period,admin,amount,projection})=>({type,year,period,admin,amount,projection}))};}catch{unavailable.push(key);return null;}}))).filter(Boolean);
   return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify({units:academic,wallets,unavailable})};
  }
  const data=scope==='soe-fake'?wallet():await read(scope);
  if(!data)return {statusCode:503,headers:access.noStore,body:'Wallet data has not been published yet.'};
  if(!validPayload(data,scope))throw Error('Invalid unit snapshot');
  return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(data)};
 }catch{return {statusCode:503,headers:access.noStore,body:'Wallet data is temporarily unavailable.'};}
};}
export const handler=createUnitDataHandler();
