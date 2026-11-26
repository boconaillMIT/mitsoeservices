import featureFlags from './src/features.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import access from './src/access.cjs';
import policy from './src/policy.cjs';
import {handler as dashboard} from './src/dashboard.mjs';
import connectivity from './netlify/functions/connectivity.mjs';

test('unauthenticated and misconfigured sessions cannot access services', async()=>{
  assert.equal((await access.authorize({}, {loadFeatures:async()=>({data:{features:{}}}),reader:async()=>null})).statusCode,401);
  assert.equal((await access.authorize({}, {loadFeatures:async()=>({data:{features:{}}}),reader:async()=>{throw Error('config');}})).statusCode,503);
});
test('only configured verified Kerberos principals are authorized',async()=>{
  const load=async()=>({data:{grants:[{username:'oconaill',scope:'school',role:'admin'},{username:'colleague',scope:'school',role:'read'}]},etag:'test'});
  assert.ok((await access.authorize({}, {load,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'oconaill'})})).user);
  assert.equal((await access.authorize({}, {load,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'other'})})).statusCode,403);
  assert.equal((await access.authorize({}, {load:async()=>({data:{grants:[]},etag:'test'}),loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({kerberos:'oconaill'})})).statusCode,403);
  assert.equal((await access.authorize({}, {load,loadFeatures:async()=>({data:{features:{}}}),reader:async()=>({email:'oconaill@mit.edu'})})).statusCode,403);
});
test('public files contain no dashboard and dashboard fails closed without configuration',async()=>{
  const html=await readFile(new URL('./public/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('Sign in with MIT'));
  assert.ok(!html.includes('Test connectivity'));
  assert.ok(!html.includes('Open installed worker'));
  const r=await dashboard({httpMethod:'GET',headers:{}});
  assert.equal(r.statusCode,503);
  assert.equal(r.headers['Cache-Control'],'private, no-store');
});
test('connectivity rejects anonymous clients without probing networks',async()=>{
  const r=await connectivity(new Request('https://example.test/.netlify/functions/connectivity'));
  assert.equal(r.status,503);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});

test('real encrypted sessions gate dashboard content for allowed users',async()=>{
  const previous={...process.env};
  const oldLoad=policy.loadPolicy,oldFlags=featureFlags.loadFlags;featureFlags.loadFlags=async()=>({data:featureFlags.defaults()});
  policy.loadPolicy=async()=>({data:policy.initialPolicy(),etag:'test'});
  Object.assign(process.env,{APP_ORIGIN:'https://example.test',OKTA_ISSUER:'https://issuer.test/oauth2/default',OKTA_CLIENT_ID:'test-client',SESSION_SECRET:'s'.repeat(64),MIT_ALLOWED_USERS:'oconaill'});
  try {
    const anonymous=await dashboard({httpMethod:'GET',headers:{}});
    assert.equal(anonymous.statusCode,200);
    assert.ok(anonymous.body.includes('Sign in with MIT'));
    assert.ok(!anonymous.body.includes('Test connectivity'));
    const {EncryptJWT}=await import('jose');
    const {createHash}=await import('node:crypto');
    const token=await new EncryptJWT({user:{sub:'test-subject',kerberos:'oconaill'}})
      .setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuer('https://example.test')
      .setAudience('mit-sso:session').setIssuedAt().setExpirationTime('5m')
      .encrypt(createHash('sha256').update(process.env.SESSION_SECRET).digest());
    const signedIn=await dashboard({httpMethod:'GET',headers:{cookie:'__Host-mit_sso_session='+token}});
    assert.equal(signedIn.statusCode,200);
    assert.ok(signedIn.body.includes('SoE HQ'));
    assert.equal(signedIn.headers['Cache-Control'],'private, no-store');
    policy.loadPolicy=async()=>({data:{grants:[{username:'someoneelse',scope:'school',role:'read'}],audit:[]},etag:'test'});
    const denied=await dashboard({httpMethod:'GET',headers:{cookie:'__Host-mit_sso_session='+token}});
    assert.equal(denied.statusCode,200);
    assert(denied.body.includes('/donation-requests'));
    assert(!denied.body.includes('href="/soe-hq"'));
    assert(!denied.body.includes('href="/units/'));
    assert(!denied.body.includes('href="/soe-hq/rct-review"'));
  } finally {
    policy.loadPolicy=oldLoad;featureFlags.loadFlags=oldFlags;
    for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key];
    Object.assign(process.env,previous);
  }
});
