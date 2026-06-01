import { useId, useMemo, useState } from "react";
import { Image as ImageIcon, Link, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { FaviconResultImage } from "@/components/favicon-result-image";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import {
  LOGO_URL_INPUT_MAX_LENGTH,
  resolveDisplayLogoSrc,
  validateCustomLogoUrlInput,
  type LogoUrlValidationCode,
} from "@/lib/logo-url";
import { cn } from "@/lib/utils";

interface LogoUrlInputPanelProps {
  value?: string | null | undefined;
  onApply: (value: string) => void;
  className?: string | undefined;
  size?: "sm" | "md" | undefined;
}

const validationMessageKeys: Record<LogoUrlValidationCode, MessageKey> = {
  empty: "media.logoLinkRequired",
  tooLong: "media.logoLinkTooLong",
  invalid: "media.logoLinkInvalid",
  scheme: "media.logoLinkSchemeInvalid",
  host: "media.logoLinkHostInvalid",
  userinfo: "media.logoLinkUserInfoInvalid",
};

function initialLogoUrl(value: string | null | undefined): string {
  if (!value) return "";
  const validation = validateCustomLogoUrlInput(value);
  return validation.ok ? validation.value : "";
}

export function LogoUrlInputPanel({
  value,
  onApply,
  className,
  size = "md",
}: LogoUrlInputPanelProps) {
  const { t } = useI18n();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const previewId = `${inputId}-preview`;
  const [rawValue, setRawValue] = useState(() => initialLogoUrl(value));
  const [touched, setTouched] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const validation = useMemo(() => validateCustomLogoUrlInput(rawValue), [rawValue]);
  const displaySrc = validation.ok ? resolveDisplayLogoSrc(validation.value) : undefined;
  const upgradedForPreview = validation.ok && displaySrc !== undefined && displaySrc !== validation.value;
  const showError = touched && !validation.ok;
  const isSmall = size === "sm";

  const errorMessage = showError && !validation.ok
    ? t(validationMessageKeys[validation.code], { max: LOGO_URL_INPUT_MAX_LENGTH })
    : undefined;

  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid gap-2">
        <Input
          id={inputId}
          type="url"
          inputMode="url"
          value={rawValue}
          maxLength={LOGO_URL_INPUT_MAX_LENGTH}
          placeholder="https://example.com/logo.svg"
          aria-invalid={showError}
          aria-describedby={showError ? errorId : validation.ok ? previewId : undefined}
          className={cn(isSmall && "h-9 text-sm")}
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setRawValue(event.target.value);
            setTouched(true);
            setPreviewFailed(false);
          }}
        />
        <FieldError id={errorId} message={errorMessage} />
      </div>

      {validation.ok ? (
        <div
          id={previewId}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-border bg-secondary/30 p-2"
        >
          <div className={cn(
            "media-thumbnail-canvas flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background p-1",
            isSmall ? "h-10 w-10" : "h-12 w-12",
          )}>
            {displaySrc && !previewFailed ? (
              <FaviconResultImage
                src={displaySrc}
                alt={t("media.logoLinkPreviewAlt")}
                className="media-thumbnail-image"
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <ImageIcon className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            {displaySrc === undefined ? (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t("media.logoLinkHttpIpBlocked")}</span>
              </p>
            ) : previewFailed ? (
              <p className="text-xs text-muted-foreground">{t("media.logoLinkPreviewFailed")}</p>
            ) : upgradedForPreview ? (
              <p className="text-xs text-muted-foreground">{t("media.logoLinkPreviewUpgraded")}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("media.logoLinkPreviewReady")}</p>
            )}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        className="w-full gap-2"
        disabled={!validation.ok}
        onClick={() => {
          if (validation.ok) onApply(validation.value);
        }}
      >
        <Link className="h-4 w-4" />
        {t("media.useLogoLink")}
      </Button>
    </div>
  );
}
