const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const statusText = { pending: '待开始', running: '工作中', waiting: '等待中', completed: '已完成', failed: '需要处理', cancelled: '已取消' };
const statusClass = status => ({ running: 'green', completed: 'green', waiting: 'orange', failed: 'orange', cancelled: 'orange' })[status] || '';
const state = { boot: null, session: null, view: 'chat', modal: null, selectedAgent: null, skillTab: 'installed', skillQuery: '', skillCategory: 'all', draft: '', mention: null, preview: null, devMode: localStorage.getItem('devMode') === 'true', showEvents: false };
const apiBase = new URL('./api', document.baseURI).pathname;

async function api(path, method = 'GET', body) {
  const response = await fetch(apiBase + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = ''; node.textContent = ''; }, 4000);
}

async function refresh(keepScroll = false) {
  const chat = $('.chat-scroll');
  const bottom = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 90;
  state.boot = await api('/bootstrap');
  if (state.session) {
    try { state.session = await api(`/sessions/${state.session.id}`); }
    catch { state.session = null; }
  }
  if (!state.session && state.boot.sessions.length) {
    const saved = localStorage.getItem('lastSessionId');
    const chosen = state.boot.sessions.find(item => item.id === saved) || state.boot.sessions[0];
    state.session = await api(`/sessions/${chosen.id}`);
  }
  if (state.session) localStorage.setItem('lastSessionId', state.session.id);
  render();
  if (keepScroll && bottom) scrollBottom();
}

function scrollBottom() { const chat = $('.chat-scroll'); if (chat) chat.scrollTop = chat.scrollHeight; }
function sessionPath() { return `/sessions/${state.session.id}`; }
function currentRun() { return state.session?.runs?.[0]; }
function activeRun() { return state.session?.runs?.find(run => ['pending', 'running'].includes(run.status)); }
function fileLink(file) { return `${apiBase}/sessions/${state.session.id}/files/${file.id}`; }
function appLink(fileId) { return `${state.boot.previewBaseUrl}/app/${state.session.id}/${fileId}`; }
function appButton(fileId, label = '打开应用 ↗') { return `<a class="app-open" href="${appLink(fileId)}" target="_blank" rel="noopener noreferrer">${label}</a>`; }
function agentStatus(agent) {
  const task = activeRun()?.tasks.find(item => item.agentId === agent.id && ['running', 'waiting', 'failed'].includes(item.status));
  return task?.status || 'idle';
}

