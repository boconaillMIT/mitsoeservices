import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import handler, {probeTcp} from './netlify/functions/connectivity.mjs';
test('rejects unexpected methods without making connections', async () => {
  const response = await handler(new Request('https://example.test',{method:'POST'}));
  assert.equal(response.status,405);
});
test('reports a reachable TCP listener', async () => {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try { assert.equal((await probeTcp('127.0.0.1',server.address().port)).reachable,true); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
