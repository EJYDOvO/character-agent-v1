// Native DSH client module: the character manager settings section. It talks
// to the Host only through Connection RPC (/character-manager/api) and sends
// character ids, never paths.
window.__ModuleLoader__.load({id: 'dsh-character-manager', factory(require) {
  const React = require('react');
  const {Button, Input, SegmentedTabs, Tag} = require('@deepseek-ai/dsh-client-ui-primitives');
  const h = React.createElement;
  const {useState, useEffect, useRef} = React;

  const CHUNK_BYTES = 128 * 1024;
  const REQUEST_TIMEOUT_MS = 15000;
  const RESTARTING = 'Host 正在重启，请稍后从桌面应用或新链接重新打开。';
  const CONFLICT = '已在别处修改，请刷新后再改';
  const TABS = [['info', '资料'], ['rules', '规则'], ['reminder', '末尾提醒'], ['relationship', '关系'], ['settings', '设置'], ['preview', '预览']];
  const EXCLUDABLE = [['description', '描述'], ['personality', '性格'], ['scenario', '场景'], ['examples', '对话示例']];
  const FIELD_NAMES = {description: '描述', personality: '性格', scenario: '场景', examples: '对话示例', rules: '规则'};
  const WARNING_HINT = {pending: '公开版尚未确认：Contact / Guest 目前只会看到中性回退文本。'};

  const css = `.dsh-cm{display:flex;flex-direction:column;gap:16px;min-width:0;color:var(--dsw-alias-label-primary);font:inherit}.dsh-cm p{margin:0;line-height:1.6}.dsh-cm h3{margin:0;font-size:16px;font-weight:600}.dsh-cm .cm-muted{color:var(--dsw-alias-label-secondary);font-size:12px}.dsh-cm .cm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dsh-cm .cm-between{justify-content:space-between}.dsh-cm .cm-item{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px}.dsh-cm label{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}.dsh-cm .cm-check{flex-direction:row;align-items:center;color:var(--dsw-alias-label-primary)}.dsh-cm textarea{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,8px);padding:8px;width:100%;box-sizing:border-box;min-height:180px;resize:vertical}.dsh-cm .cm-short{min-height:90px}.dsh-cm pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-2);padding:12px;border-radius:8px;font-size:12px;margin:0}.dsh-cm .cm-error{color:var(--dsw-alias-state-error-primary)}.dsh-cm .cm-box{padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;flex-direction:column;gap:8px}.dsh-cm .cm-field{display:grid;grid-template-columns:80px 1fr;gap:8px;font-size:12px}.dsh-cm .cm-tabs{width:100%}`;

  // Whole-text confirmation shown before a switch (QQ and the desktop window restart).
  const switchConfirmText = name => `切换后 QQ 会断开约 30 秒，桌面窗口会关闭后重新打开。旧角色设的提醒和长期任务切换后不会执行。确定切换到「${name}」？`;
  const archiveConfirmText = name => `归档后「${name}」会移出角色列表，文件保留在归档目录里。确定归档？`;

  function toBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
    return btoa(binary);
  }

  // `call(operation, args)` performs one RPC; the file goes up in 128 KiB pieces.
  async function uploadCard(call, file, {id, userName}) {
    const {uploadId} = await call('uploadBegin');
    for (let offset = 0, index = 0; offset < file.size; offset += CHUNK_BYTES, index += 1) {
      const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
      await call('uploadChunk', {uploadId, index, data: toBase64(bytes)});
    }
    return call('import', userName ? {uploadId, id, userName} : {uploadId, id});
  }

  // The hash is the one of the public persona the Owner was shown.
  function approvePublic(call, id, compiled) {
    if (!compiled?.pendingPublic) throw new Error('没有待确认的公开版');
    return call('approvePublic', {id, hash: compiled.pendingPublic.hash});
  }

  function suggestId(fileName) {
    return fileName.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  }

  function draftOf(detail) {
    const {settings} = detail;
    return {
      rules: detail.rules, reminder: detail.reminder, userName: settings.userName, nickname: settings.nickname || '',
      hangOnText: settings.hangOnText, owner: settings.relationship?.owner || '', public: settings.relationship?.public || '',
      exclude: [...settings.publicExclude],
    };
  }

  function payloadOf(draft) {
    const relationship = {};
    if (draft.owner) relationship.owner = draft.owner;
    if (draft.public) relationship.public = draft.public;
    return {
      rules: draft.rules, reminder: draft.reminder,
      settings: {userName: draft.userName, nickname: draft.nickname, hangOnText: draft.hangOnText, relationship, publicExclude: draft.exclude},
    };
  }

  const date = value => (value ? new Date(value).toLocaleString() : '');
  const btn = (label, onClick, props = {}) => h(Button, {size: 'sm', onClick, ...props}, label);
  const field = (title, value) => h('div', {className: 'cm-field'}, h('span', {className: 'cm-muted'}, title), h('span', null, value ?? '—'));

  function resultLine(result) {
    if (!result) return null;
    const outcome = result.ok ? '成功' : `失败${result.reason ? `（${result.reason}${result.restored === false ? '，未能退回原角色' : ''}）` : ''}`;
    return `最近一次切换${result.target ? `到「${result.target}」` : ''}：${outcome}${result.at ? ` · ${date(result.at)}` : ''}`;
  }

  function Page({api}) {
    const [list, setList] = useState(null), [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
    const [draft, setDraft] = useState(null), [tab, setTab] = useState('info'), [audience, setAudience] = useState('owner'), [preview, setPreview] = useState(null);
    const [confirm, setConfirm] = useState(null), [importing, setImporting] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0);
    const requests = useRef(new Set()), alive = useRef(true), epoch = useRef(0), working = useRef(false);

    const request = async (operation, args = {}) => {
      const abort = new AbortController();
      requests.current.add(abort);
      try {
        return await api(operation, args, abort.signal);
      } finally {
        requests.current.delete(abort);
      }
    };
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
        epoch.current += 1;
        for (const abort of requests.current) abort.abort();
        requests.current.clear();
      };
    }, []);

    useEffect(() => {
      let active = true;
      request('list').then(data => { if (active && alive.current) setList(data); }).catch(e => { if (active && alive.current) setError(e.message); });
      return () => { active = false; };
    }, [api, refresh]);

    useEffect(() => {
      setDetail(null); setDraft(null); setPreview(null); setConfirm(null);
      if (!selected) return undefined;
      let active = true;
      request('get', {id: selected}).then(data => {
        if (!active || !alive.current) return;
        setDetail(data);
        setDraft(draftOf(data));
      }).catch(e => { if (active && alive.current) setError(e.message); });
      return () => { active = false; };
    }, [api, selected, refresh]);

    const dirty = !!(detail && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(detail)));
    useEffect(() => {
      if (tab !== 'preview' || !selected || !draft) return undefined;
      let active = true;
      request('preview', {id: selected, draft: payloadOf(draft)}).then(data => { if (active && alive.current) { setPreview(data.compiled); setError(''); } })
        .catch(e => { if (active && alive.current) { setPreview(null); setError(e.message); } });
      return () => { active = false; };
    }, [api, tab, selected, draft]);

    // One mutation at a time; a failure leaves the page where it was.
    async function run(action, success) {
      if (working.current) return;
      working.current = true;
      setBusy(true); setError(''); setNotice('');
      try {
        await action();
        if (alive.current && success) setNotice(success);
      } catch (e) {
        if (alive.current) setError(e.message);
      } finally {
        working.current = false;
        if (alive.current) setBusy(false);
      }
    }
    const reload = () => setRefresh(x => x + 1);
    const update = patch => setDraft(old => ({...old, ...patch}));

    const save = () => run(async () => {
      await request('save', {id: selected, draft: payloadOf(draft), revision: detail.settings.revision});
      reload();
    }, '已保存。当前角色的修改会立即生效。');
    const approve = () => run(async () => {
      await approvePublic(request, selected, preview);
      reload();
    }, '公开版已确认。');
    const doSwitch = id => run(async () => {
      setConfirm(null);
      await request('switch', {id});
      reload();
    }, '已请求切换，请稍候。');
    const doArchive = id => run(async () => {
      setConfirm(null);
      await request('archive', {id});
      setSelected(null);
      reload();
    }, '已归档。');
    const doExport = () => run(async () => {
      const card = await request('exportCard', {id: selected});
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], {type: 'application/json'}));
      link.download = `${selected}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });
    const doImport = () => run(async () => {
      const compiled = await uploadCard(request, importing.file, importing);
      setImporting(null);
      setSelected(compiled.characterId);
      reload();
    }, '已导入。公开版需要确认后才会对 Contact / Guest 生效。');

    const characters = list?.characters ?? [];
    const named = id => characters.find(c => c.id === id)?.name ?? id;

    const header = h('div', {className: 'cm-row cm-between'}, h('h3', null, '角色管理'), btn('刷新', () => { setNotice(''); reload(); }, {disabled: busy}));
    // The Host gives a settings section no way to open another one, so this is a pointer, not a link.
    const memoryNote = h('p', {className: 'cm-muted'}, '当前角色的记忆在 设置 → 记忆管理 中查看和修改；切换角色后那里显示新角色的记忆。');
    const warnings = (list?.profileWarnings ?? []).map(text => h('p', {key: text, role: 'alert', className: 'cm-error'}, text));
    const status = list?.switch && h('div', null,
      list.switch.pending && h('p', {role: 'status'}, `切换到「${named(list.switch.pending.target)}」${list.switch.inProgress ? '正在进行' : '已请求，等待处理'}。`),
      list.switch.result && h('p', {className: 'cm-muted'}, resultLine(list.switch.result)));

    const rows = characters.filter(c => !c.archived).map(c => h('article', {key: c.id, className: 'cm-item'},
      h('div', {className: 'cm-row'},
        btn(c.name, () => { setSelected(c.id); setTab('info'); setNotice(''); }, {variant: c.id === selected ? 'primary' : undefined}),
        c.current && h(Tag, null, '当前'),
        c.publicPending && h(Tag, null, '公开版待确认'),
        h('span', {className: 'cm-muted'}, `${c.tokens} token · 警告 ${c.warningCount}`),
        !c.current && !c.error && btn('切换到此角色', () => setConfirm({kind: 'switch', id: c.id, name: c.name}), {disabled: busy})),
      c.error && h('p', {className: 'cm-error'}, c.error)));
    const importer = importing
      ? h('div', {className: 'cm-box'},
        h('p', null, `导入「${importing.file.name}」`),
        h('label', null, '角色 id（小写字母、数字、连字符）', h(Input, {'aria-label': '角色 id', value: importing.id, onChange: e => setImporting({...importing, id: e.target.value})})),
        h('label', null, '对你的称呼（可留空）', h(Input, {'aria-label': '导入时的称呼', value: importing.userName, onChange: e => setImporting({...importing, userName: e.target.value})})),
        h('div', {className: 'cm-row'}, btn('导入', doImport, {variant: 'primary', disabled: busy || !importing.id}), btn('取消', () => setImporting(null), {disabled: busy})))
      : h('label', {className: 'cm-row'}, h('span', {className: 'cm-muted'}, '导入角色卡（.json / .png / .yaml）'),
        h('input', {type: 'file', accept: '.json,.png,.yaml,.yml', 'aria-label': '导入角色卡', onChange: e => {
          const file = e.target.files?.[0];
          if (file) setImporting({file, id: suggestId(file.name), userName: ''});
          e.target.value = '';
        }}));

    const confirmBox = confirm && h('div', {className: 'cm-box', role: 'alertdialog'},
      h('p', null, confirm.kind === 'switch' ? switchConfirmText(confirm.name) : archiveConfirmText(confirm.name)),
      h('div', {className: 'cm-row'},
        btn('确定', () => (confirm.kind === 'switch' ? doSwitch(confirm.id) : doArchive(confirm.id)), {variant: 'primary', disabled: busy}),
        btn('取消', () => setConfirm(null), {disabled: busy})));

    const area = (key, label, short) => h('label', null, label, h('textarea', {'aria-label': label, className: short ? 'cm-short' : '', value: draft[key], disabled: busy, onChange: e => update({[key]: e.target.value})}));
    const saveRow = h('div', {className: 'cm-row'}, btn('保存', save, {variant: 'primary', disabled: busy || !dirty}), dirty && h('span', {className: 'cm-muted'}, '有未保存的修改'),
      detail?.settings && selected && characters.find(c => c.id === selected)?.current && h('span', {className: 'cm-muted'}, '当前角色：保存后立即生效'));

    let body = null;
    if (detail && draft) {
      const {compiled, card} = detail;
      const panes = {
        info: h('div', {className: 'cm-box'}, field('卡名', compiled.name), field('规格', card ? `${card.spec.toUpperCase()}（${card.format}）` : null), field('Token', `Owner ${compiled.tokens.owner} · 公开版 ${compiled.tokens.public}`),
          h('div', null, h('span', {className: 'cm-muted'}, '警告'), compiled.warnings.length ? compiled.warnings.map((text, i) => h('p', {key: i}, text)) : h('p', {className: 'cm-muted'}, '没有警告')),
          h('div', {className: 'cm-row'}, btn('导出角色卡', doExport, {disabled: busy}),
            !characters.find(c => c.id === selected)?.current && btn('归档', () => setConfirm({kind: 'archive', id: selected, name: compiled.name}), {disabled: busy}))),
        rules: h('div', {className: 'cm-box'}, area('rules', '规则'), saveRow),
        reminder: h('div', {className: 'cm-box'}, h('p', {className: 'cm-muted'}, '每轮在对话末尾重复的简短提醒，最多 4000 字。'), area('reminder', '末尾提醒', true), saveRow),
        relationship: h('div', {className: 'cm-box'}, area('owner', 'Owner 关系', true), area('public', '公开关系（留空使用默认）', true),
          h('p', {className: 'cm-muted'}, '公开版里排除的设定字段'),
          h('div', {className: 'cm-row'}, EXCLUDABLE.map(([value, label]) => h('label', {key: value, className: 'cm-check'},
            h('input', {type: 'checkbox', checked: draft.exclude.includes(value), disabled: busy, onChange: e => update({exclude: e.target.checked ? [...draft.exclude, value] : draft.exclude.filter(x => x !== value)})}), label))),
          saveRow),
        settings: h('div', {className: 'cm-box'},
          h('label', null, '称呼', h(Input, {'aria-label': '称呼', value: draft.userName, disabled: busy, onChange: e => update({userName: e.target.value})})),
          h('label', null, '昵称（留空使用卡名）', h(Input, {'aria-label': '昵称', value: draft.nickname, disabled: busy, onChange: e => update({nickname: e.target.value})})),
          h('label', null, '等待提示（最多 200 字）', h(Input, {'aria-label': '等待提示', value: draft.hangOnText, disabled: busy, onChange: e => update({hangOnText: e.target.value})})),
          saveRow),
        preview: previewPane(),
      };
      body = h('section', {'aria-label': '角色详情', className: 'cm-box'}, h('h3', null, compiled.name),
        h(SegmentedTabs, {className: 'cm-tabs', label: '角色详情', items: TABS.map(([value, label]) => ({value, label})), value: tab, onChange: setTab}), panes[tab]);
    }

    function previewPane() {
      const view = audience === 'public' ? (preview?.pendingPublic ?? preview?.public) : preview && {...preview.owner, reminder: preview.reminder};
      const pending = audience === 'public' && preview?.pendingPublic;
      return h('div', {className: 'cm-box'},
        h(SegmentedTabs, {className: 'cm-tabs', label: '预览版本', items: [{value: 'owner', label: 'Owner 版'}, {value: 'public', label: '公开版'}], value: audience, onChange: setAudience}),
        !preview ? h('p', {role: 'status', className: 'cm-muted'}, error ? '预览失败，见上方提示。' : '正在生成预览…') : h(React.Fragment, null,
          audience === 'public' && h('div', {className: 'cm-row'}, h('span', {className: 'cm-muted'}, '含「用户」称呼的设定字段：'),
            preview.userFields.length ? preview.userFields.map(name => h(Tag, {key: name}, FIELD_NAMES[name] || name)) : h('span', {className: 'cm-muted'}, '无')),
          audience === 'public' && !preview.public && h('p', {className: 'cm-muted'}, WARNING_HINT.pending),
          audience === 'public' && view && h('p', {className: 'cm-muted'}, pending ? (preview.public ? '以下是待确认的新公开版（当前生效的是旧版本，确认后才会替换）：' : '以下是待确认的公开版：') : '当前生效的公开版：'),
          view ? h(React.Fragment, null, h('pre', null, view.prefix), h('pre', null, view.suffix), h('pre', null, view.reminder)) : null,
          pending && h('div', {className: 'cm-row'}, btn('确认公开版', approve, {variant: 'primary', disabled: busy || dirty}), dirty && h('span', {className: 'cm-muted'}, '请先保存修改，再确认公开版')),
          h('p', {className: 'cm-muted'}, `Token：Owner ${preview.tokens.owner} · 公开版 ${preview.tokens.public}`),
          preview.warnings.map((text, i) => h('p', {key: i, className: 'cm-muted'}, text))));
    }

    return h('section', {className: 'dsh-cm', 'aria-label': '角色管理'}, header, memoryNote, warnings, status,
      notice && h('p', {role: 'status'}, notice), error && h('div', {role: 'alert', className: 'cm-error'}, h('p', null, error)),
      confirmBox, importer,
      list ? (rows.length ? h('div', null, rows) : h('p', {className: 'cm-muted'}, '还没有角色，请先导入角色卡。')) : h('p', {role: 'status', className: 'cm-muted'}, '正在读取角色列表…'),
      body);
  }

  class PageBoundary extends React.Component {
    constructor(props) { super(props); this.state = {failed: false, version: 0}; }
    static getDerivedStateFromError() { return {failed: true}; }
    render() {
      return this.state.failed
        ? h('section', {className: 'dsh-cm', 'aria-label': '角色管理'}, h('h3', null, '角色管理'), h('p', {role: 'alert'}, '角色管理页面渲染失败，请重新加载。'),
          btn('重新加载角色管理', () => this.setState(s => ({failed: false, version: s.version + 1}))))
        : h(Page, {...this.props, key: this.state.version});
    }
  }
  PageBoundary.helpers = {uploadCard, approvePublic, switchConfirmText, archiveConfirmText, Page};

  function apply(ctx, config = {}) {
    if (config.enabled === false) return;
    const pending = new Set();
    let disposed = false;
    const api = async (operation, args = {}, signal) => {
      if (disposed) throw new Error('角色管理已关闭');
      const abort = new AbortController();
      pending.add(abort);
      const cancel = () => abort.abort();
      signal?.addEventListener('abort', cancel, {once: true});
      if (signal?.aborted) abort.abort();
      const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
      let result;
      try {
        result = await ctx.connection.rpc.call('/character-manager', 'api', {operation, ...args}, abort.signal);
      } catch (error) {
        throw new Error(disposed ? '角色管理已关闭' : abort.signal.aborted ? '请求已取消或等待超时，请检查本机连接后重试。' : RESTARTING);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        pending.delete(abort);
      }
      if (disposed) throw new Error('角色管理已关闭');
      if (!result || typeof result.ok !== 'boolean') throw new Error('角色管理返回了无效响应，请刷新重试。');
      if (!result.ok) throw new Error(result.error?.code === 'character/409' ? CONFLICT : (result.error?.message || '角色管理请求失败，请重试。'));
      return result.value;
    };
    ctx.effect(() => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      return () => {
        disposed = true;
        for (const abort of pending) abort.abort();
        pending.clear();
        style.remove();
      };
    });
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'character-manager', order: 66, label: () => '角色管理', inject: () => ({api}),
    }, PageBoundary));
  }
  return {inject: ['slots', 'connection'], apply};
}});