function sidebar() {
  const sessions = state.boot.sessions.filter(session => !session.archived);
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-mark">✳</div><div>AI 员工工作空间<span class="brand-sub">WORKSPACE</span></div></div>
    <button class="new-btn" data-action="new-session"><span style="font-size:20px;line-height:14px">＋</span> 新建对话</button>
    <div class="nav-group"><div class="nav-label">工作区</div>
      ${nav('chat', '◌', '对话工作空间')}${nav('agents', '♙', 'Agent 中心')}${nav('skills', '✧', 'Skill 中心')}${nav('settings', '⚙', '设置')}</div>
    <div class="nav-group session-list"><div class="nav-label">最近对话</div>${sessions.map(item => `<button class="session-item ${state.view === 'chat' && state.session?.id === item.id ? 'active' : ''}" data-action="open-session" data-id="${item.id}"><span>${escapeHTML(item.title)}</span>${item.id === state.session?.id && activeRun() ? '<i class="session-dot"></i>' : ''}</button>`).join('') || '<div class="empty-small">还没有对话</div>'}</div>
    <div class="sidebar-spacer"></div><div class="sidebar-foot">每段对话都有独立的员工、任务和文件。<br>让团队围绕你的目标工作。</div>
  </aside>`;
}
function nav(view, icon, title) { return `<button class="nav-item ${state.view === view ? 'active' : ''}" data-action="nav" data-view="${view}"><span class="nav-icon">${icon}</span>${title}</button>`; }

function topbar() {
  const title = state.view === 'chat' ? state.session?.title || '对话工作空间' : ({ agents: 'Agent 中心', skills: 'Skill 中心', settings: '设置' })[state.view];
  const awaitingReview = state.view === 'chat' ? state.session?.runs.find(run => run.status === 'completed' && (run.review?.status || 'pending') === 'pending') : null;
  return `<header class="topbar"><div class="topbar-left"><h1>${escapeHTML(title)}</h1>${state.view === 'chat' ? `<button class="icon-btn" data-action="rename-session" title="重命名">✎</button>` : ''}</div><div class="topbar-right">
    ${state.view === 'chat' ? `${awaitingReview ? `<button class="outline review-jump" data-action="jump-review" data-run="${awaitingReview.id}">● 待验收</button>` : ''}<button class="outline" data-action="manage-team">团队管理</button><button class="outline" data-action="team-modal">＋ 添加员工</button><button class="icon-btn" data-action="session-menu" title="归档或删除">⋯</button>` : ''}
    <span class="topbar-badge ${state.boot.provider.configured ? '' : 'offline'}">${state.boot.provider.configured ? `● ${escapeHTML(state.boot.provider.name)} 已连接` : `● ${escapeHTML(state.boot.provider.name)} 未连接`}</span>
  </div></header>`;
}

function welcome() {
  const workers = state.session.agents.filter(agent => agent.kind === 'worker');
  return `<div class="welcome"><div class="welcome-orb">✳</div><div class="eyebrow">YOUR AI TEAM IS READY</div><h2>一个目标，交给一支团队。</h2>
    <p>说出你想完成的事。主管会理解目标、安排员工并汇总结果。你可以用 <strong>/</strong> 临时调用技能，用 <strong>@</strong> 指定参与的员工。</p>
    <div class="starter-grid"><button class="starter" data-action="starter" data-text="开发一个完整的记账 Web 应用，支持新增收支、分类筛选、统计图表和本地保存。"><span class="starter-icon">▣</span><strong>开发一个记账应用</strong><span>让前端、后端与测试员工协作完成</span></button>
    <button class="starter" data-action="starter" data-text="制作一个可交互的个人作品集网站，包含项目展示、筛选和联系表单。"><span class="starter-icon">◈</span><strong>制作个人作品集</strong><span>从想法开始，生成可预览的网页</span></button></div>
    ${workers.length < 2 ? '<button class="outline" style="margin-top:17px" data-action="setup-team">一键配置开发团队</button>' : ''}</div>`;
}

function messageHTML(message) {
  const isUser = message.role === 'user';
  const skills = (message.metadata?.skillIds || []).map(id => state.boot.skills.find(skill => skill.id === id)?.name).filter(Boolean);
  const agents = (message.metadata?.agentIds || []).map(id => state.session.agents.find(agent => agent.id === id)?.name).filter(Boolean);
  const file = state.session.files.find(item => item.id === message.metadata?.fileId);
  return `<article class="message"><div class="avatar ${isUser ? 'user' : 'assistant'}">${isUser ? '你' : '✳'}</div><div class="message-main"><div class="message-head">${isUser ? '你' : '主管'}<span class="message-time">${new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div><div class="message-body">${escapeHTML(message.content)}</div>${file && /\.html?$/i.test(file.name) ? `<div class="message-link">${appButton(file.id)}</div>` : ''}${skills.length || agents.length ? `<div class="message-meta">${skills.map(skill => `<span class="chip purple">/ ${escapeHTML(skill)}</span>`).join('')}${agents.map(agent => `<span class="chip">@ ${escapeHTML(agent)}</span>`).join('')}</div>` : ''}</div></article>`;
}

function taskDescription(task, run) {
  if (task.status === 'failed') return escapeHTML(task.error || '执行失败');
  if (task.status === 'completed') return task.result?.filename ? `产物：${escapeHTML(task.result.filename)}` : '已交付结果';
  if (task.status === 'running') return task.kind === 'qa_prep' ? '正在编写测试用例和准备数据' : '正在处理分配的工作';
  if (task.status === 'waiting') {
    const waitingFor = task.deps.map(id => run.tasks.find(item => item.id === id)).filter(item => item && item.status !== 'completed');
    return waitingFor.length ? `等待 ${waitingFor.map(item => escapeHTML(item.title.split(' · ')[0])).join('、')} 完成` : '即将开始';
  }
  return statusText[task.status] || '';
}
function taskPlanText(task) {
  return task.brief || ({ frontend: '制作可点击的页面、表单和导航', backend: '设计数据保存与接口', qa_prep: '提前准备验收清单和测试数据', qa_integration: '核对页面、接口与验收标准', summary: '汇总交付、未完成项和使用入口', direct: '完成这次目标并交付结果', contribution: '按职责完成可独立交付的工作' })[task.kind] || '完成已安排的工作';
}

function planHTML(run) {
  const criteria = run.plan?.criteria || [];
  return `<div class="delivery-flow"><span class="done">① 目标与计划</span><span class="${['pending', 'running'].includes(run.status) ? 'current' : 'done'}">② 团队执行</span><span class="${run.status === 'completed' ? 'current' : ''}">③ 交付审核</span></div>
    ${run.sourceRunId ? `<div class="revision-origin">这次工作来自上次交付的修改意见。<a href="#run-${run.sourceRunId}">查看原任务</a></div>` : ''}
    <div class="plan-box"><div class="run-section-label">主管的任务安排</div><p>${escapeHTML(run.plan?.summary || run.goal)}</p>${criteria.length ? `<div class="plan-criteria"><strong>验收时看</strong>${criteria.map(item => `<span>✓ ${escapeHTML(item)}</span>`).join('')}</div>` : ''}</div>`;
}

function activityHTML(run) {
  const events = state.session.events.filter(event => event.runId === run.id).slice(-5).reverse();
  if (!events.length) return '';
  const describe = event => {
    const task = run.tasks.find(item => item.id === event.detail?.taskId);
    return ({ run_created: '主管安排了任务', task_started: `${task?.title || event.detail?.title || '员工'}开始工作`, task_completed: `${task?.title || '员工'}完成工作`, task_failed: `${task?.title || '员工'}遇到问题`, run_completed: '团队提交了交付结果', run_failed: '任务需要处理', run_retried: '失败步骤开始重试', run_steered: '你补充了要求', suggestion_approved: '你同意安排并行任务', suggestion_rejected: '你决定不安排建议任务', delivery_accepted: '你接受了交付', changes_requested: '你要求修改交付' })[event.type] || '任务状态已更新';
  };
  return `<div class="activity-box"><div class="run-section-label">最近动作</div>${events.map(event => `<div><time>${new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time><span>${escapeHTML(describe(event))}</span></div>`).join('')}</div>`;
}

function deliveryHTML(run) {
  if (run.status !== 'completed') return '';
  const evidence = run.evidence || { artifacts: [], checks: [] };
  const review = run.review || { status: 'pending' };
  const checkLabels = { passed: '已做静态检查', attention: '需注意', not_run: '未运行' };
  return `<div class="delivery-box"><div class="run-section-label">交付包 <small>请查看结果和验证范围</small></div>
    ${evidence.artifacts.length ? `<div class="delivery-files">${evidence.artifacts.map(item => `<div><span>▤ ${escapeHTML(item.name)}</span>${/\.html?$/i.test(item.name) ? appButton(item.fileId) : `<a class="outline" href="${fileLink({ id: item.fileId })}">下载文件 ↓</a>`}</div>`).join('')}</div>` : '<p class="muted">本任务没有文件产物，请查看上方文字结果。</p>'}
    <div class="evidence-list">${evidence.checks.map(check => `<div><span class="evidence-mark ${check.status}">${check.status === 'passed' ? '✓' : check.status === 'attention' ? '!' : '○'}</span><span><strong>${escapeHTML(check.label)}</strong><small>${escapeHTML(check.detail)} · ${checkLabels[check.status]}</small></span></div>`).join('')}</div>
    ${review.status === 'pending' ? `<div class="review-actions"><strong>待你验收</strong><p>打开产物并核对目标。接受或提出具体修改意见，决定会保存在当前对话。</p><button class="primary" data-action="accept-delivery" data-run="${run.id}">接受交付</button><button class="outline" data-action="request-changes" data-run="${run.id}">要求修改</button></div>` : review.status === 'accepted' ? `<div class="review-result accepted">✓ 已接受交付 · ${new Date(review.reviewedAt).toLocaleString('zh-CN')}</div>` : `<div class="review-result"><strong>已要求修改</strong><p>${escapeHTML(review.feedback || '')}</p>${review.followupRunId ? `<a href="#run-${review.followupRunId}">查看修改任务 ↗</a>` : ''}</div>`}</div>`;
}

function runHTML(run) {
  const progress = run.progress;
  const report = progress.report;
  const reportText = items => items.length ? items.map(title => { const task = run.tasks.find(value => value.title === title); return `${escapeHTML(title)}：${escapeHTML(task ? taskPlanText(task) : '')}`; }).join('；') : '暂无';
  const pendingSuggestions = (run.suggestions || []).filter(item => item.status === 'pending');
  const hasPrep = run.tasks.some(task => task.kind === 'qa_prep' && task.status === 'running');
  return `<section class="run-card" id="run-${run.id}"><div class="run-head"><div><div class="run-title">${run.status === 'completed' ? '任务已交付，待验收' : run.status === 'failed' ? '任务需要处理' : run.status === 'cancelled' ? '任务已取消' : '团队正在协作'}</div><div class="run-sub">${progress.completed} / ${progress.total} 项清单已完成 · ${new Date(run.createdAt).toLocaleString('zh-CN')}</div></div><span class="chip ${statusClass(run.status)}">${statusText[run.status]}</span></div>
    ${planHTML(run)}
    <div class="progress-heading"><strong>总任务进度 ${progress.percent}%</strong><small>按已完成清单项计算</small></div><div class="progress-track" role="progressbar" aria-label="总任务进度" aria-valuenow="${progress.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${progress.percent}%"></span></div>
    <div class="run-section-label">工作清单</div>
    ${run.tasks.map(task => `<div class="run-task"><span class="task-symbol">${task.status === 'completed' ? '✓' : task.status === 'failed' ? '!' : task.status === 'running' ? '↗' : task.status === 'waiting' ? '◷' : '○'}</span><div class="task-content"><div class="task-title">${escapeHTML(task.title)} <span class="chip ${statusClass(task.status)}">${statusText[task.status]}</span></div><div class="task-plan">${escapeHTML(taskPlanText(task))}</div><div class="task-desc">${taskDescription(task, run)}</div>${task.result?.fileId && /\.html?$/i.test(task.result.filename || '') ? `<div class="task-open">${appButton(task.result.fileId)}</div>` : ''}</div></div>`).join('')}
    ${hasPrep || run.tasks.some(task => task.kind === 'qa_integration' && task.status === 'waiting') ? '<div class="run-foot"><strong>调度器正在调整任务：</strong>测试员工先完成不依赖接口的准备工作，接口完成后会自动进行集成检查。</div>' : ''}
    <div class="daily-report"><div class="run-section-label">团队小日报 <small>${new Date(report.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新</small></div>
      <div><b>已完成</b><span>${reportText(report.done)}</span></div>
      <div><b>正在做</b><span>${reportText(report.working)}</span></div>
      <div><b>接下来</b><span>${reportText(report.next)}</span></div>
      ${report.needsAttention.length ? `<div><b>需处理</b><span>${report.needsAttention.map(escapeHTML).join('、')}</span></div>` : ''}</div>
    ${pendingSuggestions.length ? `<div class="opportunity-list"><div class="run-section-label">可并行的工作 <small>你审核后才会执行</small></div>${pendingSuggestions.map(item => `<div class="opportunity"><div><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.reason)}</p></div><button class="outline" data-action="review-opportunity" data-run="${run.id}" data-id="${item.id}">审核安排</button></div>`).join('')}</div>` : ''}
    ${activityHTML(run)}${deliveryHTML(run)}
    <div class="detail-actions">${['running', 'pending'].includes(run.status) ? `<button class="outline" data-action="steer-run" data-run="${run.id}">补充要求</button><button class="outline danger-outline" data-action="cancel-run" data-id="${run.id}">取消任务</button>` : ''}${run.status === 'failed' ? `<button class="outline" data-action="retry-run" data-id="${run.id}">重试失败步骤</button>` : ''}${state.devMode ? `<button class="outline" data-action="toggle-events">${state.showEvents ? '收起' : '查看'}执行记录</button>` : ''}</div>
    ${state.devMode && state.showEvents ? `<div class="mini-card" style="margin-top:12px;max-height:180px;overflow:auto">${state.session.events.filter(event => event.runId === run.id).map(event => `${new Date(event.createdAt).toLocaleTimeString('zh-CN')} · ${escapeHTML(event.type)} · ${escapeHTML(JSON.stringify(event.detail))}`).join('<br>')}</div>` : ''}</section>`;
}

function chat() {
  const messages = state.session.messages;
  const content = messages.length ? messages.map((message, index) => {
    const run = state.session.runs.find(item => item.id === message.metadata?.runId);
    const matchingRun = message.role === 'user' ? run : null;
    return messageHTML(message) + (matchingRun ? runHTML(matchingRun) : '');
  }).join('') : welcome();
  return `<div class="workspace"><main class="conversation"><div class="chat-scroll"><div class="chat-inner">${content}</div></div>
    <div class="composer-wrap"><div class="composer-area"><div id="mention-slot"></div><form class="composer" id="composer-form"><textarea id="composer-input" placeholder="描述你想完成的事…  使用 / 调用技能，@ 指定员工" aria-label="输入任务内容">${escapeHTML(state.draft)}</textarea><div class="composer-bottom"><div class="composer-tools"><button type="button" class="tool-btn" data-action="attach">♧ 添加文件</button><button type="button" class="tool-btn" data-action="insert-slash">/ 技能</button><button type="button" class="tool-btn" data-action="insert-at">@ 员工</button></div><button class="send-btn" type="submit" ${activeRun() ? 'disabled title="请等待当前任务结束"' : ''}>发送 ↗</button></div></form><div class="composer-hint">AI 员工可能出错，请检查重要结果。每个会话的文件与记忆独立保存。</div></div></div>
  </main>${rightPanel()}</div>`;
}

function rightPanel() {
  const agents = state.session.agents;
  const selected = agents.find(agent => agent.id === state.selectedAgent);
  const files = state.session.files;
  const agentProgress = activeRun()?.progress.agents || currentRun()?.progress.agents || [];
  return `<aside class="right-panel"><div class="panel-section"><div class="panel-title"><h3>当前团队</h3><button class="icon-btn" data-action="team-modal" title="添加员工">＋</button></div><div class="agent-tree">${agents.map(agent => { const item = agentProgress.find(value => value.agentId === agent.id); return `<button class="agent-row ${agent.kind === 'worker' ? 'child' : ''} ${state.selectedAgent === agent.id ? 'selected' : ''}" data-action="select-agent" data-id="${agent.id}"><span class="avatar" style="background:${escapeHTML(agent.color)}">${escapeHTML(agent.emoji)}</span><span class="agent-info"><strong>${escapeHTML(agent.name)}</strong><small>${escapeHTML(agent.role)}${item?.total ? ` · ${item.percent}%` : ''}</small>${item?.total ? `<span class="agent-progress"><i style="width:${item.percent}%"></i></span>` : ''}</span><i class="status-pin ${agentStatus(agent)}"></i></button>`; }).join('')}</div><button class="add-agent" data-action="team-modal">＋ 从员工档案或模板添加</button></div>
    ${selected ? agentDetail(selected) : `<div class="panel-section"><div class="panel-title"><h3>协作方式</h3></div><div class="mini-card"><strong>主管会自动安排工作</strong>独立任务可以同时进行。等待依赖的任务会在条件满足后继续，员工也可先处理其他工作。</div></div>`}
    <div class="panel-section"><div class="panel-title"><h3>文件与产物</h3><button class="icon-btn" data-action="attach" title="上传文件">＋</button></div>${files.length ? files.map(file => `<div class="file-row"><span>▤ ${escapeHTML(file.name)}</span>${/\.html?$/i.test(file.name) ? appButton(file.id, '打开 ↗') : /\.(md|txt|js)$/i.test(file.name) ? `<button data-action="preview" data-id="${file.id}">预览</button>` : ''}<a href="${fileLink(file)}" title="下载">↓</a></div>`).join('') : '<div class="empty-small">上传的文件和生成的产物会出现在这里。</div>'}</div>
    <input type="file" id="file-input" hidden multiple></aside>`;
}

function agentDetail(agent) {
  const installed = state.boot.skills.filter(skill => skill.installed);
  return `<div class="panel-section"><div class="panel-title"><h3>员工属性</h3><button class="icon-btn" data-action="select-agent" data-id="" title="关闭">×</button></div><form id="agent-form" data-id="${agent.id}">
    <div class="field"><label>名称</label><input name="name" value="${escapeHTML(agent.name)}" required></div><div class="field"><label>角色定位</label><input name="role" value="${escapeHTML(agent.role)}"></div><div class="field"><label>职责描述</label><textarea name="description">${escapeHTML(agent.description)}</textarea></div>
    <div class="field"><label>长期装备的技能</label><div class="check-list">${installed.length ? installed.map(skill => `<label class="check-pill"><input type="checkbox" name="skillIds" value="${skill.id}" ${agent.skillIds.includes(skill.id) ? 'checked' : ''}>${escapeHTML(skill.name)}</label>`).join('') : '<span class="muted">先在 Skill 中心安装技能</span>'}</div></div>
    <div class="detail-actions"><button class="primary" type="submit">保存当前实例</button><button class="outline" type="button" data-action="save-blueprint" data-id="${agent.id}">保存为 Blueprint</button>${agent.kind === 'worker' ? `<button class="outline danger-outline" type="button" data-action="remove-agent" data-id="${agent.id}">移除员工</button>` : ''}</div></form><p class="muted" style="line-height:1.6;margin:12px 0 0">此处修改仅影响当前对话，不会更改全局员工档案。</p></div>`;
}

function agentsPage() {
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">TEAM LIBRARY</div><h2>Agent 中心</h2><p>管理可复用的员工档案。每段对话会创建独立的员工实例。</p></div><button class="primary" data-action="profile-new">＋ 新建员工档案</button></div>
    <div class="section-head"><h3>员工花名册</h3><span class="muted">${state.boot.profiles.length} 位员工</span></div><div class="card-grid">${state.boot.profiles.map(profile => `<div class="profile-card"><div class="avatar" style="background:${escapeHTML(profile.color)}">${escapeHTML(profile.emoji)}</div><h3>${escapeHTML(profile.name)}</h3><p>${escapeHTML(profile.role)} · ${escapeHTML(profile.description || '暂无职责描述')}</p><div class="card-bottom"><span class="muted">${(profile.skillIds || []).length} 项默认技能</span><button class="outline" data-action="edit-profile" data-id="${profile.id}">编辑档案</button></div></div>`).join('')}</div>
    <div class="section-head"><h3>员工 Blueprint</h3></div>${state.boot.blueprints.length ? `<div class="card-grid">${state.boot.blueprints.map(item => `<div class="profile-card"><div class="avatar" style="background:${escapeHTML(item.color || '#e9eafa')}">${escapeHTML(item.emoji || '✦')}</div><h3>${escapeHTML(item.name)}</h3><p>${escapeHTML(item.role || '协作员工')} · ${escapeHTML(item.description || '')}</p><div class="card-bottom"><span class="muted">v${item.version || 1}</span><button class="outline" data-action="use-blueprint" data-id="${item.id}">加入当前对话</button></div></div>`).join('')}</div>` : '<div class="empty-small">暂无 Blueprint。在会话内打开员工属性，可将配置保存为模板。</div>'}</div>`;
}

function skillsPage() {
  const q = state.skillQuery.toLowerCase();
  const skills = state.boot.skills.filter(skill => (state.skillTab === 'installed' ? skill.installed : true) && (state.skillCategory === 'all' || skill.category === state.skillCategory) && `${skill.name}${skill.category}${skill.description}`.toLowerCase().includes(q));
  const categories = [...new Set(state.boot.skills.map(skill => skill.category))];
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">CAPABILITY LIBRARY</div><h2>Skill 中心</h2><p>安装技能，启用后才能在任务中通过 / 临时调用，或长期装备给员工。</p></div><button class="outline" data-action="scheme-new">＋ 保存技能方案</button></div>
    <div class="tabs"><button class="tab ${state.skillTab === 'installed' ? 'active' : ''}" data-action="skill-tab" data-tab="installed">已安装</button><button class="tab ${state.skillTab === 'market' ? 'active' : ''}" data-action="skill-tab" data-tab="market">Skill 市场</button><button class="tab ${state.skillTab === 'schemes' ? 'active' : ''}" data-action="skill-tab" data-tab="schemes">技能方案</button></div>
    ${state.skillTab === 'schemes' ? (state.boot.schemes.length ? `<div class="card-grid">${state.boot.schemes.map(item => `<div class="skill-card"><div class="skill-symbol">◈</div><h3>${escapeHTML(item.name)}</h3><p>${item.skillIds.map(id => state.boot.skills.find(skill => skill.id === id)?.name).filter(Boolean).map(escapeHTML).join(' · ')}</p><div class="card-bottom"><span class="muted">${item.skillIds.length} 项技能</span><button class="outline" data-action="apply-scheme" data-id="${item.id}">装备给员工</button></div></div>`).join('')}</div>` : '<div class="empty-small">还没有技能方案。安装技能后，可以将常用组合保存为方案。</div>') : `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px"><span class="muted">${state.skillTab === 'market' ? '管理员预置技能' : '当前可管理的技能'}</span><div style="display:flex;gap:8px"><select class="search" id="skill-category" aria-label="技能分类" style="min-width:125px"><option value="all">全部分类</option>${categories.map(category => `<option value="${escapeHTML(category)}" ${state.skillCategory === category ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('')}</select><input class="search" id="skill-search" placeholder="搜索技能或分类" value="${escapeHTML(state.skillQuery)}"></div></div><div class="card-grid">${skills.map(skill => `<div class="skill-card"><div class="skill-symbol">${skill.category === '软件开发' ? '⌘' : '✧'}</div><h3>${escapeHTML(skill.name)}</h3><div class="skill-meta">${escapeHTML(skill.category)} · v${escapeHTML(skill.version)}</div><p>${escapeHTML(skill.description)}</p><div class="card-bottom"><button class="inline-link" data-action="skill-detail" data-id="${skill.id}">查看详情</button><div>${!skill.installed ? `<button class="primary" data-action="install-skill" data-id="${skill.id}">安装</button>` : `<button class="outline" data-action="toggle-skill" data-id="${skill.id}">${skill.enabled ? '停用' : '启用'}</button><button class="icon-btn" data-action="uninstall-skill" data-id="${skill.id}" title="卸载">×</button>`}</div></div></div>`).join('') || '<div class="empty-small">没有找到匹配的技能。</div>'}</div>`}</div>`;
}

function settingsPage() {
  const current = state.boot.provider;
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">PREFERENCES</div><h2>设置</h2><p>普通人模式保持简洁，开发者模式可查看更详细的执行记录。</p></div></div>
    <div class="setting-card"><h3>模型连接</h3><p>选择服务并输入 API 密钥。密钥只留在当前服务进程的内存中，不会进入对话、日志或数据库；重启服务后需重新输入。</p>
      <form id="provider-form"><div class="form-row"><div class="field"><label>模型服务</label><select id="provider-select" name="provider">${current.providers.map(item => `<option value="${item.id}" ${item.id === current.id ? 'selected' : ''}>${escapeHTML(item.name)}${item.configured ? ' · 已配置' : ''}</option>`).join('')}</select></div>
      <div class="field"><label>模型</label><select id="provider-model" name="model">${current.providers.find(item => item.id === current.id).models.map(item => `<option value="${item}" ${item === current.model ? 'selected' : ''}>${escapeHTML(item)}</option>`).join('')}</select></div></div>
      <div class="field"><label>API 密钥</label><input type="password" name="key" autocomplete="off" placeholder="在这里输入密钥，已有密钥可留空"></div>
      <div class="detail-actions"><button class="primary" type="submit">保存当前连接</button><button class="outline" type="button" data-action="test-provider">测试连接</button><span class="chip ${current.configured ? 'green' : 'orange'}">${current.configured ? `${escapeHTML(current.name)} 已配置` : `${escapeHTML(current.name)} 未配置`}</span></div></form>
      <p style="margin-top:16px">若希望重启后自动连接，可在启动服务前设置 <code>DEEPSEEK_API_KEY</code> 或 <code>MOONSHOT_API_KEY</code> 环境变量。可在 <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek 开发者平台</a> 创建 API 密钥。</p></div>
    <div class="setting-card"><h3>工作空间模式</h3><p>会话之间的对话、员工实例、文件和任务相互隔离。</p><label class="switch"><input type="checkbox" id="dev-mode" ${state.devMode ? 'checked' : ''}>开发者模式：显示任务执行记录</label></div>
    <div class="setting-card"><h3>数据管理</h3><p>数据保存在本机 <code>data/workspace.db</code>。删除一个会话只会删除该会话的数据，不影响全局员工档案、技能与模板。</p><button class="outline" data-action="archive-session">归档当前对话</button></div></div>`;
}

function modalHTML() {
  if (!state.modal) return '';
  const modal = state.modal;
  let title = '', body = '';
  if (modal.type === 'team') {
    title = '添加会话员工';
    body = `<p class="muted">从全局档案或 Blueprint 创建独立实例。</p><div class="modal-list">${state.boot.profiles.map(profile => `<button class="modal-option" data-action="add-profile-agent" data-id="${profile.id}"><span class="avatar" style="background:${escapeHTML(profile.color)}">${escapeHTML(profile.emoji)}</span><span><strong>${escapeHTML(profile.name)} · ${escapeHTML(profile.role)}</strong><small>${escapeHTML(profile.description)}</small></span></button>`).join('')}${state.boot.blueprints.map(item => `<button class="modal-option" data-action="add-blueprint-agent" data-id="${item.id}"><span class="avatar">✦</span><span><strong>${escapeHTML(item.name)} · Blueprint</strong><small>${escapeHTML(item.role)}</small></span></button>`).join('')}</div><div class="modal-footer"><button class="outline" data-action="custom-agent">自定义员工</button></div>`;
  } else if (modal.type === 'profile' || modal.type === 'custom-agent') {
    const profile = modal.profile || {};
    title = modal.type === 'profile' ? (profile.id ? '编辑员工档案' : '新建员工档案') : '创建会话员工';
    body = `<form id="profile-form"><div class="form-row"><div class="field"><label>名称</label><input name="name" value="${escapeHTML(profile.name || '')}" required></div><div class="field"><label>角色</label><input name="role" value="${escapeHTML(profile.role || '')}" required></div></div><div class="field"><label>职责描述</label><textarea name="description">${escapeHTML(profile.description || '')}</textarea></div><div class="modal-footer"><button class="outline" type="button" data-action="close-modal">取消</button><button class="primary" type="submit">保存</button></div></form>`;
  } else if (modal.type === 'skill') {
    const skill = state.boot.skills.find(item => item.id === modal.id);
    title = skill.name;
    const equipped = state.session?.agents.filter(agent => agent.skillIds.includes(skill.id)).map(agent => agent.name).join('、') || '暂无';
    body = `<p class="muted">${escapeHTML(skill.category)} · v${escapeHTML(skill.version)}</p><p style="font-size:13px;line-height:1.7">${escapeHTML(skill.description)}</p><div class="mini-card"><strong>能力说明</strong>${escapeHTML(skill.instructions)}<br><br>所需权限：${skill.permissions.length ? escapeHTML(skill.permissions.join('、')) : '无额外权限'}<br>已装备员工：${escapeHTML(equipped)}</div><div class="modal-footer">${skill.installed && skill.enabled ? `<button class="outline" data-action="test-skill" data-id="${skill.id}">运行示例测试</button>` : ''}<button class="outline" data-action="close-modal">关闭</button></div>`;
  } else if (modal.type === 'scheme') {
    title = '保存技能方案';
    body = `<form id="scheme-form"><div class="field"><label>方案名称</label><input name="name" placeholder="例如：全栈开发" required></div><div class="field"><label>选择已安装技能</label><div class="check-list">${state.boot.skills.filter(skill => skill.installed).map(skill => `<label class="check-pill"><input type="checkbox" name="skillIds" value="${skill.id}">${escapeHTML(skill.name)}</label>`).join('') || '<span class="muted">请先安装技能</span>'}</div></div><div class="modal-footer"><button class="outline" type="button" data-action="close-modal">取消</button><button class="primary" type="submit">保存方案</button></div></form>`;
  } else if (modal.type === 'apply-scheme') {
    const scheme = state.boot.schemes.find(item => item.id === modal.id);
    title = `应用「${scheme.name}」`;
    body = `<p class="muted">选择当前会话的员工，将方案中的技能长期装备给他。</p><div class="modal-list">${state.session.agents.map(agent => `<button class="modal-option" data-action="apply-scheme-agent" data-id="${agent.id}" data-scheme="${scheme.id}"><span class="avatar">${escapeHTML(agent.emoji)}</span><span><strong>${escapeHTML(agent.name)}</strong><small>${escapeHTML(agent.role)}</small></span></button>`).join('')}</div>`;
  } else if (modal.type === 'session-menu') {
    title = '对话管理';
    body = `<div class="modal-list"><button class="modal-option" data-action="rename-session">✎ 重命名对话</button><button class="modal-option" data-action="archive-session">▱ 归档对话</button><button class="modal-option danger" data-action="delete-session">× 删除对话</button></div><p class="muted" style="margin:15px 0 0">删除会清除这段对话的消息、任务、会话员工和文件；全局档案与技能保留。</p>`;
  } else if (modal.type === 'manage-team') {
    title = '当前会话团队';
    body = `<div class="modal-list">${state.session.agents.map(agent => `<button class="modal-option" data-action="edit-session-agent" data-id="${agent.id}"><span class="avatar" style="background:${escapeHTML(agent.color)}">${escapeHTML(agent.emoji)}</span><span><strong>${escapeHTML(agent.name)}</strong><small>${escapeHTML(agent.role)}</small></span></button>`).join('')}</div><div class="modal-footer"><button class="outline" data-action="team-modal">＋ 添加员工</button></div>`;
  } else if (modal.type === 'agent-edit') {
    const agent = state.session.agents.find(item => item.id === modal.id);
    title = `${agent.name} · 属性`;
    body = agentDetail(agent);
  } else if (modal.type === 'review-opportunity') {
    const run = state.session.runs.find(item => item.id === modal.runId);
    const item = run?.suggestions.find(value => value.id === modal.id);
    if (!item) return '';
    title = '审核并行任务';
    body = `<p class="muted">${escapeHTML(item.reason)}。只有点击“同意并执行”后才会分配任务。</p><form id="opportunity-form"><div class="field"><label>要做什么</label><input name="title" value="${escapeHTML(item.title)}" required maxlength="80"></div><div class="field"><label>具体要求</label><textarea name="brief" required maxlength="600">${escapeHTML(item.brief)}</textarea></div><div class="field"><label>交给谁</label><select name="agentId">${state.session.agents.map(agent => `<option value="${agent.id}" ${agent.id === item.agentId ? 'selected' : ''}>${escapeHTML(agent.name)} · ${escapeHTML(agent.role)}</option>`).join('')}</select></div><div class="modal-footer"><button class="outline danger-outline" type="button" data-action="reject-opportunity" data-run="${run.id}" data-id="${item.id}">不安排</button><button class="primary" type="submit">同意并执行</button></div></form>`;
  } else if (modal.type === 'steer-run') {
    title = '补充任务要求';
    body = `<p class="muted">这条要求会进入当前任务记录，供尚未开始的步骤使用。已经运行中的工作不会被暗中中断。</p><form id="steering-form"><div class="field"><label>补充要求</label><textarea name="content" maxlength="1000" required placeholder="例如：页面优先适配手机；交付说明写清数据保存位置"></textarea></div><div class="modal-footer"><button class="outline" type="button" data-action="close-modal">取消</button><button class="primary" type="submit">加入任务</button></div></form>`;
  } else if (modal.type === 'request-changes') {
    title = '要求修改交付';
    body = `<p class="muted">写清需要修正的地方。系统会保留本次交付，另建一项关联任务继续处理。</p><form id="revision-form"><div class="field"><label>修改意见</label><textarea name="feedback" maxlength="1000" required placeholder="例如：新增记录后统计图没有更新，请修复并实际验证"></textarea></div><div class="modal-footer"><button class="outline" type="button" data-action="close-modal">取消</button><button class="primary" type="submit">安排修改</button></div></form>`;
  }
  return `<div class="modal-backdrop" data-action="close-modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close-modal">×</button></div>${body}</div></div>`;
}

function previewHTML() {
  if (!state.preview) return '';
  return `<div class="preview-panel"><div class="preview-head"><span>预览 · ${escapeHTML(state.preview.name)}</span><div><a class="outline" href="${fileLink(state.preview)}">下载文件</a> <button class="icon-btn" data-action="close-preview">×</button></div></div>${/\.html?$/i.test(state.preview.name) ? '<iframe id="preview-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="产物预览"></iframe>' : `<pre>${escapeHTML(state.preview.content)}</pre>`}</div>`;
}

function render() {
  if (!state.boot) return;
  const focus = document.activeElement?.id === 'composer-input';
  const cursor = focus ? document.activeElement.selectionStart : null;
  $('#app').className = '';
  $('#app').innerHTML = `<div class="shell">${sidebar()}<div class="main">${topbar()}${state.view === 'chat' && state.session ? chat() : state.view === 'agents' ? agentsPage() : state.view === 'skills' ? skillsPage() : settingsPage()}</div></div>${modalHTML()}${previewHTML()}`;
  if (focus && $('#composer-input')) { $('#composer-input').focus(); $('#composer-input').setSelectionRange(cursor, cursor); }
  renderMention();
  if (state.preview && /\.html?$/i.test(state.preview.name)) {
    const frame = $('#preview-frame');
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">${state.preview.content}`;
  }
}

function renderMention() {
  const slot = $('#mention-slot');
  if (!slot) return;
  if (!state.mention) { slot.innerHTML = ''; return; }
  const q = state.mention.query.toLowerCase();
  const options = state.mention.type === '/' ? state.boot.skills.map(skill => ({ id: skill.id, name: skill.name, sub: skill.installed && skill.enabled ? skill.category : '前往 Skill 中心启用', available: skill.installed && skill.enabled })) : [
    ...state.session.agents.map(agent => ({ id: agent.id, name: agent.name, sub: agent.role, available: true })),
    ...state.boot.profiles.filter(profile => !state.session.agents.some(agent => agent.profileId === profile.id)).map(profile => ({ id: profile.id, name: profile.name, sub: `${profile.role} · 加入当前对话`, available: false }))
  ];
  const matches = options.filter(item => item.name.toLowerCase().includes(q)).sort((a, b) => Number(b.available) - Number(a.available));
  slot.innerHTML = `<div class="mention-menu"><div class="mention-caption">${state.mention.type === '/' ? '选择技能' : '选择员工'} · 点击即可加入</div>${matches.length ? matches.map(item => `<button type="button" data-action="mention" data-id="${item.id}" data-name="${escapeHTML(item.name)}" data-available="${item.available}"><span class="avatar" style="width:27px;height:27px">${state.mention.type}</span><span><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.sub)}</small></span></button>`).join('') : `<div class="empty-small" style="padding:10px">没有匹配项</div>`}</div>`;
}

