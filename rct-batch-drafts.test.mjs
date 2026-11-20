import test from 'node:test';import assert from 'node:assert/strict';import {unzipSync,strFromU8} from 'fflate';
import {parseReviewers,defaultBatchTemplate,buildInvitationBatch,invitationEml,invitationZip} from './public/rct-batch-drafts.mjs';
const records=Array.from({length:11},(_,i)=>({id:'FY27-RCT2|example-'+i,source:{pi:'Example Faculty '+i,title:'Fictional proposal '+i},review:{finalVersion:null}}));
const options={reviewers:'Reviewer One <one@example.test>\nReviewer Two <two@example.test>\nReviewer Three <three@example.test>',deadline:'2026-11-23T17:00',template:defaultBatchTemplate('https://example.test')};
test('one draft per proposal includes all reviewers, fixed CCs and the correct individual links',()=>{
 const messages=buildInvitationBatch(records,options,'https://example.test');assert.equal(messages.length,11);
 for(const [i,m]of messages.entries()){assert.equal(m.to.length,3);assert.deepEqual(m.cc,['soe-research@mit.edu','kimcs@mit.edu']);assert.match(m.body,/Dean Hammond would appreciate/);assert(m.body.includes('Fictional proposal '+i));assert(m.body.includes('?proposal=FY27-RCT2%7Cexample-'+i));assert(m.body.includes('/proposal?id=FY27-RCT2%7Cexample-'+i));assert(!m.body.includes('{{'));assert.match(m.body,/website-specific access/);}
 assert.match(buildInvitationBatch(records,{...options,dean:true},'https://example.test')[0].body,/We would appreciate/);
});
test('batch recipients are deduplicated and unsafe addresses or message headers cannot be injected',()=>{
 assert.equal(parseReviewers('one@example.test, two@example.test\none@example.test').length,2);
 assert.throws(()=>parseReviewers('a@example.test?bcc=x@example.test'));assert.throws(()=>parseReviewers('Example\rBcc: fake <a@example.test>'));
 assert.throws(()=>buildInvitationBatch([],options,'https://example.test'));assert.throws(()=>buildInvitationBatch(records,{...options,subject:'Subject\r\nBcc: attacker@example.test'},'https://example.test'));
});
test('downloadable ZIP contains 11 unsent MIME drafts with three recipients and separate CC addresses',()=>{
 const messages=buildInvitationBatch(records,options,'https://example.test'),files=unzipSync(invitationZip(messages));assert.equal(Object.keys(files).length,11);
 for(const bytes of Object.values(files)){const eml=strFromU8(bytes);assert.match(eml,/X-Unsent: 1\r\n/);assert.match(eml,/Cc: soe-research@mit.edu, kimcs@mit.edu\r\n/);assert.match(eml,/<one@example.test>.*<two@example.test>.*<three@example.test>/);assert.match(eml,/multipart\/alternative/);}
 assert.equal(invitationEml(messages[0]).includes('Bcc:'),false);
});
