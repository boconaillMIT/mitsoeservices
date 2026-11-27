import test from 'node:test';import assert from 'node:assert/strict';
import {responseFrom} from './src/http.mjs';import access from './src/access.cjs';import security from './src/security-headers.cjs';
test('Dynamic HTML, JSON, errors and redirects receive browser security headers without changing cookies or content',()=>{
 for(const status of [200,302,400,401,403,503]){const r=responseFrom({statusCode:status,body:'example',headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',...status===302?{Location:'/sign-in'}:{}},multiValueHeaders:{'Set-Cookie':['a=1; HttpOnly','b=2; Secure']}});for(const [name,value]of Object.entries(security.SECURITY_HEADERS))assert.equal(r.headers.get(name),value);assert.equal(r.status,status);assert.match(r.headers.get('set-cookie'),/a=1/);assert.match(r.headers.get('set-cookie'),/b=2/);assert.equal(r.headers.get('cache-control'),'private, no-store');}
 assert.equal(access.noStore['X-Frame-Options'],'DENY');assert.match(access.noStore['Content-Security-Policy'],/object-src 'none'/);assert.doesNotMatch(security.SECURITY_HEADERS['Content-Security-Policy'],/unsafe-inline|unsafe-eval/);
});
