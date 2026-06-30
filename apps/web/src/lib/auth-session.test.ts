import { beforeEach, describe, expect, it } from "vitest";
import { readProductSession, writeProductSession } from "@/services/product-session";
import { clearAuthSession } from "./auth-session";

const sessionFixture = {
  type: "session" as const,
  session: { id: "token-1", expiresAt: "2026-07-03T00:00:00.000Z" },
  user: {
    id: "user-1",
    email: "alice@example.com",
    name: "Alice",
    role: "admin",
    banned: false,
  },
};

describe("auth-session helpers", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not clear a newer product token when an older validation fails", () => {
    // 旧请求的 401 不能清掉用户刚刷新的 token，这是登录竞态的核心防线。
    writeProductSession(sessionFixture);

    clearAuthSession("old-token");

    expect(readProductSession()?.session.id).toBe("token-1");
  });

  it("clears the current product session when the failing token matches", () => {
    writeProductSession(sessionFixture);

    clearAuthSession("token-1");

    expect(readProductSession()).toBeNull();
  });

});