async function action(name, el) {
  if (name === 'new-session') { const session = await api('/sessions', 'POST', {}); state.session = await api(`/sessions/${session.id}`); localStorage.setItem('lastSessionId', session.id); state.view = 'chat'; state.draft = ''; await refresh(); return; }
  if (name === 'jump-review') { document.querySelector(`#run-${el.dataset.run} .delivery-box`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (name === 'open-session') { state.session = await api(`/sessions/${el.dataset.id}`); localStorage.setItem('lastSessionId', state.session.id); state.view = 'chat'; state.selectedAgent = null; state.draft = ''; render(); return; }
  if (name === 'nav') { state.view = el.dataset.view; state.modal = null; render(); return; }
  if (name === 'team-modal') state.modal = { type: 'team' };
  if (name === 'manage-team') state.modal = { type: 'manage-team' };
  if (name === 'edit-session-agent') state.modal = { type: 'agent-edit', id: el.dataset.id };
  if (name === 'select-agent') state.selectedAgent = el.dataset.id || null;
  if (name === 'close-modal' || name === 'close-modal-backdrop') state.modal = null;
  if (name === 'close-preview') state.preview = null;
  if (name === 'profile-new') state.modal = { type: 'profile', profile: {} };
  if (name === 'edit-profile') state.modal = { type: 'profile', profile: state.boot.profiles.find(item => item.id === el.dataset.id) };
  if (name === 'custom-agent') state.modal = { type: 'custom-agent' };
  if (name === 'skill-detail') state.modal = { type: 'skill', id: el.dataset.id };
  if (name === 'test-skill') { toast('正在运行技能示例测试…'); const result = await api(`/skills/${el.dataset.id}/test`, 'POST', {}); toast(`测试通过${result.filename ? ` · ${result.filename}` : ''}`); return; }
  if (name === 'scheme-new') state.modal = { type: 'scheme' };
  if (name === 'apply-scheme') state.modal = { type: 'apply-scheme', id: el.dataset.id };
  if (name === 'session-menu') state.modal = { type: 'session-menu' };
  if (name === 'skill-tab') { state.skillTab = el.dataset.tab; state.skillQuery = ''; state.skillCategory = 'all'; }
  if (name === 'starter') { state.draft = el.dataset.text; render(); focusComposerEnd(); return; }
  if (name === 'setup-team') { for (const profile of state.boot.profiles.slice(0, 3)) if (!state.session.agents.some(agent => agent.profileId === profile.id)) await api(`${sessionPath()}/agents`, 'POST', { profileId: profile.id }); toast('开发团队已加入当前对话'); await refresh(); return; }
  if (name === 'add-profile-agent' || name === 'add-blueprint-agent') { const body = name === 'add-profile-agent' ? { profileId: el.dataset.id } : { blueprintId: el.dataset.id }; await api(`${sessionPath()}/agents`, 'POST', body); state.modal = null; toast('员工已加入当前对话'); await refresh(); return; }
  if (name === 'use-blueprint') { await api(`${sessionPath()}/agents`, 'POST', { blueprintId: el.dataset.id }); state.view = 'chat'; toast('已从 Blueprint 创建会话员工'); await refresh(); return; }
  if (name === 'remove-agent') { if (confirm('从当前对话移除这位员工？全局档案会保留。')) { await api(`${sessionPath()}/agents/${el.dataset.id}`, 'DELETE'); state.selectedAgent = null; await refresh(); } return; }
  if (name === 'save-blueprint') { const agent = state.session.agents.find(item => item.id === el.dataset.id); const title = prompt('Blueprint 名称', agent.name + '配置'); if (title?.trim()) { const { id, sessionId, profileId, status, ...config } = agent; await api('/blueprints', 'POST', { ...config, name: title.trim(), version: 1 }); toast('Blueprint 已保存'); await refresh(); } return; }
  if (name === 'install-skill') { await api(`/skills/${el.dataset.id}`, 'PATCH', { installed: true, enabled: true }); toast('技能已安装并启用'); await refresh(); return; }
  if (name === 'toggle-skill') { const skill = state.boot.skills.find(item => item.id === el.dataset.id); await api(`/skills/${skill.id}`, 'PATCH', { enabled: !skill.enabled }); await refresh(); return; }
  if (name === 'uninstall-skill') { if (confirm('卸载该技能？员工现有配置会保留记录，但新任务无法调用。')) { await api(`/skills/${el.dataset.id}`, 'PATCH', { installed: false }); await refresh(); } return; }
  if (name === 'apply-scheme-agent') { const scheme = state.boot.schemes.find(item => item.id === el.dataset.scheme); const agent = state.session.agents.find(item => item.id === el.dataset.id); await api(`${sessionPath()}/agents/${agent.id}`, 'PATCH', { skillIds: [...new Set([...agent.skillIds, ...scheme.skillIds])] }); state.modal = null; toast('技能方案已装备'); await refresh(); return; }
  if (name === 'attach') { $('#file-input')?.click(); return; }
  if (name === 'insert-slash' || name === 'insert-at') { const marker = name === 'insert-slash' ? '/' : '@'; const cursor = $('#composer-input')?.selectionStart ?? state.draft.length; state.draft = state.draft.slice(0, cursor) + marker + state.draft.slice(cursor); state.mention = { type: marker, query: '', start: cursor, end: cursor + 1 }; render(); const input = $('#composer-input'); input?.focus(); input?.setSelectionRange(cursor + 1, cursor + 1); return; }
  if (name === 'mention') {
    if (!state.mention) return;
    const marker = state.mention.type;
    if (el.dataset.available === 'false') {
      if (marker === '/') { state.view = 'skills'; state.skillTab = 'market'; state.skillQuery = el.dataset.name; state.mention = null; render(); toast('请先安装并启用技能'); return; }
      const agent = await api(`${sessionPath()}/agents`, 'POST', { profileId: el.dataset.id });
      await refresh(); el = { dataset: { name: agent.name } };
    }
    const { start, end } = state.mention;
    const insertion = marker + el.dataset.name + ' ';
    state.draft = state.draft.slice(0, start) + insertion + state.draft.slice(end);
    state.mention = null; render(); const input = $('#composer-input'); input?.focus(); input?.setSelectionRange(start + insertion.length, start + insertion.length); return;
  }
  if (name === 'review-opportunity') state.modal = { type: 'review-opportunity', runId: el.dataset.run, id: el.dataset.id };
  if (name === 'reject-opportunity') { await api(`${sessionPath()}/runs/${el.dataset.run}/suggestions/${el.dataset.id}`, 'POST', { decision: 'reject' }); state.modal = null; toast('已决定不安排'); await refresh(); return; }
  if (name === 'steer-run') state.modal = { type: 'steer-run', runId: el.dataset.run };
  if (name === 'accept-delivery') { await api(`${sessionPath()}/runs/${el.dataset.run}/review`, 'POST', { decision: 'accept' }); toast('已接受交付'); await refresh(); return; }
  if (name === 'request-changes') state.modal = { type: 'request-changes', runId: el.dataset.run };
  if (name === 'cancel-run') { await api(`${sessionPath()}/runs/${el.dataset.id}/cancel`, 'POST', {}); toast('任务已取消'); await refresh(); return; }
  if (name === 'retry-run') { await api(`${sessionPath()}/runs/${el.dataset.id}/retry`, 'POST', {}); toast('正在重试'); await refresh(); return; }
  if (name === 'toggle-events') state.showEvents = !state.showEvents;
  if (name === 'test-provider') { const result = await api('/provider/test', 'POST', {}); toast(`${result.name} 连接成功`); return; }
  if (name === 'rename-session') { const title = prompt('对话名称', state.session.title); if (title?.trim()) { await api(sessionPath(), 'PATCH', { title }); state.modal = null; await refresh(); } return; }
  if (name === 'archive-session') { await api(sessionPath(), 'PATCH', { archived: true }); state.modal = null; toast('对话已归档'); await refresh(); return; }
  if (name === 'delete-session') { if (confirm('删除后，这段对话的消息、任务、会话员工和文件都将清除。全局员工档案与技能保留。确定删除？')) { await api(sessionPath(), 'DELETE'); localStorage.removeItem('lastSessionId'); state.session = null; state.modal = null; await refresh(); } return; }
  if (name === 'preview') { const file = state.session.files.find(item => item.id === el.dataset.id); const response = await fetch(`${fileLink(file)}/preview`); if (!response.ok) throw new Error('无法预览文件'); state.preview = { ...file, content: await response.text() }; }
  render();
}

function focusComposerEnd() {
  const input = $('#composer-input');
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'close-modal-backdrop' && event.target !== el) return;
  event.preventDefault();
  action(el.dataset.action, el).catch(error => toast(error.message, true));
});

