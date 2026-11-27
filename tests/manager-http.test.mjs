import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handler, MAX_BODY_BYTES, API_PATH} from '../packages/character-manager/http.mjs';

const ORIGIN = 'http://127.0.0.1:4567';

function fixture({dispatch = () => ({ok: true}), role = 'owner'} = {}) {
  const state = {calls: [], closed: false, role, admits: 0, expireAfter: Infinity};
  const run = handler({
    origin: () => ORIGIN,
    isClosed: () => state.closed,
    connection: {
      admit(req) {
        state.admits += 1;
        if (req.headers.cookie !== 'fixture' || state.admits > state.expireAfter) return {rejection: 401};
        return {peer: {principal: {kind: state.role}}};
      },
    },
    dispatch: request => {
      state.calls.push(request);
      return dispatch(request);
    },
  });
  // A request the way node's http server hands it to the handler.
  async function call({body = '{}', method = 'POST', url = API_PATH, address = '127.0.0.1', headers = {}} = {}) {
    const req = Readable.from([Buffer.from(body)]);
    Object.assign(req, {
      method, url, socket: {remoteAddress: address},
      headers: {host: '127.0.0.1:4567', cookie: 'fixture', 'content-type': 'application/json', origin: ORIGIN, ...headers},
    });
    for (const [key, value] of Object.entries(req.headers)) if (value === undefined) delete req.headers[key];
    const out = {};
    const res = {writeHead(status, head) { out.status = status; out.head = head; }, end(text) { out.body = text ? JSON.parse(text) : undefined; }};
    await run(req, res);
    return out;
  }
  return {state, call};
}

test('the request body limit is 256 KiB', async () => {
  assert.equal(MAX_BODY_BYTES, 256 * 1024);
  const f = fixture();
  assert.equal((await f.call({body: 'x'.repeat(MAX_BODY_BYTES + 1)})).status, 413);
  assert.equal((await f.call({body: JSON.stringify({pad: 'x'.repeat(MAX_BODY_BYTES - 20)})})).status, 200);
  assert.equal(f.state.calls.length, 1);
});

test('only the authenticated Owner on loopback with the right Host passes', async () => {
  const f = fixture();
  assert.equal((await f.call({address: '192.168.1.5'})).status, 403);
  assert.equal((await f.call({headers: {host: 'evil.example'}})).status, 403);
  assert.equal((await f.call({headers: {cookie: ''}})).status, 401);
  f.state.role = 'guest';
  assert.equal((await f.call()).status, 403);
  f.state.role = 'contact';
  assert.equal((await f.call()).status, 403);
  f.state.role = 'owner';
  assert.equal((await f.call({address: '::ffff:127.0.0.1'})).status, 200);
  assert.equal(f.state.calls.length, 1);
});

test('origin and content type', async () => {
  const f = fixture();
  assert.equal((await f.call({headers: {origin: 'https://foreign.invalid'}})).status, 403);
  assert.equal((await f.call({headers: {origin: 'null'}})).status, 403);
  assert.equal((await f.call({headers: {origin: undefined, 'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal((await f.call({headers: {'content-type': 'text/plain'}})).status, 403);
  assert.equal((await f.call({headers: {origin: undefined}})).status, 200); // the owned Desktop relay has no Origin
  assert.equal(f.state.calls.length, 1);
});

test('only POST on the API path, and bad JSON is a 400', async () => {
  const f = fixture();
  assert.equal((await f.call({method: 'GET'})).status, 404);
  assert.equal((await f.call({url: '/character-manager/other'})).status, 404);
  const bad = await f.call({body: 'not json'});
  assert.equal(bad.status, 400);
  assert.equal(f.state.calls.length, 0);
  f.state.closed = true;
  assert.equal((await f.call()).status, 503);
});

test('the peer is admitted again after the body is read', async () => {
  const f = fixture();
  f.state.expireAfter = 1;
  assert.equal((await f.call()).status, 401);
  assert.equal(f.state.calls.length, 0);
});

test('responses carry no-store and security headers', async () => {
  const out = await fixture().call();
  assert.equal(out.head['cache-control'], 'no-store');
  assert.equal(out.head['x-content-type-options'], 'nosniff');
  assert.match(out.head['content-type'], /^application\/json/);
});

test('client-request envelope round trip', async () => {
  const f = fixture({dispatch: request => ({echo: request.operation})});
  const envelope = (payload, extra = {}) => JSON.stringify({type: 'client-request', rpcId: 'rpc-1', method: 'api', payload, ...extra});
  const ok = await f.call({body: envelope({operation: 'list'})});
  assert.deepEqual(ok.body, {type: 'server-response', rpcId: 'rpc-1', result: {ok: true, value: {echo: 'list'}}});
  assert.equal((await f.call({body: envelope({}, {method: 'wrong'})})).status, 400);
  assert.equal((await f.call({body: envelope({}, {rpcId: ''})})).status, 400);
  assert.equal((await f.call({body: envelope({}, {rpcId: 'x'.repeat(129)})})).status, 400);
});

test('errors: revision conflicts are 409, others 400, with the message', async () => {
  const f = fixture({dispatch: request => { throw new Error(request.operation === 'stale' ? 'Revision conflict' : '角色卡 JSON 解析失败'); }});
  const envelope = operation => JSON.stringify({type: 'client-request', rpcId: 'rpc-2', method: 'api', payload: {operation}});
  const stale = await f.call({body: envelope('stale')});
  assert.equal(stale.status, 200);
  assert.deepEqual([stale.body.rpcId, stale.body.result.ok, stale.body.result.error.code], ['rpc-2', false, 'character/409']);
  const other = await f.call({body: envelope('other')});
  assert.equal(other.body.result.error.code, 'character/400');
  assert.equal(other.body.result.error.message, '角色卡 JSON 解析失败');
  assert.equal((await f.call({body: JSON.stringify({operation: 'stale'})})).status, 409);
  assert.equal((await f.call({body: JSON.stringify({operation: 'other'})})).status, 400);
});
