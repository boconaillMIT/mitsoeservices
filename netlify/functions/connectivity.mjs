import net from 'node:net';
import access from '../../src/access.cjs';

export function probeTcp(host, port, timeoutMs = 5000) {
  return new Promise(resolve => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let complete = false;
    const finish = (reachable, reason) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolve({ reachable, reason, duration_ms: Date.now() - started });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, 'Connected'));
    socket.once('timeout', () => finish(false, 'Connection timed out'));
    socket.once('error', err => finish(false, err.code || 'Connection failed'));
  });
}

async function handler(request) {
  if (request.method !== 'GET') return new Response('Method not allowed', {status:405});
  const auth = await access.authorize({headers:Object.fromEntries(request.headers)});
  if (!auth.user) return new Response(auth.body, {status:auth.statusCode, headers:auth.headers});
  // Fixed destinations only. No caller-provided hosts, SQL, passwords, or tokens.
  const [warehouse, quickbase] = await Promise.all([
    probeTcp('warehouse.mit.edu', 1521), probeTcp('api.quickbase.com', 443)
  ]);
  return Response.json({
    checked_at: new Date().toISOString(),
    warehouse, quickbase,
    credentials_sent: false,
    scope: 'TCP reachability only; database authentication and encrypted Oracle connectivity are not tested.'
  }, {headers:{'Cache-Control':'private, no-store', 'Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
}

import policy from '../../src/policy.cjs';
export default (request,context)=>policy.withPolicyContext(context,()=>handler(request));
