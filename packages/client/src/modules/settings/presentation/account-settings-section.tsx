/**
 * 账号设置展示区。
 *
 * 架构位置：只渲染邮箱、密码弹窗和 PocketBase Admin 入口；密码修改流程由 application hook 管理。
 *
 * 注意： 不要在展示层缓存密码字段，关闭弹窗时必须交给 controller 清理。
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from '@/components/router-link';
import { useI18n } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';
import { PasswordChangeDialog } from './password-change-dialog';

export interface AccountSettingsSectionProps {
  id?: string;
  className?: string;
  accountEmail: string | null;
  canManageUsers: boolean;
  canAccessPocketBaseAdmin: boolean;
  passwordResetEnabled: boolean;
  passwordDialogOpen: boolean;
  setPasswordDialogOpen: (open: boolean) => void;
  handlePasswordDialogOpenChange: (open: boolean) => void;
  currentPassword: string;
  setCurrentPassword: (value: string) => void;
  newPassword: string;
  setNewPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  isUpdatingPassword: boolean;
  updatePassword: () => void | Promise<void>;
  passwordDisabled?: boolean;
}

export function AccountSettingsSection({
  id,
  className,
  accountEmail,
  canManageUsers,
  canAccessPocketBaseAdmin,
  passwordResetEnabled,
  passwordDialogOpen,
  setPasswordDialogOpen,
  handlePasswordDialogOpenChange,
  currentPassword,
  setCurrentPassword,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  isUpdatingPassword,
  updatePassword,
  passwordDisabled = false,
}: AccountSettingsSectionProps) {
  const { t } = useI18n();

  return (
    <>
                  <section id={id} className={cn("rounded-xl border border-border bg-card p-6", className)}>
                    <h2 className="mb-6 text-lg font-semibold text-foreground">{t("settings.account")}</h2>
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="username">{t("settings.username")}</Label>
                        <Input
                          id="username"
                          value={accountEmail ?? ""}
                          placeholder={accountEmail === null ? t("settings.emailLoading") : t("settings.emailMissing")}
                          readOnly
                          className="border-border bg-secondary"
                        />
                        <p className="text-xs text-muted-foreground">{t("settings.usernameHelp")}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {canManageUsers ? (
                            <Link
                              href="/admin/users"
                              className="inline-flex text-xs text-primary hover:underline"
                            >
                              {t("settings.manageUsers")}
                            </Link>
                          ) : null}
                          {canAccessPocketBaseAdmin ? (
                            <a
                              href="/_/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              {t("settings.pocketBaseAdmin")}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="password">{t("auth.password")}</Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          readOnly
                          className="border-border bg-secondary"
                        />
                        <div className="flex items-center gap-3">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-primary/40 text-primary hover:bg-primary/10"
                            onClick={() => setPasswordDialogOpen(true)}
                            disabled={passwordDisabled}
                          >
                            {t("settings.changePassword")}
                          </Button>
                          {passwordResetEnabled ? (
                            <Link
                              href="/forgot-password"
                              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                            >
                              {t("auth.forgotPassword")}
                            </Link>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{t("settings.passwordHelp")}</p>
                      </div>
                    </div>
                  </section>
      
                  <PasswordChangeDialog
                    open={passwordDialogOpen}
                    onOpenChange={handlePasswordDialogOpenChange}
                    currentPassword={currentPassword}
                    onCurrentPasswordChange={setCurrentPassword}
                    newPassword={newPassword}
                    onNewPasswordChange={setNewPassword}
                    confirmPassword={confirmPassword}
                    onConfirmPasswordChange={setConfirmPassword}
                    isUpdating={isUpdatingPassword}
                    onSubmit={updatePassword}
                  />
      
    </>
  );
}
