// HTTP carrier of the character manager RPC. It knows transport and
// authentication only: loopback, the Host header, native Owner admission
// (again after the body is read), same-origin or the desktop relay, a bounded
// JSON body. What a request means is the dispatcher's business.
export const MAX_BODY_BYTES = 256 * 1024;
export const API_PATH = '/character-manager/api';

const BODY_TIMEOUT_MS = 10000;
const MAX_MESSAGE_CHARS = 500;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

const isLoopback = address => ['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(address);

/**
 * @param {{connection: {admit: Function}, origin: () => string,
 *   dispatch: (request: unknown) => unknown, isClosed?: () => boolean}} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function handler({connection, origin, dispatch, isClosed = () => false}) {
  return async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS});
      res.end(JSON.stringify(body));
    };
    if (isClosed()) return send(503, {error: 'Character manager unavailable'});
    if (!isLoopback(req.socket.remoteAddress) || req.headers.host !== new URL(origin()).host) return send(403, {error: 'Local access required'});
    const admitted = connection.admit(req);
    if ('rejection' in admitted) return send(admitted.rejection, {error: 'Open the authenticated DSH Web page first'});
    if (admitted.peer?.principal?.kind !== 'owner') return send(403, {error: 'Host owner required'});

    const url = new URL(req.url, origin());
    if (req.method !== 'POST' || url.pathname !== API_PATH) return send(404, {error: 'Not found'});
    // Desktop's owned dsh-app:// relay removes Origin and Sec-Fetch-Site and
    // supplies its private Host cookie; native admission above still applies.
    // Origin: null, a foreign origin or an untrusted browser site never passes.
    const desktopRelay = req.headers.origin === undefined && req.headers['sec-fetch-site'] === undefined;
    if ((req.headers.origin !== origin() && !desktopRelay) || req.headers['content-type']?.split(';')[0] !== 'application/json') {
      return send(403, {error: 'Same-origin JSON required'});
    }

    let rpcId;
    const timer = setTimeout(() => req.destroy(), BODY_TIMEOUT_MS);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return send(413, {error: 'Request too large'});
        chunks.push(chunk);
      }
      if (isClosed()) return send(503, {error: 'Character manager unavailable'});
      // The body arrived asynchronously: admit the peer again.
      const fresh = connection.admit(req);
      if ('rejection' in fresh || fresh.peer?.principal?.kind !== 'owner') return send(401, {error: 'Authentication expired'});

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let request = body;
      if (body?.type === 'client-request') {
        if (body.method !== 'api' || typeof body.rpcId !== 'string' || !body.rpcId || body.rpcId.length > 128) throw new Error('Invalid envelope');
        rpcId = body.rpcId;
        request = body.payload;
      }
      const value = await dispatch(request);
      return send(200, rpcId ? {type: 'server-response', rpcId, result: {ok: true, value}} : value);
    } catch (error) {
      const status = /Revision conflict/.test(error.message) ? 409 : 400;
      const message = String(error.message).slice(0, MAX_MESSAGE_CHARS);
      return rpcId
        ? send(200, {type: 'server-response', rpcId, result: {ok: false, error: {code: `character/${status}`, message}}})
        : send(status, {error: message});
    } finally {
      clearTimeout(timer);
    }
  };
}
