import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../packages/character-manager/client.js', import.meta.url), 'utf8');

function fixture(react = {}) {
  let exported, registration, styles = 0;
  const cleanups = [], calls = [];
  const sandbox = {
    window: {__ModuleLoader__: {load({id, factory}) {
      assert.equal(id, 'dsh-character-manager');
      exported = factory(name => {
        assert(['react', '@deepseek-ai/dsh-client-ui-primitives'].includes(name), name);
        return name === 'react'
          ? {Component: class { constructor(props) { this.props = props; } setState(fn) { this.state = typeof fn === 'function' ? fn(this.state) : fn; } }, createElement: (tag, props, ...children) => ({tag, props, children}), ...react}
          : {Button: 'Button', Input: 'Input', SegmentedTabs: 'SegmentedTabs', Tag: 'Tag'};
      });
    }}},
    document: {createElement() { return {remove() { styles -= 1; }}; }, head: {append() { styles += 1; }}},
    AbortController, setTimeout, clearTimeout, btoa: text => Buffer.from(text, 'latin1').toString('base64'), Uint8Array, Blob, URL,
  };
  vm.runInNewContext(source, sandbox);
  const ctx = {
    effect(fn) { cleanups.push(fn()); },
    connection: {rpc: {async call(...args) { calls.push(args); return {ok: true, value: {}}; }}},
    slots: {
      inject(name, fn) { assert.equal(name, 'settings.section'); cleanups.push(fn()); },
      register(meta, component) { registration = {meta, boundary: component, helpers: component.helpers}; return () => { registration = undefined; }; },
    },
  };
  return {exported, ctx, calls, cleanups, get registration() { return registration; }, get styles() { return styles; }};
}

// Objects made inside the vm context have another Object prototype.
const plain = value => JSON.parse(JSON.stringify(value));
const dispose = f => f.cleanups.reverse().forEach(fn => fn?.());

test('registers one settings section, reuses Connection RPC, disposes and respects disable', async () => {
  const f = fixture();
  assert.deepEqual(plain(f.exported.inject), ['slots', 'connection']);
  f.exported.apply(f.ctx);
  assert.equal(f.styles, 1);
  const {meta} = f.registration;
  assert.deepEqual([meta.name, meta.id, meta.order, meta.label()], ['settings.section', 'character-manager', 66, '角色管理']);
  const api = meta.inject().api;
  await api('list', {});
  assert.deepEqual(plain(f.calls[0].slice(0, 3)), ['/character-manager', 'api', {operation: 'list'}]);
  dispose(f);
  assert.equal(f.styles, 0);
  assert.equal(f.registration, undefined);
  await assert.rejects(() => api('list'), /关闭/);

  const off = fixture();
  off.exported.apply(off.ctx, {enabled: false});
  assert.equal(off.styles, 0);
  assert.equal(off.registration, undefined);
});

test('aborts requests on disposal and on the caller signal; maps errors', async () => {
  const f = fixture();
  f.exported.apply(f.ctx);
  const api = f.registration.meta.inject().api;

  f.ctx.connection.rpc.call = async () => ({ok: false, error: {code: 'character/409', message: 'Revision conflict'}});
  await assert.rejects(() => api('save'), /已在别处修改，请刷新后再改/);
  f.ctx.connection.rpc.call = async () => ({ok: false, error: {code: 'character/400', message: '角色卡 JSON 解析失败'}});
  await assert.rejects(() => api('import'), /角色卡 JSON 解析失败/);
  f.ctx.connection.rpc.call = async () => { throw new Error('socket closed'); };
  await assert.rejects(() => api('list'), /Host 正在重启，请稍后从桌面应用或新链接重新打开。/);
  f.ctx.connection.rpc.call = async () => 'garbage';
  await assert.rejects(() => api('list'), /无效响应/);

  let signal;
  f.ctx.connection.rpc.call = (_c, _m, _p, s) => new Promise((resolve, reject) => { signal = s; s.addEventListener('abort', () => reject(new Error('aborted')), {once: true}); });
  const own = new AbortController();
  const cancelled = assert.rejects(() => api('list', {}, own.signal), /已取消/);
  own.abort();
  await cancelled;

  const pending = api('list');
  const closed = assert.rejects(() => pending, /关闭/);
  dispose(f);
  await closed;
  assert(signal.aborted);
});

