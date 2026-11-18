import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createReportHandler} from './src/report-page.mjs';

test('hosted report retains MIT sign-in and access checks', async () => {
  for (const status of [403,503]) {
    const response = await createReportHandler(async()=>({statusCode:status,body:'Denied'}))({httpMethod:'GET'});
    assert.equal(response.statusCode,status);
    assert.equal(response.body,'Denied');
  }
  const login = await createReportHandler(async()=>({statusCode:401}))({httpMethod:'GET'});
  assert.match(login.body,/returnTo=%2Freports/);
  assert.doesNotMatch(login.body,/id="accounts"/);
  const page = await createReportHandler(async()=>({user:{kerberos:'test'}}))({httpMethod:'GET'});
  assert.equal(page.statusCode,200);
  assert.match(page.body,/id="published-selection"/);
  assert.match(page.body,/Dean’s discretionary/);
  assert.equal((await createReportHandler()({httpMethod:'POST'})).statusCode,405);
});

test('local window rejects wrong origins, sources, nonces, and requests before consent', async () => {
  const source = await readFile('../sync_app/static/hosted_bridge.js','utf8');
  let listener; const sent=[]; const requests=[]; const buttons={};
  for (const id of ['#bridge-status','#connect','#disconnect']) buttons[id]={disabled:true,addEventListener(type,fn){this.click=fn;}};
  const opener={postMessage(data,origin){sent.push({data,origin});}};
  const sandbox={window:{opener,addEventListener(type,fn){listener=fn;}},
    document:{querySelector(selector){return selector.startsWith('meta')?{content:'local-csrf'}:buttons[selector];}},
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({safe:true})};}};
  vm.runInNewContext(source,sandbox);
  const nonce='a'.repeat(64);
  const send=async(data,origin='https://mitsoeservices.netlify.app',sender=opener)=>listener({origin,source:sender,data:{protocol:'soe-reports-v1',nonce,...data}});
  await send({type:'hello'},'https://evil.test'); assert.equal(sent.length,0);
  await send({type:'hello'},undefined,{}); assert.equal(sent.length,0);
  await send({type:'hello'}); assert.equal(sent[0].data.type,'waiting');
  await send({type:'request',id:'one',payload:{action:'run'}}); assert.equal(requests.length,0);
  buttons['#connect'].click(); assert.equal(sent.at(-1).data.type,'connected');
  await send({type:'request',nonce:'b'.repeat(64),id:'two',payload:{action:'run'}}); assert.equal(requests.length,0);
  await send({type:'request',id:'three',payload:{action:'update'}}); assert.equal(requests.length,0);
  await send({type:'request',id:'four',payload:{action:'options'}}); assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/hosted-report-api');
  assert.equal(requests[0].options.headers['X-CSRF-Token'],'local-csrf');
  assert.ok(sent.every(message=>message.origin==='https://mitsoeservices.netlify.app'));
  assert.ok(sent.every(message=>!JSON.stringify(message).includes('local-csrf')));
  buttons['#disconnect'].click();
  await send({type:'request',id:'five',payload:{action:'options'}}); assert.equal(requests.length,1);
});

test('Dean report deep link survives sign-in and opens its named view',async()=>{
 const event={httpMethod:'GET',queryStringParameters:{view:'deans'}};
 const login=await createReportHandler(async()=>({statusCode:401}))(event);
 assert.ok(login.body.includes('returnTo=%2Freports%3Fview%3Ddeans'));
 const page=await createReportHandler(async()=>({user:{kerberos:'test'}}))(event);
 assert.ok(page.body.includes('<h1>Dean’s discretionary accounts</h1>'));
});

test('all-account link survives sign-in without expanding unit-only access',async()=>{
 const event={httpMethod:'GET',queryStringParameters:{view:'all'}};
 const login=await createReportHandler(async()=>({statusCode:401}))(event);
 assert.ok(login.body.includes('returnTo=%2Freports%3Fview%3Dall'));
 const page=await createReportHandler(async()=>({user:{kerberos:'test'}}))(event);
 assert.ok(page.body.includes('<h1>All SoE-controlled accounts</h1>'));
 assert.ok(page.body.includes('value="all"'));
 assert.equal((await createReportHandler(async()=>({statusCode:403,body:'Denied'}))(event)).statusCode,403);
});
