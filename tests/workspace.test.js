import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace } from '../src/workspace.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'employee-workspace-'));
  const app = createWorkspace(join(dir, 'app.db'));
  t.after(() => { app.close(); rmSync(dir, { recursive: true, force: true }); });
  return app;
}

test('new sessions have independent manager instances and isolated data', t => {
  const app = fixture(t);
  const first = app.createSession();
  const second = app.createSession();
  assert.equal(app.getSession(first.id).agents.length, 1);
  assert.equal(app.getSession(second.id).agents.length, 1);
  assert.notEqual(app.getSession(first.id).agents[0].id, app.getSession(second.id).agents[0].id);
  app.addMessage(first.id, 'user', 'private goal');
  app.addFile(first.id, 'secret.txt', 'text/plain', Buffer.from('private'));
  assert.equal(app.getSession(second.id).messages.length, 0);
  assert.equal(app.getSession(second.id).files.length, 0);
  assert.throws(() => app.getFile(second.id, app.getSession(first.id).files[0].id), /不存在/);
});

test('editing an instance does not change its global profile or another session', t => {
  const app = fixture(t);
  const profile = app.listProfiles().find(item => item.name === '小克');
  const one = app.createSession();
  const two = app.createSession();
  const a = app.addAgent(one.id, { profileId: profile.id });
  const b = app.addAgent(two.id, { profileId: profile.id });
  app.updateSkill('web-build', { installed: true });
  app.updateAgent(one.id, a.id, { name: '新名字', skillIds: ['web-build'] });
  assert.equal(app.getSession(two.id).agents.find(item => item.id === b.id).name, '小克');
  assert.equal(app.listProfiles().find(item => item.id === profile.id).name, '小克');
});

test('slash skills are temporary and unavailable skills are rejected', t => {
  const app = fixture(t);
  const session = app.createSession();
  const agent = app.addAgent(session.id, { profileId: app.listProfiles()[0].id });
  assert.throws(() => app.parseInvocation(session.id, '/网页开发 @小克 制作页面'), /尚未安装/);
  app.updateSkill('web-build', { installed: true, enabled: true });
  const parsed = app.parseInvocation(session.id, '/网页开发 @小克 制作页面');
  assert.deepEqual(parsed.skillIds, ['web-build']);
  assert.deepEqual(parsed.agentIds, [agent.id]);
  assert.deepEqual(app.getSession(session.id).agents.find(item => item.id === agent.id).skillIds, []);
  assert.deepEqual(app.parseInvocation(session.id, '参考 https://example.com/path 和 name@example.com').skillIds, []);
  const chinese = app.parseInvocation(session.id, '请@小克用/网页开发做页面');
  assert.deepEqual(chinese.agentIds, [agent.id]);
  assert.deepEqual(chinese.skillIds, ['web-build']);
});

test('web task plan lets test preparation run while integration waits', t => {
  const app = fixture(t);
  const session = app.createSession();
  const people = app.listProfiles().slice(0, 3).map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const tasks = app.planTasks(session.id, '制作一个记账 Web 应用', people.map(person => person.id));
  const prep = tasks.find(item => item.kind === 'qa_prep');
  const integration = tasks.find(item => item.kind === 'qa_integration');
  assert.ok(prep);
  assert.deepEqual(prep.deps, []);
  assert.equal(integration.deps.length, 2);
  assert.ok(integration.deps.every(depId => tasks.some(task => task.id === depId)));
  assert.equal(integration.agentId, prep.agentId);
});

test('cancelled dependency settles waiting tasks and retains other sessions', t => {
  const app = fixture(t);
  const one = app.createSession();
  const two = app.createSession();
  const firstRun = app.createRun(one.id, 'build', [], []);
  const secondRun = app.createRun(two.id, 'separate', [], []);
  app.cancelRun(firstRun.id);
  assert.equal(app.getRun(firstRun.id).status, 'cancelled');
  assert.equal(app.getRun(secondRun.id).status, 'pending');
  assert.ok(app.getRun(firstRun.id).tasks.every(task => task.status === 'cancelled'));
});

