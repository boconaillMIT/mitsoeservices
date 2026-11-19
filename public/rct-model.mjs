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
 complete:Boolean(['supported','declined'].includes(decisionState(r.decision))&&r.award!==null&&Math.abs(r.award-(assigned??0))<0.005&&(decisionState(r.decision)!=='declined'||r.award===0))};
}
export function decisionState(value){const d=String(value||'').trim().toLowerCase();return ['support','partial support'].includes(d)?'supported':d==='decline'?'declined':'undecided';}
const cents=n=>Math.round(n*100);
export function commitmentView(records,{scope='supported',groupBy='proposal'}={}){
 if(!['supported','all','undecided','declined'].includes(scope)||!['proposal','department','school'].includes(groupBy))throw Error('Invalid funding view.');
 const selected=records.filter(r=>scope==='all'||decisionState(r.review.decision)===scope),columns=['requested',...MONEY,'assigned','unallocated'];
 const aggregate=rows=>{const amounts={};for(const key of columns){const values=rows.map(r=>key==='requested'?r.source.requested:MONEY.includes(key)?r.review[key]:fundingSummary(r.review)[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));amounts[key]={total:values.length?values.reduce((n,v)=>n+cents(v),0)/100:null,entered:values.length,count:rows.length};}return {count:rows.length,amounts,complete:rows.filter(r=>fundingSummary(r.review).complete).length};};
 const groups=new Map();for(const row of selected){const label=String(groupBy==='proposal'?row.source.pi:groupBy==='school'?row.source.area:row.source.department).replace(/\s+/g,' ').trim()||'Not specified',key=groupBy==='proposal'?row.id:label;if(!groups.has(key))groups.set(key,{key,label,records:[]});groups.get(key).records.push(row);}
 return {scope,groupBy,selected:selected.length,excluded:records.length-selected.length,rows:[...groups.values()].map(g=>({key:g.key,label:g.label,...aggregate(g.records),proposalIds:g.records.map(r=>r.id)})).sort((a,b)=>a.label.localeCompare(b.label)),total:aggregate(selected)};
}
