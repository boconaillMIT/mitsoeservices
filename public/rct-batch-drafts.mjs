import {invitationDraft,proposalLinks,deadlineText,DEFAULT_DEADLINE,emailDraftUrl} from './rct-invitations.mjs';
import {REVIEWER_DIRECTORY} from './rct-reviewers.mjs';
export const INVITATION_CC=['soe-research@mit.edu','kimcs@mit.edu'];
export const REVIEWER_INVITATION_SUBJECT='RCT Round 2 — proposals ready for your review';
export const REVIEWER_INVITATION_TEMPLATE=`Dear {{REVIEWER}},

{{REQUEST}} the following Research Continuity and Transition (RCT) Round 2 proposals, which are ready for your review.

My review — your assigned proposals and progress:
{{MYREVIEW}}

Proposals for your review:
{{PROPOSALS}}

On your review page, enter your need priority ranking and comments for each proposal. The scale is 1 = highest priority and 5 = lowest priority. A check mark identifies proposals where you have saved a priority score.

The “Funding contributions” section appears below the reviewer rankings in each proposal’s full review. It shows the proposed funding split and any amounts entered for School, department and PI contributions. These are planning figures, rather than confirmed commitments.

Please complete your review by {{DEADLINE}}. If you have trouble accessing the website or proposals, please let me know. The website requires MIT sign-in and website-specific access; original Dropbox files have separate permissions.

Many thanks,
Brían`;
export function buildReviewerInvitations(records,{deadline,template=REVIEWER_INVITATION_TEMPLATE,subject=REVIEWER_INVITATION_SUBJECT,reviewers=REVIEWER_DIRECTORY.map(p=>p.key)},origin){
 if(typeof template!=='string'||!template.trim()||template.length>12000||typeof subject!=='string'||!subject.trim()||subject.length>300||/[\r\n]/.test(subject)||!Array.isArray(reviewers)||reviewers.some(key=>!REVIEWER_DIRECTORY.some(p=>p.key===key)))throw Error('Enter valid reviewer invitation settings.');
 return REVIEWER_DIRECTORY.filter(p=>reviewers.includes(p.key)).flatMap(person=>{const assigned=records.filter(r=>(r.review.assignments||[]).includes(person.key));if(!assigned.length)return [];const values={REVIEWER:person.name,REQUEST:person.key==='hammond'?'We would appreciate your review of':'Dean Hammond would appreciate your review of',MYREVIEW:new URL('/soe-hq/rct-review/my-review',origin).href,DEADLINE:deadlineText(deadline),PROPOSALS:assigned.map((r,i)=>{let pdf;try{const url=new URL(r.source.proposalUrl);if(url.protocol!=='https:'||url.hostname!=='www.dropbox.com')throw Error();pdf=url.href;}catch{pdf=proposalLinks(r,origin).pdf;}return (i+1)+'. '+r.source.pi+' — '+r.source.title+'\nProposal in Dropbox: '+pdf+'\nFull review and funding: '+proposalLinks(r,origin).website;}).join('\n\n')},render=text=>text.replace(/\{\{([A-Z]+)\}\}/g,(token,key)=>{if(!Object.hasOwn(values,key))throw Error('The email wording has changed. Refresh the invitation page and prepare the reviewer emails again.');return values[key];});return [{id:person.key,to:[{name:person.name,email:person.email}],cc:INVITATION_CC,subject:render(subject),body:render(template),proposalIds:assigned.map(r=>r.id)}];});
}
export function parseReviewers(value){
 const lines=String(value).split(/[\n;]+/).flatMap(line=>line.includes('<')?[line]:line.split(',')),seen=new Set(),result=[];
 for(const line of lines){const text=line.trim();if(!text)continue;const match=/^([^<>]+)\s*<([^<>]+)>$/.exec(text),email=(match?match[2]:text).trim(),name=(match?match[1]:'').trim();if(/[\x00-\x1f\x7f]/.test(name+email))throw Error('Reviewer names and addresses must stay on one line.');emailDraftUrl(email,'','');if(seen.has(email.toLowerCase()))continue;seen.add(email.toLowerCase());result.push({name,email});}
 if(!result.length||result.length>20)throw Error('Enter between 1 and 20 reviewer email addresses.');return result;
}
export function defaultBatchTemplate(origin){
 const sample={id:'template',source:{pi:'{{PI}}',title:'{{TITLE}}'},review:{finalVersion:null}},links=proposalLinks(sample,origin);
 return invitationDraft(sample,{name:'{{REVIEWERS}}'},origin).body.replace('Dean Hammond would appreciate your review of','{{REQUEST}}').replace(links.website,'{{WEBSITE}}').replace(links.pdf,'{{PDF}}').replace(deadlineText(DEFAULT_DEADLINE),'{{DEADLINE}}');
}
export function buildInvitationBatch(records,{reviewers,deadline,dean=false,template,subject='RCT Round 2 — review requested for {{PI}}'},origin){
 if(!records.length||records.length>50)throw Error('Select between 1 and 50 proposals.');if(typeof template!=='string'||!template.trim()||template.length>12000||typeof subject!=='string'||!subject.trim()||subject.length>300||/[\r\n]/.test(subject))throw Error('Enter a subject and message within the allowed lengths.');
 const people=parseReviewers(reviewers),names=people.every(p=>p.name)?people.map(p=>p.name):[],greeting=names.length>1?names.slice(0,-1).join(', ')+' and '+names.at(-1):names[0]||'reviewers';
 const isDean=dean||people.some(p=>/\bpaula\b.*\bhammond\b/i.test(p.name)),request=isDean?'We would appreciate your review of':'Dean Hammond would appreciate your review of';
 return records.map(record=>{const links=proposalLinks(record,origin),values={PI:record.source.pi,TITLE:record.source.title,WEBSITE:links.website,PDF:links.pdf,DEADLINE:deadlineText(deadline),REVIEWERS:greeting,REQUEST:request},render=s=>s.replace(/\{\{([A-Z]+)\}\}/g,(token,key)=>{if(!Object.hasOwn(values,key))throw Error('Unknown message placeholder: '+token);return values[key];});return {id:record.id,to:people,cc:INVITATION_CC,subject:render(subject),body:render(template)};});
}
const encoder=new TextEncoder();
const base64=text=>{const bytes=encoder.encode(text);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);};
const encodedHeader=text=>{const parts=[];let part='';for(const char of String(text)){if(encoder.encode(part+char).length>36){parts.push(part);part='';}part+=char;}if(part)parts.push(part);return parts.map(value=>'=?UTF-8?B?'+base64(value)+'?=').join('\r\n ');};
const address=p=>p.name?encodedHeader(p.name)+' <'+p.email+'>':p.email;
const wrappedBase64=text=>base64(text).match(/.{1,76}/g)?.join('\r\n')||'';
export function invitationEml(message){
 const boundary='rct_invitation_parts',plain=message.body.replace(/\r?\n/g,'\r\n');
 return ['From: '+encodedHeader('Brían')+' <oconaill@mit.edu>','To: '+message.to.map(address).join(', '),'Cc: '+message.cc.join(', '),'Subject: '+encodedHeader(message.subject),'X-Unsent: 1','MIME-Version: 1.0','Content-Type: multipart/alternative; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',wrappedBase64(plain),'--'+boundary,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',wrappedBase64('<html><body style="font-family:Arial,sans-serif;font-size:11pt;line-height:1.5">'+message.body.split(/\n\n/).map(p=>'<p>'+p.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/https:\/\/[^\s<]+/g,url=>'<a href="'+url+'">'+url+'</a>').replace(/\n/g,'<br>')+'</p>').join('')+'</body></html>'),'--'+boundary+'--',''].join('\r\n');
}
// Standard, uncompressed ZIP entries keep this small batch browser-only.
export function invitationZip(messages){
 const entries=messages.map((m,i)=>({name:encoder.encode(String(i+1).padStart(2,'0')+'-'+m.id.replace(/[^a-z0-9-]/gi,'-')+'.eml'),bytes:encoder.encode(invitationEml(m))})),parts=[],directory=[];let offset=0;
 const header=size=>new Uint8Array(size),set=(bytes,at,value,size)=>new DataView(bytes.buffer).setUint32(at,value,true),crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
 for(const entry of entries){const local=header(30),dv=new DataView(local.buffer),crc=crc32(entry.bytes);set(local,0,0x04034b50);dv.setUint16(4,20,true);set(local,14,crc);set(local,18,entry.bytes.length);set(local,22,entry.bytes.length);dv.setUint16(26,entry.name.length,true);parts.push(local,entry.name,entry.bytes);
  const central=header(46),cv=new DataView(central.buffer);set(central,0,0x02014b50);cv.setUint16(4,20,true);cv.setUint16(6,20,true);set(central,16,crc);set(central,20,entry.bytes.length);set(central,24,entry.bytes.length);cv.setUint16(28,entry.name.length,true);set(central,42,offset);directory.push(central,entry.name);offset+=local.length+entry.name.length+entry.bytes.length;
 }
 const length=directory.reduce((n,b)=>n+b.length,0),end=header(22),ev=new DataView(end.buffer);set(end,0,0x06054b50);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);set(end,12,length);set(end,16,offset);parts.push(...directory,end);const output=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output;
}