document.addEventListener('submit', event => {
  event.preventDefault();
  (async () => {
    const form = event.target;
    if (form.id === 'composer-form') {
      const content = state.draft.trim();
      if (!content) return;
      if (/^(帮我)?(?:(?:进行)?(?:文件|应用|网页|页面|产物)的?)?(打开|预览|查看)(一下)?(?:文件|应用|网页|页面|产物)?[。！!？?\s]*$/.test(content)) {
        const file = state.session.files.find(item => /\.html?$/i.test(item.name));
        if (!file) throw new Error('当前对话还没有可打开的网页应用');
        window.open(appLink(file.id), '_blank', 'noopener');
        state.draft = ''; state.mention = null; render(); toast('已打开交互应用'); return;
      }
      await api(`${sessionPath()}/messages`, 'POST', { content });
      state.draft = ''; state.mention = null;
      await refresh(true); scrollBottom();
    } else if (form.id === 'agent-form') {
      const data = new FormData(form);
      await api(`${sessionPath()}/agents/${form.dataset.id}`, 'PATCH', { name: data.get('name'), role: data.get('role'), description: data.get('description'), skillIds: data.getAll('skillIds') });
      toast('当前会话员工已保存'); await refresh();
    } else if (form.id === 'profile-form') {
      const data = Object.fromEntries(new FormData(form));
      if (state.modal.type === 'custom-agent') { await api(`${sessionPath()}/agents`, 'POST', data); state.view = 'chat'; }
      else { const profile = state.modal.profile; await api(profile.id ? `/profiles/${profile.id}` : '/profiles', profile.id ? 'PATCH' : 'POST', data); }
      state.modal = null; toast('已保存'); await refresh();
    } else if (form.id === 'scheme-form') {
      const data = new FormData(form);
      await api('/schemes', 'POST', { name: data.get('name'), skillIds: data.getAll('skillIds') });
      state.modal = null; toast('技能方案已保存'); await refresh();
    } else if (form.id === 'opportunity-form') {
      const data = Object.fromEntries(new FormData(form));
      await api(`${sessionPath()}/runs/${state.modal.runId}/suggestions/${state.modal.id}`, 'POST', { decision: 'approve', ...data });
      state.modal = null; toast('已加入工作清单并安排执行'); await refresh();
    } else if (form.id === 'steering-form') {
      const content = new FormData(form).get('content');
      await api(`${sessionPath()}/runs/${state.modal.runId}/steer`, 'POST', { content });
      state.modal = null; toast('已加入任务，后续步骤会看到补充要求'); await refresh();
    } else if (form.id === 'revision-form') {
      const feedback = new FormData(form).get('feedback');
      await api(`${sessionPath()}/runs/${state.modal.runId}/review`, 'POST', { decision: 'request_changes', feedback });
      state.modal = null; toast('已安排关联的修改任务'); await refresh(true); scrollBottom();
    } else if (form.id === 'provider-form') {
      const data = new FormData(form);
      const payload = { provider: data.get('provider'), model: data.get('model') };
      if (data.get('key')) payload.key = data.get('key');
      await api('/provider', 'POST', payload);
      form.elements.key.value = '';
      toast('模型连接已保存到当前服务进程'); await refresh();
    }
  })().catch(error => toast(error.message, true));
});

