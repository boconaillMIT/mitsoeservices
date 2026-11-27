const { randomBytes, createHash } = require('node:crypto');
const {SECURITY_HEADERS}=require('./security-headers.cjs');

const BASE = '/.netlify/functions/';
const random = () => randomBytes(32).toString('base64url');
const json = (statusCode, data) => ({
  statusCode,
  headers: { ...SECURITY_HEADERS,'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  body: JSON.stringify(data)
});

function config(env) {
  const origin = new URL(env.APP_ORIGIN);
  if (origin.origin !== env.APP_ORIGIN ||
      !(origin.protocol === 'https:' || (origin.protocol === 'http:' && origin.hostname === 'localhost'))) {
    throw new Error('APP_ORIGIN must be an HTTPS origin (HTTP localhost is allowed for development)');
  }
  const issuer = new URL(env.OKTA_ISSUER);
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('OKTA_ISSUER must be an HTTPS issuer URL');
  }
  if (!env.OKTA_CLIENT_ID || env.OKTA_CLIENT_ID.startsWith('replace-') ||
      !env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || env.SESSION_SECRET.startsWith('replace-')) {
    throw new Error('Set OKTA_CLIENT_ID and a random SESSION_SECRET of at least 32 characters');
  }
  return {
    origin: origin.origin, issuer: env.OKTA_ISSUER.replace(/\/$/, ''),
    clientId: env.OKTA_CLIENT_ID, clientSecret: env.OKTA_CLIENT_SECRET,
    key: createHash('sha256').update(env.SESSION_SECRET).digest(),
    secure: origin.protocol === 'https:',
    redirectUri: `${origin.origin}${BASE}auth-callback`
  };
}

function safeReturnTo(value, origin) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 1500) return '/';
  const url = new URL(value, origin);
  if (url.origin !== origin || url.pathname.startsWith(BASE)) return '/';
  return url.pathname + url.search + url.hash;
}

