// Login 页面测试保护 setup/forgot-password 能力入口和 next 跳转清洗，不让认证页绕过公共路由契约。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Login from "./login";

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  reportClientError: vi.fn(),
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

vi.mock("@/lib/report-client-error", () => ({
  reportClientError: mocks.reportClientError,
}));

vi.mock("@/hooks/use-setup-status", () => ({
  useSetupStatus: mocks.useSetupStatus,
}));

const rememberedLoginEmailStorageKey = "renewlet_login_email";

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

describe("Login page", () => {
  beforeEach(() => {
    mocks.signInEmail.mockReset();
    mocks.signInEmail.mockResolvedValue({ error: null });
    mocks.reportClientError.mockReset();
    localStorage.clear();
    mocks.usePasswordResetAvailability.mockReturnValue(false);
    mocks.useSetupStatus.mockReturnValue({
      setupRequired: false,
      setupEnabled: true,
      demoMode: false,
      isLoading: false,
    });
  });

  it("hides the first deployment setup prompt after setup is complete", () => {
    renderLogin();

    expect(screen.queryByText("First deployment? Go to")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "initialize admin" })).not.toBeInTheDocument();
  });

  it("shows the setup prompt only when setup is required and enabled", () => {
    mocks.useSetupStatus.mockReturnValue({
      setupRequired: true,
      setupEnabled: true,
      demoMode: false,
      isLoading: false,
    });

    renderLogin();

    expect(screen.getByText("First deployment? Go to")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "initialize admin" })).toHaveAttribute("href", "/setup");
  });

  it("uses login autofill metadata for email and password fields", () => {
    renderLogin();

    const emailInput = screen.getByLabelText("Email");
    const passwordInput = screen.getByLabelText("Password");
    expect(emailInput).toHaveAttribute("autocomplete", "username");
    expect(emailInput).toHaveAttribute("inputmode", "email");
    expect(emailInput).toHaveAttribute("enterkeyhint", "next");
    expect(emailInput).toHaveAttribute("autocapitalize", "none");
    expect(emailInput).toHaveAttribute("spellcheck", "false");
    expect(passwordInput).toHaveAttribute("autocomplete", "current-password");
    expect(passwordInput).toHaveAttribute("enterkeyhint", "done");
  });

  it("shows the remember email option checked by default", () => {
    renderLogin();

    expect(screen.getByRole("checkbox", { name: "Remember email" })).toBeChecked();
  });

  it("prefills only the remembered email from localStorage", () => {
    localStorage.setItem(rememberedLoginEmailStorageKey, " alice@example.com ");

    renderLogin();

    expect(screen.getByLabelText("Email")).toHaveValue("alice@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Remember email" })).toBeChecked();
  });

  it("remembers the trimmed email only after a successful login", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), " alice@example.com ");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: "alice@example.com",
        password: "password123",
      });
    });
    expect(localStorage.getItem(rememberedLoginEmailStorageKey)).toBe("alice@example.com");
  });

  it("does not remember the email when login fails", async () => {
    const user = userEvent.setup();
    mocks.signInEmail.mockResolvedValueOnce({ error: new Error("invalid credentials") });
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalled();
    });
    expect(localStorage.getItem(rememberedLoginEmailStorageKey)).toBeNull();
  });

  it("clears the remembered email when unchecked and does not write it back on login", async () => {
    const user = userEvent.setup();
    localStorage.setItem(rememberedLoginEmailStorageKey, "alice@example.com");
    renderLogin();

    await user.click(screen.getByRole("checkbox", { name: "Remember email" }));
    expect(screen.getByRole("checkbox", { name: "Remember email" })).not.toBeChecked();
    expect(localStorage.getItem(rememberedLoginEmailStorageKey)).toBeNull();

    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(mocks.signInEmail).toHaveBeenCalled();
    });
    expect(localStorage.getItem(rememberedLoginEmailStorageKey)).toBeNull();
  });

  it("does not restore the remembered email merely by checking the box again", async () => {
    const user = userEvent.setup();
    localStorage.setItem(rememberedLoginEmailStorageKey, "alice@example.com");
    renderLogin();

    await user.click(screen.getByRole("checkbox", { name: "Remember email" }));
    await user.click(screen.getByRole("checkbox", { name: "Remember email" }));

    expect(screen.getByRole("checkbox", { name: "Remember email" })).toBeChecked();
    expect(localStorage.getItem(rememberedLoginEmailStorageKey)).toBeNull();
  });

  it("uses form errors instead of native validation for empty credentials", async () => {
    const user = userEvent.setup();
    const { container } = renderLogin();

    expect(container.querySelector("form")).toHaveAttribute("novalidate");

    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByText("Enter your email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });

  it("does not treat the display name as a login identifier", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Email"), "Admin");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });
});
