import {MAX_RCT_REVIEWERS,REVIEWER_KEY} from './rct-reviewers.mjs';
export const ROUND='FY27-RCT2';
export const FUNDING=[['provost','Provost funded','H'],['evpt','EVPT funded','I'],['school','SoE funded','J'],['department','Local source 1 funded','K'],['pi','Local source 2 funded','L'],['other','Other funded','W']];
export const LOCAL_LABELS={department:'Department',pi:'PI',other:'Other'};
export const fundingName=(review,key)=>review.fundingLabels?.[key]||LOCAL_LABELS[key]||({school:'SoE',provost:'Provost',evpt:'EVPT'}[key]);
export const localFundingEntries=review=>Object.keys(LOCAL_LABELS).map(key=>({key,label:fundingName(review,key),value:review[key]??null}));
export const localFundingTitle=review=>['SoE',...localFundingEntries(review).map(x=>x.label)].join(' / ');
export const MONEY=['award',...FUNDING.map(([key])=>key)];
export const REVIEWERS=['Hammond','Balakrishnan','Plata','Solomon','',''];
export const emptyReview=()=>({awardMode:null,requested:null,requestedHistory:[],...Object.fromEntries(MONEY.map(k=>[k,null])),fundingLabels:{...LOCAL_LABELS},commentStamps:{notes:null,reviewers:REVIEWERS.map(()=>null)},decision:'',notes:'',assignments:[],reviewers:REVIEWERS.map(name=>({name,grade:'',comments:''})),priority:null,gradStudents:null,autoCentral:true,vpr:null,notesHistory:[],finalVersion:null});
export function commentStampText(stamp){return stamp?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'long'}).format(new Date(stamp.at))+' · '+stamp.by:'';}
export const stampedComment=(text,stamp)=>text?(stamp?'Saved '+commentStampText(stamp)+'\n':'')+text:'';
export function reviewerPriorityStats(review){
 const scores=(review.reviewers||[]).filter(v=>typeof v.name==='string'&&v.name.trim()&&['1','2','3','4','5'].includes(v.grade)).map(v=>Number(v.grade));
 const count=scores.length,sum=scores.reduce((a,b)=>a+b,0);return {count,sum,average:count?sum/count:null};
}
export function proposalPriorityStanding(records,id){
 const scored=records.map(record=>({id:record.id,...reviewerPriorityStats(record.review)})).filter(s=>s.count),current=scored.find(s=>s.id===id);
 if(!current)return {...reviewerPriorityStats({}),rank:null,scored:scored.length,tied:false};
 return {...current,rank:1+scored.filter(s=>s.sum*current.count<current.sum*s.count).length,scored:scored.length,tied:scored.filter(s=>s.sum*current.count===current.sum*s.count).length>1};
}
export function centralThirds(award){const third=Math.round(award*100/3)/100;return {provost:third,evpt:third,local:Math.round((award-2*third)*100)/100,schoolTarget:Math.round(award*100/6)/100};}
// VPR and the former manual-central flag are accepted for old saved records only.
// Funding always uses the six active sources and fixed central thirds.
export const requestedTotal=(review,source)=>review.requested??source?.requested??null;
export const awardModeFor=(review,source)=>review.awardMode??(review.award===null||review.award===requestedTotal(review,source)?'follow':'custom');
export function syncRequestedAward(previous,next,source,{modeProvided=true,awardChanged=next.award!==previous.award}={}){
 let mode=modeProvided&&next.awardMode?next.awardMode:awardModeFor(previous,source);
 if(awardChanged&&(!modeProvided||mode==='follow'))mode=next.award===null||next.award===requestedTotal(next,source)?'follow':'custom';
 const changed=requestedTotal(previous,source)!==requestedTotal(next,source),resumed=mode==='follow'&&awardModeFor(previous,source)==='custom';
 return {...next,awardMode:mode,award:mode==='follow'&&(changed||resumed)?requestedTotal(next,source):next.award};
}
export const fundingTotal=(review,source)=>review.award??requestedTotal(review,source);
export const requestAmountNotes=(review,source)=>{const amount=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);return review.requestedHistory?.length?'Original requested amount: '+amount(source.requested)+'\n'+review.requestedHistory.map(v=>commentStampText(v)+' · '+(v.amount===null?'Restored original amount: '+amount(source.requested):'Revised requested amount: '+amount(v.amount))).join('\n'):'';};
export function fundingReview(review,source){const total=fundingTotal(review,source),thirds=total===null?null:centralThirds(total);return {...review,autoCentral:true,provost:thirds?.provost??null,evpt:thirds?.evpt??null};}
export function departmentInfo(source){
 const text=String(source.department||''),rules=[[/Civil|\bCEE\b/i,1,'Civil & Environmental Engineering'],[/Mechanical|MechE/i,2,'Mechanical Engineering'],[/Materials|DMSE/i,3,'Materials Science & Engineering'],[/Architect|\bArch\b/i,4,'Architecture'],[/Electrical|Computer|EECS/i,6,'Electrical Engineering & Computer Science'],[/Chemical|ChemE/i,10,'Chemical Engineering'],[/Aeronaut|AeroAstro/i,16,'Aeronautics & Astronautics'],[/Nuclear|\bNSE\b/i,22,'Nuclear Science & Engineering'],[/Biological|\bBE\b/i,20,'Biological Engineering']];
 const matches=rules.filter(([pattern])=>pattern.test(text)).sort((a,b)=>a[1]-b[1]);
 return matches.length?{number:matches[0][1],label:'Course '+matches.map(x=>x[1]).join(' / ')+' · '+text}:{number:999,label:text||'Other units'};
}
export function sortProposals(records){return [...records].sort((a,b)=>departmentInfo(a.source).number-departmentInfo(b.source).number||departmentInfo(a.source).label.localeCompare(departmentInfo(b.source).label)||a.source.pi.localeCompare(b.source.pi));}
export function validateReview(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...MONEY,'awardMode','requested','requestedHistory','fundingLabels','commentStamps','assignments','vpr','decision','notes','reviewers','priority','gradStudents','autoCentral','notesHistory','finalVersion'].includes(k)))throw Error('Invalid review fields.');
 const result=emptyReview();
 if(value.awardMode!==undefined&&value.awardMode!==null&&!['follow','custom'].includes(value.awardMode))throw Error('Invalid award mode.');result.awardMode=value.awardMode??null;
 if(value.assignments!==undefined){if(!Array.isArray(value.assignments)||value.assignments.length>MAX_RCT_REVIEWERS||new Set(value.assignments).size!==value.assignments.length||value.assignments.some(key=>typeof key!=='string'||!REVIEWER_KEY.test(key)))throw Error('Invalid reviewer assignments.');result.assignments=[...value.assignments];}
 if(value.commentStamps!==undefined){const meta=value.commentStamps;const stamp=s=>{if(s===null)return null;if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['by','at'].includes(k))||typeof s.by!=='string'||!s.by.trim()||s.by.length>100||/[\x00-\x1f\x7f]/.test(s.by)||typeof s.at!=='string'||!Number.isFinite(Date.parse(s.at)))throw Error('Invalid comment stamp.');return {by:s.by,at:s.at};};if(!meta||typeof meta!=='object'||Array.isArray(meta)||Object.keys(meta).some(k=>!['notes','reviewers'].includes(k))||!Array.isArray(meta.reviewers)||(meta.reviewers.length<6||meta.reviewers.length>MAX_RCT_REVIEWERS))throw Error('Invalid comment stamps.');result.commentStamps={notes:stamp(meta.notes),reviewers:meta.reviewers.map(stamp)};}
 if(value.fundingLabels!==undefined){const labels=value.fundingLabels;if(!labels||typeof labels!=='object'||Array.isArray(labels)||Object.keys(labels).some(k=>!Object.hasOwn(LOCAL_LABELS,k)))throw Error('Invalid funding names.');for(const key of Object.keys(LOCAL_LABELS)){const label=labels[key];if(label===undefined)continue;if(typeof label!=='string'||!label.trim()||label.length>60||/[\x00-\x1f\x7f]/.test(label))throw Error('Funding names must contain 1 to 60 characters.');result.fundingLabels[key]=label.trim();}}
 for(const key of [...MONEY,'requested','vpr']){const v=value[key];if(v===null||v===''||v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw Error('Amounts must be nonnegative numbers with at most two decimal places.');result[key]=v;}
 for(const [key,max]of [['decision',100],['notes',15000]]){if(typeof value[key]!=='string'||value[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key]))throw Error('Invalid '+key+'.');result[key]=value[key];}
 if(value.priority!==undefined&&value.priority!==null&&(!Number.isInteger(value.priority)||value.priority<1||value.priority>1000))throw Error('Priority must be a whole number from 1 to 1000.');
 result.priority=value.priority??null;
 if(value.gradStudents!==undefined&&value.gradStudents!==null&&typeof value.gradStudents!=='boolean')throw Error('Invalid graduate-student flag.');result.gradStudents=value.gradStudents??null;
 if(value.autoCentral!==undefined&&typeof value.autoCentral!=='boolean')throw Error('Invalid funding mode.');result.autoCentral=true;
 if(value.reviewers!==undefined){if(!Array.isArray(value.reviewers)||(value.reviewers.length<6||value.reviewers.length>MAX_RCT_REVIEWERS))throw Error('Between 6 and 100 reviewer slots are required.');result.reviewers=value.reviewers.map((r,i)=>{if(!r||Object.keys(r).some(k=>!['name','grade','comments','reviewerKey'].includes(k))||r.reviewerKey!==undefined&&(typeof r.reviewerKey!=='string'||!REVIEWER_KEY.test(r.reviewerKey))||typeof r.name!=='string'||r.name.length>100||typeof r.grade!=='string'||!['','1','2','3','4','5'].includes(r.grade)||typeof r.comments!=='string'||r.comments.length>6000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r.name+r.grade+r.comments))throw Error('Invalid reviewer name, need priority ranking or comment.');if(!r.name.trim()&&r.grade.trim())throw Error('Name the reviewer before adding a need priority ranking.');return {...r};});}
 if(value.requestedHistory!==undefined){if(!Array.isArray(value.requestedHistory)||value.requestedHistory.some(v=>!v||Object.keys(v).some(k=>!['amount','by','at'].includes(k))||v.amount!==null&&(typeof v.amount!=='number'||!Number.isFinite(v.amount)||v.amount<0||v.amount>100000000||Math.abs(v.amount*100-Math.round(v.amount*100))>0.00001)||typeof v.by!=='string'||!v.by.trim()||v.by.length>100||/[\x00-\x1f\x7f]/.test(v.by)||typeof v.at!=='string'||!Number.isFinite(Date.parse(v.at))))throw Error('Invalid requested amount history.');result.requestedHistory=value.requestedHistory.map(v=>({...v}));}
 const reviewerKeys=result.reviewers.filter(v=>v.reviewerKey).map(v=>v.reviewerKey);if(new Set(reviewerKeys).size!==reviewerKeys.length)throw Error('A reviewer can only have one score slot.');result.commentStamps.reviewers=result.reviewers.map((_,i)=>result.commentStamps.reviewers[i]??null);
 if(value.notesHistory!==undefined){if(!Array.isArray(value.notesHistory)||value.notesHistory.some(n=>!n||typeof n.text!=='string'||n.text.length>15000||typeof n.by!=='string'||n.by.length>100||typeof n.at!=='string'||!Number.isFinite(Date.parse(n.at))))throw Error('Invalid note history.');result.notesHistory=value.notesHistory.map(n=>({text:n.text,by:n.by,at:n.at}));}
 if(value.finalVersion!==undefined&&value.finalVersion!==null&&value.finalVersion!=='original'&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.finalVersion))throw Error('Invalid final proposal version.');result.finalVersion=value.finalVersion??null;
 return result;
}
const sum=(r,keys)=>Math.round(keys.reduce((s,k)=>s+(r[k]??0),0)*100)/100;
export function fundingSummary(r,source){
 const total=fundingTotal(r,source);
 const assigned=MONEY.slice(1).some(k=>Number.isFinite(r[k]))?sum(r,MONEY.slice(1)):null;
 const local=['school','department','pi','other'].some(k=>Number.isFinite(r[k]))?sum(r,['school','department','pi','other']):null;
 return {assigned,local,central:total===null?null:Math.round((total-(local??0))*100)/100,unallocated:total===null?null:Math.round((total-(assigned??0))*100)/100,
 complete:Boolean(['supported','declined'].includes(decisionState(r.decision))&&r.award!==null&&Math.abs(r.award-(assigned??0))<0.005&&(decisionState(r.decision)!=='declined'||r.award===0))};
}
export function decisionState(value){const d=String(value||'').trim().toLowerCase();return ['support','partial support'].includes(d)?'supported':d==='decline'?'declined':'undecided';}
const cents=n=>Math.round(n*100);
export function commitmentView(records,{scope='supported',groupBy='proposal'}={}){
 if(!['supported','all','undecided','declined'].includes(scope)||!['proposal','department','school'].includes(groupBy))throw Error('Invalid funding view.');
 records=records.map(r=>({...r,review:fundingReview(r.review,r.source)}));
 const selected=records.filter(r=>scope==='all'||decisionState(r.review.decision)===scope),columns=['requested',...MONEY,'assigned','unallocated','local'];
 const names=new Map();for(const record of selected)for(const entry of localFundingEntries(record.review))if(entry.value!==null||entry.label!==LOCAL_LABELS[entry.key]){const key='contributor:'+entry.label.toLowerCase();if(!names.has(key))names.set(key,{key,label:entry.label});}
 const localFunders=[...names.values()].sort((a,b)=>a.label.localeCompare(b.label));
 const aggregate=rows=>{const amounts={};for(const key of columns){const values=rows.map(r=>key==='requested'?requestedTotal(r.review,r.source):MONEY.includes(key)?r.review[key]:fundingSummary(r.review,r.source)[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));amounts[key]={total:values.length?values.reduce((n,v)=>n+cents(v),0)/100:null,entered:values.length,count:rows.length};}return {count:rows.length,amounts,complete:rows.filter(r=>fundingSummary(r.review,r.source).complete).length};};
 const groups=new Map();for(const row of selected){const label=String(groupBy==='proposal'?row.source.pi:groupBy==='school'?row.source.area:row.source.department).replace(/\s+/g,' ').trim()||'Not specified',key=groupBy==='proposal'?row.id:label;if(!groups.has(key))groups.set(key,{key,label,records:[]});groups.get(key).records.push(row);}
 const namedAggregate=rows=>{const result=aggregate(rows);for(const f of localFunders){const values=rows.map(r=>localFundingEntries(r.review).filter(e=>'contributor:'+e.label.toLowerCase()===f.key&&e.value!==null)).filter(entries=>entries.length).map(entries=>entries.reduce((n,e)=>n+cents(e.value),0));result.amounts[f.key]={total:values.length?values.reduce((a,b)=>a+b,0)/100:null,entered:values.length,count:rows.length};}return result;};
 return {scope,groupBy,localFunders,selected:selected.length,excluded:records.length-selected.length,rows:[...groups.values()].map(g=>({key:g.key,label:g.label,...namedAggregate(g.records),proposalIds:g.records.map(r=>r.id)})).sort((a,b)=>a.label.localeCompare(b.label)),total:namedAggregate(selected)};
}
