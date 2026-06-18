import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { CloudBackupSnapshotList } from "./cloud-backup-snapshot-list";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { CloudBackupSnapshot } from "@/lib/api/schemas/cloud-backup";

// 快照列表测试固定“设置页摘要 + 用户主动查看全部”的布局边界，避免大量远端快照重新撑高设置页。
vi.mock("@/hooks/use-media-query", () => ({
  useMediaQuery: vi.fn(() => false),
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        "common.close": "关闭",
        "common.delete": "删除",
        "common.loading": "加载中",
        "settings.cloudBackupProviderWebdav": "WebDAV",
        "settings.cloudBackupProviderS3": "S3 兼容存储",
        "settings.cloudBackupRefresh": "刷新",
        "settings.cloudBackupRestore": "恢复",
        "settings.cloudBackupRestoring": "恢复中...",
        "settings.cloudBackupDeleting": "删除中...",
        "settings.cloudBackupSnapshots": "云端快照",
        "settings.cloudBackupSnapshotsEmpty": "暂无云端快照。",
        "settings.cloudBackupSnapshotsHelp": "快照下载前会校验 manifest 与 SHA-256；恢复仍需在导入预览中确认。",
        "settings.cloudBackupSnapshotsViewAll": "查看全部 ({count})",
        "settings.cloudBackupUpstreamOpen": "查看错误详情",
      };
      const message = messages[key] ?? key;
      if (!params) return message;
      return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
    },
    formatDateTime: () => "2026-06-09 08:00",
  }),
}));

const useMediaQueryMock = vi.mocked(useMediaQuery);

function snapshotFixture(overrides: Partial<CloudBackupSnapshot> = {}): CloudBackupSnapshot {
  const id = overrides.id ?? "snapshot-1";
  return {
    id,
    provider: "webdav",
    filename: `renewlet-${id}.zip`,
    sizeBytes: 1024,
    sha256: "a".repeat(64),
    createdAt: "2026-06-09T08:00:00.000Z",
    ...overrides,
  };
}

