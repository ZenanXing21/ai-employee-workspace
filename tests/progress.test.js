import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProgress } from '../src/progress.js';

test('progress counts delivered checklist items without inventing partial model completion', () => {
  const agents = [{ id: 'lead', name: '主管' }, { id: 'qa', name: '小K' }];
  const run = { status: 'running', updatedAt: '2026-10-27T10:00:00.000Z', tasks: [
    { id: 'a', title: '测试准备', agentId: 'qa', status: 'completed' },
    { id: 'b', title: '集成检查', agentId: 'qa', status: 'waiting', deps: ['c'] },
    { id: 'c', title: '实现接口', agentId: 'lead', status: 'running' },
    { id: 'd', title: '汇总交付', agentId: 'lead', status: 'waiting', deps: ['a', 'b', 'c'] }
  ] };
  const result = summarizeProgress(run, agents);
  assert.deepEqual({ completed: result.completed, total: result.total, percent: result.percent }, { completed: 1, total: 4, percent: 25 });
  assert.equal(result.agents.find(item => item.agentId === 'qa').percent, 50);
  assert.equal(result.agents.find(item => item.agentId === 'lead').percent, 0);
  assert.deepEqual(result.report.done, ['测试准备']);
  assert.deepEqual(result.report.working, ['实现接口']);
  assert.ok(result.report.next.includes('集成检查'));
});
