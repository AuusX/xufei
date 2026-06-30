import { useState } from "react";
import { Cloud } from "lucide-react";
import { CloudBackupErrorDetailsDialog } from "@/components/cloud-backup-error-details-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n/I18nProvider";
import { CloudBackupActionsPanel } from "./cloud-backup-actions-panel";
import { CloudBackupConnectionForm, type CloudBackupConnectionField } from "./cloud-backup-connection-form";
import { CloudBackupPolicyForm } from "./cloud-backup-policy-form";
import { CloudBackupSnapshotList } from "./cloud-backup-snapshot-list";
import { LoadingButtonContent } from "./settings-shared-controls";
import { getSettingsSectionClassName } from "./settings-layout";
import type { CloudBackupController } from "../application/use-cloud-backup-controller";
import type { CloudBackupProvider, CloudBackupSnapshot } from "@/lib/api/schemas/cloud-backup";

interface CloudBackupSectionProps {
  id?: string;
  className?: string;
  controller: CloudBackupController;
  disabled?: boolean;
}

type CloudBackupStatus = "idle" | "success" | "failed";

// Section 只负责编排当前 tab provider；策略、状态、快照和错误详情都来自 controller 的 provider-scoped 视图。
export function CloudBackupSection({
  id,
  className,
  controller,
  disabled = false,
}: CloudBackupSectionProps) {
  const { t, formatDateTime } = useI18n();
  const [deleteTarget, setDeleteTarget] = useState<CloudBackupSnapshot | null>(null);
  const {
    config,
    form,
    snapshots,
    credentialSet,
    canCreateSnapshot,
    isLoading,
    isSaving,
    isTesting,
    isCreating,
    isDownloading,
    isDeleting,
    isRefreshingSnapshots,
    restoringSnapshotKey,
    deletingSnapshotKey,
    hasUnsavedChanges,
    snapshotsErrorMessage,
    cloudBackupErrorDetails,
    cloudBackupErrorDetailsOpen,
    setCloudBackupErrorDetailsOpen,
    openSnapshotsErrorDetails,
    updateForm,
    saveConfig,
    testConfig,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    refreshSnapshots,
  } = controller;
  const busy = isSaving || isTesting || isCreating || isDownloading || isDeleting;
  const providerStatus = config?.statusByProvider[form.provider] ?? null;
  const status = providerStatus?.lastStatus ?? "idle";
  const statusLabel = statusLabelFor(status, {
    idle: t("settings.cloudBackupStatusIdle"),
    success: t("settings.cloudBackupStatusSuccess"),
    failed: t("settings.cloudBackupStatusFailed"),
  });
  const credentialLabel = credentialSet ? t("settings.cloudBackupCredentialSaved") : t("settings.cloudBackupCredentialMissing");
  const secretPlaceholder = credentialSet ? t("settings.cloudBackupSecretPlaceholderSaved") : t("settings.cloudBackupSecretPlaceholder");
  const saveLabel = hasUnsavedChanges ? t("settings.cloudBackupSave") : t("settings.cloudBackupSaveAgain");
  const providerLabel = providerLabelFor(form.provider, {
    webdav: t("settings.cloudBackupProviderWebdav"),
    s3: t("settings.cloudBackupProviderS3"),
  });
  const lastBackupLabel = providerStatus?.lastBackupAt
    ? formatDateTime(providerStatus.lastBackupAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : t("settings.cloudBackupNeverBackedUp");
  const deleteDialogBusy = deleteTarget ? deletingSnapshotKey === cloudBackupSnapshotKey(deleteTarget) : false;

  return (
    <section id={id} className={getSettingsSectionClassName(className)}>
      <div className="mb-5 flex min-w-0 items-start gap-3">
        <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{t("settings.cloudBackup")}</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.cloudBackupHelp")}</p>
        </div>
      </div>

      <div className="grid gap-5">
        <CloudBackupConnectionForm
          form={form}
          secretPlaceholder={secretPlaceholder}
          disabled={disabled}
          onProviderChange={(provider) => updateForm("provider", provider)}
          onTextChange={(field: CloudBackupConnectionField, value) => updateForm(field, value)}
        />
        <CloudBackupPolicyForm
          scheduleEnabled={form.scheduleEnabled}
          scheduleFrequency={form.scheduleFrequency}
          scheduleTime={form.scheduleTime}
          scheduleWeekday={form.scheduleWeekday}
          retention={form.retention}
          busy={busy}
          disabled={disabled}
          onScheduleEnabledChange={(checked) => updateForm("scheduleEnabled", checked)}
          onFrequencyChange={(frequency) => updateForm("scheduleFrequency", frequency)}
          onScheduleTimeChange={(value) => updateForm("scheduleTime", value)}
          onScheduleWeekdayChange={(weekday) => updateForm("scheduleWeekday", weekday)}
          onRetentionChange={(value) => updateForm("retention", value)}
        />
        <CloudBackupActionsPanel
          providerLabel={providerLabel}
          credentialLabel={credentialLabel}
          statusLabel={statusLabel}
          lastBackupLabel={lastBackupLabel}
          lastError={providerStatus?.lastError ?? null}
          saveLabel={saveLabel}
          busy={busy}
          disabled={disabled}
          canCreateSnapshot={canCreateSnapshot}
          isSaving={isSaving}
          isTesting={isTesting}
          isCreating={isCreating}
          onSave={saveConfig}
          onTest={testConfig}
          onCreate={createSnapshot}
        />
        <CloudBackupSnapshotList
          snapshots={snapshots}
          isLoading={isLoading}
          busy={busy}
          disabled={disabled}
          restoringSnapshotKey={restoringSnapshotKey}
          deletingSnapshotKey={deletingSnapshotKey}
          canRefreshSnapshots={canCreateSnapshot}
          isRefreshingSnapshots={isRefreshingSnapshots}
          snapshotsErrorMessage={snapshotsErrorMessage}
          onRefresh={refreshSnapshots}
          onOpenErrorDetails={openSnapshotsErrorDetails}
          onRestore={restoreSnapshot}
          onDelete={setDeleteTarget}
        />
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => {
        if (!open && !deleteDialogBusy) setDeleteTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.cloudBackupDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.cloudBackupDeleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled || deleteDialogBusy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || deleteDialogBusy}
              aria-busy={deleteDialogBusy ? true : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (disabled) return;
                const snapshot = deleteTarget;
                if (!snapshot) return;
                void deleteSnapshot(snapshot).finally(() => setDeleteTarget(null));
              }}
              className="min-w-[5.25rem] bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <LoadingButtonContent loading={deleteDialogBusy} loadingLabel={t("settings.cloudBackupDeleting")}>
                {t("common.delete")}
              </LoadingButtonContent>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CloudBackupErrorDetailsDialog
        open={cloudBackupErrorDetailsOpen}
        details={cloudBackupErrorDetails}
        onOpenChange={setCloudBackupErrorDetailsOpen}
      />
    </section>
  );
}

function statusLabelFor(status: CloudBackupStatus, labels: Record<CloudBackupStatus, string>): string {
  return labels[status];
}

function providerLabelFor(provider: CloudBackupProvider, labels: Record<CloudBackupProvider, string>): string {
  return labels[provider];
}

function cloudBackupSnapshotKey(snapshot: CloudBackupSnapshot): string {
  return `${snapshot.provider}:${snapshot.id}`;
}
