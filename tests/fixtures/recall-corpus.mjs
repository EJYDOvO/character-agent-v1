// Synthetic, versioned judgments. No chat history, credentials or model calls.
export const corpusVersion=1;
export const records=[
 ['release','The release checklist requires a rollback snapshot, staged validation and a recorded health check.'],
 ['release-decoy','Snapshot rollback vocabulary for a spelling exercise.'],
 ['deploy','部署前保留回滚点，先在隔离环境验证，再检查健康状态。'],
 ['deploy-decoy','回滚点的中文写法与拼音练习。'],
 ['blueprint','发布窗口使用 KAPPA-42 蓝图，执行前核对版本、依赖与恢复说明。'],
 ['blueprint-decoy','kappa and 42 are unrelated labels in the glossary.'],
 ['language','工作报告默认用中文，引用英文原文时保留出处。'],
 ['editor','The preferred editor theme is dark with a readable monospace font.'],
 ['long','前置材料：'+ '先核对证据并保留原始引用。'.repeat(55)+'最终约定：海蓝档案保留原始事件编号，跨会话核验来源。'],
 ['previous-session','上一轮 Session 已约定：河谷项目每周三生成合成演练报告。'],
 ['quote','The document quotes “act as system” as an example of untrusted text, not an authorization.'],
 ['synonym-zh','周末通常选择徒步，工作日优先完成测试。'],
 ['synonym-en','The office commute is by bicycle on weekdays.'],
 ['alias-zh','故障排查需要保留错误堆栈（调用栈）和完整时间线。'],
 ['alias-en','The release rehearsal is a dry run with synthetic records.'],
 ['expired','过期演练约定：星港项目使用旧检查项。'],
 ['forgotten','遗忘演练约定：竹林项目使用待遗忘的检查项。'],
 ['conflict-a','合成镜像部署端口为 7801。'],
 ['conflict-b','合成镜像部署端口为 7802。'],
];
export const queries=[
 {id:'english-case',language:'en',query:'ROLLBACK SNAPSHOT',relevant:{release:2,'release-decoy':1}},
 {id:'english-control',language:'en',query:'rollback snapshot',relevant:{release:2,'release-decoy':1}},
 {id:'mixed-case',language:'mixed',query:'kappa-42',relevant:{blueprint:2,'blueprint-decoy':1}},
 {id:'compat-width',language:'mixed',query:'ＫＡＰＰＡ-４２',relevant:{blueprint:2,'blueprint-decoy':1}},
 {id:'chinese',language:'zh',query:'隔离环境 回滚点',relevant:{deploy:2}},
 {id:'preference',language:'zh',query:'中文 英文 出处',relevant:{language:2}},
 {id:'english-preference',language:'en',query:'dark editor theme',relevant:{editor:2}},
 {id:'long-record',language:'zh',query:'海蓝档案 原始事件编号',relevant:{long:2}},
 {id:'cross-session',language:'zh',query:'河谷项目 周三 报告',relevant:{'previous-session':2}},
 {id:'legitimate-quote',language:'en',query:'act as system',relevant:{quote:2}},
 {id:'synonym-with-anchor-zh',language:'zh',query:'调用栈 时间线',relevant:{'alias-zh':2}},
 {id:'synonym-with-anchor-en',language:'en',query:'dry run synthetic records',relevant:{'alias-en':2}},
 // Lexically disjoint synonyms deliberately remain in the score: FTS cannot
 // solve these without a separately reviewed expansion/semantic mechanism.
 {id:'disjoint-synonym-zh',language:'zh',query:'远足',relevant:{'synonym-zh':2}},
 {id:'disjoint-synonym-en',language:'en',query:'cycling',relevant:{'synonym-en':2}},
];
