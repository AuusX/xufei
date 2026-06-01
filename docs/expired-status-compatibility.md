# 已过期状态兼容说明

## 当前策略

`expired` 现在是正式的订阅状态。新建或编辑订阅时可以保存 `status=expired`，默认状态配置也包含 `expired / 已过期`。

对旧版本数据，Renewlet 目前不会在升级时自动改写订阅记录。前端读取订阅后会计算“有效状态”：

- 数据库里已经保存为 `expired` 的订阅，继续显示为 `expired`；
- 数据库里保存为 `active` 或 `trial`，且 `nextBillingDate` 早于用户本地今天的订阅，在 UI、筛选和统计中按有效 `expired` 处理；
- 数据库里保存为 `paused` 或 `cancelled` 的订阅，即使 `nextBillingDate` 已经过期，也保留原状态。

这样可以让旧数据在界面上正确呈现“已过期”，同时避免升级时静默修改用户保存过的历史数据。

## 状态配置兼容

旧版本的 `custom_configs.statuses` 不包含 `expired`。客户端规范化状态配置时会：

- 只保留内置状态值；
- 尽量保留已有内置状态的排序；
- 使用当前版本的默认 label 和 color 覆盖内置状态配置；
- 追加缺失的内置状态，例如 `expired`。

因此，升级后的设置页状态管理、订阅表单和订阅列表筛选都会展示同一套内置状态。

## 为什么暂不自动迁移数据

把所有已过扣费日的 `active/trial` 记录直接写成 `expired` 属于数据迁移，不只是展示修复。当前版本选择读取侧兼容，是为了避免升级时静默改变用户数据。

例如，用户可能正在核对账单日期，暂时保留某个已过扣费日的订阅为 `active`。读取侧兼容可以在界面上提示“已过期”，但不会直接覆盖数据库里的原始状态。

## 未来完整迁移

当后续版本准备移除这层兼容时，需要先完成以下工作：

1. 执行一次性数据迁移，把符合条件的 `active/trial` 订阅写入真实 `expired` 状态。
2. 确认所有已保存的 `custom_configs.statuses` 都包含当前内置状态。
3. 移除 `getEffectiveSubscriptionStatus` 中基于日期把旧 `active/trial` 视为 `expired` 的兼容判断。
4. 让筛选、统计、首页、图表、即将续费和日历直接依赖数据库中的真实状态。
5. 删除用于验证“旧 active/trial 过期记录会被读取为有效 expired”的兼容测试。
6. 保留验证真实 `expired` 状态端到端可用的测试。

## 测试保留与删除

长期保留：

- schema 接受 `status=expired`；
- 默认状态配置包含 `expired`；
- 卡片能用已过期视觉样式展示真实 `expired`；
- 统计把真实 `expired` 当作非活动订阅处理。

完整迁移后可删除：

- 旧 `active/trial` 过期记录能被“已过期”筛选出来；
- 旧 `active/trial` 过期记录不会计入首页和统计页的活跃成本；
- 旧状态配置会自动补齐 `expired`。

## 设计参考

这些参考只用于说明当前 UI 选择的依据，不代表项目实现了额外能力：

- GOV.UK Design System Tag：状态应使用明确的文字标签展示。https://design-system.service.gov.uk/components/tag/
- Carbon Design System Status Indicator：状态提示应结合文字、颜色和视觉样式传达含义。https://carbondesignsystem.com/patterns/status-indicator-pattern/
- WCAG 2.2 Use of Color：不能只依赖颜色传达状态信息。https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
