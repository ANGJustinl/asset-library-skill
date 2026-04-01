# Workflow

## Trigger examples

- “我有哪些可用材料”
- “查一下证书类材料”
- “看看哪些可用于实习申请”

## Filter normalization

### material_types

- `证明类` -> `proof`
- `经历类` -> `experience`
- `权益类` -> `rights`
- `财务类` -> `finance`
- `协议类` -> `agreement`

### validity_statuses

- `有效` -> `valid`
- `快过期` -> `expiring`
- `已过期` -> `expired`
- `长期有效` -> `long_term`
- `未知` -> `unknown`

### reusable_scenario

- `实习申请` -> `summer_internship_application`

## Default behavior

- 完全无过滤条件时，做安全的有界查询，不要直接 dump 全库。
