import { Script } from 'node:vm';
import { extractHTML } from './preview.js';

export function buildEvidence(run, readFile) {
  const artifacts = [];
  const checks = [];
  const files = (run.tasks || []).filter(task => task.result?.fileId).map(task => {
    const file = readFile(task.result.fileId);
    artifacts.push({ fileId: task.result.fileId, name: task.result.filename || file.name, taskId: task.id, agentId: task.agentId || null, kind: task.kind });
    return { task, text: Buffer.from(file.bytes).toString('utf8') };
  });
  const htmlFile = files.find(item => /\.html?$/i.test(item.task.result.filename || ''));
  const jsFile = files.find(item => item.task.kind === 'backend' && /\.m?js$/i.test(item.task.result.filename || ''));
  if (htmlFile) {
    const html = htmlFile.text.length <= 512 * 1024 ? extractHTML(htmlFile.text) : null;
    checks.push({ id: 'html_structure', label: 'HTML 页面结构', status: html ? 'passed' : 'attention', detail: html ? '找到完整的 HTML 文档。' : '文件不完整或超过静态检查大小限制。' });
    checks.push({ id: 'html_script', label: '页面脚本', status: html && /<script\b[^>]*>[\s\S]*\S[\s\S]*<\/script>/i.test(html) ? 'passed' : 'attention', detail: '仅检查是否包含脚本，不代表按钮已经实际测试。' });
    checks.push({ id: 'browser_test', label: '浏览器实际操作', status: 'not_run', detail: '工作空间尚未自动执行浏览器交互测试，请打开页面验收。' });
  }
  if (jsFile) {
    let status = 'passed', detail = 'JavaScript 文本通过静态语法解析，服务未运行。';
    if (jsFile.text.length > 512 * 1024 || /^\s*(?:import|export)\b/m.test(jsFile.text)) {
      status = 'not_run'; detail = '此文件需要 ESM 或更大文件的独立语法检查；服务未运行。';
    } else {
      try { new Script(jsFile.text); }
      catch (error) { status = 'attention'; detail = `语法解析失败：${error.message}`.slice(0, 180); }
    }
    checks.push({ id: 'javascript_syntax', label: '后端代码语法', status, detail });
  }
  if (htmlFile && jsFile) checks.push({ id: 'integration_test', label: '前后端联通', status: 'not_run', detail: '目前未运行生成的后端，也未验证页面是否调用该接口。' });
  if (!files.length) checks.push({ id: 'execution_test', label: '实际运行验证', status: 'not_run', detail: '本任务没有可运行的文件产物。' });
  return { artifacts, checks };
}
