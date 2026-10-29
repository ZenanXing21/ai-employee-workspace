const DEFAULT_ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';
import { extractHTML } from './preview.js';

function cleanCode(text) {
  return text.trim().replace(/^```(?:html|javascript|js|json|text)?\s*\n/i, '').replace(/\n```\s*$/, '');
}

export function createKimiExecutor({ key = process.env.MOONSHOT_API_KEY || '', model = process.env.MOONSHOT_MODEL || 'kimi-k2.5', endpoint = process.env.MOONSHOT_ENDPOINT || DEFAULT_ENDPOINT, providerName = 'Kimi', fetchImpl = fetch } = {}) {
  return async ({ run, task, agent, deps, skills, files, messages = [], sourceArtifacts = [], signal }) => {
    if (!key) throw new Error(`尚未配置 ${providerName} API 密钥。请在设置页面连接模型服务。`);
    const prior = deps.map(dep => `${dep.title} (${dep.status}): ${dep.result?.text || dep.error || ''}${dep.result?.filename ? `；文件：${dep.result.filename}\n${dep.content}` : ''}`).join('\n\n').slice(0, 50000);
    const skillContext = skills.map(skill => `${skill.name}: ${skill.instructions}`).join('\n');
    const uploaded = files.filter(file => !deps.some(dep => dep.result?.fileId === file.id)).slice(0, 8).map(file => `${file.name}${file.text ? `:\n${file.text}` : '（二进制附件，当前仅提供文件名）'}`).join('\n\n').slice(0, 30000);
    const memory = messages.filter(message => message.content).map(message => `${message.role === 'user' ? '用户' : '主管'}：${message.content}`).join('\n').slice(-12000);
    const revisionSource = sourceArtifacts.map(file => `完整的原交付文件 ${file.name}：\n${file.content}`).join('\n\n');
    const taskRules = {
      frontend: '只输出一个可直接打开的完整 HTML 文件代码。把 CSS 和 JavaScript 内联，制作真实可交互的界面。不要使用远程资源、Markdown 代码块或说明文字。',
      backend: '只输出一个可运行的 Node.js 服务文件代码，使用内置模块，包含数据持久化与清晰的 API。不要使用远程依赖、Markdown 代码块或说明文字。',
      qa_prep: '在前后端尚未完成时，独立编写可执行的验收场景、输入数据、边界条件和预期结果。不要声称已完成集成测试。',
      qa_integration: '阅读前置任务的成果，检查前后端接口和测试计划是否一致。明确区分已验证事实和仅建议的测试步骤，不要声称运行了未运行的代码。',
      summary: '汇总各员工真实完成的内容、文件和未完成项。失败的工作要如实说明。给普通用户简短、清晰的交付说明。',
      direct: '直接完成用户的任务。若要求制作 Web 应用，只输出一个完整、可交互的 HTML 文件代码，不要 Markdown 代码块。',
      contribution: '按你的职责完成可独立交付的工作，并给出具体内容。'
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [
          { role: 'system', content: `你是${agent.name}，职责：${agent.role}。${agent.description || ''}\n当前任务：${task.title}。${taskRules[task.kind] || ''}\n任务说明：${task.brief || '按用户目标完成本项工作'}。\n临时调用的技能：${skillContext || '无'}。` },
          { role: 'user', content: `用户目标：${run.goal}\n${revisionSource ? `需要在以下完整原交付文件基础上修改，保留无须变动的功能：\n${revisionSource}\n` : ''}当前会话的近期对话：\n${memory || '无'}\n当前会话附件：${uploaded || '无'}\n前置结果：${prior || '无'}` }
        ] }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`${providerName} API 返回 ${response.status}：${detail.slice(0, 300)}`);
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error(`${providerName} 未返回可用内容`);
      const text = cleanCode(content);
      const html = extractHTML(text);
      if (task.kind === 'frontend' && (!html || !/<script\b[^>]*>\s*\S[\s\S]*?<\/script>/i.test(html))) throw new Error('生成的页面缺少完整 HTML 或交互脚本，请重试');
      if (['frontend', 'direct'].includes(task.kind) && html) {
        return { text: `已生成可交互页面：${task.kind === 'direct' ? '应用' : '前端页面'}。`, filename: 'index.html', mime: 'text/html; charset=utf-8', content: html };
      }
      if (task.kind === 'backend') return { text: '已生成后端服务代码。', filename: 'server.js', mime: 'text/javascript; charset=utf-8', content: text };
      if (task.kind === 'qa_prep') return { text: '已准备测试用例。', filename: 'test-plan.md', mime: 'text/markdown; charset=utf-8', content: text };
      if (task.kind === 'qa_integration') return { text: '已完成集成检查报告。', filename: 'qa-report.md', mime: 'text/markdown; charset=utf-8', content: text };
      return { text };
    } finally { clearTimeout(timeout); }
  };
}
