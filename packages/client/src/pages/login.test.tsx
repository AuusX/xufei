import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Login from "./login";

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  usePasswordResetAvailability: vi.fn(),
  useSetupStatus: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: mocks.signInEmail,
    },
  },
}));

vi.mock("@/hooks/use-password-reset-availability", () => ({
  usePasswordResetAvailability: mocks.usePasswordResetAvailability,
}));

vi.mock("@/hooks/use-setup-status", () => ({
  useSetupStatus: mocks.useSetupStatus,
}));

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe("Login page", () => {
  beforeEach(() => {
    mocks.usePasswordResetAvailability.mockReturnValue(false);
    mocks.useSetupStatus.mockReturnValue({
      setupRequired: false,
      setupEnabled: true,
      isLoading: false,
    });
  });

  it("hides the first deployment setup prompt after setup is complete", () => {
    renderLogin();

    expect(screen.queryByText("首次部署请先前往")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "初始化管理员" })).not.toBeInTheDocument();
  });

  it("shows the setup prompt only when setup is required and enabled", () => {
    mocks.useSetupStatus.mockReturnValue({
      setupRequired: true,
      setupEnabled: true,
      isLoading: false,
    });

    renderLogin();

    expect(screen.getByText("首次部署请先前往")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "初始化管理员" })).toHaveAttribute("href", "/setup");
  });

  it("uses login autofill metadata for email and password fields", () => {
    renderLogin();

    const emailInput = screen.getByLabelText("邮箱");
    const passwordInput = screen.getByLabelText("密码");
    expect(emailInput).toHaveAttribute("autocomplete", "username");
    expect(emailInput).toHaveAttribute("inputmode", "email");
    expect(emailInput).toHaveAttribute("enterkeyhint", "next");
    expect(emailInput).toHaveAttribute("autocapitalize", "none");
    expect(emailInput).toHaveAttribute("spellcheck", "false");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    expect(passwordInput).toHaveAttribute("enterkeyhint", "done");
  });

  it("uses form errors instead of native validation for empty credentials", async () => {
    const user = userEvent.setup();
    const { container } = renderLogin();

    expect(container.querySelector("form")).toHaveAttribute("novalidate");

    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByText("请输入邮箱")).toBeInTheDocument();
    expect(screen.getByText("请输入密码")).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("密码")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });
});
