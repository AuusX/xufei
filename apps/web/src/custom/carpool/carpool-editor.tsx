/**
 * 「管理拼车」弹窗里的编辑表单：车辆信息 + 分摊方式 + 车友列表。
 *
 * 从 carpool-page.tsx 拆出以控制单文件长度。这里只管渲染与交互，草稿结构和保存前校验在
 * carpool-draft.ts，输入框上限与那边的 LIMITS 保持一致（后端 zod 和上游 costSharingSchema 会拒收超限值）。
 */
import { Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CarpoolBillingCycle, CarpoolMemberStatus, CarpoolSplitMode } from "@/custom/carpool/api";
import { LIMITS, parseAmount, type Draft, type DraftMember } from "@/custom/carpool/carpool-draft";

const STATUS_OPTIONS: Array<{ value: CarpoolMemberStatus; label: string }> = [
  { value: "active", label: "使用中" },
  { value: "paused", label: "暂停" },
  { value: "expired", label: "已过期" },
];
const CYCLE_OPTIONS: Array<{ value: CarpoolBillingCycle; label: string }> = [
  { value: "monthly", label: "月付" },
  { value: "quarterly", label: "季付" },
  { value: "yearly", label: "年付" },
  { value: "custom", label: "自定义天数" },
];
const SELECT_CLASS = "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

export interface CarpoolEditorProps {
  draft: Draft;
  currency: string;
  saving: boolean;
  removing: boolean;
  cnyToCurrency: (cny: number) => number;
  onAccount: (account: string) => void;
  onCardLast4: (cardLast4: string) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onSplitMode: (mode: CarpoolSplitMode) => void;
  onAddMember: () => void;
  onRemoveMember: (memberKey: string) => void;
  onUpdateMember: (memberKey: string, patch: Partial<DraftMember>) => void;
  onRenewMember: (memberId: string) => void;
  /** 正在续费的成员 id；只让那一行转圈，而不是整屏按钮一起变灰。 */
  renewingMemberId: string | null;
  onRemoveFromPlan: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function CarpoolEditor(props: CarpoolEditorProps) {
  const { draft, currency, saving } = props;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs">车辆信息 · gpt账号</Label>
          <Input
            value={draft.account}
            maxLength={LIMITS.account}
            placeholder="例如：共享的 GPT 账号 / 登录邮箱"
            onChange={(e) => props.onAccount(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">车辆信息 · 信用卡尾数</Label>
          <Input value={draft.cardLast4} maxLength={8} placeholder="如 1234" onChange={(e) => props.onCardLast4(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={draft.enabled} onCheckedChange={props.onToggleEnabled} />
          启用拼车
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">分摊方式</span>
          <Button variant={draft.splitMode === "equal" ? "default" : "outline"} size="sm" onClick={() => props.onSplitMode("equal")}>均摊</Button>
          <Button variant={draft.splitMode === "custom" ? "default" : "outline"} size="sm" onClick={() => props.onSplitMode("custom")}>自定义金额</Button>
        </div>
      </div>
      {!draft.enabled && draft.members.length > 0 ? (
        <p className="text-xs text-muted-foreground">已关闭拼车：车友信息会保留，只是这辆车不再计入「进行中的拼车」。</p>
      ) : null}

      <div className="space-y-3">
        {draft.members.map((member) => {
          const cny = parseAmount(member.amountCny);
          const preview = cny !== null && currency !== "CNY" ? `≈ ${formatMoney(props.cnyToCurrency(cny), currency)}` : "";
          const renewing = props.renewingMemberId !== null && props.renewingMemberId === member.id;
          return (
            <div key={member.key} className="rounded-md border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">车友</span>
                <div className="flex items-center gap-3">
                  {member.id ? (
                    <Button variant="outline" size="sm" className="h-7 text-xs" disabled={renewing} onClick={() => { if (member.id) props.onRenewMember(member.id); }}>
                      {renewing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} 续费
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="删除车友"
                    className="h-7 w-7"
                    onClick={() => {
                      // 和「续费」挨着，误点代价是整行资料没了——所以要二次确认。
                      if (window.confirm(`删除车友${member.name.trim() ? `「${member.name.trim()}」` : ""}？他的到期日、微信、金额都会一起删除。`)) {
                        props.onRemoveMember(member.key);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <Label className="text-xs">姓名/备注</Label>
                  <Input value={member.name} maxLength={LIMITS.name} placeholder="车友" onChange={(e) => props.onUpdateMember(member.key, { name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">状态</Label>
                  <select className={SELECT_CLASS} value={member.status} onChange={(e) => props.onUpdateMember(member.key, { status: e.target.value as CarpoolMemberStatus })}>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">微信</Label>
                  <Input value={member.wechat} maxLength={LIMITS.wechat} placeholder="微信号" onChange={(e) => props.onUpdateMember(member.key, { wechat: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">邮箱</Label>
                  <Input value={member.email} maxLength={LIMITS.email} placeholder="邮箱" onChange={(e) => props.onUpdateMember(member.key, { email: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">付款金额 (¥ 人民币)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    disabled={draft.splitMode !== "custom"}
                    value={member.amountCny}
                    placeholder={draft.splitMode === "custom" ? "¥ 0.00" : "均摊自动计算"}
                    onChange={(e) => props.onUpdateMember(member.key, { amountCny: e.target.value })}
                  />
                  {preview ? <div className="mt-0.5 text-[11px] text-muted-foreground">{preview}</div> : null}
                </div>
                <div>
                  <Label className="text-xs">扣费周期</Label>
                  <select className={SELECT_CLASS} value={member.billingCycle} onChange={(e) => props.onUpdateMember(member.key, { billingCycle: e.target.value as CarpoolBillingCycle })}>
                    {CYCLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {member.billingCycle === "custom" ? (
                  <div>
                    <Label className="text-xs">自定义天数</Label>
                    <Input
                      type="number"
                      min="1"
                      max={LIMITS.customDays}
                      step="1"
                      value={member.customDays}
                      placeholder="必填，如 30"
                      onChange={(e) => props.onUpdateMember(member.key, { customDays: e.target.value })}
                    />
                  </div>
                ) : null}
                <div>
                  <Label className="text-xs">上车时间</Label>
                  <Input type="date" value={member.joinDate} onChange={(e) => props.onUpdateMember(member.key, { joinDate: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">到期时间</Label>
                  <Input
                    type="date"
                    disabled={member.autoCalcExpiry}
                    value={member.expiryDate}
                    placeholder={member.autoCalcExpiry ? "自动计算" : ""}
                    onChange={(e) => props.onUpdateMember(member.key, { expiryDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">到期提醒(提前天数)</Label>
                  <Input
                    type="number"
                    min="0"
                    max={LIMITS.reminderDays}
                    step="1"
                    value={member.reminderDays}
                    placeholder="留空=不提醒"
                    onChange={(e) => props.onUpdateMember(member.key, { reminderDays: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-xs">
                  <Switch checked={member.autoCalcExpiry} onCheckedChange={(v) => props.onUpdateMember(member.key, { autoCalcExpiry: v })} />
                  自动计算到期
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={draft.members.length >= LIMITS.members} onClick={props.onAddMember}>
            <Plus className="mr-1 h-4 w-4" /> 添加车友
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={props.removing} onClick={props.onRemoveFromPlan}>
            <Trash2 className="mr-1 h-4 w-4" /> 移出计划
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel} disabled={saving}>取消</Button>
          <Button size="sm" onClick={props.onSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}
