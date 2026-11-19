export const ROUND='FY27-RCT2';
export const FUNDING=[['provost','Provost funded','H'],['evpt','EVPT funded','I'],['school','School funded','J'],['department','Department funded','K'],['pi','PI funded','L'],['vpr','VPR funded','M']];
export const MONEY=['award',...FUNDING.map(([key])=>key)];
export const emptyReview=()=>Object.fromEntries([...MONEY.map(k=>[k,null]),['decision',''],['notes','']]);
export function validateReview(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...MONEY,'decision','notes'].includes(k)))throw Error('Invalid review fields.');
 const result=emptyReview();
 for(const key of MONEY){const v=value[key];if(v===null||v===''||v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw Error('Amounts must be nonnegative numbers with at most two decimal places.');result[key]=v;}
 for(const [key,max]of [['decision',100],['notes',15000]]){if(typeof value[key]!=='string'||value[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key]))throw Error('Invalid '+key+'.');result[key]=value[key].trim();}
 return result;
}
const sum=(r,keys)=>Math.round(keys.reduce((s,k)=>s+(r[k]??0),0)*100)/100;
export function fundingSummary(r){
 const assigned=MONEY.slice(1).some(k=>r[k]!==null)?sum(r,MONEY.slice(1)):null;
 const local=['school','department','pi'].some(k=>r[k]!==null)?sum(r,['school','department','pi']):null;
 return {assigned,local,central:r.award===null?null:Math.round((r.award-(local??0))*100)/100,unallocated:r.award===null?null:Math.round((r.award-(assigned??0))*100)/100,
 complete:Boolean(r.decision&&r.award!==null&&Math.abs(r.award-(assigned??0))<0.005)};
}
