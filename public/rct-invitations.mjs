const ROOT='/soe-hq/rct-review';
export const DEFAULT_DEADLINE='2026-11-23T17:00';
export function invitationSubject(subject,deadline=DEFAULT_DEADLINE){
 deadlineText(deadline);const [date,time]=deadline.split('T'),[year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number),stamp=new Date(Date.UTC(year,month-1,day)),weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(stamp),monthName=new Intl.DateTimeFormat('en-US',{month:'short',timeZone:'UTC'}).format(stamp),ordinal=day%100>=11&&day%100<=13?'th':({1:'st',2:'nd',3:'rd'}[day%10]||'th'),clock=(hour%12||12)+(minute?':'+String(minute).padStart(2,'0'):'')+(hour>=12?'pm':'am');
 return String(subject).replace(/\s*\(due [^)]*\)\s*$/i,'').trim()+' (due '+clock+' '+weekday+' '+monthName+' '+day+ordinal+')';
}
export function proposalLinks(record,origin){
 const root=new URL(ROOT,origin),id=encodeURIComponent(record.id),final=record.review.finalVersion;
 return {website:root.href+'?proposal='+id,pdf:root.href+(final&&final!=='original'?'/file?id='+id+'&version='+encodeURIComponent(final):'/proposal?id='+id),final:!!final,uploaded:!!final&&final!=='original'};
}
export function deadlineText(value){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('Choose a deadline date and time.');
 const [date,time]=value.split('T'),[year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number),stamp=new Date(Date.UTC(year,month-1,day));
 if(stamp.getUTCFullYear()!==year||stamp.getUTCMonth()!==month-1||stamp.getUTCDate()!==day||hour>23||minute>59)throw Error('Choose a valid deadline.');
 return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(stamp)+' at '+(hour%12||12)+(minute?':'+String(minute).padStart(2,'0'):'')+(hour>=12?'pm':'am')+' Eastern';
}
export function invitationDraft(record,{name,dean=false,deadline=DEFAULT_DEADLINE},origin){
 const links=proposalLinks(record,origin),due=deadlineText(deadline),greeting=String(name||'').trim()||(dean?'Paula':'Reviewer');
 const opening=dean?'We would appreciate your review of':'Dean Hammond would appreciate your review of';
 return {subject:'RCT Round 2 — review requested for '+record.source.pi,body:`Dear ${greeting},

${opening} ${record.source.pi}’s RCT Round 2 proposal, “${record.source.title}.”

Open the RCT review website:
${links.website}

Open the ${links.final?'final ':''}proposal PDF directly:
${links.pdf}

On the website, the proposal will be selected for you. Find “Reviewer need priority rankings & comments” and record your ranking and any comments in your reviewer slot. The scale is 1 = highest priority and 5 = lowest priority.

The “Funding contributions” section appears below the reviewer rankings. It shows the proposed funding split and any amounts entered for School, department and PI contributions. These are planning figures, rather than confirmed commitments.

Please complete your review by ${due}. If you have trouble accessing the website or proposal, please let me know. The website requires MIT sign-in and website-specific access; original Dropbox files have separate permissions.

Many thanks,
Brían`};
}
export function emailDraftUrl(email,subject,body){
 if(!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(email))throw Error('Enter one valid reviewer email address.');
 return 'mailto:'+encodeURIComponent(email)+'?cc='+encodeURIComponent('soe-research@mit.edu,kimcs@mit.edu')+'&subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
}
