# Workflow

## Default values

- `submission_profile = judge_demo_v1`
- `dry_run = false`

## Sequential flow

1. `get_package_run`
2. `get_submission_profile`
3. preflight
4. 浏览器执行
5. `write_execution_log`

## Browser-stage responsibilities

- 打开目标页
- 填文本字段
- 上传 zip
- 可选点击最终提交

## dry_run

- 检查页面可达、字段存在、zip 可上传
- 不点最终提交
