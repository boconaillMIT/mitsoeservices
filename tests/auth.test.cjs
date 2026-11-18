const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createAuth, safeReturnTo } = require('../src/mit-sso.cjs');
const env = {
  APP_ORIGIN: 'https://example.test', OKTA_ISSUER: 'https://issuer.test/oauth2/default',
  OKTA_CLIENT_ID: 'test-client', SESSION_SECRET: 'a'.repeat(64)
};
const fixedNow = 1800000000;
const event = (method = 'GET', query = {}, cookie = '', headers = {}) => ({
  httpMethod: method, queryStringParameters: query, headers: { cookie, ...headers }
});
const cookies = response => response.multiValueHeaders['Set-Cookie'];
const pair = value => value.split(';')[0];
async function fixture(overrides = {}, customEnv = {}) {
  const jose = await import('jose');
  const keys = await jose.generateKeyPair('RS256');
  const jwk = await jose.exportJWK(keys.publicKey);
  const activeEnv = { ...env, ...customEnv };
  let captured;
  let token;
  const auth = createAuth({
    env: activeEnv, now: () => fixedNow,
    jwks: jose.createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] }),
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ id_token: token }) };
    }
  });
  const login = await auth.handle('login', event('GET', { returnTo: '/projects?tab=one' }));
  const transactionCookie = pair(cookies(login)[0]);
  const key = createHash('sha256').update(activeEnv.SESSION_SECRET).digest();
  const { payload: transaction } = await jose.jwtDecrypt(transactionCookie.slice(transactionCookie.indexOf('=') + 1), key,
    { currentDate: new Date(fixedNow * 1000) });
  const claims = {
    sub: 'user-123', email: 'person@mit.edu', preferred_username: 'person@mit.edu',
    given_name: 'Test', family_name: 'Person', nonce: transaction.nonce, ...overrides
  };
  token = await new jose.SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(activeEnv.OKTA_ISSUER).setAudience(activeEnv.OKTA_CLIENT_ID)
    .setIssuedAt(fixedNow).setExpirationTime(fixedNow + 3600).sign(keys.privateKey);
  return { auth, login, transactionCookie, transaction, captured: () => captured,
    callback: (query = {}) => auth.handle('callback', event('GET', { code: 'one-time-code', state: transaction.state, ...query }, transactionCookie)) };
}

test('PKCE login, verified callback, encrypted session, and logout', async () => {
  const f = await fixture();
  assert.equal(f.login.statusCode, 302);
  const url = new URL(f.login.headers.Location);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(f.transaction.verifier).digest('base64url'));
  assert.equal(url.searchParams.get('nonce'), f.transaction.nonce);
  assert.match(cookies(f.login)[0], /__Host-mit_sso_transaction=.*HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  const callback = await f.callback();
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.Location, '/projects?tab=one');
  const sessionCookie = cookies(callback)[1];
  assert.match(sessionCookie, /Max-Age=3600; Secure/);
  assert.ok(!sessionCookie.includes('person@mit.edu'));
  const response = await f.auth.handle('session', event('GET', {}, pair(sessionCookie)));
  assert.equal(response.statusCode, 200);
  const user = JSON.parse(response.body).user;
  assert.equal(user.kerberos, 'person');
  assert.equal(user.name, 'Test Person');
  assert.equal(user.sub, 'user-123');
  assert.equal(JSON.parse(response.body).id_token, undefined);
  const body = new URLSearchParams(f.captured().options.body);
  assert.equal(body.get('code_verifier'), f.transaction.verifier);
  assert.equal(body.get('client_id'), env.OKTA_CLIENT_ID);
  assert.equal(body.get('redirect_uri'), 'https://example.test/.netlify/functions/auth-callback');
  const logout = await f.auth.handle('logout', event('POST', {}, pair(sessionCookie), { Origin: env.APP_ORIGIN }));
  assert.equal(logout.statusCode, 200);
  assert.ok(cookies(logout).every(c => c.includes('Max-Age=0')));
});