test('parallel opportunity requires review before becoming executable work', t => {
  const app = fixture(t);
  const session = app.createSession();
  const people = app.listProfiles().map(profile => app.addAgent(session.id, { profileId: profile.id }));
  const run = app.createRun(session.id, '开发一个记账 Web 应用', [], people.map(person => person.id));
  assert.ok(run.suggestions.length > 0);
  assert.ok(run.suggestions.every(item => item.status === 'pending'));
  assert.equal(run.tasks.some(task => task.kind === 'opportunity'), false);
  const suggestion = run.suggestions[0];
  const approved = app.reviewSuggestion(session.id, run.id, suggestion.id, { decision: 'approve', title: '补充可访问性检查', brief: '检查键盘操作和标签', agentId: people[2].id });
  assert.equal(approved.status, 'approved');
  const updated = app.getRun(run.id);
  const extra = updated.tasks.find(task => task.kind === 'opportunity');
  assert.equal(extra.title, '补充可访问性检查');
  assert.equal(extra.agentId, people[2].id);
  assert.ok(updated.tasks.find(task => task.kind === 'summary').deps.includes(extra.id));
  const other = app.createSession();
  assert.throws(() => app.reviewSuggestion(other.id, run.id, run.suggestions[1].id, { decision: 'reject' }), /不存在/);
  assert.equal(app.reviewSuggestion(session.id, run.id, run.suggestions[1].id, { decision: 'reject' }).status, 'rejected');
  assert.equal(app.getRun(run.id).tasks.filter(task => task.kind === 'opportunity').length, 1);
});

test('completed delivery can be accepted once and remains scoped to its session', t => {
  const app = fixture(t);
  const one = app.createSession();
  const two = app.createSession();
  const run = app.createRun(one.id, '制作可交互记账网页', [], []);
  assert.match(app.getRun(run.id).plan.summary, /记账网页/);
  assert.ok(app.getRun(run.id).plan.criteria.length > 0);
  assert.throws(() => app.reviewRun(two.id, run.id, { decision: 'accept' }), /不存在/);
  assert.throws(() => app.reviewRun(one.id, run.id, { decision: 'accept' }), /完成/);
  app.updateTask(run.tasks[0].id, { status: 'completed', result: { text: '完成' } });
  app.updateRun(run.id, { status: 'completed' });
  const accepted = app.reviewRun(one.id, run.id, { decision: 'accept' });
  assert.equal(accepted.review.status, 'accepted');
  assert.ok(accepted.review.reviewedAt);
  assert.throws(() => app.reviewRun(one.id, run.id, { decision: 'accept' }), /审核/);
});

test('requesting changes keeps prior delivery and creates one linked follow-up', t => {
  const app = fixture(t);
  const session = app.createSession();
  const worker = app.addAgent(session.id, { profileId: app.listProfiles()[0].id });
  app.updateSkill('web-build', { installed: true, enabled: true });
  const original = app.createRun(session.id, '开发记账页面', ['web-build'], [worker.id], { id: 'deepseek', model: 'deepseek-flash' });
  for (const task of original.tasks) app.updateTask(task.id, { status: 'completed', result: { text: 'done' } });
  app.updateRun(original.id, { status: 'completed' });
  assert.throws(() => app.reviewRun(session.id, original.id, { decision: 'request_changes', feedback: '  ' }), /修改意见/);
  const reviewed = app.reviewRun(session.id, original.id, { decision: 'request_changes', feedback: '补上编辑记录功能', provider: { id: 'kimi', model: 'kimi-k2.5' } });
  assert.equal(reviewed.review.status, 'changes_requested');
  const followup = app.getRun(reviewed.review.followupRunId);
  assert.equal(followup.sourceRunId, original.id);
  assert.match(followup.goal, /补上编辑记录功能/);
  assert.deepEqual(followup.agentIds, [worker.id]);
  assert.deepEqual(followup.skillIds, []);
  assert.equal(followup.provider.id, 'kimi');
  assert.throws(() => app.reviewRun(session.id, original.id, { decision: 'request_changes', feedback: 'again' }), /审核/);
});

test('steering records a run-scoped instruction for work not started yet', t => {
  const app = fixture(t);
  const session = app.createSession();
  const other = app.createSession();
  const run = app.createRun(session.id, '制作网站', [], []);
  assert.throws(() => app.addSteering(other.id, run.id, '改成蓝色'), /不存在/);
  const message = app.addSteering(session.id, run.id, '改成蓝色');
  assert.equal(message.metadata.steeringRunId, run.id);
  assert.ok(app.getSession(session.id).events.some(event => event.type === 'run_steered'));
  app.updateRun(run.id, { status: 'completed' });
  assert.throws(() => app.addSteering(session.id, run.id, '再改'), /运行/);
});

test('revision refuses a source artifact too large to provide completely', t => {
  const app = fixture(t);
  const session = app.createSession();
  const run = app.createRun(session.id, '制作网页', [], []);
  const file = app.addFile(session.id, 'index.html', 'text/html', Buffer.alloc(90 * 1024, 'x'));
  app.updateTask(run.tasks[0].id, { status: 'completed', result: { text: 'done', fileId: file.id, filename: file.name } });
  app.updateRun(run.id, { status: 'completed' });
  assert.throws(() => app.reviewRun(session.id, run.id, { decision: 'request_changes', feedback: '改成蓝色' }), /产物过大/);
  assert.equal(app.getSession(session.id).runs.length, 1);
  assert.equal(app.getRun(run.id).review.status, 'pending');
});
