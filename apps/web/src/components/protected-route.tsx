import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth-client";

/** 客户端受保护路由：先确认会话，再挂载 settings/subscriptions/history 等会打私有 API 的页面。 */
export function ProtectedRoute({ children, adminOnly = false }: { children: ReactNode; adminOnly?: boolean }) {
  const location = useLocation();
  const { data: sessionData, isPending } = authClient.useSession();

  if (isPending) return null;
  if (!sessionData?.session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (adminOnly && (sessionData.user.role !== "admin" || sessionData.user.banned)) {
    // adminOnly 是前端体验防线：避免无权限页面挂载后再弹失败 toast；后端 requireAdmin 仍是最终授权点。
    return <Navigate to="/settings" replace />;
  }

  return <>{children}</>;
}
