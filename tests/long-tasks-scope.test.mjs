// Recovery with tasks of another Character in the shared task ledger.
// The ledger is a Home-wide native storageDomain, while each Character runs
// with its own Identity scope. After a character switch the ledger holds
// tasks the current Identity does not own; they must stay untouched, and
// must not stop the current Character's long tasks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LongTasks} from '../packages/long-tasks/service.mjs';

const KEYS = ['principalId', 'characterId', 'projectId', 'conversationId'];
const scopeOf = characterId => ({principalId: 'owner-x', characterId, projectId: 'personal', conversationId: 'qq-x'});
const table = rows => {
  const map = new Map(rows.map(row => [row.id, row]));
  return {map, get: id => map.get(id), put: async (id, value) => void map.set(id, value), entries: () => map.entries()};
};
const task = (id, characterId, state = 'active') => ({
  id, delivery: 'new', cwd: 'D:/work', presetId: 'long-task', title: id, prompt: 'p', state, revision: 1,
  scheduleId: 'schedule-' + id, route: {provider: 'p', model: 'm'}, scope: scopeOf(characterId),
});

function fixture({tasks, runs = []}) {
  const current = scopeOf('tasha'), notified = [], warnings = [];
  const host = {
    tasks: table(tasks), runs: table(runs), startedAt: Date.now(),
    identity: {
      conversationScope: () => current,
      validateConversation(scope) { if (KEYS.some(k => scope?.[k] !== current[k])) throw Error('Foreign task conversation'); return current; },
      async notifyConversation(scope, event) { this.validateConversation(scope); notified.push(event); return {status: 'sent'}; },
    },
    schedule: {
      catalog: async () => tasks.map(t => ({id: t.scheduleId, status: 'active', prompt: `[LONG TASK ${t.id} REV 1]\np`, target: {kind: 'new', create: {agentPreset: 'long-task', cwd: 'D:/work'}}})),
      view: async () => ({}), history: async () => ({records: []}),
    },
    agents: {get: () => undefined}, load: async () => ({events: []}), canCreateSessions: () => true,
    warn: message => warnings.push(message),
  };
  return {host, service: new LongTasks(host, {cwd: 'D:/work'}), notified, warnings};
}

test('a task of another Character does not stop recovery or the current Character', async () => {
  const {host, service, warnings} = fixture({tasks: [task('yuha-task', 'yuha', 'creating'), task('tasha-task', 'tasha', 'creating')]});
  await service.recover();
  await service.ready;
  assert.equal(host.tasks.get('tasha-task').state, 'active', 'the current Character\'s task is reconciled');
  assert.equal(host.tasks.get('yuha-task').state, 'creating', 'the other Character\'s task is left as it was');
  assert.equal(warnings.filter(w => /another Character/.test(w)).length, 1);
});

test('runs of another Character\'s task are neither settled nor notified', async () => {
  const running = {id: 'run-1', taskId: 'yuha-task', sessionId: 's-1', status: 'running', occurrenceAt: '2026-11-17T00:00:00Z', turn: 1};
  const pending = {id: 'run-2', taskId: 'yuha-task', sessionId: 's-2', status: 'completed', occurrenceAt: '2026-11-17T01:00:00Z', notification: 'pending'};
  const {host, service, notified} = fixture({tasks: [task('yuha-task', 'yuha')], runs: [running, pending]});
  await service.recover();
  assert.equal(host.runs.get('run-1').status, 'running');
  assert.equal(host.runs.get('run-2').notification, 'pending');
  assert.deepEqual(notified, []);
});

test('a run whose task is missing is skipped with a warning instead of stopping recovery', async () => {
  const orphan = {id: 'run-x', taskId: 'gone', sessionId: 's-x', status: 'running', occurrenceAt: '2026-11-17T00:00:00Z', turn: 1};
  const {host, service, warnings} = fixture({tasks: [task('tasha-task', 'tasha')], runs: [orphan]});
  await service.recover();
  await service.ready;
  assert.equal(host.runs.get('run-x').status, 'running');
  assert.equal(warnings.filter(w => /no task/.test(w)).length, 1);
});
