import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { getDisplayErrorMessage } from "@/lib/display-error";
import { mfaService } from "@/services/mfa-service";
import { MFA_STATUS_QUERY_KEY } from "./account-security-query-keys";
import type { AccountSecurityDialogState } from "./account-security-dialog-state";

interface AccountSecurityDialogsProps {
  state: AccountSecurityDialogState;
  onStateChange: (state: AccountSecurityDialogState) => void;
}

/**
 * 身份验证器弹窗只承载 TOTP setup、恢复码和关闭/重建流程。
 * Passkey 管理不挂载在这里，避免“添加通行密钥”误复用关闭身份验证器的密码确认状态。
 */
export function AccountSecurityDialogs({ state, onStateChange }: AccountSecurityDialogsProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const resetDialogFields = () => {
    setSetupCode("");
    setSetupPassword("");
    setCurrentPassword("");
  };

  const closeDialog = () => {
    resetDialogFields();
    onStateChange({ type: "none" });
  };

  const invalidateMfa = async () => {
    await queryClient.invalidateQueries({ queryKey: MFA_STATUS_QUERY_KEY });
  };

  const enableTotpMutation = useMutation({
    mutationFn: async () => {
      if (state.type !== "mfa_setup") throw new Error(t("settings.mfaSetupMissing"));
      return await mfaService.enableTotp({
        setupId: state.setup.setupId,
        code: setupCode.trim(),
        currentPassword: setupPassword,
      });
    },
    onSuccess: async (codes) => {
      setSetupCode("");
      setSetupPassword("");
      onStateChange({ type: "recovery_codes", codes });
      await invalidateMfa();
      toast.success(t("settings.mfaEnabled"));
    },
    onError: (error) => {
      toast.error(t("settings.mfaEnableFailed"), {
        description: getDisplayErrorMessage(error, t("settings.mfaEnableFailedDescription")),
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (state.type !== "mfa_password") throw new Error(t("settings.mfaSetupMissing"));
      if (state.action === "regenerate") {
        const codes = await mfaService.regenerateRecoveryCodes({ currentPassword });
        return { action: state.action, codes };
      }
      await mfaService.disable({ currentPassword });
      return { action: state.action, codes: null };
    },
    onSuccess: async ({ action, codes }) => {
      setCurrentPassword("");
      if (codes) {
        // 恢复码明文只在这次响应中可见；关闭一次性展示弹窗后组件丢弃 state，后端也不会再返回。
        onStateChange({ type: "recovery_codes", codes });
        toast.success(t("settings.mfaRecoveryRegenerated"));
      } else {
        onStateChange({ type: "none" });
        toast.success(t(action === "disable" ? "settings.mfaDisabled" : "settings.mfaRecoveryRegenerated"));
      }
      await invalidateMfa();
    },
    onError: (error) => {
      toast.error(t("settings.mfaActionFailed"), {
        description: getDisplayErrorMessage(error, t("settings.mfaActionFailedDescription")),
      });
    },
  });

  if (state.type === "none") return null;

  if (state.type === "mfa_setup") {
    return (
      <Dialog open onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <DialogContent closeLabel={t("common.close")} dismissMode="explicit">
          <DialogHeader>
            <DialogTitle>{t("settings.mfaSetupTitle")}</DialogTitle>
            <DialogDescription>{t("settings.mfaSetupDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="mx-auto rounded-md border border-border bg-white p-3">
              <QRCodeSVG value={state.setup.otpauthUrl} size={164} />
            </div>
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("settings.mfaManualSecret")}</span>
              <code className="break-all rounded-md bg-secondary px-3 py-2 text-xs text-foreground">
                {state.setup.secret}
              </code>
            </div>
            <FormField id="mfa-setup-code" label={t("settings.mfaSetupCode")}>
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={setupCode}
                  onChange={(event) => setSetupCode(event.target.value)}
                  placeholder={t("auth.mfaCodePlaceholder")}
                />
              )}
            </FormField>
            <FormField id="mfa-setup-password" label={t("settings.currentPassword")}>
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  placeholder={t("settings.currentPasswordPlaceholder")}
                />
              )}
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={enableTotpMutation.isPending || !/^\d{6}$/.test(setupCode.trim()) || !setupPassword}
              onClick={() => enableTotpMutation.mutate()}
            >
              {enableTotpMutation.isPending ? t("common.saving") : t("settings.mfaConfirmEnable")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (state.type === "mfa_password") {
    return (
      <Dialog open onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <DialogContent closeLabel={t("common.close")} dismissMode="explicit">
          <DialogHeader>
            <DialogTitle>
              {state.action === "disable" ? t("settings.mfaDisableTitle") : t("settings.mfaRegenerateTitle")}
            </DialogTitle>
            <DialogDescription>
              {state.action === "disable" ? t("settings.mfaDisableDescription") : t("settings.mfaRegenerateDescription")}
            </DialogDescription>
          </DialogHeader>
          <FormField id="mfa-current-password" label={t("settings.currentPassword")}>
            {({ id }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                placeholder={t("settings.currentPasswordPlaceholder")}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant={state.action === "disable" ? "destructive" : "default"}
              disabled={passwordMutation.isPending || !currentPassword}
              onClick={() => passwordMutation.mutate()}
            >
              {passwordMutation.isPending ? t("common.saving") : (
                state.action === "disable" ? t("settings.mfaDisable") : t("settings.mfaRegenerateRecovery")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (state.type === "recovery_codes") {
    const copyRecoveryCodes = async () => {
      try {
        await navigator.clipboard.writeText(state.codes.join("\n"));
        toast.success(t("settings.mfaRecoveryCopied"));
      } catch (error) {
        toast.error(t("settings.mfaRecoveryCopyFailed"), {
          description: getDisplayErrorMessage(error, t("settings.mfaRecoveryCopyFailedDescription")),
        });
      }
    };

    return (
      <Dialog open onOpenChange={(open) => {
        if (!open) closeDialog();
      }}>
        <DialogContent closeLabel={t("common.close")} dismissMode="explicit">
          <DialogHeader>
            <DialogTitle>{t("settings.mfaRecoveryCodesTitle")}</DialogTitle>
            <DialogDescription>{t("settings.mfaRecoveryCodesDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 rounded-md border border-border bg-secondary/30 p-3">
            {state.codes.map((code) => (
              <code key={code} className="text-sm font-medium text-foreground">{code}</code>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={copyRecoveryCodes}>
              {t("settings.mfaCopyRecovery")}
            </Button>
            <Button type="button" onClick={closeDialog}>
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return null;
}
