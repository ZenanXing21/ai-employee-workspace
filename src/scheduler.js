export function createScheduler(workspace, execute, { concurrency = 3 } = {}) {
  const active = new Map();
  let pumping = false;
  let queued = false;
  const idleWaiters = [];

  function finishIdle() {
    if (active.size || workspace.listActiveRuns().length) return;
    while (idleWaiters.length) idleWaiters.shift()();
  }

  function taskContext(run, task) {
    const session = workspace.getSession(run.sessionId);
    const sourceArtifacts = run.sourceRunId && ['frontend', 'backend', 'direct', 'contribution'].includes(task.kind) ? workspace.getSourceArtifacts(run.sessionId, run.sourceRunId) : [];
    const sourceFileIds = new Set(sourceArtifacts.map(file => file.fileId));
    return {
      run, task,
      agent: session.agents.find(agent => agent.id === task.agentId),
      deps: task.deps.map(depId => run.tasks.find(item => item.id === depId)).filter(Boolean).map(dep => ({ ...dep, content: dep.result?.fileId ? Buffer.from(workspace.getFile(run.sessionId, dep.result.fileId).bytes).toString('utf8').slice(0, 30000) : '' })),
      skills: workspace.listSkills().filter(skill => run.skillIds.includes(skill.id)),
      messages: session.messages.filter(message => !message.metadata?.steeringRunId || message.metadata.steeringRunId === run.id).slice(-16),
      sourceArtifacts,
      files: session.files.filter(file => !sourceFileIds.has(file.id)).map(file => ({ ...file, text: /^(text\/|application\/(json|xml|javascript))/.test(file.mime) ? Buffer.from(workspace.getFile(run.sessionId, file.id).bytes).toString('utf8').slice(0, 20000) : '' }))
    };
  }

  async function launch(run, task) {
    const controller = new AbortController();
    active.set(task.id, { controller, agentId: task.agentId });
    workspace.updateTask(task.id, { status: 'running', attempts: task.attempts + 1, startedAt: new Date().toISOString() });
    workspace.addEvent(run.sessionId, run.id, 'task_started', { taskId: task.id, title: task.title });
    try {
      const output = await execute({ ...taskContext(workspace.getRun(run.id), task), signal: controller.signal });
      if (workspace.getRun(run.id).status === 'cancelled') return;
      let fileId = null;
      if (output.filename && output.content) {
        const file = workspace.addFile(run.sessionId, output.filename, output.mime || 'text/plain', Buffer.from(output.content));
        fileId = file.id;
      }
      workspace.updateTask(task.id, { status: 'completed', completedAt: new Date().toISOString(), result: { text: String(output.text || '').slice(0, 30000), fileId, filename: output.filename || null } });
      workspace.addEvent(run.sessionId, run.id, 'task_completed', { taskId: task.id, fileId });
    } catch (error) {
      if (workspace.getRun(run.id).status === 'cancelled') return;
      const message = error?.message || '未知错误';
      workspace.updateTask(task.id, { status: 'failed', error: message });
      workspace.addEvent(run.sessionId, run.id, 'task_failed', { taskId: task.id, error: message });
    } finally {
      active.delete(task.id);
      kick();
    }
  }

  function pump() {
    if (pumping) { queued = true; return; }
    pumping = true;
    do {
      queued = false;
      for (const candidate of workspace.listActiveRuns()) {
        let run = workspace.getRun(candidate.id);
        if (run.status === 'pending') workspace.updateRun(run.id, { status: 'running' });
        for (const task of run.tasks.filter(item => item.status === 'waiting')) {
          const deps = task.deps.map(depId => run.tasks.find(item => item.id === depId));
          if (deps.every(dep => dep && ['completed', 'failed', 'cancelled'].includes(dep.status))) {
            if (task.kind !== 'summary' && deps.some(dep => dep.status !== 'completed')) {
              workspace.updateTask(task.id, { status: 'failed', error: '依赖任务未完成' });
              workspace.addEvent(run.sessionId, run.id, 'task_failed', { taskId: task.id, error: '依赖任务未完成' });
            } else workspace.updateTask(task.id, { status: 'pending' });
            queued = true;
          }
        }
        run = workspace.getRun(run.id);
        for (const task of run.tasks.filter(item => item.status === 'pending')) {
          if (active.size >= concurrency) break;
          if ([...active.values()].some(item => item.agentId === task.agentId)) continue;
          void launch(run, task);
        }
        run = workspace.getRun(run.id);
        if (run.tasks.every(task => ['completed', 'failed', 'cancelled'].includes(task.status))) {
          const failed = run.tasks.some(task => task.status === 'failed');
          workspace.updateRun(run.id, { status: failed ? 'failed' : 'completed' });
          workspace.expireSuggestions(run.id);
          const delivery = run.tasks.find(task => task.kind === 'summary' || task.kind === 'direct');
          if (delivery?.result?.text) workspace.addMessage(run.sessionId, 'assistant', delivery.result.text, { runId: run.id, fileId: delivery.result.fileId });
          else workspace.addMessage(run.sessionId, 'assistant', '任务未能完成。请查看任务状态并重试失败的步骤。', { runId: run.id });
          workspace.addEvent(run.sessionId, run.id, failed ? 'run_failed' : 'run_completed', {});
        }
      }
    } while (queued);
    pumping = false;
    finishIdle();
  }

  function kick() { queueMicrotask(pump); }
  return {
    kick,
    cancel(runId) {
      for (const [taskId, item] of active) if (workspace.getRun(runId).tasks.some(task => task.id === taskId)) item.controller.abort();
      workspace.cancelRun(runId);
      kick();
    },
    retry(runId) {
      const run = workspace.getRun(runId);
      if (run.status !== 'failed') throw new Error('只能重试失败的任务');
      for (const task of run.tasks) if (task.status === 'failed' || task.kind === 'summary') workspace.updateTask(task.id, { status: task.deps.length ? 'waiting' : 'pending', error: null, result: null });
      workspace.updateRun(runId, { status: 'pending' });
      workspace.addEvent(run.sessionId, runId, 'run_retried', {});
      kick();
      return workspace.getRun(runId);
    },
    recover() {
      for (const run of workspace.listActiveRuns()) for (const task of workspace.getRun(run.id).tasks) if (task.status === 'running') workspace.updateTask(task.id, { status: 'pending' });
      kick();
    },
    waitForIdle() {
      return new Promise(resolve => { idleWaiters.push(resolve); kick(); });
    }
  };
}
