import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ProtectedRoute } from "./protected-route";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderProtectedRoute(initialEntry = "/settings?tab=notifications") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="/settings"
          element={(
            <ProtectedRoute>
              <div>private settings</div>
            </ProtectedRoute>
          )}
        />
        <Route path="/login" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  beforeEach(() => {
    mocks.useSession.mockReset();
  });

  it("redirects unauthenticated users before rendering protected content", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: false });

    renderProtectedRoute();

    expect(screen.queryByText("private settings")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/login?next=%2Fsettings%3Ftab%3Dnotifications");
  });

  it("keeps protected content hidden while session validation is pending", () => {
    mocks.useSession.mockReturnValue({ data: null, isPending: true });

    renderProtectedRoute();

    expect(screen.queryByText("private settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
  });

  it("renders protected content for authenticated users", () => {
    mocks.useSession.mockReturnValue({
      data: {
        session: { id: "token-1" },
        user: { id: "user-1", email: "alice@example.com", name: "Alice", role: "admin", banned: false },
      },
      isPending: false,
    });

    renderProtectedRoute();

    expect(screen.getByText("private settings")).toBeInTheDocument();
  });
});
