---
name: caixu-submit-demo
description: "Submit Package to Demo Page. Use when the user wants the final package submitted to an external judge demo page at the submission stage, including “提交到演示页”“执行最后一步”“上传并记录日志”. Prefer caixu-skill when the user asks for the full end-to-end mainline or is unsure which stage to run. This skill loads the saved package plan and submission profile, checks submission preconditions, uses AutoClaw or OpenClaw browser actions for the real submission, writes back a structured execution_log, and supports dry_run without clicking final submit."
---

# Submit Package to Demo Page

在用户要“提交到演示页”“执行最后一步”“上传并记录日志”时使用这个 skill。

## Quick flow

1. 读取 package plan 和 submission profile
2. 预检 readiness、zip 路径和 profile 必填项
3. 用 AutoClaw/OpenClaw 完成浏览器提交并写 `execution_log`

## Read next only when needed

- 要确认 `dry_run`、`allow_risky_submit` 和提交流程时，读 [references/workflow.md](references/workflow.md)
- 要确认 `SubmitDemoData`、`execution_log` 和 profile 字段时，读 [references/tool-contracts.md](references/tool-contracts.md)
- 要对齐 `execution_log` 和 dry-run 输出时，读 [references/output-patterns.md](references/output-patterns.md)
- 遇到浏览器失败、profile 缺字段或阻塞 readiness 时，读 [references/failure-modes.md](references/failure-modes.md)

## Required tools

- `caixu-data-mcp.get_package_run`
- `caixu-data-mcp.get_submission_profile`
- `caixu-data-mcp.write_execution_log`

## Required runtime

- 已可用的 AutoClaw/OpenClaw 浏览器执行环境

## Required input

- `package_plan_id` or `package_id`
- `submission_profile`
- `allow_risky_submit?`
- `dry_run?`

## Workflow

1. 调用 `get_package_run`。
2. 调用 `get_submission_profile`。
3. 在真正打开浏览器前，运行 `scripts/preflight-submit.mjs` 检查：
   - zip 路径存在
   - profile 必填项完整
   - readiness 是否允许进入浏览器
4. `dry_run = true` 时，只校验页面、字段和文件，不点最终提交。
5. 真实浏览器执行失败时，也必须写结构化 `execution_log`。
6. 调用 `write_execution_log` 并返回 `ToolResult<SubmitDemoData>`。

## Guardrails

- 如果 `ready_for_submission = false` 且未显式允许 risky submit，浏览器前就停止。
- 不允许只返回“提交失败，请重试”。
- 每个浏览器阶段失败都必须变成非空 `failure_reason`。
- 真实浏览器工作属于 AutoClaw/OpenClaw，不要切换到第二套浏览器框架。