document.addEventListener('input', event => {
  if (event.target.id === 'composer-input') {
    state.draft = event.target.value;
    const caret = event.target.selectionStart;
    const before = state.draft.slice(0, caret);
    const match = before.match(/([/@])([^\s/@]*)$/);
    const start = match ? caret - match[0].length : -1;
    const valid = start >= 0 && (start === 0 || !/[a-zA-Z0-9._:/@-]/.test(state.draft[start - 1]));
    state.mention = valid ? { type: match[1], query: match[2], start, end: caret } : null;
    renderMention();
  }
  if (event.target.id === 'skill-search') {
    state.skillQuery = event.target.value;
    const caret = event.target.selectionStart;
    render(); $('#skill-search')?.focus(); $('#skill-search')?.setSelectionRange(caret, caret);
  }
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'composer-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (state.mention && $('.mention-menu button')) $('.mention-menu button').click(); else $('#composer-form')?.requestSubmit(); }
  if (event.key === 'Escape') { state.modal = null; state.preview = null; state.mention = null; render(); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'skill-category') { state.skillCategory = event.target.value; render(); }
  if (event.target.id === 'provider-select') {
    const item = state.boot.provider.providers.find(provider => provider.id === event.target.value);
    $('#provider-model').innerHTML = item.models.map(model => `<option value="${escapeHTML(model)}">${escapeHTML(model)}</option>`).join('');
    const badge = $('#provider-form .chip');
    badge.textContent = `${item.name} ${item.configured ? '已配置' : '未配置'}`;
    badge.className = `chip ${item.configured ? 'green' : 'orange'}`;
  }
  if (event.target.id === 'dev-mode') { state.devMode = event.target.checked; localStorage.setItem('devMode', state.devMode); render(); }
  if (event.target.id === 'file-input') {
    (async () => {
      for (const file of event.target.files) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} 超过 5 MB`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        await api(`${sessionPath()}/files`, 'POST', { name: file.name, mime: file.type || 'application/octet-stream', base64: btoa(binary) });
      }
      toast('文件已加入当前对话'); await refresh();
    })().catch(error => toast(error.message, true));
  }
});

async function init() {
  await refresh();
  if (!state.session) { const session = await api('/sessions', 'POST', {}); state.session = await api(`/sessions/${session.id}`); await refresh(); }
  setInterval(async () => { if (activeRun()) { try { await refresh(true); } catch (error) { toast(error.message, true); } } }, 1800);
}
init().catch(error => { $('#app').innerHTML = `<div class="app-loading"><div class="loading-mark">!</div><p>无法打开工作空间：${escapeHTML(error.message)}</p></div>`; });
