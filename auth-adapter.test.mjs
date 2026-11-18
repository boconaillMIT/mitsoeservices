import test from 'node:test';
import assert from 'node:assert/strict';
import {handler as login} from './netlify/functions/auth-login.mjs';
import {handler as callback} from './netlify/functions/auth-callback.mjs';
import {handler as logout} from './netlify/functions/auth-logout.mjs';
import {handler as session} from './netlify/functions/auth-session.mjs';
test('deployed authentication adapters preserve native multi-value cookie responses',async()=>{
 const names=['APP_ORIGIN','OKTA_ISSUER','OKTA_CLIENT_ID','SESSION_SECRET'];const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{APP_ORIGIN:'https://example.test',OKTA_ISSUER:'https://issuer.test',OKTA_CLIENT_ID:'test-client',SESSION_SECRET:'s'.repeat(64)});
 try{
  const r=await login({httpMethod:'GET',headers:{},queryStringParameters:{}});
  assert.equal(r.statusCode,302);assert.equal(r.multiValueHeaders['Set-Cookie'].length,1);
  assert.match(r.multiValueHeaders['Set-Cookie'][0],/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal((await session({httpMethod:'GET',headers:{}})).statusCode,401);
  const failed=await callback({httpMethod:'GET',headers:{},queryStringParameters:{}});
  assert.equal(failed.statusCode,400);assert.match(failed.multiValueHeaders['Set-Cookie'][0],/Max-Age=0/);
  const out=await logout({httpMethod:'POST',headers:{origin:'https://example.test'}});
  assert.equal(out.statusCode,200);assert.equal(out.multiValueHeaders['Set-Cookie'].length,2);
  assert.ok(out.multiValueHeaders['Set-Cookie'].every(c=>c.includes('Max-Age=0')));
 }finally{for(const k of names)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
});