function header(event, name) {
  const entry = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function cookieName(c, kind) { return `${c.secure ? '__Host-' : ''}mit_sso_${kind}`; }
function getCookie(event, c, kind) {
  const name = cookieName(c, kind) + '=';
  return (header(event, 'cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name))?.slice(name.length);
}
function cookie(c, kind, value, maxAge) {
  return `${cookieName(c, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${c.secure ? '; Secure' : ''}`;
}

function createAuth({ env = process.env, fetchImpl = globalThis.fetch, jwks, now = () => Math.floor(Date.now() / 1000) } = {}) {
  let remoteKeys;
  async function seal(c, kind, payload, ttl) {
    const { EncryptJWT } = await import('jose');
    return new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuer(c.origin).setAudience(`mit-sso:${kind}`).setIssuedAt(now()).setExpirationTime(now() + ttl).encrypt(c.key);
  }
  async function open(event, c, kind) {
    const { jwtDecrypt } = await import('jose');
    const value = getCookie(event, c, kind);
    if (!value) throw new Error('Missing cookie');
    return (await jwtDecrypt(value, c.key, {
      issuer: c.origin, audience: `mit-sso:${kind}`, currentDate: new Date(now() * 1000),
      keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['exp', 'iat']
    })).payload;
  }
  async function readSession(event) {
    const c = config(env);
    try { return (await open(event, c, 'session')).user; } catch { return null; }
  }
  async function login(event, c) {
    if (event.httpMethod !== 'GET') return json(405, { error: 'GET required' });
    const verifier = random();
    const transaction = {
      state: random(), nonce: random(), verifier,
      returnTo: safeReturnTo(event.queryStringParameters?.returnTo, c.origin)
    };
    const params = new URLSearchParams({
      client_id: c.clientId, response_type: 'code', scope: 'openid profile email',
      redirect_uri: c.redirectUri, state: transaction.state, nonce: transaction.nonce,
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url')
    });
    const response = json(302, {});
    response.headers.Location = `${c.issuer}/v1/authorize?${params}`;
    response.multiValueHeaders = { 'Set-Cookie': [cookie(c, 'transaction', await seal(c, 'transaction', transaction, 600), 600)] };
    return response;
  }
  async function callback(event, c) {
    if (event.httpMethod !== 'GET') return json(405, { error: 'GET required' });
    const clearTransaction = cookie(c, 'transaction', '', 0);
    try {
      const transaction = await open(event, c, 'transaction');
      const params = event.queryStringParameters || {};
      if (!params.state || params.state !== transaction.state || params.error || !params.code) {
        throw new Error('Invalid callback');
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code: params.code, redirect_uri: c.redirectUri,
        code_verifier: transaction.verifier
      });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (c.clientSecret) {
        // OAuth client_secret_basic uses form-encoded client credentials.
        const encode = value => new URLSearchParams({ x: value }).toString().slice(2);
        headers.Authorization = 'Basic ' + Buffer.from(`${encode(c.clientId)}:${encode(c.clientSecret)}`).toString('base64');
      } else body.set('client_id', c.clientId);
      const tokenResponse = await fetchImpl(`${c.issuer}/v1/token`, {
        method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(10000), redirect: 'error'
      });
      if (!tokenResponse.ok) throw new Error('Token exchange rejected');
      const tokens = await tokenResponse.json();
      const { jwtVerify, createRemoteJWKSet } = await import('jose');
      remoteKeys ||= jwks || createRemoteJWKSet(new URL(`${c.issuer}/v1/keys`));
      const { payload } = await jwtVerify(tokens.id_token, remoteKeys, {
        algorithms: ['RS256'], issuer: c.issuer, audience: c.clientId,
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'], currentDate: new Date(now() * 1000)
      });
      if (payload.nonce !== transaction.nonce ||
          (payload.azp !== undefined && payload.azp !== c.clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== c.clientId)) {
        throw new Error('Invalid ID token binding');
      }
      const string = value => typeof value === 'string' ? value.slice(0, 256) : '';
      const user = {
        sub: payload.sub, name: string(payload.name) || [string(payload.given_name), string(payload.family_name)].filter(Boolean).join(' '),
        firstName: string(payload.given_name), lastName: string(payload.family_name), email: string(payload.email),
        kerberos: string(payload.preferred_username).replace(/@mit\.edu$/i, ''),
        department: string(payload.department), title: string(payload.title), loginTime: new Date(now() * 1000).toISOString()
      };
      const ttl = Math.min(8 * 3600, payload.exp - now());
      if (ttl <= 0) throw new Error('Expired ID token');
      const sessionCookie = cookie(c, 'session', await seal(c, 'session', { user }, ttl), ttl);
      if (Buffer.byteLength(sessionCookie) > 4000) throw new Error('Profile too large');
      const response = json(302, {});
      response.headers.Location = safeReturnTo(transaction.returnTo, c.origin);
      response.multiValueHeaders = { 'Set-Cookie': [clearTransaction, sessionCookie] };
      return response;
    } catch {
      const response = json(400, { error: 'Sign-in could not be completed. Please start a new login.' });
      response.multiValueHeaders = { 'Set-Cookie': [clearTransaction] };
      return response;
    }
  }
  async function handle(action, event) {
    try {
      const c = config(env);
      if (action === 'login') return await login(event, c);
      if (action === 'callback') return await callback(event, c);
      if (action === 'session') {
        if (event.httpMethod !== 'GET') return json(405, { error: 'GET required' });
        const user = await readSession(event);
        return user ? json(200, { user }) : json(401, { user: null });
      }
      if (action === 'logout') {
        if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
        if (header(event, 'origin') !== c.origin) return json(403, { error: 'Origin rejected' });
        const response = json(200, { user: null });
        response.multiValueHeaders = { 'Set-Cookie': [cookie(c, 'session', '', 0), cookie(c, 'transaction', '', 0)] };
        return response;
      }
      return json(404, { error: 'Unknown auth route' });
    } catch {
      return json(500, { error: 'Authentication service is not configured correctly.' });
    }
  }
  return { handle, readSession };
}

module.exports = { createAuth, safeReturnTo };
