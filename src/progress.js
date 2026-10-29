export function summarizeProgress(run, agents = []) {
  const tasks = run.tasks || [];
  const completed = tasks.filter(task => task.status === 'completed').length;
  const total = tasks.length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  const byAgent = agents.map(agent => {
    const assigned = tasks.filter(task => task.agentId === agent.id);
    const done = assigned.filter(task => task.status === 'completed').length;
    const current = assigned.find(task => task.status === 'running') || assigned.find(task => task.status === 'waiting') || assigned.find(task => task.status === 'pending') || assigned.find(task => task.status === 'failed');
    return { agentId: agent.id, name: agent.name, completed: done, total: assigned.length, percent: assigned.length ? Math.round(done / assigned.length * 100) : 0, currentTask: current?.title || null, status: current?.status || (assigned.length && done === assigned.length ? 'completed' : 'idle') };
  });
  return {
    completed, total, percent, agents: byAgent,
    report: {
      updatedAt: run.updatedAt,
      done: tasks.filter(task => task.status === 'completed').map(task => task.title),
      working: tasks.filter(task => task.status === 'running').map(task => task.title),
      next: tasks.filter(task => ['pending', 'waiting'].includes(task.status)).map(task => task.title),
      needsAttention: tasks.filter(task => task.status === 'failed').map(task => task.title),
      reviewCount: (run.suggestions || []).filter(item => item.status === 'pending').length
    }
  };
}
