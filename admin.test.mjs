import test from 'node:test';
import assert from 'node:assert/strict';
import policy from './src/policy.cjs';
import access from './src/access.cjs';
import {createAdminHandler} from './src/admin-api.mjs';
import {eventFrom,responseFrom} from './src/http.mjs';
function memoryStore(){
  let value=null, etag=0;
  return {
    async getWithMetadata(){return value?{data:structuredClone(value),etag:String(etag)}:null;},
    async setJSON(key,data,conditions={}){
      if((conditions.onlyIfNew && value) || (conditions.onlyIfMatch && conditions.onlyIfMatch!==String(etag)))return {modified:false};
      value=structuredClone(data);etag++;return {modified:true,etag:String(etag)};
    }
  };
}
test('permission audit records the prior role when access changes or is removed',async()=>{
 const store=memoryStore();let current=await policy.loadPolicy(store);
 for(const role of ['read','write']){const changed=await policy.changePolicy('oconaill','add','teststaff',current.etag,store,{scope:'aeroastro',role});assert.equal(changed.status,200);current=await policy.loadPolicy(store);}
 assert.equal(current.data.audit.at(-1).previous_role,'read');assert.equal(current.data.audit.at(-1).role,'write');
 const removed=await policy.changePolicy('oconaill','remove','teststaff',current.etag,store,{scope:'aeroastro'});assert.equal(removed.status,200);
 current=await policy.loadPolicy(store);assert.equal(current.data.audit.at(-1).previous_role,'write');assert.equal(current.data.audit.at(-1).action,'remove');
});
test('initial users persist; administrator removal is refused',async()=>{
  const store=memoryStore();
  let entry=await policy.loadPolicy(store);
  assert.deepEqual(entry.data.users,[...policy.INITIAL_USERS].sort());
  assert.equal((await policy.changePolicy('hammond','add','newperson',entry.etag,store)).status,403);
  assert.equal((await policy.changePolicy('oconaill','remove','oconaill',entry.etag,store)).status,400);
  assert.equal((await policy.changePolicy('oconaill','add','bad@example.org',entry.etag,store)).status,400);
  assert.equal((await policy.changePolicy('juliekuk','add','newperson',entry.etag,store)).status,200);
  assert.ok((await policy.loadPolicy(store)).data.users.includes('newperson'));
  assert.equal((await policy.changePolicy('oconaill','remove','hammond',entry.etag,store)).status,409);
});
test('removal blocks an existing signed-in session on its next request',async()=>{
  const store=memoryStore();
  const start=await policy.loadPolicy(store);
  await policy.changePolicy('oconaill','add','hammond',start.etag,store);
  const options={loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({sub:'test',kerberos:'hammond'}),load:()=>policy.loadPolicy(store)};
  assert.ok((await access.authorize({},options)).user);
  const entry=await policy.loadPolicy(store);
  assert.equal((await policy.changePolicy('juliekuk','remove','hammond',entry.etag,store)).status,200);
  assert.equal((await access.authorize({},options)).statusCode,403);
  const state=await policy.loadPolicy(store);
  assert.equal(state.data.audit.at(-1).actor,'juliekuk');
  assert.equal(state.data.audit.at(-1).action,'remove');
});
test('storage failure never grants access',async()=>{
  assert.equal((await access.authorize({}, {loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'oconaill'}),load:async()=>{throw Error('offline');}})).statusCode,503);
});
test('admin API rejects nonadmins, cross-origin posts, malformed input and lost writes',async()=>{
  const previous=process.env.APP_ORIGIN;process.env.APP_ORIGIN='https://example.test';
  try{
    const result={user:{kerberos:'oconaill'},kerberos:'oconaill',admin:true,policy:{data:{users:['oconaill'],audit:[]},etag:'1'}};
    let writes=0;
    const handler=createAdminHandler({authorize:async()=>result,change:async()=>{writes++;return {status:409,error:'Conflict'};}});
    const request=(origin,body={action:'add',username:'newperson',version:'1'})=>new Request('https://example.test/.netlify/functions/admin-access',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await handler(request('https://evil.test'))).status,403);
    assert.equal(writes,0);
    const denied=createAdminHandler({authorize:async()=>({...result,admin:false})});
    assert.equal((await denied(request('https://example.test'))).status,403);
    assert.equal((await handler(request('https://example.test',null))).status,400);
    assert.equal((await handler(request('https://example.test'))).status,409);
    assert.equal(writes,1);
  }finally{if(previous===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=previous;}
});
test('modern adapter preserves separate transaction/session cookies',()=>{
  const request=new Request('https://example.test/?state=abc',{headers:{Cookie:'test=value'}});
  assert.equal(eventFrom(request).queryStringParameters.state,'abc');
  const response=responseFrom({statusCode:302,headers:{Location:'/'},multiValueHeaders:{'Set-Cookie':['one=x; Path=/','two=y; Path=/']}});
  assert.equal(response.headers.getSetCookie().length,2);
});
