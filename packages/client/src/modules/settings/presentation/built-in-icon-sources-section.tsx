import { useState } from 'react';
import { Image as ImageIcon, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { BUILT_IN_ICON_PROVIDERS, type BuiltInIconProvider } from '@renewlet/shared/built-in-icons';
import type { AppSettings } from '@/types/subscription';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/I18nProvider';
import type { MessageKey, MessageParams } from '@/i18n/messages';

interface BuiltInIconSourcesSectionProps {
  sources: AppSettings["builtInIconSources"];
  onChange: (sources: AppSettings["builtInIconSources"]) => void;
}

export function BuiltInIconSourcesSection({ sources, onChange }: BuiltInIconSourcesSectionProps) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const enabledCount = BUILT_IN_ICON_PROVIDERS.filter((provider) => sources[provider].enabled).length;
  const variantsEnabledCount = BUILT_IN_ICON_PROVIDERS.filter((provider) => sources[provider].enabled && sources[provider].variantsEnabled).length;
  const enabledSourceNames = BUILT_IN_ICON_PROVIDERS
    .filter((provider) => sources[provider].enabled)
    .map((provider) => t(`settings.builtInIconSourceShort.${provider}`))
    .join(" / ");

  const updateProvider = (
    provider: BuiltInIconProvider,
    patch: Partial<AppSettings["builtInIconSources"][BuiltInIconProvider]>,
  ) => {
    const next = {
      ...sources,
      [provider]: {
        ...sources[provider],
        ...patch,
      },
    };
    if (BUILT_IN_ICON_PROVIDERS.every((item) => !next[item].enabled)) return;
    onChange(next);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">{t("settings.builtInIconSources")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.builtInIconSourcesHelp")}</p>
            <p className="mt-2 text-xs font-medium text-foreground">
              {t("settings.builtInIconSourcesSummary", {
                enabled: enabledCount,
                variants: variantsEnabledCount,
                total: BUILT_IN_ICON_PROVIDERS.length,
              })}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{enabledSourceNames}</p>
          </div>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" className="w-full shrink-0 gap-2 sm:w-auto">
              <SlidersHorizontal className="h-4 w-4" />
              {t("settings.builtInIconSourcesConfigure")}
            </Button>
          </DialogTrigger>
          <DialogContent className="flex min-h-0 max-w-3xl flex-col overflow-hidden border-border bg-card p-0">
            <DialogHeader className="border-b border-border px-4 py-5 pr-12 text-left sm:px-6 sm:pr-14">
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-primary" />
                {t("settings.builtInIconSourcesDialogTitle")}
              </DialogTitle>
              <DialogDescription className="text-left">
                {t("settings.builtInIconSourcesDialogDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="grid gap-3">
                {BUILT_IN_ICON_PROVIDERS.map((provider) => (
                  <BuiltInIconSourceCard
                    key={provider}
                    provider={provider}
                    source={sources[provider]}
                    disableSourceToggle={sources[provider].enabled && enabledCount <= 1}
                    onUpdate={updateProvider}
                    t={t}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{t("settings.builtInIconSourcesRequired")}</p>
            </div>

            <DialogFooter className="border-t border-border px-4 py-4 sm:px-6">
              <p className="text-left text-xs leading-5 text-muted-foreground sm:mr-auto">
                {t("settings.builtInIconSourcesPendingHint")}
              </p>
              <Button type="button" onClick={() => setDialogOpen(false)} className="w-full sm:w-auto">
                {t("settings.builtInIconSourcesDialogDone")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}

interface BuiltInIconSourceCardProps {
  provider: BuiltInIconProvider;
  source: AppSettings["builtInIconSources"][BuiltInIconProvider];
  disableSourceToggle: boolean;
  onUpdate: (
    provider: BuiltInIconProvider,
    patch: Partial<AppSettings["builtInIconSources"][BuiltInIconProvider]>,
  ) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
}

function BuiltInIconSourceCard({
  provider,
  source,
  disableSourceToggle,
  onUpdate,
  t,
}: BuiltInIconSourceCardProps) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-start min-[420px]:justify-between">
        <div className="min-w-0">
          <Label htmlFor={`built-in-icon-source-${provider}`} className="text-sm font-medium">
            {t(`settings.builtInIconSource.${provider}`)}
          </Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t(`settings.builtInIconSource.${provider}.help`)}
          </p>
        </div>
        <Switch
          id={`built-in-icon-source-${provider}`}
          checked={source.enabled}
          disabled={disableSourceToggle}
          onCheckedChange={(checked) => onUpdate(provider, { enabled: checked })}
          aria-label={t("settings.builtInIconSourceToggle", { source: t(`settings.builtInIconSource.${provider}`) })}
        />
      </div>

      <div className={cn("mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3", !source.enabled && "opacity-50")}>
        <div className="min-w-0">
          <Label htmlFor={`built-in-icon-source-variants-${provider}`} className="text-xs font-medium">
            {t("settings.builtInIconSourceVariants")}
          </Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t(`settings.builtInIconSource.${provider}.variantsHelp`)}
          </p>
        </div>
        <Switch
          id={`built-in-icon-source-variants-${provider}`}
          checked={source.variantsEnabled}
          disabled={!source.enabled}
          onCheckedChange={(checked) => onUpdate(provider, { variantsEnabled: checked })}
          aria-label={t("settings.builtInIconSourceVariantsToggle", { source: t(`settings.builtInIconSource.${provider}`) })}
        />
      </div>
    </div>
  );
}