test('upload splits a 300 KiB file into 3 chunks with index 0, 1, 2', async () => {
  const f = fixture();
  f.exported.apply(f.ctx);
  const {uploadCard} = f.registration.helpers;
  const bytes = new Uint8Array(300 * 1024).map((_, i) => i % 251);
  const file = {size: bytes.length, slice: (start, end) => ({arrayBuffer: async () => bytes.slice(start, end).buffer})};
  const sent = [];
  const call = async (operation, args) => {
    sent.push([operation, args]);
    return operation === 'uploadBegin' ? {uploadId: 'up-1'} : {characterId: 'yuha'};
  };
  assert.deepEqual(plain(await uploadCard(call, file, {id: 'yuha', userName: ''})), {characterId: 'yuha'});
  assert.deepEqual(plain(sent.map(([operation]) => operation)), ['uploadBegin', 'uploadChunk', 'uploadChunk', 'uploadChunk', 'import']);
  const chunks = sent.filter(([operation]) => operation === 'uploadChunk').map(([, args]) => args);
  assert.deepEqual(plain(chunks.map(c => c.index)), [0, 1, 2]);
  assert(chunks.every(c => c.uploadId === 'up-1'));
  assert.deepEqual(plain(chunks.map(c => Buffer.from(c.data, 'base64').length)), [128 * 1024, 128 * 1024, 44 * 1024]);
  assert(Buffer.concat(chunks.map(c => Buffer.from(c.data, 'base64'))).equals(Buffer.from(bytes)));
  assert.deepEqual(plain(sent.at(-1)), ['import', {uploadId: 'up-1', id: 'yuha'}]);
  sent.length = 0;
  await uploadCard(call, {size: 1, slice: () => ({arrayBuffer: async () => new Uint8Array([7]).buffer})}, {id: 'a', userName: '阿宁'});
  assert.deepEqual(plain(sent.at(-1)), ['import', {uploadId: 'up-1', id: 'a', userName: '阿宁'}]);
});

test('approving sends the hash of the public version that was previewed', async () => {
  const f = fixture();
  f.exported.apply(f.ctx);
  const {approvePublic} = f.registration.helpers;
  const sent = [];
  await approvePublic(async (operation, args) => { sent.push([operation, args]); return {}; }, 'yuha', {pendingPublic: {hash: 'abc123', prefix: 'p'}});
  assert.deepEqual(plain(sent), [['approvePublic', {id: 'yuha', hash: 'abc123'}]]);
  assert.throws(() => approvePublic(async () => {}, 'yuha', {public: {hash: 'x'}}), /没有待确认/);
});

test('confirmation texts', () => {
  const f = fixture();
  f.exported.apply(f.ctx);
  assert.equal(f.registration.helpers.switchConfirmText('小夜'),
    '切换后 QQ 会断开约 30 秒，桌面窗口会关闭后重新打开。旧角色设的提醒和长期任务切换后不会执行。确定切换到「小夜」？');
});

test('render errors are contained without exposing details', () => {
  const f = fixture();
  f.exported.apply(f.ctx);
  const {boundary: Boundary} = f.registration;
  const instance = new Boundary({api() {}});
  instance.state = {...instance.state, ...Boundary.getDerivedStateFromError(new Error('private stack'))};
  const error = instance.render();
  assert(JSON.stringify(error).includes('页面渲染失败'));
  assert(!JSON.stringify(error).includes('private stack'));
  error.children.find(node => node?.tag === 'Button').props.onClick();
  assert.equal(instance.state.failed, false);
  assert.equal(instance.state.version, 1);
});

