import { readProductSession, writeProductSession } from "@/services/product-session";

function currentSessionToken(): string {
  return readProductSession()?.session.id ?? "";
}

export function clearAuthSession(token: string) {
  const currentToken = currentSessionToken();
  // 401 清理只能消费请求发出时的 token 快照；无快照或旧快照都不能影响当前登录态。
  if (!currentToken || currentToken !== token) return;

  writeProductSession(null);
}
