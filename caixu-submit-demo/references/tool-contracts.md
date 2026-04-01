# Tool Contracts

## Required objects

- `SubmitDemoData`
- `execution_log`

## execution_log expectations

至少包含：

- `status`
- `started_at`
- `finished_at`
- `steps`
- `result_summary`
- `submitted_artifacts`
- `failure_reason`

## judge_demo_v1 minimum expectations

skill 应准备好这些信息：

- 演示页地址
- 文本字段映射
- 上传字段
- 成功判定条件
