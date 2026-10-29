import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/workspace.js';
import { createScheduler } from '../src/scheduler.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'employee-scheduler-'));
  const app = createWorkspace(join(dir, 'app.db'));
  t.after(() => { app.close(); rmSync(dir, { recursive: true, force: true }); });
  return app;
}

test('independent work and test preparation start before integration', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const people = app.listProfiles().map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const run = app.createRun(session.id, '制作记账应用', [], people.map(person => person.id));
  const started = [];
  let releaseBackend;
  const backendGate = new Promise(resolve => { releaseBackend = resolve; });
  const scheduler = createScheduler(app, async ({ task }) => {
    started.push(task.kind);
    if (task.kind === 'backend') await backendGate;
    return { text: `${task.kind} result` };
  }, { concurrency: 3 });
  scheduler.kick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(started.includes('frontend'));
  assert.ok(started.includes('backend'));
  assert.ok(started.includes('qa_prep'));
  assert.ok(!started.includes('qa_integration'));
  releaseBackend();
  await scheduler.waitForIdle();
  assert.ok(started.indexOf('qa_integration') > started.indexOf('qa_prep'));
  assert.equal(app.getRun(run.id).status, 'completed');
});

test('failed prerequisite does not leave dependent work waiting', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const people = app.listProfiles().map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const run = app.createRun(session.id, '制作页面', [], people.map(person => person.id));
  const scheduler = createScheduler(app, async ({ task }) => {
    if (task.kind === 'backend') throw new Error('接口失败');
    return { text: 'ok' };
  });
  scheduler.kick();
  await scheduler.waitForIdle();
  const result = app.getRun(run.id);
  assert.equal(result.tasks.find(task => task.kind === 'qa_integration').status, 'failed');
  assert.equal(result.status, 'failed');
  assert.ok(result.tasks.every(task => task.status !== 'waiting'));
});

test('Kimi adapter refuses to pretend work completed without a key', async () => {
  const { createKimiExecutor } = await import('../src/kimi.js');
  const execute = createKimiExecutor({ key: '' });
  await assert.rejects(() => execute({ run: { goal: 'hello' }, task: { kind: 'direct' }, agent: { role: '主管' }, deps: [], skills: [], files: [] }), /Kimi API 密钥/);
});

test('text uploads and dependency artifacts are included in the worker context', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const file = app.addFile(session.id, 'brief.txt', 'text/plain', Buffer.from('用户专属需求'));
  app.addMessage(session.id, 'user', '先前决定使用蓝色主题');
  const people = app.listProfiles().slice(0, 2).map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const run = app.createRun(session.id, '制作页面', [], people.map(person => person.id));
  let seen;
  const scheduler = createScheduler(app, async context => { seen = context; return { text: 'done' }; });
  scheduler.kick();
  await scheduler.waitForIdle();
  assert.equal(seen.files.find(item => item.id === file.id).text, '用户专属需求');
  assert.ok(seen.messages.some(item => item.content === '先前决定使用蓝色主题'));
});

test('steering reaches later dependent work without rewriting work already running', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const people = app.listProfiles().map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const run = app.createRun(session.id, '开发记账应用', [], people.map(person => person.id));
  let releaseBackend;
  const backendGate = new Promise(resolve => { releaseBackend = resolve; });
  const seen = [];
  const scheduler = createScheduler(app, async context => {
    seen.push({ kind: context.task.kind, messages: context.messages.map(item => item.content) });
    if (context.task.kind === 'backend') await backendGate;
    return { text: 'done' };
  });
  scheduler.kick();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.addSteering(session.id, run.id, '页面优先适配手机');
  releaseBackend();
  await scheduler.waitForIdle();
  assert.ok(!seen.find(item => item.kind === 'backend').messages.includes('页面优先适配手机'));
  assert.ok(seen.find(item => item.kind === 'qa_integration').messages.includes('页面优先适配手机'));
});

test('steering for one run does not leak into another run in the same session', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const first = app.createRun(session.id, '制作蓝色页面', [], []);
  app.addSteering(session.id, first.id, '只在第一个任务使用蓝色');
  const second = app.createRun(session.id, '制作红色页面', [], []);
  const seen = new Map();
  const scheduler = createScheduler(app, async context => {
    seen.set(context.run.id, context.messages.map(message => message.content));
    return { text: 'done' };
  });
  scheduler.kick();
  await scheduler.waitForIdle();
  assert.ok(seen.get(first.id).includes('只在第一个任务使用蓝色'));
  assert.ok(!seen.get(second.id).includes('只在第一个任务使用蓝色'));
});

test('a revision receives the complete source artifact beyond the ordinary file preview limit', async t => {
  const app = fixture(t);
  const session = app.createSession();
  const original = app.createRun(session.id, '制作页面', [], []);
  const html = `<!doctype html><html><body>${'x'.repeat(40000)}<script>const marker = 'END_OF_SOURCE';</script></body></html>`;
  const file = app.addFile(session.id, 'index.html', 'text/html', Buffer.from(html));
  app.updateTask(original.tasks[0].id, { status: 'completed', result: { text: 'done', fileId: file.id, filename: file.name } });
  app.updateRun(original.id, { status: 'completed' });
  const revised = app.reviewRun(session.id, original.id, { decision: 'request_changes', feedback: '按钮改成蓝色' });
  let source;
  const scheduler = createScheduler(app, async context => { source = context.sourceArtifacts; return { text: 'done' }; });
  scheduler.kick();
  await scheduler.waitForIdle();
  assert.equal(app.getRun(revised.review.followupRunId).sourceRunId, original.id);
  assert.equal(source[0].content, html);
});
