# Output Patterns

## Dry-run response

`dry_run = true` 时，仍应返回结构化 `execution_log`：

```json
{
  "execution_log": {
    "status": "success",
    "dry_run": true,
    "failure_reason": null
  }
}
```

## Real submit response

真实提交流程结束后，返回：

```json
{
  "execution_log": {
    "status": "success",
    "dry_run": false,
    "failure_reason": null
  }
}
```

- 浏览器失败也必须返回非空 `failure_reason`
- `ready_for_submission = false` 且未允许 risky submit 时，不得进入真实提交