test('missing session returns 401', async () => {
  assert.equal((await createAuth({ env }).handle('session', event())).statusCode, 401);
});
test('wrong state and provider errors never reach the token endpoint', async () => {
  for (const query of [{ state: 'wrong' }, { error: 'access_denied' }]) {
    const f = await fixture();
    const response = await f.callback(query);
    assert.equal(response.statusCode, 400);
    assert.equal(f.captured(), undefined);
    assert.match(cookies(response)[0], /Max-Age=0/);
  }
});
test('missing transaction is rejected', async () => {
  const f = await fixture();
  assert.equal((await f.auth.handle('callback', event('GET', { code: 'code', state: f.transaction.state }))).statusCode, 400);
});
test('nonce and authorized party are checked', async () => {
  for (const claims of [{ nonce: 'wrong' }, { azp: 'other-app' }]) {
    const f = await fixture(claims);
    assert.equal((await f.callback()).statusCode, 400);
  }
});
test('forged, expired, wrong-issuer and wrong-audience ID tokens are rejected', async () => {
  const jose = await import('jose');
  const trusted = await jose.generateKeyPair('RS256');
  const forged = await jose.generateKeyPair('RS256');
  const key = await jose.exportJWK(trusted.publicKey);
  for (const type of ['signature', 'expiry', 'issuer', 'audience']) {
    let token;
    const auth = createAuth({ env, now: () => fixedNow,
      jwks: jose.createLocalJWKSet({ keys: [{ ...key, kid: 'k' }] }),
      fetchImpl: async () => ({ ok: true, json: async () => ({ id_token: token }) }) });
    const login = await auth.handle('login', event());
    const url = new URL(login.headers.Location);
    token = await new jose.SignJWT({ sub: 'person', nonce: url.searchParams.get('nonce') })
      .setProtectedHeader({ alg: 'RS256', kid: 'k' }).setIssuedAt(fixedNow - 100)
      .setExpirationTime(type === 'expiry' ? fixedNow - 1 : fixedNow + 300)
      .setIssuer(type === 'issuer' ? 'https://evil.test' : env.OKTA_ISSUER)
      .setAudience(type === 'audience' ? 'other-app' : env.OKTA_CLIENT_ID)
      .sign(type === 'signature' ? forged.privateKey : trusted.privateKey);
    const response = await auth.handle('callback', event('GET', { state: url.searchParams.get('state'), code: 'code' }, pair(cookies(login)[0])));
    assert.equal(response.statusCode, 400, type);
  }
});
test('expired transaction and session are rejected', async () => {
  const f = await fixture();
  const later = createAuth({ env, now: () => fixedNow + 601 });
  assert.equal((await later.handle('callback', event('GET', { code: 'code', state: f.transaction.state }, f.transactionCookie))).statusCode, 400);
  const callback = await f.callback();
  const expired = createAuth({ env, now: () => fixedNow + 3601 });
  assert.equal((await expired.handle('session', event('GET', {}, pair(cookies(callback)[1])))).statusCode, 401);
});
test('modified session and transaction cookies cannot authenticate', async () => {
  const f = await fixture();
  const callback = await f.callback();
  const changed = pair(cookies(callback)[1]) + 'tampered';
  assert.equal((await f.auth.handle('session', event('GET', {}, changed))).statusCode, 401);
  assert.equal((await f.auth.handle('session', event('GET', {}, f.transactionCookie))).statusCode, 401);
});
test('logout requires POST and the same origin', async () => {
  const auth = createAuth({ env });
  assert.equal((await auth.handle('logout', event())).statusCode, 405);
  for (const origin of [undefined, 'https://evil.test']) {
    assert.equal((await auth.handle('logout', event('POST', {}, '', { origin }))).statusCode, 403);
  }
});
test('return URLs cannot leave the site or loop into auth endpoints', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/.netlify/functions/auth-login', undefined]) {
    assert.equal(safeReturnTo(value, env.APP_ORIGIN), '/');
  }
  assert.equal(safeReturnTo('/page?id=123#details', env.APP_ORIGIN), '/page?id=123#details');
});
test('confidential client credentials stay in the server token exchange', async () => {
  const f = await fixture({}, { OKTA_CLIENT_SECRET: 'server-secret' });
  assert.ok(!f.login.headers.Location.includes('server-secret'));
  assert.equal((await f.callback()).statusCode, 302);
  assert.equal(f.captured().options.headers.Authorization, 'Basic ' + Buffer.from('test-client:server-secret').toString('base64'));
});
test('upstream failures do not expose provider errors', async () => {
  const auth = createAuth({ env, now: () => fixedNow, fetchImpl: async () => { throw new Error('private-provider-detail'); } });
  const login = await auth.handle('login', event());
  const url = new URL(login.headers.Location);
  const response = await auth.handle('callback', event('GET', { code: 'code', state: url.searchParams.get('state') }, pair(cookies(login)[0])));
  assert.equal(response.statusCode, 400);
  assert.ok(!response.body.includes('private-provider-detail'));
});
test('incomplete configuration fails closed', async () => {
  assert.equal((await createAuth({ env: {} }).handle('login', event())).statusCode, 500);
});
