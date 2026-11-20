import test from 'node:test';import assert from 'node:assert/strict';
import {proposalLinks,invitationDraft,emailDraftUrl,deadlineText} from './public/rct-invitations.mjs';
import {createRctHandler} from './src/rct-review.mjs';
const record={id:'FY27-RCT2|example',source:{pi:'Example PI',title:'Fictional research continuity'},review:{finalVersion:null}};
test('RCT invitations distinguish the Dean, retain the proposal link and use Eastern deadlines',()=>{
 const normal=invitationDraft(record,{name:'Example reviewer'},'https://example.test');
 assert.match(normal.body,/Dean Hammond would appreciate/);assert.match(normal.body,/Monday, November 23, 2026 at 5pm Eastern/);assert.match(normal.body,/1 = highest priority and 5 = lowest priority/);assert.match(normal.body,/\?proposal=FY27-RCT2%7Cexample/);
 assert.match(invitationDraft(record,{name:'Paula',dean:true},'https://example.test').body,/We would appreciate/);
 assert.equal(deadlineText('2026-11-24T09:30'),'Tuesday, November 24, 2026 at 9:30am Eastern');assert.throws(()=>deadlineText('2026-02-30T17:00'));
});
test('RCT PDF links follow the saved final version without changing original proposal access',()=>{
 assert.equal(proposalLinks(record,'https://example.test').pdf,'https://example.test/soe-hq/rct-review/proposal?id=FY27-RCT2%7Cexample');
 const revision={...record,review:{finalVersion:'00000000-0000-4000-8000-000000000001'}};
 assert.match(proposalLinks(revision,'https://example.test').pdf,/\/file\?id=.*&version=00000000/);assert.equal(proposalLinks(revision,'https://example.test').uploaded,true);
 assert.equal(proposalLinks({...record,review:{finalVersion:'original'}},'https://example.test').uploaded,false);
});
test('RCT email drafts encode editable text and reject extra recipients or injected headers',()=>{
 const url=new URL(emailDraftUrl('reviewer@example.test','Example & subject','Body\nWith another line'));
 assert.equal(url.searchParams.get('subject'),'Example & subject');assert.equal(url.searchParams.get('body'),'Body\nWith another line');assert.equal(url.searchParams.get('cc'),'soe-research@mit.edu,kimcs@mit.edu');
 for(const email of ['bad','a@example.test,b@example.test','a@example.test?bcc=x@example.test','a@example.test\r\nBcc:x@example.test'])assert.throws(()=>emailDraftUrl(email,'Subject','Body'));
});
test('RCT proposal invitation links survive MIT sign-in without allowing foreign redirects',async()=>{
 const handler=createRctHandler({authorize:async()=>({statusCode:401})});
 for(const proposal of ['FY27-RCT2|example','https://outside.example/','FY27-RCT2|example&next=outside']){
  const response=await handler({path:'/soe-hq/rct-review',httpMethod:'GET',queryStringParameters:{proposal}});
  assert.equal(response.statusCode,302);const location=new URL(response.headers.Location,'https://example.test');
  assert.equal(location.searchParams.get('returnTo'),'/soe-hq/rct-review'+(proposal==='FY27-RCT2|example'?'?proposal=FY27-RCT2%7Cexample':''));
 }
});
