/**
 * 设置页路由装配层。
 *
 * 架构位置：SettingsScreen 已经包含 controller/presentation 组合；路由文件只保持懒加载边界清晰。
 */
import { SettingsScreen } from "@/modules/settings/presentation/settings-screen";

export default function SettingsPage() {
  return <SettingsScreen />;
}
