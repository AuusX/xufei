import { useRef, useState } from "react";
import { Clipboard, KeyRound, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { ApiToken } from "@/lib/api/schemas/public-api";
import type { SettingsPublicApiController } from "../application/use-public-api-settings-controller";
import { LoadingButtonContent } from "./settings-shared-controls";
import { getSettingsSectionClassName } from "./settings-layout";

interface PublicApiSectionProps {
  id?: string;
  className?: string;
  controller: SettingsPublicApiController;
}

export function PublicApiSection({ id, className, controller }: PublicApiSectionProps) {
  const { t, formatDateTime } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [tokenToDelete, setTokenToDelete] = useState<ApiToken | null>(null);
  const plainTokenInputRef = useRef<HTMLInputElement>(null);
  const busy = controller.isLoading || controller.isCreating || controller.deletingTokenId !== null;
  const tokenCount = controller.tokens.length;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const created = await controller.createToken(trimmed);
    if (created) setName("");
  };
  const formatTokenTime = (value: string | null | undefined, fallback: string) => {
    if (!value) return fallback;
    return formatDateTime(value, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const handleDialogOpenChange = (open: boolean) => {
    // 一次性明文 token 只返回一次；误关弹窗不能清空它，否则用户只能重新创建 token。
    setDialogOpen(open);
  };

  return (
    <section id={id} className={getSettingsSectionClassName(className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t("settings.publicApi")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.publicApiHelp")}</p>
            <p className="mt-2 text-xs font-medium text-foreground">
              {controller.isLoading
                ? t("settings.publicApiTokensLoading")
                : t("settings.publicApiSummary", { count: tokenCount })}
            </p>
            {controller.createdPlainToken ? (
              <p className="mt-1 text-xs font-medium text-primary">{t("settings.publicApiPendingPlainToken")}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <Badge variant={tokenCount > 0 ? "default" : "secondary"} className="w-fit">
            {t("settings.publicApiTokenCount", { count: tokenCount })}
          </Badge>
          <Button type="button" variant="outline" size="sm" className="w-full gap-2 border-border sm:w-auto" onClick={() => setDialogOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            {t("settings.publicApiManage")}
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent dismissMode="explicit" className="flex h-[min(calc(var(--app-viewport-height)-2rem),44rem)] min-h-0 max-w-3xl flex-col gap-0 overflow-hidden border-border bg-card p-0">
          <DialogHeader className="border-b border-border px-4 py-5 pr-12 text-left sm:px-6 sm:pr-14">
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              {t("settings.publicApiDialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-left">
              {t("settings.publicApiDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid gap-5">
              {controller.createdPlainToken ? (
                <div className="grid gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-foreground">{t("settings.publicApiPlainToken")}</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.publicApiPlainTokenHelp")}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={controller.dismissPlainToken} aria-label={t("settings.publicApiDismissPlainToken")} className="h-8 w-8 shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Input ref={plainTokenInputRef} value={controller.createdPlainToken} readOnly className="border-border bg-background font-mono text-xs" aria-label={t("settings.publicApiPlainToken")} />
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => {
                        void controller.copyPlainToken(plainTokenInputRef.current);
                      }}
                      className="justify-center gap-2"
                    >
                      <Clipboard className="h-4 w-4" />
                      {t("settings.publicApiCopyToken")}
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="public-api-token-name">{t("settings.publicApiCreateName")}</Label>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    id="public-api-token-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("settings.publicApiCreateNamePlaceholder")}
                    maxLength={80}
                    disabled={busy}
                    className="border-border bg-secondary"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      void handleCreate();
                    }}
                    disabled={busy || name.trim().length === 0}
                    aria-busy={controller.isCreating ? true : undefined}
                    className="justify-center gap-2"
                  >
                    <LoadingButtonContent loading={controller.isCreating} loadingLabel={t("common.saving")}>
                      <Plus className="h-4 w-4" />
                      {t("settings.publicApiCreate")}
                    </LoadingButtonContent>
                  </Button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{t("settings.publicApiCreateHelp")}</p>
              </div>

              <div className="grid gap-3 border-t border-border pt-4">
                {controller.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("settings.publicApiTokensLoading")}</p>
                ) : controller.tokens.length === 0 ? (
                  <p className="text-sm leading-6 text-muted-foreground">{t("settings.publicApiTokensEmpty")}</p>
                ) : (
                  <div className="grid gap-2" role="list" aria-label={t("settings.publicApiTokens")}>
                    {controller.tokens.map((token) => (
                      <div key={token.id} role="listitem" className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-medium text-foreground">{token.name}</h3>
                            <Badge variant="secondary" className="font-mono">{token.tokenPrefix}</Badge>
                          </div>
                          <div className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                            <span>{t("settings.publicApiTokenScopes", { scopes: token.scopes.join(", ") })}</span>
                            <span>{t("settings.publicApiTokenCreated", { time: formatTokenTime(token.createdAt, t("settings.publicApiTokenUnknownTime")) })}</span>
                            <span>{t("settings.publicApiTokenLastUsed", { time: formatTokenTime(token.lastUsedAt, t("settings.publicApiTokenNeverUsed")) })}</span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setTokenToDelete(token)}
                          disabled={busy}
                          aria-busy={controller.deletingTokenId === token.id ? true : undefined}
                          className="justify-center gap-2 text-destructive hover:text-destructive"
                        >
                          <LoadingButtonContent loading={controller.deletingTokenId === token.id} loadingLabel={t("common.saving")}>
                            <Trash2 className="h-4 w-4" />
                            {t("settings.publicApiDelete")}
                          </LoadingButtonContent>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border px-4 py-4 sm:px-6">
            <p className="text-left text-xs leading-5 text-muted-foreground sm:mr-auto">
              {t("settings.publicApiManageHint")}
            </p>
            <Button type="button" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">
              {t("settings.publicApiDialogDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(tokenToDelete)} onOpenChange={(open) => !open && setTokenToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.publicApiDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.publicApiDeleteDescription", { name: tokenToDelete?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!tokenToDelete) return;
                void controller.deleteToken(tokenToDelete.id);
                setTokenToDelete(null);
              }}
            >
              {t("settings.publicApiDelete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