function renderSnapshotList(overrides: Partial<ComponentProps<typeof CloudBackupSnapshotList>> = {}) {
  return render(
    <CloudBackupSnapshotList
      snapshots={[]}
      isLoading={false}
      busy={false}
      restoringSnapshotKey={null}
      deletingSnapshotKey={null}
      canRefreshSnapshots
      isRefreshingSnapshots={false}
      snapshotsErrorMessage={null}
      onRefresh={vi.fn()}
      onOpenErrorDetails={vi.fn()}
      onRestore={vi.fn()}
      onDelete={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  useMediaQueryMock.mockReturnValue(false);
});

describe("CloudBackupSnapshotList", () => {
  it("shows only two snapshot rows on the settings page and opens all rows on demand", async () => {
    const user = userEvent.setup();
    const snapshots = [
      snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
      snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
      snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
    ];

    renderSnapshotList({ snapshots });

    expect(screen.getByText("renewlet-1.zip")).toBeInTheDocument();
    expect(screen.getByText("renewlet-2.zip")).toBeInTheDocument();
    expect(screen.queryByText("renewlet-3.zip")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));

    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("renewlet-1.zip")).toBeInTheDocument();
    expect(within(dialog).getByText("renewlet-2.zip")).toBeInTheDocument();
    expect(within(dialog).getByText("renewlet-3.zip")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-backup-snapshot-full-list-scroll")).toHaveClass("overflow-y-auto", "min-h-0", "flex-1");
  });

  it("refreshes the current provider snapshot query from the full-list dialog", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();

    renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
        snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
      ],
      onRefresh: refresh,
    });

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));
    const dialog = screen.getByRole("dialog", { name: "云端快照" });

    await user.click(within(dialog).getByRole("button", { name: "刷新" }));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInTheDocument();
  });

  it("uses the same disabled and loading state for summary and full-list refresh buttons", async () => {
    const user = userEvent.setup();

    renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
        snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
      ],
      isRefreshingSnapshots: true,
    });

    const summaryRefresh = screen.getByRole("button", { name: "刷新" });
    expect(summaryRefresh).toBeDisabled();
    expect(summaryRefresh).toHaveAttribute("aria-busy", "true");
    expect(summaryRefresh.querySelector("svg")).toHaveClass("animate-spin");

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));
    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    const dialogRefresh = within(dialog).getByRole("button", { name: "刷新" });
    expect(dialogRefresh).toBeDisabled();
    expect(dialogRefresh).toHaveAttribute("aria-busy", "true");
    expect(dialogRefresh.querySelector("svg")).toHaveClass("animate-spin");
  });

  it("does not show the full-list trigger when the summary already contains all snapshots", () => {
    renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
      ],
    });

    expect(screen.getByText("renewlet-1.zip")).toBeInTheDocument();
    expect(screen.getByText("renewlet-2.zip")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看全部/ })).not.toBeInTheDocument();
  });

  it("matches restoring state by provider and id in summary and full list", async () => {
    const user = userEvent.setup();
    const snapshots = [
      snapshotFixture({ id: "same-id", filename: "renewlet-webdav.zip" }),
      snapshotFixture({ id: "same-id", provider: "s3", filename: "renewlet-s3.zip", sha256: "b".repeat(64) }),
      snapshotFixture({ id: "idle-id", filename: "renewlet-idle.zip", sha256: "c".repeat(64) }),
    ];

    renderSnapshotList({
      snapshots,
      busy: true,
      restoringSnapshotKey: "s3:same-id",
      deletingSnapshotKey: null,
    });

    const webdavRow = screen.getByText("renewlet-webdav.zip").closest("div.grid");
    expect(webdavRow).not.toBeNull();
    expect(within(webdavRow as HTMLElement).queryByRole("button", { name: "恢复中..." })).not.toBeInTheDocument();

    const s3Row = screen.getByText("renewlet-s3.zip").closest("div.grid");
    expect(s3Row).not.toBeNull();
    expect(within(s3Row as HTMLElement).getByRole("button", { name: "恢复中..." })).toHaveAttribute("aria-busy", "true");

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));

    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    const fullListS3Row = within(dialog).getByText("renewlet-s3.zip").closest("div.grid");
    expect(fullListS3Row).not.toBeNull();
    expect(within(fullListS3Row as HTMLElement).getByRole("button", { name: "恢复中..." })).toHaveAttribute("aria-busy", "true");
  });

  it("matches deleting state by provider and id in summary and full list", async () => {
    const user = userEvent.setup();
    const snapshots = [
      snapshotFixture({ id: "same-id", filename: "renewlet-webdav.zip" }),
      snapshotFixture({ id: "same-id", provider: "s3", filename: "renewlet-s3.zip", sha256: "b".repeat(64) }),
      snapshotFixture({ id: "idle-id", filename: "renewlet-idle.zip", sha256: "c".repeat(64) }),
    ];

    renderSnapshotList({
      snapshots,
      busy: true,
      deletingSnapshotKey: "s3:same-id",
    });

    const webdavRow = screen.getByText("renewlet-webdav.zip").closest("div.grid");
    expect(webdavRow).not.toBeNull();
    expect(within(webdavRow as HTMLElement).queryByRole("button", { name: "删除中..." })).not.toBeInTheDocument();
    expect(within(webdavRow as HTMLElement).getByRole("button", { name: "删除" })).toBeDisabled();

    const s3Row = screen.getByText("renewlet-s3.zip").closest("div.grid");
    expect(s3Row).not.toBeNull();
    expect(within(s3Row as HTMLElement).getByRole("button", { name: "删除中..." })).toHaveAttribute("aria-busy", "true");

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));

    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    const fullListS3Row = within(dialog).getByText("renewlet-s3.zip").closest("div.grid");
    expect(fullListS3Row).not.toBeNull();
    expect(within(fullListS3Row as HTMLElement).getByRole("button", { name: "删除中..." })).toHaveAttribute("aria-busy", "true");
  });

  it("passes the complete snapshot object from the full list actions", async () => {
    const user = userEvent.setup();
    const targetSnapshot = snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip", sha256: "d".repeat(64) });
    const restore = vi.fn();
    const remove = vi.fn();

    renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
        targetSnapshot,
      ],
      onRestore: restore,
      onDelete: remove,
    });

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));
    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    const targetRow = within(dialog).getByText("renewlet-3.zip").closest("div.grid");
    expect(targetRow).not.toBeNull();

    await user.click(within(targetRow as HTMLElement).getByRole("button", { name: "恢复" }));
    await user.click(within(targetRow as HTMLElement).getByRole("button", { name: "删除" }));

    expect(restore).toHaveBeenCalledWith(targetSnapshot);
    expect(remove).toHaveBeenCalledWith(targetSnapshot);
  });

  it("keeps loading, empty, and error states inline without opening the full-list overlay", () => {
    const openErrorDetails = vi.fn();
    const { rerender } = renderSnapshotList({ isLoading: true });

    expect(screen.getByText("加载中")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <CloudBackupSnapshotList
        snapshots={[]}
        isLoading={false}
        busy={false}
        restoringSnapshotKey={null}
        deletingSnapshotKey={null}
        canRefreshSnapshots
        isRefreshingSnapshots={false}
        snapshotsErrorMessage={null}
        onRefresh={vi.fn()}
        onOpenErrorDetails={openErrorDetails}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("暂无云端快照。")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(
      <CloudBackupSnapshotList
        snapshots={[snapshotFixture()]}
        isLoading={false}
        busy={false}
        restoringSnapshotKey={null}
        deletingSnapshotKey={null}
        canRefreshSnapshots
        isRefreshingSnapshots={false}
        snapshotsErrorMessage="云端快照列表加载失败"
        onRefresh={vi.fn()}
        onOpenErrorDetails={openErrorDetails}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("云端快照列表加载失败")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看全部/ })).not.toBeInTheDocument();
  });

  it("keeps the full-list overlay open and shows the provider error when refresh fails", async () => {
    const user = userEvent.setup();
    const openErrorDetails = vi.fn();
    const { rerender } = renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
        snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
      ],
      onOpenErrorDetails: openErrorDetails,
    });

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));
    expect(screen.getByRole("dialog", { name: "云端快照" })).toBeInTheDocument();

    rerender(
      <CloudBackupSnapshotList
        snapshots={[
          snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
          snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
          snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
        ]}
        isLoading={false}
        busy={false}
        restoringSnapshotKey={null}
        deletingSnapshotKey={null}
        canRefreshSnapshots
        isRefreshingSnapshots={false}
        snapshotsErrorMessage="云端快照列表加载失败"
        onRefresh={vi.fn()}
        onOpenErrorDetails={openErrorDetails}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "云端快照" });
    expect(within(dialog).getByText("云端快照列表加载失败")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "查看错误详情" }));
    expect(openErrorDetails).toHaveBeenCalledTimes(1);
  });

  it("uses the mobile drawer branch for the full list on compact screens", async () => {
    const user = userEvent.setup();
    useMediaQueryMock.mockReturnValue(true);

    renderSnapshotList({
      snapshots: [
        snapshotFixture({ id: "snapshot-1", filename: "renewlet-1.zip" }),
        snapshotFixture({ id: "snapshot-2", filename: "renewlet-2.zip" }),
        snapshotFixture({ id: "snapshot-3", filename: "renewlet-3.zip" }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "查看全部 (3)" }));

    const drawer = screen.getAllByText("云端快照")
      .map((element) => element.closest(".h5-drawer-panel"))
      .find((element): element is HTMLElement => element instanceof HTMLElement);
    expect(drawer).not.toBeNull();
    expect(within(drawer as HTMLElement).getByText("renewlet-3.zip")).toBeInTheDocument();
    expect(within(drawer as HTMLElement).getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
});
