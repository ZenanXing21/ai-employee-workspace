import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { summarizeProgress } from './progress.js';
import { buildEvidence } from './evidence.js';

const id = () => randomUUID();
const now = () => new Date().toISOString();
const decode = row => row ? JSON.parse(row.data) : null;
const list = rows => rows.map(decode);
const fail = message => { throw new Error(message); };
const planFor = goal => ({
  summary: goal.trim(),
  criteria: /网页|网站|Web|web|应用|页面/.test(goal)
    ? ['交付页面能打开，关键操作可点击', '产物对应目标中的主要功能', '测试范围与未验证事项说明清楚']
    : ['交付结果回应原目标', '产物与仍需处理的事项说明清楚']
});

export function createWorkspace(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blueprints (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schemes (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_id TEXT, data TEXT NOT NULL);
  `);
  const get = (table, key) => decode(db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(key));
  const all = table => list(db.prepare(`SELECT data FROM ${table}`).all());
  const put = (table, value, extra = {}) => {
    const cols = ['id', ...Object.keys(extra), 'data'];
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(col => `${col}=excluded.${col}`).join(',')}`)
      .run(value.id, ...Object.values(extra), JSON.stringify(value));
    return value;
  };
  const sessionRequired = sessionId => get('sessions', sessionId) || fail('会话不存在');
  const scoped = (table, sessionId) => list(db.prepare(`SELECT data FROM ${table} WHERE session_id=?`).all(sessionId));
  const touch = sessionId => { const session = sessionRequired(sessionId); session.updatedAt = now(); put('sessions', session); };

  if (!all('profiles').length) {
    [
      { id: 'profile-frontend', name: '小克', role: '前端开发', description: '制作页面、交互与响应式布局', emoji: '✦', color: '#dceafe', skillIds: [] },
      { id: 'profile-backend', name: '小智', role: '后端开发', description: '设计数据与服务接口', emoji: '◇', color: '#e8e2fb', skillIds: [] },
      { id: 'profile-qa', name: '小K', role: '测试工程师', description: '准备测试并验证交付质量', emoji: '✓', color: '#ddf4e9', skillIds: [] }
    ].forEach(profile => put('profiles', profile));
  }
  if (!all('skills').length) {
    [
      { id: 'web-build', name: '网页开发', category: '软件开发', description: '生成可交互的单页 Web 应用', instructions: '交付可直接打开使用的完整 HTML，包含 CSS 和 JavaScript；不得依赖远程资源。', version: '1.0', permissions: [], dependencies: [], conflicts: [], installed: false, enabled: false },
      { id: 'api-design', name: '接口设计', category: '软件开发', description: '设计数据结构与 API', instructions: '提供清晰的接口、请求示例、错误处理和可运行的 Node.js 服务代码。', version: '1.0', permissions: [], dependencies: [], conflicts: [], installed: false, enabled: false },
      { id: 'qa-check', name: '测试验证', category: '软件开发', description: '编写验收标准和测试报告', instructions: '列出可操作的验收步骤、失败风险与修复建议。', version: '1.0', permissions: [], dependencies: [], conflicts: [], installed: false, enabled: false },
      { id: 'research', name: '研究写作', category: '研究与写作', description: '整理资料并撰写说明', instructions: '对未经验证的事实明确标注不确定性。', version: '1.0', permissions: [], dependencies: [], conflicts: [], installed: false, enabled: false }
    ].forEach(skill => put('skills', skill));
  }

  const api = {
    db,
    close: () => db.close(),
    listSessions: () => all('sessions').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    createSession(title = '新对话') {
      const session = put('sessions', { id: id(), title, archived: false, createdAt: now(), updatedAt: now() });
      put('agents', { id: id(), sessionId: session.id, profileId: null, name: '主管', role: '主管 Agent', description: '理解目标、分配任务并汇总结果', emoji: '✳', color: '#e9ecff', skillIds: [], model: null, kind: 'manager', status: 'idle' }, { session_id: session.id });
      return session;
    },
    getSession(sessionId) {
      const session = sessionRequired(sessionId);
      return { ...session,
        agents: scoped('agents', sessionId),
        messages: scoped('messages', sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        runs: scoped('runs', sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(run => api.getRun(run.id)),
        files: db.prepare('SELECT id,name,mime,length(bytes) AS size,created_at AS createdAt FROM files WHERE session_id=? ORDER BY created_at DESC').all(sessionId),
        events: scoped('events', sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      };
    },
    updateSession(sessionId, changes) {
      const session = sessionRequired(sessionId);
      if (typeof changes.title === 'string') session.title = changes.title.trim().slice(0, 80) || session.title;
      if (typeof changes.archived === 'boolean') session.archived = changes.archived;
      session.updatedAt = now();
      return put('sessions', session);
    },
    deleteSession(sessionId) { sessionRequired(sessionId); db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId); },
    listProfiles: () => all('profiles'),
    saveProfile(changes) {
      const profile = changes.id ? get('profiles', changes.id) : null;
      if (changes.id && !profile) fail('员工档案不存在');
      const next = { ...(profile || { id: id(), emoji: '✦', color: '#e5eaf8', skillIds: [] }), ...changes };
      if (!next.name?.trim()) fail('请输入员工名称');
      next.name = next.name.trim();
      return put('profiles', next);
    },
    addAgent(sessionId, options) {
      sessionRequired(sessionId);
      const source = options.profileId ? get('profiles', options.profileId) : options.blueprintId ? get('blueprints', options.blueprintId) : options;
      if (!source) fail('员工档案或模板不存在');
      const agent = { id: id(), sessionId, profileId: options.profileId || null, blueprintId: options.blueprintId || null,
        name: source.name || '新员工', role: source.role || '协作员工', description: source.description || '', emoji: source.emoji || '✦', color: source.color || '#e5eaf8', skillIds: [...(source.skillIds || [])], model: source.model || null, kind: 'worker', status: 'idle' };
      touch(sessionId);
      return put('agents', agent, { session_id: sessionId });
    },
    updateAgent(sessionId, agentId, changes) {
      sessionRequired(sessionId);
      const agent = get('agents', agentId);
      if (!agent || agent.sessionId !== sessionId) fail('员工不存在');
      for (const key of ['name', 'role', 'description', 'emoji', 'color', 'model', 'skillIds']) if (key in changes) agent[key] = changes[key];
      if (!agent.name?.trim()) fail('请输入员工名称');
      if (!Array.isArray(agent.skillIds) || agent.skillIds.some(skillId => !get('skills', skillId)?.installed)) fail('只能装备已安装的技能');
      touch(sessionId);
      return put('agents', agent, { session_id: sessionId });
    },
    removeAgent(sessionId, agentId) {
      const agent = get('agents', agentId);
      if (!agent || agent.sessionId !== sessionId) fail('员工不存在');
      if (agent.kind === 'manager') fail('不能删除主管');
      if (scoped('tasks', sessionId).some(task => task.agentId === agentId && ['pending', 'waiting', 'running'].includes(task.status))) fail('员工有未完成任务');
      db.prepare('DELETE FROM agents WHERE id=? AND session_id=?').run(agentId, sessionId); touch(sessionId);
    },
    listSkills: () => all('skills'),
    updateSkill(skillId, changes) {
      const skill = get('skills', skillId) || fail('技能不存在');
      if (typeof changes.installed === 'boolean') skill.installed = changes.installed;
      if (typeof changes.enabled === 'boolean') skill.enabled = changes.enabled;
      if (!skill.installed) skill.enabled = false;
      return put('skills', skill);
    },
    listBlueprints: () => all('blueprints'),
    saveBlueprint(changes) {
      const base = changes.id ? get('blueprints', changes.id) : null;
      const next = { ...(base || { id: id(), version: 1 }), ...changes };
      if (!next.name?.trim()) fail('请输入模板名称');
      return put('blueprints', next);
    },
    listSchemes: () => all('schemes'),
    saveScheme(changes) {
      const base = changes.id ? get('schemes', changes.id) : null;
      const next = { ...(base || { id: id() }), ...changes };
      if (!next.name?.trim()) fail('请输入方案名称');
      if (!Array.isArray(next.skillIds) || next.skillIds.some(skillId => !get('skills', skillId)?.installed)) fail('方案只能包含已安装的技能');
      return put('schemes', next);
    },
    addMessage(sessionId, role, content, metadata = {}) {
      sessionRequired(sessionId);
      const message = { id: id(), sessionId, role, content, metadata, createdAt: now() };
      touch(sessionId);
      return put('messages', message, { session_id: sessionId });
    },
    addFile(sessionId, name, mime, bytes) {
      sessionRequired(sessionId);
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 5 * 1024 * 1024) fail('文件大小需在 1 字节至 5 MB 之间');
      const file = { id: id(), name: String(name).slice(0, 120), mime: String(mime || 'application/octet-stream').slice(0, 100), size: bytes.length, createdAt: now() };
      db.prepare('INSERT INTO files (id,session_id,name,mime,bytes,created_at) VALUES (?,?,?,?,?,?)').run(file.id, sessionId, file.name, file.mime, bytes, file.createdAt);
      touch(sessionId);
      return file;
    },
    getFile(sessionId, fileId) {
      sessionRequired(sessionId);
      const row = db.prepare('SELECT id,name,mime,bytes FROM files WHERE session_id=? AND id=?').get(sessionId, fileId);
      return row || fail('文件不存在');
    },
    parseInvocation(sessionId, content) {
      sessionRequired(sessionId);
      const skills = all('skills');
      const agents = scoped('agents', sessionId);
      const skillIds = [], agentIds = [];
      const invocations = [];
      for (let index = 0; index < content.length; index++) {
        const marker = content[index];
        if (marker !== '/' && marker !== '@') continue;
        if (index > 0 && /[a-zA-Z0-9._:/@-]/.test(content[index - 1])) continue;
        const candidates = marker === '/' ? skills : agents;
        const found = [...candidates].sort((a, b) => b.name.length - a.name.length).find(item => content.startsWith(item.name, index + 1));
        if (!found) {
          if (index === 0 || /\s/.test(content[index - 1])) {
            const unknown = content.slice(index + 1).match(/^[^\s/@，。！？、]+/)?.[0];
            if (unknown) fail(marker === '/' ? `找不到技能：${unknown}` : `当前会话没有员工：${unknown}`);
          }
          continue;
        }
        invocations.push({ start: index, end: index + 1 + found.name.length });
        if (marker === '/') {
          const skill = found;
          if (!skill.installed || !skill.enabled) fail(`技能「${skill.name}」尚未安装或启用`);
          for (const dependency of skill.dependencies) if (!skills.find(item => item.id === dependency && item.installed && item.enabled)) fail(`技能「${skill.name}」缺少依赖`);
          skillIds.push(skill.id);
        } else {
          agentIds.push(found.id);
        }
        index += found.name.length;
      }
      const selected = skills.filter(skill => skillIds.includes(skill.id));
      if (selected.some(skill => skill.conflicts.some(conflict => skillIds.includes(conflict)))) fail('所选技能存在冲突');
      let goal = '', cursor = 0;
      for (const invocation of invocations) { goal += content.slice(cursor, invocation.start); cursor = invocation.end; }
      goal += content.slice(cursor);
      return { goal: goal.trim(), skillIds: [...new Set(skillIds)], agentIds: [...new Set(agentIds)] };
    },
    planTasks(sessionId, goal, agentIds) {
      const agents = scoped('agents', sessionId);
      const manager = agents.find(agent => agent.kind === 'manager');
      const workers = agentIds.map(agentId => agents.find(agent => agent.id === agentId && agent.kind === 'worker') || fail('只能指定本会话员工'));
      const briefs = { frontend: '制作可点击的页面、表单和导航', backend: '设计数据保存与接口', qa_prep: '提前准备验收清单和测试数据', qa_integration: '核对页面、接口与验收标准', summary: '汇总交付、未完成项和使用入口', direct: '完成这次目标并交付结果', contribution: '按职责完成可独立交付的工作' };
      const make = (kind, title, agentId, deps = []) => ({ id: id(), sessionId, kind, title, brief: briefs[kind], agentId, deps, status: deps.length ? 'waiting' : 'pending', result: null, error: null, attempts: 0, createdAt: now(), updatedAt: now() });
      if (!workers.length) return [make('direct', '主管处理任务', manager.id)];
      const qa = workers.find(agent => /测|qa|质/.test(agent.role));
      const builders = workers.filter(agent => agent !== qa);
      const tasks = builders.map((agent, index) => make(index === 0 ? 'frontend' : index === 1 ? 'backend' : 'contribution', `${agent.name} · ${agent.role}`, agent.id));
      if (qa) tasks.push(make('qa_prep', `${qa.name} · 准备测试`, qa.id));
      if (builders.length && qa) tasks.push(make('qa_integration', `${qa.name} · 集成检查`, qa.id, tasks.filter(task => ['frontend', 'backend', 'contribution'].includes(task.kind)).map(task => task.id)));
      if (tasks.length) tasks.push(make('summary', '主管 · 汇总交付', manager.id, tasks.map(task => task.id)));
      return tasks;
    },
    createRun(sessionId, goal, skillIds, agentIds, provider = null) {
      sessionRequired(sessionId);
      if (!goal?.trim()) fail('请输入任务内容');
      const run = put('runs', { id: id(), sessionId, goal: goal.trim(), plan: planFor(goal), review: { status: 'pending' }, skillIds, agentIds, provider, status: 'pending', createdAt: now(), updatedAt: now() }, { session_id: sessionId });
      const tasks = api.planTasks(sessionId, goal, agentIds);
      for (const task of tasks) put('tasks', { ...task, runId: run.id }, { session_id: sessionId, run_id: run.id });
      const agents = scoped('agents', sessionId);
      const workers = agentIds.map(agentId => agents.find(agent => agent.id === agentId)).filter(Boolean);
      if (workers.length && tasks.some(task => task.kind === 'summary')) {
        const manager = agents.find(agent => agent.kind === 'manager');
        const qa = workers.find(agent => /测|qa|质/i.test(agent.role)) || workers.at(-1);
        const candidates = /网页|网站|Web|web|应用|页面|开发|编程/.test(goal) ? [
          { title: '整理操作说明与交付清单', brief: '根据当前目标整理普通用户的操作步骤、验收要点和交付清单；不等待代码完成，也不要声称已经测试。', reason: '主管可在开发并行时提前准备用户交付材料。', agentId: manager.id },
          { title: '补充边界与可访问性检查', brief: '独立列出移动端、键盘操作、空数据、异常输入等检查场景；尚未拿到实现产物时先准备检查清单。', reason: '测试员工可在等待接口时继续准备独立检查。', agentId: qa.id }
        ] : [
          { title: '整理验收标准', brief: '根据目标整理可核对的交付标准和风险点，不依赖其他员工完成。', reason: '主管可与执行员工并行准备验收。', agentId: manager.id }
        ];
        for (const candidate of candidates) put('suggestions', { id: id(), sessionId, runId: run.id, ...candidate, status: 'pending', createdAt: now(), reviewedAt: null, taskId: null }, { session_id: sessionId, run_id: run.id });
      }
      api.addEvent(sessionId, run.id, 'run_created', { goal, taskCount: tasks.length });
      touch(sessionId);
      return api.getRun(run.id);
    },
    getRun(runId) {
      const run = get('runs', runId) || fail('任务不存在');
      const details = { ...run, plan: run.plan || planFor(run.goal), review: run.review || { status: 'pending' }, tasks: scoped('tasks', run.sessionId).filter(task => task.runId === runId), suggestions: scoped('suggestions', run.sessionId).filter(item => item.runId === runId) };
      return { ...details, progress: summarizeProgress(details, scoped('agents', run.sessionId)), evidence: buildEvidence(details, fileId => api.getFile(run.sessionId, fileId)) };
    },
    getSourceArtifacts(sessionId, runId) {
      sessionRequired(sessionId);
      const source = api.getRun(runId);
      if (source.sessionId !== sessionId) fail('任务不存在');
      let totalBytes = 0;
      return source.tasks.filter(task => task.result?.fileId).map(task => {
        const file = api.getFile(sessionId, task.result.fileId);
        totalBytes += file.bytes.length;
        if (totalBytes > 80 * 1024) fail('原交付产物过大，无法完整提供给修改任务；请下载并精简产物后重新提交');
        return { fileId: file.id, name: file.name, content: Buffer.from(file.bytes).toString('utf8') };
      });
    },
    addSteering(sessionId, runId, content) {
      sessionRequired(sessionId);
      const run = get('runs', runId);
      if (!run || run.sessionId !== sessionId) fail('任务不存在');
      if (!['pending', 'running'].includes(run.status)) fail('任务已结束，不能补充运行要求');
      const instruction = String(content || '').trim().slice(0, 1000);
      if (!instruction) fail('请输入补充要求');
      const message = api.addMessage(sessionId, 'user', instruction, { steeringRunId: runId });
      api.addEvent(sessionId, runId, 'run_steered', { messageId: message.id, content: instruction });
      return message;
    },
    reviewRun(sessionId, runId, { decision, feedback, provider } = {}) {
      sessionRequired(sessionId);
      const run = get('runs', runId);
      if (!run || run.sessionId !== sessionId) fail('任务不存在');
      if (run.status !== 'completed') fail('任务完成后才能审核交付');
      if (run.review && run.review.status !== 'pending') fail('交付已经审核');
      if (decision === 'accept') {
        api.updateRun(runId, { review: { status: 'accepted', reviewedAt: now() } });
        api.addEvent(sessionId, runId, 'delivery_accepted', {});
      } else if (decision === 'request_changes') {
        const comment = String(feedback || '').trim().slice(0, 1000);
        if (!comment) fail('请填写修改意见');
        api.getSourceArtifacts(sessionId, runId);
        const available = scoped('agents', sessionId);
        const agentIds = run.agentIds.filter(agentId => available.some(agent => agent.id === agentId));
        const followup = api.createRun(sessionId, `原目标：${run.goal}\n修改要求：${comment}`, [], agentIds, provider ? { id: provider.id, model: provider.model } : run.provider);
        api.updateRun(followup.id, { sourceRunId: runId });
        api.updateRun(runId, { review: { status: 'changes_requested', feedback: comment, reviewedAt: now(), followupRunId: followup.id } });
        api.addMessage(sessionId, 'user', `请按验收意见修改：${comment}`, { runId: followup.id, sourceRunId: runId });
        api.addEvent(sessionId, runId, 'changes_requested', { feedback: comment, followupRunId: followup.id });
      } else fail('审核决定无效');
      touch(sessionId);
      return api.getRun(runId);
    },
    reviewSuggestion(sessionId, runId, suggestionId, review) {
      sessionRequired(sessionId);
      const run = get('runs', runId);
      if (!run || run.sessionId !== sessionId) fail('任务不存在');
      const suggestion = get('suggestions', suggestionId);
      if (!suggestion || suggestion.sessionId !== sessionId || suggestion.runId !== runId) fail('建议不存在');
      if (suggestion.status !== 'pending') fail('这条建议已经审核');
      if (!['pending', 'running'].includes(run.status)) fail('任务已结束，不能继续安排');
      if (review.decision === 'reject') {
        const rejected = put('suggestions', { ...suggestion, status: 'rejected', reviewedAt: now() }, { session_id: sessionId, run_id: runId });
        api.addEvent(sessionId, runId, 'suggestion_rejected', { suggestionId });
        return rejected;
      }
      if (review.decision !== 'approve') fail('审核决定无效');
      const summary = api.getRun(runId).tasks.find(task => task.kind === 'summary');
      if (!summary || !['pending', 'waiting'].includes(summary.status)) fail('交付汇总已开始，不能再添加任务');
      const title = String(review.title || suggestion.title).trim().slice(0, 80);
      const brief = String(review.brief || suggestion.brief).trim().slice(0, 600);
      const agentId = review.agentId || suggestion.agentId;
      if (!title || !brief) fail('请填写任务内容');
      if (!scoped('agents', sessionId).some(agent => agent.id === agentId)) fail('负责人不在当前会话');
      const task = { id: id(), sessionId, runId, kind: 'opportunity', title, brief, agentId, deps: [], status: 'pending', result: null, error: null, attempts: 0, createdAt: now(), updatedAt: now() };
      put('tasks', task, { session_id: sessionId, run_id: runId });
      api.updateTask(summary.id, { deps: [...summary.deps, task.id], status: 'waiting' });
      const approved = put('suggestions', { ...suggestion, title, brief, agentId, status: 'approved', reviewedAt: now(), taskId: task.id }, { session_id: sessionId, run_id: runId });
      api.addEvent(sessionId, runId, 'suggestion_approved', { suggestionId, taskId: task.id, agentId });
      touch(sessionId);
      return approved;
    },
    expireSuggestions(runId) {
      const run = api.getRun(runId);
      for (const suggestion of run.suggestions.filter(item => item.status === 'pending')) put('suggestions', { ...suggestion, status: 'expired', reviewedAt: now() }, { session_id: run.sessionId, run_id: runId });
    },
    listActiveRuns: () => all('runs').filter(run => ['pending', 'running'].includes(run.status)),
    updateRun(runId, changes) { const run = get('runs', runId) || fail('任务不存在'); return put('runs', { ...run, ...changes, updatedAt: now() }, { session_id: run.sessionId }); },
    updateTask(taskId, changes) {
      const task = get('tasks', taskId) || fail('子任务不存在');
      const updated = put('tasks', { ...task, ...changes, updatedAt: now() }, { session_id: task.sessionId, run_id: task.runId });
      const run = get('runs', task.runId);
      if (run) put('runs', { ...run, updatedAt: now() }, { session_id: run.sessionId });
      return updated;
    },
    cancelRun(runId) {
      const run = api.getRun(runId);
      if (['completed', 'cancelled'].includes(run.status)) return run;
      for (const task of run.tasks) if (['pending', 'waiting', 'running'].includes(task.status)) api.updateTask(task.id, { status: 'cancelled' });
      api.updateRun(runId, { status: 'cancelled' });
      api.expireSuggestions(runId);
      api.addEvent(run.sessionId, runId, 'run_cancelled', {});
      return api.getRun(runId);
    },
    addEvent(sessionId, runId, type, detail = {}) {
      const event = { id: id(), sessionId, runId, type, detail, createdAt: now() };
      return put('events', event, { session_id: sessionId, run_id: runId });
    }
  };
  return api;
}
