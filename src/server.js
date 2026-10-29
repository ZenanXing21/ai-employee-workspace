import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspace } from './workspace.js';
import { createScheduler } from './scheduler.js';
import { createProviderRegistry } from './provider.js';
import { createPreviewServer } from './preview.js';

const publicDir = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const errorStatus = error => error.code === 'ENOENT' || /不存在|找不到/.test(error.message) ? 404 : 400;

async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8 * 1024 * 1024) throw new Error('请求内容过大');
  }
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error('请求格式无效'); }
}

export function createServer(app, scheduler, { providerRegistry = null, keyConfigured = !!process.env.MOONSHOT_API_KEY, model = process.env.MOONSHOT_MODEL || 'kimi-k2.5', previewPort = Number(process.env.PREVIEW_PORT || 4174), publicOrigin = process.env.PUBLIC_ORIGIN || '', previewPublicUrl = process.env.PREVIEW_PUBLIC_URL || '' } = {}) {
  return httpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method;
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && req.headers?.origin && !new Set([`http://${req.headers.host}`, publicOrigin]).has(req.headers.origin)) return json(res, 403, { error: '请求来源无效' });
      if (parts[0] !== 'api') {
        const file = parts.length ? join(publicDir, ...parts) : join(publicDir, 'index.html');
        if (!resolve(file).startsWith(publicDir)) return json(res, 404, { error: '页面不存在' });
        const bytes = await readFile(file);
        res.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(bytes);
        return;
      }
      if (parts[1] === 'health' && method === 'GET') return json(res, 200, { ok: true });
      if (parts[1] === 'bootstrap' && method === 'GET') return json(res, 200, {
        sessions: app.listSessions(), profiles: app.listProfiles(), skills: app.listSkills(), blueprints: app.listBlueprints(), schemes: app.listSchemes(), previewBaseUrl: previewPublicUrl.replace(/\/$/, '') || `http://127.0.0.1:${previewPort}`,
        provider: providerRegistry?.status() || { id: 'kimi', name: 'Kimi', model, configured: keyConfigured, providers: [{ id: 'kimi', name: 'Kimi', models: [model], configured: keyConfigured }] }
      });
      if (parts[1] === 'provider' && providerRegistry) {
        if (parts.length === 2 && method === 'POST') {
          const status = providerRegistry.configure(await readBody(req));
          if (status.configured) scheduler.recover();
          return json(res, 200, status);
        }
        if (parts[2] === 'test' && method === 'POST') return json(res, 200, await providerRegistry.testConnection());
      }
      if (parts[1] === 'sessions' && parts.length === 2) {
        if (method === 'GET') return json(res, 200, app.listSessions());
        if (method === 'POST') return json(res, 201, app.createSession((await readBody(req)).title));
      }
      if (parts[1] === 'sessions' && parts[2]) {
        const sessionId = parts[2];
        if (parts.length === 3) {
          if (method === 'GET') return json(res, 200, app.getSession(sessionId));
          if (method === 'PATCH') return json(res, 200, app.updateSession(sessionId, await readBody(req)));
          if (method === 'DELETE') { app.deleteSession(sessionId); return json(res, 200, { ok: true }); }
        }
        if (parts[3] === 'agents') {
          if (parts.length === 4 && method === 'POST') return json(res, 201, app.addAgent(sessionId, await readBody(req)));
          if (parts.length === 5 && method === 'PATCH') return json(res, 200, app.updateAgent(sessionId, parts[4], await readBody(req)));
          if (parts.length === 5 && method === 'DELETE') { app.removeAgent(sessionId, parts[4]); return json(res, 200, { ok: true }); }
        }
        if (parts[3] === 'runs' && parts[4] && (parts.length === 5 || parts.length === 6)) {
          const run = app.getRun(parts[4]);
          if (run.sessionId !== sessionId) throw new Error('任务不存在');
          if (parts.length === 5 && method === 'GET') return json(res, 200, run);
          if (parts.length === 6 && parts[5] === 'cancel' && method === 'POST') { scheduler.cancel(run.id); return json(res, 200, app.getRun(run.id)); }
          if (parts.length === 6 && parts[5] === 'retry' && method === 'POST') return json(res, 200, scheduler.retry(run.id));
        }
        if (parts[3] === 'runs' && parts[4] && parts.length === 6 && method === 'POST') {
          if (parts[5] === 'steer') return json(res, 200, app.addSteering(sessionId, parts[4], (await readBody(req)).content));
          if (parts[5] === 'review') {
            const review = await readBody(req);
            if (review.decision === 'request_changes' && providerRegistry && !providerRegistry.status().configured) return json(res, 409, { error: '请先在设置中连接模型，再要求修改' });
            const currentProvider = providerRegistry?.status();
            const result = app.reviewRun(sessionId, parts[4], { ...review, provider: currentProvider?.configured ? { id: currentProvider.id, model: currentProvider.model } : undefined });
            if (result.review.status === 'changes_requested') scheduler.kick();
            return json(res, 200, result);
          }
        }
        if (parts[3] === 'runs' && parts[5] === 'suggestions' && parts[6] && method === 'POST') {
          const review = await readBody(req);
          const suggestion = app.reviewSuggestion(sessionId, parts[4], parts[6], review);
          if (suggestion.status === 'approved') scheduler.kick();
          return json(res, 200, { suggestion, run: app.getRun(parts[4]) });
        }
        if (parts[3] === 'messages' && method === 'POST') {
          const { content } = await readBody(req);
          if (!content?.trim()) throw new Error('请输入任务内容');
          const session = app.getSession(sessionId);
          if (/^(帮我)?(?:(?:进行)?(?:文件|应用|网页|页面|产物)的?)?(打开|预览|查看)(一下)?(?:文件|应用|网页|页面|产物)?[。！!？?\s]*$/.test(content.trim())) {
            const file = [...session.files].reverse().find(item => /\.html?$/i.test(item.name));
            if (!file) throw new Error('当前对话还没有可打开的网页应用');
            app.addMessage(sessionId, 'user', content);
            app.addMessage(sessionId, 'assistant', '应用已经准备好，点击下方按钮即可打开。', { fileId: file.id });
            return json(res, 200, { opened: file.id });
          }
          const provider = providerRegistry?.status() || { id: 'kimi', name: 'Kimi', model, configured: keyConfigured };
          if (!provider.configured) return json(res, 409, { error: `${provider.name} 尚未连接。请到设置页面输入 API 密钥。` });
          const parsed = app.parseInvocation(sessionId, content);
          if (!parsed.goal) throw new Error('请输入任务内容');
          if (session.title === '新对话') app.updateSession(sessionId, { title: parsed.goal.slice(0, 28) });
          const explicitWorkers = parsed.agentIds.filter(agentId => session.agents.some(agent => agent.id === agentId && agent.kind === 'worker'));
          const autoWorkers = /网页|网站|Web|web|应用|页面|开发|编程/.test(parsed.goal) ? session.agents.filter(agent => agent.kind === 'worker').slice(0, 3).map(agent => agent.id) : [];
          const selectedAgents = parsed.agentIds.length ? explicitWorkers : autoWorkers;
          const run = app.createRun(sessionId, parsed.goal, parsed.skillIds, selectedAgents, { id: provider.id, model: provider.model });
          app.addMessage(sessionId, 'user', content, { skillIds: parsed.skillIds, agentIds: selectedAgents, runId: run.id });
          scheduler.kick();
          return json(res, 201, run);
        }
        if (parts[3] === 'files') {
          if (parts.length === 4 && method === 'POST') {
            const body = await readBody(req);
            const bytes = Buffer.from(body.base64 || '', 'base64');
            return json(res, 201, app.addFile(sessionId, body.name || 'file', body.mime || 'application/octet-stream', bytes));
          }
          if (parts.length === 5 && method === 'GET') {
            const file = app.getFile(sessionId, parts[4]);
            res.writeHead(200, { 'Content-Type': file.mime, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff' });
            return res.end(file.bytes);
          }
          if (parts.length === 6 && parts[5] === 'preview' && method === 'GET') {
            const file = app.getFile(sessionId, parts[4]);
            if (!/^text\/(html|plain|markdown)/.test(file.mime) && !/javascript/.test(file.mime)) throw new Error('此文件不能预览');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
            return res.end(file.bytes);
          }
        }
      }
      if (parts[1] === 'skills' && parts[2] && parts[3] === 'test' && method === 'POST' && providerRegistry) {
        const skill = app.listSkills().find(item => item.id === parts[2]);
        if (!skill) throw new Error('技能不存在');
        if (!skill.installed || !skill.enabled) throw new Error('请先安装并启用技能');
        const provider = providerRegistry.status();
        if (!provider.configured) return json(res, 409, { error: '请先连接模型服务' });
        const kind = { 'web-build': 'frontend', 'api-design': 'backend', 'qa-check': 'qa_prep' }[skill.id] || 'contribution';
        const goal = { 'web-build': '制作一个可以点击按钮改变文字的单页应用', 'api-design': '设计一个简单的记账 API', 'qa-check': '为记账应用准备基础验收用例' }[skill.id] || `用${skill.name}处理一个简短的示例任务`;
        const output = await providerRegistry.execute({ run: { goal, provider: { id: provider.id, model: provider.model } }, task: { kind, title: '技能自测' }, agent: { name: '测试员工', role: '技能验证', description: '' }, deps: [], skills: [skill], files: [], messages: [] });
        return json(res, 200, { ok: true, skillId: skill.id, summary: output.text, filename: output.filename || null });
      }
      if (parts[1] === 'skills' && parts[2] && method === 'PATCH') return json(res, 200, app.updateSkill(parts[2], await readBody(req)));
      if (parts[1] === 'profiles') {
        if (method === 'GET') return json(res, 200, app.listProfiles());
        if (method === 'POST') return json(res, 201, app.saveProfile(await readBody(req)));
        if (parts[2] && method === 'PATCH') return json(res, 200, app.saveProfile({ ...await readBody(req), id: parts[2] }));
      }
      if (parts[1] === 'blueprints') {
        if (method === 'GET') return json(res, 200, app.listBlueprints());
        if (method === 'POST') return json(res, 201, app.saveBlueprint(await readBody(req)));
      }
      if (parts[1] === 'schemes') {
        if (method === 'GET') return json(res, 200, app.listSchemes());
        if (method === 'POST') return json(res, 201, app.saveScheme(await readBody(req)));
      }
      return json(res, 404, { error: '接口不存在' });
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, errorStatus(error), { error: error.message || '服务出错' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createWorkspace(resolve(process.env.WORKSPACE_DB || 'data/workspace.db'));
  const providerRegistry = createProviderRegistry();
  const scheduler = createScheduler(app, context => providerRegistry.execute(context));
  const previewPort = Number(process.env.PREVIEW_PORT || 4174);
  const server = createServer(app, scheduler, { providerRegistry, previewPort });
  const preview = createPreviewServer(app);
  const port = Number(process.env.PORT || 4173);
  preview.listen(previewPort, '127.0.0.1', () => console.log(`交互应用预览：http://127.0.0.1:${previewPort}`));
  server.listen(port, '127.0.0.1', () => {
    console.log(`AI 员工工作空间：http://127.0.0.1:${port}`);
    if (providerRegistry.status().configured) scheduler.recover();
  });
}
