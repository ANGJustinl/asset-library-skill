---
name: caixu-query-assets
description: Use when the user wants to search or filter an existing 材序 asset library by library_id, material type, keyword, reusable scenario, or validity status. This skill normalizes filters into canonical values, runs deterministic queries through caixu-data-mcp, and returns stored asset cards and merge groups without re-running extraction or agent judgment.
---

# query-assets

在用户要“查我有哪些材料”“看哪些可复用”“按类型筛资产”时使用这个 skill。

## Quick flow

1. 归一化查询条件
2. 调用 `query_assets`
3. 返回结构化结果或推荐先建库

## Read next only when needed

- 需要映射中文类别、场景或有效期状态时，读 [references/workflow.md](references/workflow.md)
- 需要确认 `QueryAssetsData` 字段或 tool 边界时，读 [references/tool-contracts.md](references/tool-contracts.md)
- 需要对齐 filter 归一化输出时，读 [references/output-patterns.md](references/output-patterns.md)
- 遇到空库、空结果、SQLite 不可用时，读 [references/failure-modes.md](references/failure-modes.md)

## Required tools

- `caixu-data-mcp.query_assets`

## Required input

- `library_id`
- `material_types[]?`
- `keyword?`
- `reusable_scenario?`
- `validity_statuses[]?`

## Workflow

1. 要求一个明确的 `library_id`，不要猜测库。
2. 把用户表达归一化成 canonical filters。
3. 如果用户完全没给过滤条件，做一个安全的有界查询，不要无界倾倒全库。
4. 调用 `query_assets` 并直接返回 `ToolResult<QueryAssetsData>`。
5. 如果库还没有 `asset_card`，停止并推荐 `build-asset-library`。

## Guardrails

- 这是 DB 查询 skill，不重新抽取材料，不做 agent 判断。
- 不得把“没有命中”包装成假错误。
- 不得把 SQLite 错误伪装成空结果。
- `merged_assets` 只能跟随命中的资产返回，不要把无关归并组混进结果。
