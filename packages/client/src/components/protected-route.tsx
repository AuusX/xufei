import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authClient } from "@/lib/auth-client";

/** 客户端受保护路由：先确认会话，再挂载 settings/subscriptions/history 等会打私有 API 的页面。 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { data: sessionData, isPending } = authClient.useSession();

  if (isPending) return null;
  if (!sessionData?.session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}
