import { FieldError } from "@/components/ui/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey, MessageParams } from "@/i18n/messages";
import type { SearchableSelectOption } from "@/lib/searchable-options";
import type { CostSharing, CostSharingMember } from "@/types/subscription";
import type { SubscriptionFormState } from "@/types/subscription-form";
import { calculateCostSharingSummary } from "@renewlet/shared/cost-sharing";
import { Plus, Trash2 } from "lucide-react";

function newCostSharingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `member-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultCostSharing(t: (key: MessageKey, values?: MessageParams) => string): CostSharing {
  const firstMemberId = newCostSharingId();
  return {
    enabled: true,
    payerMemberId: firstMemberId,
    selfMemberId: firstMemberId,
    splitMode: "equal",
    members: [
      { id: firstMemberId, name: t("subscription.costSharing.memberDefault", { index: 1 }), included: true },
    ],
  };
}

function normalizeCostSharingSelection(costSharing: CostSharing): CostSharing {
  // v1 表单只支持“所有成员参与分摊”；included 字段仍随 API 保存，给后续排除成员 UI 留同一 wire shape。
  const members = (costSharing.members.length > 0 ? costSharing.members : [{ id: newCostSharingId(), name: "Member 1", included: true }])
    .map((member) => ({ ...member, included: true }));
  const ids = new Set(members.map((member) => member.id));
  const firstId = members[0]!.id;
  return {
    ...costSharing,
    members,
    selfMemberId: ids.has(costSharing.selfMemberId) ? costSharing.selfMemberId : firstId,
    payerMemberId: ids.has(costSharing.payerMemberId) ? costSharing.payerMemberId : firstId,
  };
}

function costSharingMemberInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

export function CostSharingFields({
  id,
  formData,
  update,
  error,
  currencyOptions,
  currencyConvert,
}: {
  id: (name: string) => string;
  formData: SubscriptionFormState;
  update: <K extends keyof SubscriptionFormState>(key: K, value: SubscriptionFormState[K]) => void;
  error?: string | undefined;
  currencyOptions: SearchableSelectOption[];
  currencyConvert?: ((amount: number, fromCurrency: string, toCurrency: string) => number) | undefined;
}) {
  const { t, formatCurrency } = useI18n();
  const costSharing = formData.costSharing;
  const price = Number(formData.price);
  const total = Number.isFinite(price) && price >= 0 ? price : 0;
  const summary = calculateCostSharingSummary(costSharing, total, { baseCurrency: formData.currency, convert: currencyConvert });

  const setCostSharing = (next: CostSharing | undefined) => update("costSharing", next ? normalizeCostSharingSelection(next) : undefined);
  const enabled = Boolean(costSharing?.enabled);
  const members = costSharing?.members ?? [];
  const memberShareInCurrency = (member: CostSharingMember) => {
    const memberCurrency = member.currency ?? formData.currency;
    const baseShare = members.length > 0 ? total / members.length : 0;
    return currencyConvert ? currencyConvert(baseShare, formData.currency, memberCurrency) : baseShare;
  };

  const updateMember = (memberId: string, patch: Partial<CostSharingMember>) => {
    if (!costSharing) return;
    setCostSharing({
      ...costSharing,
      members: costSharing.members.map((member) => member.id === memberId ? { ...member, ...patch } : member),
    });
  };

  const removeMember = (memberId: string) => {
    if (!costSharing || costSharing.members.length <= 1) return;
    setCostSharing({
      ...costSharing,
      members: costSharing.members.filter((member) => member.id !== memberId),
    });
  };

  const addMember = () => {
    const base = costSharing ?? defaultCostSharing(t);
    setCostSharing({
      ...base,
      enabled: true,
      members: [
        ...base.members,
        {
          id: newCostSharingId(),
          name: t("subscription.costSharing.memberDefault", { index: base.members.length + 1 }),
          included: true,
        },
      ],
    });
  };

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id("costSharingEnabled")} className="cursor-pointer text-sm font-medium">
            {t("subscription.costSharing.title")}
          </Label>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("subscription.costSharing.help")}</p>
        </div>
        <Switch
          id={id("costSharingEnabled")}
          checked={enabled}
          onCheckedChange={(checked) => setCostSharing(checked ? { ...(costSharing ?? defaultCostSharing(t)), enabled: true } : undefined)}
          aria-label={t("subscription.costSharing.title")}
        />
      </div>

      {enabled && costSharing ? (
        <>
          <div className="grid gap-3 sm:max-w-xs">
            <div className="grid gap-2">
              <Label htmlFor={id("costSharingSplitMode")}>{t("subscription.costSharing.splitMode")}</Label>
              <Select value={costSharing.splitMode} onValueChange={(value) => setCostSharing({ ...costSharing, splitMode: value as CostSharing["splitMode"] })}>
                <SelectTrigger id={id("costSharingSplitMode")} className="border-border bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="equal">{t("subscription.costSharing.equal")}</SelectItem>
                  <SelectItem value="custom">{t("subscription.costSharing.custom")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="grid gap-2.5 rounded-lg border border-border bg-background/70 p-3 shadow-sm transition-colors hover:bg-background sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,11rem)_2.25rem] sm:items-center"
              >
                <div className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-2">
                  <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary shadow-inner">
                    {costSharingMemberInitial(member.name)}
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor={id(`costSharingMemberName-${member.id}`)} className="sr-only">
                      {t("subscription.costSharing.memberName")}
                    </Label>
                    <Input
                      id={id(`costSharingMemberName-${member.id}`)}
                      value={member.name}
                      onChange={(event) => updateMember(member.id, { name: event.target.value })}
                      aria-label={t("subscription.costSharing.memberName")}
                      className="h-9 border-border bg-secondary font-medium"
                    />
                    <Label htmlFor={id(`costSharingMemberNote-${member.id}`)} className="sr-only">
                      {t("subscription.costSharing.memberNote")}
                    </Label>
                    <Input
                      id={id(`costSharingMemberNote-${member.id}`)}
                      value={member.note ?? ""}
                      onChange={(event) => updateMember(member.id, { note: event.target.value })}
                      aria-label={t("subscription.costSharing.memberNote")}
                      placeholder={t("subscription.costSharing.memberNotePlaceholder")}
                      className="h-8 border-border bg-secondary text-sm text-muted-foreground placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>
                {costSharing.splitMode === "custom" ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
                    <NumericInput
                      allowNegative={false}
                      allowedDecimalSeparators={[".", "。"]}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={member.customAmount?.toString() ?? ""}
                      onRawValueChange={(value) => updateMember(member.id, { customAmount: value.trim() === "" ? undefined : Number(value) })}
                      className="h-9 border-border bg-secondary px-2 font-semibold sm:text-right"
                      aria-label={t("subscription.costSharing.customAmount")}
                    />
                    <MemberCurrencySelect
                      value={member.currency ?? formData.currency}
                      onValueChange={(value) => updateMember(member.id, { currency: value })}
                      options={currencyOptions}
                      ariaLabel={t("subscription.costSharing.memberCurrency")}
                      placeholder={t("subscription.placeholder.currency")}
                      searchPlaceholder={t("subscription.search.currency")}
                      emptyMessage={t("subscription.empty.currency")}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
                    <span className="truncate rounded-md bg-secondary px-2.5 py-2 text-sm font-semibold text-foreground sm:text-right">
                      {formatCurrency(memberShareInCurrency(member), member.currency ?? formData.currency)}
                    </span>
                    <MemberCurrencySelect
                      value={member.currency ?? formData.currency}
                      onValueChange={(value) => updateMember(member.id, { currency: value })}
                      options={currencyOptions}
                      ariaLabel={t("subscription.costSharing.memberCurrency")}
                      placeholder={t("subscription.placeholder.currency")}
                      searchPlaceholder={t("subscription.search.currency")}
                      emptyMessage={t("subscription.empty.currency")}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 justify-self-end text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeMember(member.id)}
                  disabled={members.length <= 1}
                  aria-label={t("common.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addMember}>
              <Plus className="h-4 w-4" />
              {t("subscription.costSharing.addMember")}
            </Button>
          </div>

          <div className="grid gap-2 rounded-md bg-background/60 p-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.familyContribution")}</p>
              <p className="font-semibold text-warning">{formatCurrency(summary.familyContribution, formData.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.yourShare")}</p>
              <p className="font-semibold text-primary">{formatCurrency(summary.yourShare, formData.currency)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">{t("subscription.costSharing.recoverableAmount")}</p>
              <p className="font-semibold text-foreground">{formatCurrency(summary.recoverableAmount, formData.currency)}</p>
            </div>
          </div>
          <FieldError id={id("costSharing-error")} message={error} />
        </>
      ) : null}
    </div>
  );
}

function MemberCurrencySelect({
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  searchPlaceholder,
  emptyMessage,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  ariaLabel: string;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
}) {
  return (
    <SearchableSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
      className="h-9 border-border bg-secondary px-2 text-sm font-semibold"
      contentClassName="min-w-[16rem]"
      aria-label={ariaLabel}
      renderValue={(option) => (
        <span className="block text-center tracking-wide">{option?.value ?? value}</span>
      )}
      renderOption={(option) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium">{option.value}</span>
          <span className="min-w-0 truncate text-muted-foreground">{option.label}</span>
        </span>
      )}
    />
  );
}