// A minimal hook runtime: state and refs by call order, effects when their dependencies change.
function mounted(handlers) {
  const values = [], effects = [], refs = [], scheduled = [];
  let stateIndex, refIndex, effectIndex, tree;
  const f = fixture({
    useState(initial) {
      const i = stateIndex++;
      if (!(i in values)) values[i] = initial;
      return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }];
    },
    useRef(initial) { const i = refIndex++; return refs[i] ??= {current: initial}; },
    useEffect(fn, deps) {
      const i = effectIndex++, old = effects[i];
      if (!old || !deps || deps.some((x, n) => x !== old.deps[n])) scheduled.push(() => { old?.cleanup?.(); effects[i] = {deps, cleanup: fn()}; });
    },
  });
  f.exported.apply(f.ctx);
  const requests = [];
  f.ctx.connection.rpc.call = async (_c, _m, payload) => {
    requests.push(payload);
    const handler = handlers[payload.operation];
    if (!handler) throw new Error(`unexpected ${payload.operation}`);
    return {ok: true, value: handler(payload)};
  };
  const {api} = f.registration.meta.inject();
  const Page = f.registration.helpers.Page;
  const render = () => { stateIndex = refIndex = effectIndex = 0; tree = Page({api}); scheduled.splice(0).forEach(run => run()); return tree; };
  const walk = node => (!node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.children)]);
  const nodes = () => walk(tree);
  const find = (tag, text) => nodes().find(n => n.tag === tag && JSON.stringify(n.children).includes(text));
  const settle = async () => { for (let n = 0; n < 4; n += 1) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const unmount = () => { effects.forEach(e => e.cleanup?.()); dispose(f); };
  return {render, find, nodes, settle, requests, unmount, get text() { return JSON.stringify(tree); }};
}

const compiled = {
  version: 1, revision: 3, characterId: 'b', name: 'Tasha', hangOnText: 'x', reminder: '提醒', owner: {prefix: 'OWNER-PREFIX', suffix: 'OWNER-SUFFIX'},
  pendingPublic: {prefix: 'PUBLIC-PREFIX', suffix: 'PUBLIC-SUFFIX', reminder: 'PUBLIC-REMINDER', hash: 'hash-1'},
  tokens: {owner: 120, public: 100}, warnings: ['已忽略 system_prompt'], userFields: ['description'], cardRevision: 'c', rulesRevision: 'r',
};
const listing = {
  characters: [
    {id: 'a', name: '小夜', current: true, archived: false, tokens: 90, warningCount: 1, publicPending: false, publicApproved: true},
    {id: 'b', name: 'Tasha', current: false, archived: false, tokens: 120, warningCount: 1, publicPending: true, publicApproved: false},
  ],
  switch: {pending: null, inProgress: false, result: {ok: false, target: 'b', reason: 'expired', at: Date.parse('2026-11-16T10:00:00Z')}},
  profileWarnings: [],
};
const handlers = () => ({
  list: () => listing,
  get: () => ({settings: {userName: '用户', hangOnText: 'x', relationship: {}, publicExclude: [], revision: 3}, rules: '规则文本', reminder: '提醒', compiled, card: {spec: 'v3', format: 'json'}}),
  preview: () => ({compiled}),
  approvePublic: () => compiled,
  switch: () => ({target: 'b'}),
});

test('the page lists characters, asks before switching and never mentions permissions', async () => {
  const m = mounted(handlers());
  try {
    m.render();
    await m.settle();
    assert(m.text.includes('小夜') && m.text.includes('Tasha'));
    assert(m.text.includes('当前') && m.text.includes('公开版待确认'));
    assert(m.text.includes('最近一次切换到「b」：失败（expired）'));
    assert.equal(m.nodes().filter(n => n.tag === 'Button' && JSON.stringify(n.children).includes('切换到此角色')).length, 1);
    assert(m.find('Button', '切换到此角色'));

    m.find('Button', '切换到此角色').props.onClick();
    m.render();
    assert(m.text.includes('切换后 QQ 会断开约 30 秒，桌面窗口会关闭后重新打开。旧角色设的提醒和长期任务切换后不会执行。确定切换到「Tasha」？'));
    assert(!m.requests.some(r => r.operation === 'switch'));
    await m.find('Button', '确定').props.onClick();
    assert.deepEqual(plain(m.requests.find(r => r.operation === 'switch')), {operation: 'switch', id: 'b'});

    m.find('Button', 'Tasha').props.onClick();
    m.render();
    await m.settle();
    for (const label of ['资料', '规则', '末尾提醒', '关系', '设置', '预览']) assert(m.text.includes(label), label);
    assert(!/权限|Preset|\/role/.test(m.text), 'no permission, Preset or /role content');
  } finally {
    m.unmount();
  }
});

