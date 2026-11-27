import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import access from './access.cjs';
import policy from './policy.cjs';
import features from './features.cjs';
import {encryptionKey} from './nimbus-store.mjs';
import {createFinanceRepository} from './aeroastro-finance-store.mjs';
import {validateFinanceSource,AEROASTRO_PROFIT_CENTERS} from './aeroastro-finance-source.mjs';
import {validateExpenseProfiles} from './aeroastro-expense-profile.mjs';
import {facultyBenefitAttribution} from './aeroastro-faculty-benefits.mjs';
import {warehouseHelperPackage} from './aeroastro-warehouse-package.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const cents=n=>Math.round(n*100)/100;
const pc=p=>String(p).replace(/^P(?=\d{6}$)/,'');
const amount=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e13;
export const warehouseVersion=s=>sha(JSON.stringify([s.sourceHash,s.publishedAt,s.asOf]));
export function createWarehouseTickets(key=encryptionKey,now=()=>new Date()){
 const mac=s=>createHmac('sha256',key()).update('aeroastro-warehouse-v1:'+s).digest('hex');
 return {issue(data){const encoded=Buffer.from(JSON.stringify({...data,expires:+now()+15*60000})).toString('base64url');return encoded+'.'+mac(encoded);},read(token){
  if(typeof token!=='string'||token.length>2000||!/^[-_A-Za-z0-9]+\.[a-f0-9]{64}$/.test(token))throw Error('Invalid refresh authorization');
  const [encoded,signature]=token.split('.');if(!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(encoded),'hex')))throw Error('Invalid refresh authorization');
  const t=JSON.parse(Buffer.from(encoded,'base64url'));if(t.unit!=='aeroastro'||!policy.validUsername(t.actor)||! /^[a-f0-9-]{36}$/.test(t.id)||! /^[a-f0-9]{64}$/.test(t.version)||!Number.isFinite(t.expires)||t.expires<=+now()||t.expires>+now()+15*60000)throw Error('Refresh authorization expired');return t;
 }};
}
// Fixed GL categories. The server, not the desktop client, derives projections.
const patterns=[['Faculty salary','academic',['400025','400026','400040','400041','400090','400105']],['Graduate teaching pay','academic',['400700','400702']],['TA tuition','academic',['422304']],['Fellowship tuition','academic',['422306']],['Fellowship stipend','year-round',['422315']],['Posted summer faculty salary (not repeated)','scheduled',['400005','400006','400070']]];
export function prepareWarehouseRefresh(current,bundle,asOf){
 if(bundle?.schema!==1||bundle.asOf!==asOf||!Array.isArray(bundle.balances)||!Array.isArray(bundle.gl)||bundle.balances.length!==current.rows.length||bundle.gl.length>80000)throw Error('Incomplete Warehouse extract');
 const fy=Number(asOf.slice(0,4))+(Number(asOf.slice(5,7))>=7?1:0),period=String(fy)+String((Number(asOf.slice(5,7))+5)%12+1).padStart(2,'0');
 if(bundle.period!==period)throw Error('Warehouse fiscal period does not match the refresh date');
 const allowed=new Map(current.rows.map(r=>[r.account,r])),balances=new Map(),leaf=new Map(),seen=new Set();
 for(const b of bundle.balances){const old=allowed.get(b.account);if(!old||balances.has(b.account)||pc(b.profitCenter)!==pc(old.profitCenter)||!AEROASTRO_PROFIT_CENTERS.includes(pc(b.profitCenter)))throw Error('Warehouse account scope mismatch');
  const fields=['currentBalance','ytdExpenses','currentExpenses','commitments'];if(fields.some(k=>b[k]!==null&&!amount(b[k]))||b.ytdExpenses===null!== (b.currentExpenses===null))throw Error('Invalid Warehouse balance');balances.set(b.account,b);
 }
 for(const r of bundle.gl){const old=allowed.get(r.account),id=r.account+'|'+r.gl;if(!old||pc(r.profitCenter)!==pc(old.profitCenter)||!/^\d{6}$/.test(r.gl)||seen.has(id)||!['ytd','current','summer'].every(k=>amount(r[k])))throw Error('Invalid Warehouse expense scope');seen.add(id);const list=leaf.get(r.account)||[];list.push(r);leaf.set(r.account,list);}
 const profiles=[],rows=current.rows.map(old=>{
  const b=balances.get(old.account),items=leaf.get(old.account)||[];
  if(b.ytdExpenses===null){if(items.some(r=>r.ytd||r.current||r.summer))throw Error('Expense detail without a reported balance');return {...old,currentBalance:b.currentBalance,ytdExpenses:null,commitments:b.commitments};}
  const sum=(codes,field)=>items.filter(r=>codes.includes(r.gl)).reduce((s,r)=>s+r[field],0);
  // Reconcile the complete expense GL extract to the Balance Summary measures.
  for(const [field,target]of [['ytd',b.ytdExpenses],['current',b.currentExpenses]])if(Math.abs(items.reduce((s,r)=>s+r[field],0)-target)>.1)throw Error('Warehouse expense detail does not reconcile to account totals');
  let spent=0,active=0;const components=[];
  for(const [label,basis,codes]of patterns){const ytd=sum(codes,'ytd'),cur=sum(codes,'current'),summer=sum(codes,'summer');spent+=ytd;active+=cur;if(!ytd&&!cur&&!summer)continue;components.push(basis==='scheduled'?{label,basis,schedule:[]}:{label,basis,closedAmount:cents(ytd-cur-(basis==='academic'?summer:0)),currentAmount:cents(cur)});}
  const benefit=facultyBenefitAttribution(items,fy),eb=['600204','600205','600226','600227'];
  for(const field of ['ytd','current','summer'])if(benefit.regular[field]+benefit.summer[field]>0&&benefit.regular[field]+benefit.summer[field]>sum(eb,field)+.10)throw Error('Faculty benefits attribution exceeds posted benefits');
  for(const [kind,label]of [['regular','Faculty salary benefits (estimated at MIT FY27 rates)'],['summer','Posted summer faculty benefits (not repeated)']]){const v=benefit[kind];spent+=v.ytd;active+=v.current;if(!v.ytd&&!v.current&&!v.summer)continue;components.push(kind==='summer'?{label,basis:'scheduled',schedule:[]}:{label,basis:'academic',closedAmount:cents(v.ytd-v.current-v.summer),currentAmount:v.current});}
  components.push({label:'Other expenses, non-faculty benefits and adjustments',basis:'year-round',closedAmount:cents(b.ytdExpenses-b.currentExpenses-spent+active),currentAmount:cents(b.currentExpenses-active)});
  profiles.push({account:old.account,components,facultyBenefitsAdjusted:true,summerBenefitsRate:benefit.summerBenefitsRate,defaultSummerRate:benefit.defaultSummerRate});
  return {...old,currentBalance:b.currentBalance,ytdExpenses:b.ytdExpenses,commitments:b.commitments};
 });
 const sourceHash=sha(JSON.stringify(bundle)),expenseProfiles=validateExpenseProfiles({schema:1,unit:'aeroastro',asOf,sourceHash,rows:profiles});
 return {rows,sourceHash,expenseProfiles};
}
export function createWarehouseHandler({authorize=access.authorize,loadPolicy=policy.loadPolicy,loadFeatures=features.loadFlags,repository=()=>createFinanceRepository(),key=encryptionKey,now=()=>new Date(),uuid=randomUUID}={}){
 const tickets=createWarehouseTickets(key,now),reply=(statusCode,body)=>({statusCode,headers:{...access.noStore,'Content-Type':'application/json'},body:JSON.stringify(body)});
 return async event=>{
  const h=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));let ticket,auth,b;
  if(!['POST','GET'].includes(event.httpMethod))return reply(405,{error:'GET or POST required.'});
  if(event.httpMethod==='POST'){if(h['content-type']?.split(';')[0]!=='application/json'||typeof event.body!=='string'||Buffer.byteLength(event.body)>5500000)return reply(400,{error:'Invalid refresh message.'});try{b=JSON.parse(event.body);}catch{return reply(400,{error:'Invalid refresh message.'});}}
  if(h.authorization){try{if(!h.authorization.startsWith('Bearer '))throw Error();ticket=tickets.read(h.authorization.slice(7));const p=await loadPolicy();if((policy.CAPABILITIES[policy.effectiveRole(p.data,ticket.actor,'finance:aeroastro','full')]||0)<2)return reply(403,{error:'AeroAstro refresh access has been revoked.'});const visible=features.effectiveFeatures((await loadFeatures()).data,Boolean(policy.effectiveRole(p.data,ticket.actor,'school','limited')));if(visible['aeroastro-finance']===false)return reply(403,{error:'AeroAstro finance is temporarily unavailable.'});}catch{return reply(401,{error:'Refresh authorization expired. Start again from the accounts page.'});}}
  else{auth=await authorize(event,{scope:'finance:aeroastro',minimum:'write',audience:'full'});if(!auth.user)return auth;if(event.httpMethod==='GET'&&event.queryStringParameters?.download==='helper'){try{return {statusCode:200,headers:{...access.noStore,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="AeroAstro-Warehouse-Helper.zip"'},isBase64Encoded:true,body:(await warehouseHelperPackage()).toString('base64')};}catch{return reply(503,{error:'The Warehouse helper download is unavailable.'});}}if(event.httpMethod!=='POST'||h.origin!==process.env.APP_ORIGIN||!process.env.APP_ORIGIN)return reply(403,{error:'Same-origin JSON required.'});}
  try{
   const repo=repository(),current=await repo.snapshot('accounts');if(!current?.sourceHash)return reply(503,{error:'The verified AeroAstro account list is unavailable.'});
   if(!ticket){
    if(b?.action==='start'){const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now()),id=uuid(),value=tickets.issue({unit:'aeroastro',actor:auth.kerberos,id,asOf:date,version:warehouseVersion(current)});return reply(200,{ticket:value,launch:'mitsoe-warehouse://refresh/'+value});}
    if(b?.action==='status'){let t;try{t=tickets.read(b.ticket);}catch{return reply(409,{error:'Refresh expired. Start again.'});}if(t.actor!==auth.kerberos)return reply(403,{error:'This refresh belongs to another user.'});return reply(200,{saved:current.importId===t.id,changed:warehouseVersion(current)!==t.version,asOf:current.asOf});}
    return reply(400,{error:'Unknown refresh action.'});
   }
   if(warehouseVersion(current)!==ticket.version)return reply(409,{error:'Account data changed. Start a new refresh from the accounts page.'});
   if(event.httpMethod==='GET')return reply(200,{schema:1,unit:'aeroastro',actor:ticket.actor,asOf:ticket.asOf,inventory:current.rows.map(r=>({account:r.account,profitCenter:pc(r.profitCenter)}))});
   if(b?.action!=='complete'||Object.keys(b).some(k=>!['action','bundle'].includes(k)))return reply(400,{error:'Invalid refresh completion.'});
   let prepared;try{prepared=prepareWarehouseRefresh(current,b.bundle,ticket.asOf);}catch(e){return reply(400,{error:e.message});}
   const candidate=validateFinanceSource({schema:1,unit:'aeroastro',kind:'accounts',asOf:ticket.asOf,label:'MIT Data Warehouse · direct read-only extract',...prepared,publishedAt:now().toISOString(),publishedBy:ticket.actor,importId:ticket.id},'accounts',now());
   const saved=await repo.refreshAccounts(current,candidate);return saved.conflict?reply(409,{error:'Another refresh was saved first. Start again.'}):reply(200,{saved:true,accounts:prepared.rows.length,profiles:prepared.expenseProfiles.rows.length,asOf:candidate.asOf});
  }catch{return reply(503,{error:'Warehouse refresh could not be confirmed. Existing balances and notes are preserved.'});}
 };
}
export const handler=createWarehouseHandler();
