// The Alpha Host normally flushes and releases a child as soon as it is idle.
// Hold only the final idle flush while a probe inspects a resident child's
// capabilities. Release it to exercise the real settlement and cold resume.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

export function fixtureWorkerSettlement(ctx) {
  const holds = new Map();
  ctx.on('subagent/start', ({id, local}) => {
    if (local) holds.set(id, Promise.withResolvers());
  });
  ctx.on('session/flush', async session => {
    if (ctx.agents.get(session.id)?.status === 'idle') await holds.get(session.id)?.promise;
  });
  return {
    async settle(id) {
      const hold = holds.get(id);
      holds.delete(id);
      hold?.resolve();
      const signal = AbortSignal.timeout(10000);
      while (ctx.agents.get(id) !== undefined && !signal.aborted) await delay(20);
      assert.equal(ctx.agents.get(id), undefined, 'Worker did not settle and release its Agent');
    },
    releaseAll() {
      for (const hold of holds.values()) hold.resolve();
      holds.clear();
    },
  };
}
