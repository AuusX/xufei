/**
 * SPA 路由表。
 *
 * 架构位置：只声明 URL 到页面组件的映射；受保护页面统一由 ProtectedRoute
 * 延迟挂载，认证跳转、setup 可见性和缓存刷新继续由 AuthSync / 页面级 hook 处理。
 *
 * 注意： 新增公开页面时必须同步 `public-routes.ts`，否则刷新后会被客户端守卫带回登录页。
 */
import { Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "@/pages/dashboard";
import Subscriptions from "@/pages/subscriptions";
import Calendar from "@/pages/calendar";
import Statistics from "@/pages/statistics";
import Settings from "@/pages/settings";
import Setup from "@/pages/setup";
import Login from "@/pages/login";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import AdminUsers from "@/pages/admin/users";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";
import { ProtectedRoute } from "@/components/protected-route";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/subscriptions" element={<ProtectedRoute><Subscriptions /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><Calendar /></ProtectedRoute>} />
      <Route path="/statistics" element={<ProtectedRoute><Statistics /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/index.html" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
