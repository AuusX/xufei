import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import AdminUsersPage from "./index";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type AdminUserFixture = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  createdAt: string;
};

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  useI18n: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: mocks.useI18n,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
  },
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiFetch: mocks.apiFetch,
  };
});

const messages: Record<string, string> = {
  "admin.actions": "操作",
  "admin.banned": "已禁用",
  "admin.createUser": "创建用户",
  "admin.currentUserProtected": "不能禁用、降级或删除当前登录账号",
  "admin.enabled": "启用",
  "admin.lastAdmin": "至少需要保留一个启用的管理员",
  "admin.loadFailed": "加载用户失败",
  "admin.loadFailedDescription": "加载用户失败，请稍后重试",
  "admin.resetPassword": "重置密码",
  "admin.role": "角色",
  "admin.roleAdmin": "管理员",
  "admin.roleUser": "用户",
  "admin.status": "状态",
  "admin.subtitle": "管理可访问本系统的用户账号",
  "admin.title": "用户管理",
  "admin.user": "用户",
  "common.delete": "删除",
  "common.loading": "Loading...",
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function makeT(prefix = "") {
  return (key: string, params?: Record<string, string | number>) => {
    let value: string = messages[key] ?? key;
    for (const [paramKey, paramValue] of Object.entries(params ?? {})) {
      value = value.split(`{${paramKey}}`).join(String(paramValue));
    }
    return prefix ? `${prefix}${value}` : value;
  };
}

function user(overrides: Partial<AdminUserFixture> = {}): AdminUserFixture {
  return {
    id: "user-1",
    name: "张三",
    email: "zhangsan@example.com",
    role: "user",
    banned: false,
    createdAt: "2026-05-15T00:00:00.000Z",
    ...overrides,
  };
}

function renderAdminUsersPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <AdminUsersPage />
    </TooltipProvider>,
  );
}

describe("AdminUsersPage", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.useI18n.mockReturnValue({ t: makeT() });
    mocks.useSession.mockReturnValue({
      data: {
        session: { id: "token" },
        user: {
          id: "current-admin",
          email: "admin@example.com",
          name: "管理员",
          role: "admin",
          banned: false,
        },
      },
      isPending: false,
    });
  });

  it("shows loading only until the initial users request resolves", async () => {
    const usersRequest = createDeferred<{ users: AdminUserFixture[] }>();
    mocks.apiFetch.mockReturnValueOnce(usersRequest.promise);

    renderAdminUsersPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    usersRequest.resolve({ users: [user({ name: "李四", email: "lisi@example.com" })] });

    expect(await screen.findByText("李四")).toBeInTheDocument();
    expect(screen.getByText("lisi@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("does not reload users when the translation function reference changes", async () => {
    mocks.apiFetch.mockResolvedValueOnce({
      users: [user({ name: "王五", email: "wangwu@example.com" })],
    });
    const { rerender } = renderAdminUsersPage();

    expect(await screen.findByText("王五")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);

    mocks.useI18n.mockReturnValue({ t: makeT("[new] ") });
    rerender(
      <TooltipProvider delayDuration={0}>
        <AdminUsersPage />
      </TooltipProvider>,
    );

    expect(screen.getByText("王五")).toBeInTheDocument();
    expect(screen.queryByText("[new] Loading...")).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing list visible while a refresh request is pending", async () => {
    const userFixture = user({ id: "editable-user", name: "赵六", email: "zhaoliu@example.com" });
    const refreshRequest = createDeferred<{ users: AdminUserFixture[] }>();
    let getRequests = 0;

    mocks.apiFetch.mockImplementation((input: string, _responseSchema: unknown, init?: RequestInit) => {
      if (input === "/api/app/admin/users") {
        getRequests += 1;
        if (getRequests === 1) return Promise.resolve({ users: [userFixture] });
        return refreshRequest.promise;
      }
      if (input === "/api/app/admin/users/editable-user" && init?.method === "PATCH") {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`Unexpected request: ${input}`));
    });

    const interaction = userEvent.setup();
    renderAdminUsersPage();

    expect(await screen.findByText("赵六")).toBeInTheDocument();

    await interaction.click(screen.getByRole("switch"));

    await waitFor(() => expect(getRequests).toBe(2));
    expect(screen.getByText("赵六")).toBeInTheDocument();
    expect(screen.getByText("zhaoliu@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

    refreshRequest.resolve({ users: [{ ...userFixture, banned: true }] });

    await waitFor(() => expect(screen.getByText("已禁用")).toBeInTheDocument());
  });
});