test('confirming the public version sends the hash the preview returned', async () => {
  const m = mounted(handlers());
  try {
    m.render();
    await m.settle();
    m.find('Button', 'Tasha').props.onClick();
    m.render();
    await m.settle();
    m.nodes().find(n => n.tag === 'SegmentedTabs' && n.props.label === '角色详情').props.onChange('preview');
    m.render();
    await m.settle();
    assert(m.text.includes('OWNER-PREFIX'));
    m.nodes().find(n => n.tag === 'SegmentedTabs' && n.props.label === '预览版本').props.onChange('public');
    m.render();
    assert(m.text.includes('PUBLIC-PREFIX') && m.text.includes('PUBLIC-REMINDER') && !m.text.includes('OWNER-PREFIX'));
    assert(m.text.includes('描述'), 'userFields are marked');
    await m.find('Button', '确认公开版').props.onClick();
    assert.deepEqual(plain(m.requests.find(r => r.operation === 'approvePublic')), {operation: 'approvePublic', id: 'b', hash: 'hash-1'});
  } finally {
    m.unmount();
  }
});

test('saving sends the revision and only the editable parts', async () => {
  const m = mounted({...handlers(), save: () => { throw new Error('boom'); }});
  try {
    m.render();
    await m.settle();
    m.find('Button', 'Tasha').props.onClick();
    m.render();
    await m.settle();
    m.nodes().find(n => n.tag === 'SegmentedTabs' && n.props.label === '角色详情').props.onChange('rules');
    m.render();
    m.nodes().find(n => n.props?.['aria-label'] === '规则').props.onChange({target: {value: '新规则'}});
    m.render();
    await m.find('Button', '保存').props.onClick();
    const save = m.requests.find(r => r.operation === 'save');
    assert.equal(save.revision, 3);
    assert.equal(save.id, 'b');
    assert.equal(save.draft.rules, '新规则');
    assert.deepEqual(plain(Object.keys(save.draft).sort()), ['reminder', 'rules', 'settings']);
    assert.deepEqual(plain(save.draft.settings.relationship), {});
  } finally {
    m.unmount();
  }
});

test('profile warnings are shown at the top', async () => {
  const m = mounted({...handlers(), list: () => ({...listing, profileWarnings: ['检测到 Profile 覆盖了 persona 行']})});
  try {
    m.render();
    await m.settle();
    assert(m.text.includes('检测到 Profile 覆盖了 persona 行'));
  } finally {
    m.unmount();
  }
});

const approvedAndPending = {...compiled, public: {prefix: 'OLD-PUBLIC-PREFIX', suffix: 'OLD-PUBLIC-SUFFIX', reminder: 'OLD-PUBLIC-REMINDER', hash: 'hash-old'}};
async function openPublicPreview(m) {
  m.render();
  await m.settle();
  m.find('Button', 'Tasha').props.onClick();
  m.render();
  await m.settle();
  m.nodes().find(n => n.tag === 'SegmentedTabs' && n.props.label === '角色详情').props.onChange('preview');
  m.render();
  await m.settle();
  m.nodes().find(n => n.tag === 'SegmentedTabs' && n.props.label === '预览版本').props.onChange('public');
  m.render();
}

test('with an approved and a pending public version the pane shows the pending one and approves its hash', async () => {
  const m = mounted({...handlers(), preview: () => ({compiled: approvedAndPending})});
  try {
    await openPublicPreview(m);
    assert(m.text.includes('PUBLIC-PREFIX') && m.text.includes('PUBLIC-SUFFIX') && m.text.includes('PUBLIC-REMINDER'));
    assert(!m.text.includes('OLD-PUBLIC'), 'the approved old text is not shown as the thing to approve');
    await m.find('Button', '确认公开版').props.onClick();
    assert.deepEqual(plain(m.requests.find(r => r.operation === 'approvePublic')), {operation: 'approvePublic', id: 'b', hash: 'hash-1'});
  } finally {
    m.unmount();
  }
});

test('with only an approved public version there is nothing to approve', async () => {
  const {pendingPublic, ...settled} = approvedAndPending;
  const m = mounted({...handlers(), preview: () => ({compiled: settled})});
  try {
    await openPublicPreview(m);
    assert(m.text.includes('OLD-PUBLIC-PREFIX'));
    assert.equal(m.find('Button', '确认公开版'), undefined);
  } finally {
    m.unmount();
  }
});
