// 自定义配置文案覆盖用户可编辑分类/状态/支付/货币管理，和默认配置 labels 的来源保持分离。
import { msg } from "@lingui/core/macro";

export const messages = [
  msg({ id: "customConfig.iconLabel", message: "图标：" }),
  msg({ id: "customConfig.valuePlaceholder", message: "键值" }),
  msg({ id: "customConfig.labelZhPlaceholder", message: "中文名称" }),
  msg({ id: "customConfig.labelEnPlaceholder", message: "英文名称" }),
  msg({ id: "customConfig.customColorPlaceholder", message: "自定义颜色" }),
  msg({ id: "customConfig.empty", message: "暂无配置项" }),
  msg({ id: "customConfig.enabledCount", message: "{enabled}/{total} 已启用" }),
  msg({ id: "customConfig.srDescription", message: "管理{title}的选项、排序和启用状态。" }),
  msg({ id: "customConfig.dragSortEnabled", message: "拖拽排序 · {enabled}/{total} 已启用" }),
  msg({ id: "customConfig.dragSortOnly", message: "仅支持拖拽排序" }),
  msg({ id: "customConfig.dragSort", message: "拖拽排序" }),
  msg({ id: "customConfig.totalItems", message: "共 {count} 项" }),
  msg({ id: "customConfig.addOption", message: "添加选项" }),
  msg({ id: "customConfig.confirmDeleteTitle", message: "确认删除" }),
  msg({ id: "customConfig.confirmDeleteDescription", message: "确定要删除「{label}」吗？删除后不会影响已有订阅数据，但该选项将不再可选，且可能影响展示/筛选。" }),
] as const;
