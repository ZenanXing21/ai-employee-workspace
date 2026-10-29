# Copilot Inspired Delivery Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 给 AI 员工工作空间加入可读计划、真实执行证据和人工交付审核闭环。

**Architecture:** 保留现有 SQLite 与调度器；在 run 数据上增加 plan/review/sourceRunId，审核决定通过会话限定的 API 写入。静态证据由独立纯模块分析产物；前端任务卡呈现流程，不伪造运行测试。

**Tech Stack:** Node.js 24 内置 HTTP/SQLite、原生浏览器 JavaScript/CSS、`node:test`。

**Spec:** `docs/design/copilot-inspired-delivery-flow.md`

## Global Constraints

- 不引入第三方运行依赖。
- 不执行模型生成的后端代码；静态检查与实际运行分开标注。
- 审核、补充要求和文件都按 Session 验证归属。
- 现有会话、历史任务与生成文件必须继续可读。

## Review Focus

- 重复点击审核：只能记录一次，不能生成多个修改任务。
- 跨会话请求：不能读取或修改其他会话的 run。
- 运行中补充要求：只能保证影响尚未启动的步骤，界面需说明。
- HTML 中有说明文字或不完整标签：证据应如实标记，不能声称浏览器已验证。
- 无可交付文件的完成任务：审核包仍可展示，不能凭空生成文件。

---

### Task 1: 计划、审核和修改任务的持久状态

**Files:** `src/workspace.js`, `src/server.js`, `tests/workspace.test.js`, `tests/server.test.js`

**Interfaces:** `workspace.reviewRun(sessionId, runId, {decision, feedback})`；`workspace.addSteering(sessionId, runId, content)`；`POST /api/sessions/:sessionId/runs/:runId/review|steer`。

- [x] 写失败测试：计划与验收要点持久化；完成后仅一次审核；修改意见生成 `sourceRunId` 链接；跨会话拒绝。
- [x] 运行对应测试确认失败。
- [x] 实现 run.plan、run.review 与审核/补充要求 API，并用事件记录决定。
- [x] 运行对应测试确认通过。

### Task 2: 如实呈现的交付证据

**Files:** `src/evidence.js`, `src/workspace.js`, `tests/evidence.test.js`

**Interfaces:** `buildEvidence(run, readFile)` 返回 `{artifacts, checks}`，check 有 `status: passed|attention|not_run`。

- [x] 写失败测试：完整 HTML 与不完整 HTML、后端语法、未运行的集成验证。
- [x] 运行对应测试确认失败。
- [x] 实现纯静态检查，并在 `getRun` 中附上证据。
- [x] 运行对应测试确认通过。

### Task 3: 对话任务卡与交互

**Files:** `public/app.js`, `public/styles.css`, `README.md`

**Interfaces:** 任务卡显示 plan/evidence/review；补充要求和审核表单调用 Task 1 API。

- [x] 在任务卡加入计划、最近动作、交付证据与待验收操作。
- [x] 加入补充要求和要求修改表单，显示明确的生效范围。
- [x] 检查 HTML 链接、`@`/`/` 候选与既有进度仍可用。
- [x] 运行 `node --check public/app.js`、`npm test` 并在浏览器打开本地页面验收。


