# Output Patterns

## Filter normalization response

当先用 agent 归一化自然语言查询时，优先贴近下面的 shape：

```json
{
  "material_types": ["proof"],
  "keyword": null,
  "reusable_scenario": "summer_internship_application",
  "validity_statuses": [],
  "explanation": "Mapped internship-ready proof materials to canonical filters.",
  "next_recommended_skill": ["check-lifecycle"]
}
```

- 只归一化 filter，不改写数据库命中内容
- 没有关键词时返回 `null`
- 没有下一步建议时返回空数组
