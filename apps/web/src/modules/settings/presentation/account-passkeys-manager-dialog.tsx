import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useI18n } from "@/i18n/I18nProvider";
import type { Passkey } from "@/lib/api/schemas/auth";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { passkeyService } from "@/services/passkey-service";
import { LoadingButtonContent } from "./settings-shared-controls";
import { MFA_STATUS_QUERY_KEY, PASSKEYS_QUERY_KEY } from "./account-security-query-keys";

interface AccountPasskeysManagerDialogProps {
  accountEmail: string | null;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passkeys: Passkey[];
  isLoading: boolean;
}

/**
 * 通行密钥完整列表集中在管理弹窗，设置页只保留摘要入口。
 * 这里独立处理添加/删除，不能借用身份验证器 Dialog 的密码确认或恢复码状态。
 */
export function AccountPasskeysManagerDialog({
  accountEmail,
  disabled = false,
  open,
  onOpenChange,
  passkeys,
  isLoading,
}: AccountPasskeysManagerDialogProps) {
  const { t, formatDateTime } = useI18n();
  const queryClient = useQueryClient();
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyPassword, setPasskeyPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Passkey | null>(null);
  const [deletePasskeyPassword, setDeletePasskeyPassword] = useState("");

  const invalidatePasskeys = async () => {
    // 通行密钥和身份验证器可共存；mutation 后同时刷新两块摘要，确保设置页 badge 和数量不读旧缓存。
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: MFA_STATUS_QUERY_KEY }),
    ]);
  };

  const registerMutation = useMutation({
    mutationFn: () => passkeyService.register({
      name: passkeyName.trim(),
      currentPassword: passkeyPassword,
    }),
    onSuccess: async () => {
      setPasskeyName("");
      setPasskeyPassword("");
      await invalidatePasskeys();
      toast.success(t("settings.passkeyAdded"));
    },
    onError: (error) => {
      toast.error(t("settings.passkeyAddFailed"), {
        description: getDisplayErrorMessage(error, t("settings.mfaActionFailedDescription")),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ passkey, currentPassword }: { passkey: Passkey; currentPassword: string }) => {
      await passkeyService.delete(passkey.id, { currentPassword });
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      setDeletePasskeyPassword("");
      await invalidatePasskeys();
      toast.success(t("settings.passkeyDeleted"));
    },
    onError: (error) => {
      toast.error(t("settings.passkeyDeleteFailed"), {
        description: getDisplayErrorMessage(error, t("settings.mfaActionFailedDescription")),
      });
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled && nextOpen) return;
    if (!nextOpen && (registerMutation.isPending || deleteMutation.isPending)) return;
    onOpenChange(nextOpen);
  };

  const isBusy = registerMutation.isPending || deleteMutation.isPending;
  useEffect(() => {
    // 管理弹窗内部也要响应 demo 只读回流，避免确认弹窗绕过入口禁用继续提交账号安全 mutation。
    if (!disabled || isBusy) return;
    setPasskeyName("");
    setPasskeyPassword("");
    setDeleteTarget(null);
    setDeletePasskeyPassword("");
  }, [disabled, isBusy]);

  const canRegister = !disabled && !isBusy && passkeyName.trim().length > 0 && passkeyPassword.length > 0;
  const submitPasskeyRegistration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRegister) return;
    registerMutation.mutate();
  };
  const formattedCreatedAt = (passkey: Passkey) =>
    formatDateTime(passkey.createdAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          dismissMode="explicit"
          layout="frame"
          className="flex h-[min(calc(var(--app-viewport-height)-2rem),44rem)] min-h-0 max-w-3xl flex-col gap-0 overflow-hidden border-border bg-card p-0"
          closeLabel={t("common.close")}
        >
          <DialogHeader className="border-b border-border px-4 py-5 pr-12 text-left sm:px-6 sm:pr-14">
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
              {t("settings.passkeysManageTitle")}
            </DialogTitle>
            <DialogDescription className="text-left">
              {t("settings.passkeysManageDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6" data-testid="passkeys-manager-scroll">
            <div className="grid gap-5">
              <form
                aria-label={t("settings.addPasskey")}
                className="grid gap-3 rounded-md border border-border bg-secondary/20 p-3"
                onSubmit={submitPasskeyRegistration}
                noValidate
              >
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground">{t("settings.addPasskey")}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.addPasskeyDescription")}</p>
                </div>
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={accountEmail ?? ""}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                  className="sr-only"
                />
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <FormField id="passkey-name" label={t("settings.passkeyName")}>
                    {({ id }) => (
                      <Input
                        id={id}
                        name="passkey-name"
                        autoComplete="off"
                        value={passkeyName}
                        onChange={(event) => setPasskeyName(event.target.value)}
                        placeholder={t("settings.passkeyNamePlaceholder")}
                        disabled={disabled || registerMutation.isPending}
                        maxLength={80}
                      />
                    )}
                  </FormField>
                  <FormField id="passkey-password" label={t("settings.currentPassword")}>
                    {({ id }) => (
                      <Input
                        id={id}
                        name="current-password"
                        type="password"
                        autoComplete="current-password"
                        value={passkeyPassword}
                        onChange={(event) => setPasskeyPassword(event.target.value)}
                        placeholder={t("settings.currentPasswordPlaceholder")}
                        disabled={disabled || registerMutation.isPending}
                      />
                    )}
                  </FormField>
                  <Button
                    type="submit"
                    className="justify-center gap-2"
                    disabled={!canRegister}
                  >
                    <LoadingButtonContent loading={registerMutation.isPending} loadingLabel={t("common.saving")}>
                      <Plus className="h-4 w-4" />
                      {t("settings.addPasskey")}
                    </LoadingButtonContent>
                  </Button>
                </div>
              </form>

              <div className="grid gap-3 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium text-foreground">{t("settings.passkeys")}</h3>
                  <span className="text-xs text-muted-foreground">{t("settings.passkeyCount", { count: passkeys.length })}</span>
                </div>
                {isLoading && passkeys.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-muted-foreground">{t("common.loading")}</p>
                ) : passkeys.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-muted-foreground">{t("settings.noPasskeys")}</p>
                ) : (
                  // 管理弹窗承载完整通行密钥列表，避免凭据数量把设置页主内容撑长。
                  <ul className="grid gap-2" aria-label={t("settings.passkeys")}>
                    {passkeys.map((passkey) => (
                      <li key={passkey.id} className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{passkey.name}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {t("settings.passkeyCreatedAt", { time: formattedCreatedAt(passkey) })}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="justify-center gap-2 text-destructive hover:text-destructive"
                          disabled={disabled || isBusy}
                          aria-label={t("settings.deletePasskeyNamed", { name: passkey.name })}
                          onClick={() => setDeleteTarget(passkey)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("settings.deletePasskey")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border px-4 py-4 sm:px-6">
            <p className="text-left text-xs leading-5 text-muted-foreground sm:mr-auto">
              {t("settings.passkeysManageHint")}
            </p>
            <Button type="button" onClick={() => handleOpenChange(false)} disabled={isBusy} className="w-full sm:w-auto">
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => {
        // 删除请求进行中必须保留目标 passkey，否则确认弹窗会失去 pending 行为和错误归属。
        if (!nextOpen && !deleteMutation.isPending) {
          setDeleteTarget(null);
          setDeletePasskeyPassword("");
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deletePasskeyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t("settings.deletePasskeyDescription", { name: deleteTarget.name })
                : t("settings.passkeyMissing")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField id="delete-passkey-password" label={t("settings.currentPassword")}>
            {({ id }) => (
              <Input
                id={id}
                name="current-password"
                type="password"
                autoComplete="current-password"
                value={deletePasskeyPassword}
                onChange={(event) => setDeletePasskeyPassword(event.target.value)}
                placeholder={t("settings.currentPasswordPlaceholder")}
                disabled={disabled || deleteMutation.isPending}
              />
            )}
          </FormField>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || deleteMutation.isPending || !deleteTarget || !deletePasskeyPassword}
              onClick={(event) => {
                event.preventDefault();
                if (disabled || !deleteTarget || !deletePasskeyPassword) return;
                deleteMutation.mutate({ passkey: deleteTarget, currentPassword: deletePasskeyPassword });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <LoadingButtonContent loading={deleteMutation.isPending} loadingLabel={t("common.saving")}>
                {t("settings.deletePasskey")}
              </LoadingButtonContent>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
