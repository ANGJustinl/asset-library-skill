# Workflow

## Trigger examples

- “把这些材料建成资产库”
- “生成资产卡”
- “帮我去重并整理版本”

## Sequencing

1. `get_parsed_files`
2. 过滤无可信文本的记录
3. agent 先做 document triage，决定文件是否应进入资产库
4. agent 只对 triage 通过的文件抽取 `asset_card`
5. `upsert_asset_cards`
6. agent 保守生成 `merged_assets`
7. `upsert_merged_assets`

## Batch handling

- 如果上游给了 `file_ids[]`，优先按本批次构建，避免重扫全库。
- 如果未给 `file_ids[]`，可回退到库内全部 parsed files。
- triage 未通过的文件应记为 skip，不要硬抽资产卡。

## Non-goals

- 不做 SQLite 查询回答
- 不做 lifecycle 判断
- 不做 package 或 submission
