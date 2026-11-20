import {REVIEWER_DIRECTORY} from '../public/rct-reviewers.mjs';
import {buildInvitationBatch,invitationZip,invitationEml} from '../public/rct-batch-drafts.mjs';
import {dropboxLink} from './rct-dropbox.mjs';
function invitationMessages(records,payload,origin){
 if(!payload||Object.keys(payload).some(k=>!['rows','deadline','template','subject','format'].includes(k))||payload.format!==undefined&&!['zip','eml'].includes(payload.format)||!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>50||new Set(payload.rows.map(r=>r.id)).size!==payload.rows.length)throw Error('Select proposals and prepare the drafts again.');
 const messages=payload.rows.flatMap(ref=>{const row=records.find(r=>r.id===ref.id);if(!row||row.revision!==ref.revision)throw Error('A proposal changed. Reload the invitation page and prepare the drafts again.');const people=REVIEWER_DIRECTORY.filter(p=>row.review.assignments.includes(p.key));if(!people.length)throw Error('This proposal has no assigned reviewers. Prepare the drafts again.');
  const template=String(payload.template||'').replaceAll('{{DROPBOX}}',dropboxLink(row.source.proposalUrl,'.pdf').toString());
  return buildInvitationBatch([row],{reviewers:people.map(p=>p.name+' <'+p.email+'>').join('\n'),deadline:payload.deadline,template,subject:payload.subject,dean:people.some(p=>p.key==='hammond')},origin);
 });
 return messages;
}
export function invitationDownload(records,payload,origin){return invitationZip(invitationMessages(records,payload,origin));}
export function invitationAttachment(records,payload,origin){const messages=invitationMessages(records,payload,origin);if(payload.format==='eml'){if(messages.length!==1)throw Error('Select one proposal for an individual draft.');return {bytes:Buffer.from(invitationEml(messages[0]),'utf8'),type:'message/rfc822',filename:'RCT-'+messages[0].id.replace(/[^a-z0-9-]/gi,'-')+'.eml'};}return {bytes:invitationZip(messages),type:'application/zip',filename:'FY27_RCT_Reviewer_Invitations.zip'};}
