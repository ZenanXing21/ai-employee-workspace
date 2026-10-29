import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidence } from '../src/evidence.js';

test('delivery evidence distinguishes static HTML checks from browser execution', () => {
  const run = { tasks: [{ id: 'front', title: '小克 · 前端', kind: 'frontend', status: 'completed', agentId: 'a', result: { fileId: 'html', filename: 'index.html' } }] };
  const evidence = buildEvidence(run, () => ({ name: 'index.html', mime: 'text/html', bytes: Buffer.from('说明\n<!doctype html><html><body><script>document.body.onclick = () => 1</script></body></html>\n说明') }));
  assert.equal(evidence.artifacts[0].fileId, 'html');
  assert.equal(evidence.checks.find(check => check.id === 'html_structure').status, 'passed');
  assert.equal(evidence.checks.find(check => check.id === 'html_script').status, 'passed');
  assert.equal(evidence.checks.find(check => check.id === 'browser_test').status, 'not_run');
});

test('incomplete HTML and invalid JavaScript are flagged without running generated code', () => {
  const run = { tasks: [
    { id: 'front', kind: 'frontend', status: 'completed', result: { fileId: 'bad-html', filename: 'index.html' } },
    { id: 'back', kind: 'backend', status: 'completed', result: { fileId: 'bad-js', filename: 'server.js' } }
  ] };
  const contents = { 'bad-html': '<html><body><script>1</script>', 'bad-js': 'function (' };
  const evidence = buildEvidence(run, id => ({ name: id, bytes: Buffer.from(contents[id]) }));
  assert.equal(evidence.checks.find(check => check.id === 'html_structure').status, 'attention');
  assert.equal(evidence.checks.find(check => check.id === 'javascript_syntax').status, 'attention');
  assert.equal(evidence.checks.find(check => check.id === 'integration_test').status, 'not_run');
});

test('a text-only delivery has no invented file or passed test', () => {
  const evidence = buildEvidence({ tasks: [{ id: 'a', kind: 'direct', status: 'completed', result: { text: '答复' } }] }, () => { throw Error('should not read'); });
  assert.deepEqual(evidence.artifacts, []);
  assert.ok(evidence.checks.every(check => check.status === 'not_run'));
});
