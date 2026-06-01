/**
 * 404 页面（App Router 的 not-found）。
 *
 * 说明：
 * - 这里会记录一次 console.error，便于在开发/监控里发现错误路由访问
 */

import { useEffect } from "react";
import { usePathname } from '@/lib/router';
import Link from '@/components/router-link';
import { useI18n } from "@/i18n/I18nProvider";

/** 404 兜底页面组件。 */
export default function NotFound() {
  const pathname = usePathname();
  const { t } = useI18n();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", pathname);
  }, [pathname]);

  return (
    <div className="auth-page bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("notFound.title")}</p>
        <Link href="/" className="text-primary underline hover:text-primary/90">
          {t("notFound.home")}
        </Link>
      </div>
    </div>
  );
}
