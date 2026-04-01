# Tool Contracts

## Tool

- `caixu-data-mcp.query_assets`

## Output

返回 `ToolResult<QueryAssetsData>`，其中至少包含：

- `data.library_id`
- `data.asset_cards`
- `data.merged_assets`

## Preconditions

- 该库至少应完成一次成功的 `build-asset-library`
- 若库里只有 parsed files，没有 asset cards，应停止并推荐建库
