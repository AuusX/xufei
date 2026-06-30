import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { useI18n } from "@/i18n/I18nProvider";
import { CLOUD_BACKUP_MAX_RETENTION } from "@/lib/api/schemas/cloud-backup";
import { cn } from "@/lib/utils";
import type { CloudBackupFormState } from "../application/use-cloud-backup-controller";

type NumericAllowedValues = {
  floatValue: number | undefined;
  value: string;
};

// 保留数量是 provider 级策略字段，输入态允许清空，但非空值必须先被控件挡在 shared schema 边界内。
function isAllowedRetentionValue(values: NumericAllowedValues) {
  return values.value === "" || (
    values.floatValue !== undefined
    && values.floatValue >= 1
    && values.floatValue <= CLOUD_BACKUP_MAX_RETENTION
  );
}

interface CloudBackupPolicyFormProps {
  scheduleEnabled: boolean;
  scheduleFrequency: CloudBackupFormState["scheduleFrequency"];
  scheduleTime: string;
  scheduleWeekday: CloudBackupFormState["scheduleWeekday"];
  retention: string;
  busy: boolean;
  disabled?: boolean;
  onScheduleEnabledChange: (checked: boolean) => void;
  onFrequencyChange: (frequency: CloudBackupFormState["scheduleFrequency"]) => void;
  onScheduleTimeChange: (value: string) => void;
  onScheduleWeekdayChange: (weekday: CloudBackupFormState["scheduleWeekday"]) => void;
  onRetentionChange: (value: string) => void;
}

export function CloudBackupPolicyForm({
  scheduleEnabled,
  scheduleFrequency,
  scheduleTime,
  scheduleWeekday,
  retention,
  busy,
  disabled = false,
  onScheduleEnabledChange,
  onFrequencyChange,
  onScheduleTimeChange,
  onScheduleWeekdayChange,
  onRetentionChange,
}: CloudBackupPolicyFormProps) {
  const { t } = useI18n();

  return (
    <div className="grid gap-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">{t("settings.cloudBackupPolicy")}</h3>
      <div className="flex max-w-3xl items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor="cloudBackupSchedule" className="cursor-pointer text-sm font-medium">{t("settings.cloudBackupSchedule")}</Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("settings.cloudBackupScheduleHelp")}</p>
        </div>
        <Switch
          id="cloudBackupSchedule"
          checked={scheduleEnabled}
          onCheckedChange={onScheduleEnabledChange}
          disabled={disabled || busy}
          aria-label={t("settings.cloudBackupSchedule")}
        />
      </div>
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:items-start">
        <FieldRow label={t("settings.cloudBackupFrequency")} htmlFor="cloudBackupFrequency">
          <Select
            value={scheduleFrequency}
            disabled={disabled || !scheduleEnabled || busy}
            onValueChange={(value) => onFrequencyChange(value as CloudBackupFormState["scheduleFrequency"])}
          >
            <SelectTrigger id="cloudBackupFrequency" className="h-9 border-border bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">{t("settings.cloudBackupFrequencyDaily")}</SelectItem>
              <SelectItem value="weekly">{t("settings.cloudBackupFrequencyWeekly")}</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        {scheduleFrequency === "weekly" ? (
          <FieldRow label={t("settings.cloudBackupScheduleWeekday")} htmlFor="cloudBackupScheduleWeekday">
            <Select
              value={scheduleWeekday}
              disabled={disabled || !scheduleEnabled || busy}
              onValueChange={(value) => onScheduleWeekdayChange(value as CloudBackupFormState["scheduleWeekday"])}
            >
              <SelectTrigger id="cloudBackupScheduleWeekday" className="h-9 border-border bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monday">{t("settings.cloudBackupWeekdayMonday")}</SelectItem>
                <SelectItem value="tuesday">{t("settings.cloudBackupWeekdayTuesday")}</SelectItem>
                <SelectItem value="wednesday">{t("settings.cloudBackupWeekdayWednesday")}</SelectItem>
                <SelectItem value="thursday">{t("settings.cloudBackupWeekdayThursday")}</SelectItem>
                <SelectItem value="friday">{t("settings.cloudBackupWeekdayFriday")}</SelectItem>
                <SelectItem value="saturday">{t("settings.cloudBackupWeekdaySaturday")}</SelectItem>
                <SelectItem value="sunday">{t("settings.cloudBackupWeekdaySunday")}</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
        ) : null}
        <FieldRow label={t("settings.cloudBackupScheduleTime")} htmlFor="cloudBackupScheduleTime">
          <TimePicker
            id="cloudBackupScheduleTime"
            value={scheduleTime}
            disabled={disabled || !scheduleEnabled || busy}
            onChange={onScheduleTimeChange}
            ariaLabel={t("settings.cloudBackupScheduleTime")}
            density="compact"
            className="w-full sm:max-w-[9rem]"
          />
        </FieldRow>
        <FieldRow label={t("settings.cloudBackupRetention")} htmlFor="cloudBackupRetention">
          <NumericInput
            id="cloudBackupRetention"
            inputMode="numeric"
            value={retention}
            allowNegative={false}
            decimalScale={0}
            isAllowed={isAllowedRetentionValue}
            disabled={disabled || busy}
            onRawValueChange={onRetentionChange}
            className="h-9 border-border bg-background"
          />
        </FieldRow>
      </div>
    </div>
  );
}

interface FieldRowProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

function FieldRow({ label, htmlFor, children, className }: FieldRowProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 self-start", className)}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
      {children}
    </div>
  );
}
