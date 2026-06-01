/**
 * 法务/声明类页面外壳。
 *
 * 架构位置：
 * - 登录页可链接到无需登录的 terms/privacy 页面。
 * - 本组件统一品牌区、正文容器和返回入口。
 */
import Link from '@/components/router-link';
import type { ReactNode } from "react";
import { ArrowLeft, Home } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RenewletLogo } from "@/components/icons/renewlet-logo";
import { useI18n } from "@/i18n/I18nProvider";

/**
 * 法务/声明类页面通用外壳（/terms、/privacy 等）。
 *
 * 目标：
 * - 登录页里会链接到这些页面，因此必须是“无需登录也可访问”
 * - 统一 UI：避免重复维护两套布局
 */
export function LegalPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="auth-page theme-gradient">
      <div className="w-full max-w-2xl">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card grid gap-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#111720] text-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_32px_-22px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
              <RenewletLogo className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-foreground">{title}</h1>
              {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>

          <div className="text-sm text-muted-foreground leading-relaxed">
            {children}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="outline" className="border-border">
              <Link href="/login" className="inline-flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t("common.backToLogin")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="border-border">
              <Link href="/" className="inline-flex items-center gap-2">
                <Home className="h-4 w-4" />
                {t("common.backHome")}
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
