import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderRegistry } from '../src/provider.js';
import { createKimiExecutor } from '../src/kimi.js';

test('DeepSeek key stays private while requests use the official endpoint', async () => {
  let request;
  const registry = createProviderRegistry({ kimiKey: '', deepseekKey: '', fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '完成' } }] }) };
  } });
  registry.configure({ provider: 'deepseek', model: 'deepseek-flash', key: 'secret-test-key' });
  const status = registry.status();
  assert.equal(status.name, 'DeepSeek');
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes('secret-test-key'));
  await registry.execute({ run: { goal: '打招呼' }, task: { kind: 'direct', title: '主管处理任务' }, agent: { name: '主管', role: '主管' }, deps: [], skills: [], files: [], messages: [] });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-test-key');
  assert.equal(JSON.parse(request.options.body).model, 'deepseek-flash');
  const check = await registry.testConnection();
  assert.deepEqual(check, { ok: true, name: 'DeepSeek', model: 'deepseek-flash' });
});

test('invalid provider and model are rejected', () => {
  const registry = createProviderRegistry({ kimiKey: '', deepseekKey: '' });
  assert.throws(() => registry.configure({ provider: 'unknown' }), /模型服务/);
  assert.throws(() => registry.configure({ provider: 'deepseek', model: 'unknown' }), /模型/);
});

test('frontend deliverable must include actual interaction code', async () => {
  const execute = createKimiExecutor({ key: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '<html><body>Static only</body></html>' } }] }) }) });
  await assert.rejects(() => execute({ run: { goal: '制作互动页面' }, task: { kind: 'frontend', title: '前端' }, agent: { name: '小克', role: '前端' }, deps: [], skills: [], files: [] }), /交互/);
});

test('revision request includes full source artifact in the model prompt', async () => {
  let body;
  const execute = createKimiExecutor({ key: 'test', fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '已收到' } }] }) }; } });
  await execute({ run: { goal: '修改页面' }, task: { kind: 'direct', title: '修改' }, agent: { name: '主管', role: '主管' }, deps: [], skills: [], files: [], messages: [], sourceArtifacts: [{ name: 'index.html', content: `${'x'.repeat(40000)}END_OF_SOURCE` }] });
  assert.match(body.messages[1].content, /END_OF_SOURCE/);
});
