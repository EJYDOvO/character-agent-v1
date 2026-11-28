import assert from 'node:assert/strict';

export function fixtureLoginUrl(ctx) {
  const target = new URL('/', ctx.webServer.getOrigin());
  const entries = [];
  ctx.emit(ctx.webServer, 'webserver/entry-url', target.href, entries);
  for (const {url} of entries) {
    const candidate = new URL(url);
    if (candidate.origin === target.origin && candidate.pathname === target.pathname && candidate.searchParams.has('token')) {
      return candidate.href;
    }
  }
  throw Error('Synthetic Host did not publish a loopback Token entry');
}

export async function fixtureOwnerCookie(ctx) {
  const response = await fetch(fixtureLoginUrl(ctx), {redirect: 'manual'});
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie');
  assert(cookie, 'Synthetic Host did not exchange its Token for an Owner cookie');
  return cookie.split(';', 1)[0];
}
