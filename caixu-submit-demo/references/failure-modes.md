# Failure Modes

## Blocked readiness

- 若 `ready_for_submission = false` 且 `allow_risky_submit` 不为真，浏览器前停止

## Missing package context

- `get_package_run` 或 `get_submission_profile` 失败时，返回结构化错误
- 不要假装总能写出完整 `execution_log`

## Browser failure

- 状态必须是 `failed` 或 `partial`
- `failure_reason` 必须非空
- 不允许只返回自由文本错误
