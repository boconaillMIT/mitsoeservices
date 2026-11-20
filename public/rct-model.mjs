export const ROUND='FY27-RCT2';
export const FUNDING=[['provost','Provost funded','H'],['evpt','EVPT funded','I'],['school','SoE funded','J'],['department','Department funded','K'],['pi','PI funded','L']];
export const MONEY=['award',...FUNDING.map(([key])=>key)];
export const REVIEWERS=['Hammond','Balakrishnan','Plata','Solomon','',''];
export const emptyReview=()=>({...Object.fromEntries(MONEY.map(k=>[k,null])),decision:'',notes:'',reviewers:REVIEWERS.map(name=>({name,grade:'',comments:''})),priority:null,gradStudents:null,autoCentral:true,vpr:null,notesHistory:[],finalVersion:null});
export function centralThirds(award){const third=Math.round(award*100/3)/100;return {provost:third,evpt:third,local:Math.round((award-2*third)*100)/100,schoolTarget:Math.round(award*100/6)/100};}
// VPR and the former manual-central flag are accepted for old saved records only.
// Funding always uses the five active sources and fixed central thirds.
export const fundingTotal=(review,source)=>review.award??source?.requested??null;
export function fundingReview(review,source){const total=fundingTotal(review,source),thirds=total===null?null:centralThirds(total);return {...review,autoCentral:true,provost:thirds?.provost??null,evpt:thirds?.evpt??null};}
export function departmentInfo(source){
 const text=String(source.department||''),rules=[[/Civil|\bCEE\b/i,1,'Civil & Environmental Engineering'],[/Mechanical|MechE/i,2,'Mechanical Engineering'],[/Materials|DMSE/i,3,'Materials Science & Engineering'],[/Architect|\bArch\b/i,4,'Architecture'],[/Electrical|Computer|EECS/i,6,'Electrical Engineering & Computer Science'],[/Chemical|ChemE/i,10,'Chemical Engineering'],[/Aeronaut|AeroAstro/i,16,'Aeronautics & Astronautics'],[/Nuclear|\bNSE\b/i,22,'Nuclear Science & Engineering'],[/Biological|\bBE\b/i,20,'Biological Engineering']];
 const matches=rules.filter(([pattern])=>pattern.test(text)).sort((a,b)=>a[1]-b[1]);
 return matches.length?{number:matches[0][1],label:'Course '+matches.map(x=>x[1]).join(' / ')+' · '+text}:{number:999,label:text||'Other units'};
}
export function sortProposals(records){return [...records].sort((a,b)=>departmentInfo(a.source).number-departmentInfo(b.source).number||departmentInfo(a.source).label.localeCompare(departmentInfo(b.source).label)||a.source.pi.localeCompare(b.source.pi));}
export function validateReview(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>![...MONEY,'vpr','decision','notes','reviewers','priority','gradStudents','autoCentral','notesHistory','finalVersion'].includes(k)))throw Error('Invalid review fields.');
 const result=emptyReview();
 for(const key of [...MONEY,'vpr']){const v=value[key];if(v===null||v===''||v===undefined)continue;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100000000||Math.abs(v*100-Math.round(v*100))>0.00001)throw Error('Amounts must be nonnegative numbers with at most two decimal places.');result[key]=v;}
 for(const [key,max]of [['decision',100],['notes',15000]]){if(typeof value[key]!=='string'||value[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key]))throw Error('Invalid '+key+'.');result[key]=value[key];}
 if(value.priority!==undefined&&value.priority!==null&&(!Number.isInteger(value.priority)||value.priority<1||value.priority>1000))throw Error('Priority must be a whole number from 1 to 1000.');
 result.priority=value.priority??null;
 if(value.gradStudents!==undefined&&value.gradStudents!==null&&typeof value.gradStudents!=='boolean')throw Error('Invalid graduate-student flag.');result.gradStudents=value.gradStudents??null;
 if(value.autoCentral!==undefined&&typeof value.autoCentral!=='boolean')throw Error('Invalid funding mode.');result.autoCentral=true;
 if(value.reviewers!==undefined){if(!Array.isArray(value.reviewers)||value.reviewers.length!==6)throw Error('Six reviewer slots are required.');result.reviewers=value.reviewers.map((r,i)=>{if(!r||Object.keys(r).some(k=>!['name','grade','comments'].includes(k))||typeof r.name!=='string'||r.name.length>100||i<4&&r.name!==REVIEWERS[i]||typeof r.grade!=='string'||!['','1','2','3','4','5'].includes(r.grade)||typeof r.comments!=='string'||r.comments.length>6000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r.name+r.grade+r.comments))throw Error('Invalid reviewer name, need priority ranking or comment.');if(!r.name.trim()&&(r.grade.trim()||r.comments.trim()))throw Error('Name the additional reviewer before adding a need priority ranking or comment.');return {...r};});}
 if(value.notesHistory!==undefined){if(!Array.isArray(value.notesHistory)||value.notesHistory.some(n=>!n||typeof n.text!=='string'||n.text.length>15000||typeof n.by!=='string'||n.by.length>100||typeof n.at!=='string'||!Number.isFinite(Date.parse(n.at))))throw Error('Invalid note history.');result.notesHistory=value.notesHistory.map(n=>({text:n.text,by:n.by,at:n.at}));}
 if(value.finalVersion!==undefined&&value.finalVersion!==null&&value.finalVersion!=='original'&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.finalVersion))throw Error('Invalid final proposal version.');result.finalVersion=value.finalVersion??null;
 return result;
}
const sum=(r,keys)=>Math.round(keys.reduce((s,k)=>s+(r[k]??0),0)*100)/100;
export function fundingSummary(r,source){
 const total=fundingTotal(r,source);
 const assigned=MONEY.slice(1).some(k=>r[k]!==null)?sum(r,MONEY.slice(1)):null;
 const local=['school','department','pi'].some(k=>r[k]!==null)?sum(r,['school','department','pi']):null;
 return {assigned,local,central:total===null?null:Math.round((total-(local??0))*100)/100,unallocated:total===null?null:Math.round((total-(assigned??0))*100)/100,
 complete:Boolean(['supported','declined'].includes(decisionState(r.decision))&&r.award!==null&&Math.abs(r.award-(assigned??0))<0.005&&(decisionState(r.decision)!=='declined'||r.award===0))};
}
export function decisionState(value){const d=String(value||'').trim().toLowerCase();return ['support','partial support'].includes(d)?'supported':d==='decline'?'declined':'undecided';}
const cents=n=>Math.round(n*100);
export function commitmentView(records,{scope='supported',groupBy='proposal'}={}){
 if(!['supported','all','undecided','declined'].includes(scope)||!['proposal','department','school'].includes(groupBy))throw Error('Invalid funding view.');
 records=records.map(r=>({...r,review:fundingReview(r.review,r.source)}));
 const selected=records.filter(r=>scope==='all'||decisionState(r.review.decision)===scope),columns=['requested',...MONEY,'assigned','unallocated'];
 const aggregate=rows=>{const amounts={};for(const key of columns){const values=rows.map(r=>key==='requested'?r.source.requested:MONEY.includes(key)?r.review[key]:fundingSummary(r.review,r.source)[key]).filter(v=>typeof v==='number'&&Number.isFinite(v));amounts[key]={total:values.length?values.reduce((n,v)=>n+cents(v),0)/100:null,entered:values.length,count:rows.length};}return {count:rows.length,amounts,complete:rows.filter(r=>fundingSummary(r.review,r.source).complete).length};};
 const groups=new Map();for(const row of selected){const label=String(groupBy==='proposal'?row.source.pi:groupBy==='school'?row.source.area:row.source.department).replace(/\s+/g,' ').trim()||'Not specified',key=groupBy==='proposal'?row.id:label;if(!groups.has(key))groups.set(key,{key,label,records:[]});groups.get(key).records.push(row);}
 return {scope,groupBy,selected:selected.length,excluded:records.length-selected.length,rows:[...groups.values()].map(g=>({key:g.key,label:g.label,...aggregate(g.records),proposalIds:g.records.map(r=>r.id)})).sort((a,b)=>a.label.localeCompare(b.label)),total:aggregate(selected)};
}
