import test from 'node:test';
import assert from 'node:assert/strict';
import {validSubmission,latestSubmission,submissionHtml,submissionLineHtml} from './public/budget-submission.mjs';
import {loadSubmissionOutlooks} from './src/budget-submissions.mjs';
import {createUnitDataHandler} from './src/unit-data.mjs';
const example=(extra={})=>({schema:1,unit:'cee',year:2028,date:'2026-11-20',document:'Example revised memo.docx',sha:'a'.repeat(64),summary:'Fictional planning figures, separate from account balances.',facts:[{label:'Example request',amount:900}],funds:[{label:'Example restricted fund',years:[{year:2026,projected:false,income:50,expense:40,balance:100},{year:2027,projected:true,income:50,expense:60,balance:90},{year:2028,projected:true,income:50,expense:55,balance:85}]}],lineNote:'Example revised request rationale.',...extra});
test('latest submission is unit and year specific, and keeps dated source history',()=>{
 const original=example(),revised=example({date:'2026-11-22',sha:'b'.repeat(64)}),rows=[{source:{submissions:[original,revised]}}];
 assert.equal(latestSubmission(rows,'cee',2028).sha,revised.sha);assert.equal(latestSubmission(rows,'meche',2028),null);assert.equal(latestSubmission(rows,'cee',2027),null);assert.equal(rows[0].source.submissions.length,2);
});
test('forecast output is escaped, separates projections from wallets, and never accepts invalid amounts',()=>{
 const value=example({document:'Example <script>.docx',lineNote:'<img src=x onerror=alert(1)>'});assert(validSubmission(value));
 const html=submissionHtml(value);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/not added to wallet totals/);assert.match(html,/Reported historical/);assert.match(html,/Projected/);
 assert.match(submissionLineHtml({submissions:[value]}),/&lt;img/);assert.equal(submissionHtml(example({facts:[{label:'Bad',amount:NaN}]})),'');
 const compact=submissionHtml(value,{compact:true});assert.doesNotMatch(compact,/>2026</);assert.match(compact,/>2028</);
});
test('source loader rejects a submission assigned to a different department row',async()=>{
 const selected=[{id:1,label:'Department'},{id:2,label:'Budget Fiscal Year'},{id:3,label:'Workbook Source JSON'}];
 const load=async()=>({selected,raw:[{'1':{value:'Mechanical Engineering'},'2':{value:'FY28'},'3':{value:JSON.stringify({schema:1,sources:[],submissions:[example()]})}}]});
 assert.deepEqual(await loadSubmissionOutlooks({load}),{});
 const own=async()=>({selected,raw:[{'1':{value:'Civil & Environmental Engineering'},'2':{value:'FY28'},'3':{value:JSON.stringify({schema:1,sources:[],submissions:[example()]})}}]});
 assert.equal((await loadSubmissionOutlooks({load:own})).cee.document,'Example revised memo.docx');
});
test('forecast API authorizes before loading, returns only requested unit and never writes',async()=>{
 let reads=0;const submissions=async()=>{reads++;return {cee:example(),meche:example({unit:'meche'})};};
 let endpoint=createUnitDataHandler({authorize:async()=>({statusCode:403,body:'Denied'}),submissions});
 assert.equal((await endpoint({httpMethod:'GET',queryStringParameters:{unit:'cee',action:'submission'}})).statusCode,403);assert.equal(reads,0);
 endpoint=createUnitDataHandler({authorize:async()=>({user:{},role:'read'}),submissions});
 const response=await endpoint({httpMethod:'GET',queryStringParameters:{unit:'cee',action:'submission'}}),data=JSON.parse(response.body);
 assert.equal(data.submission.unit,'cee');assert.doesNotMatch(response.body,/"unit":"meche"/);assert.equal((await endpoint({httpMethod:'POST',queryStringParameters:{unit:'cee',action:'submission'}})).statusCode,405);
});
