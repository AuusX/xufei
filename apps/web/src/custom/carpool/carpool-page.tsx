/**
 * 拼车栏目（/carpool）。
 *
 * 视图（内部 state 切换，不新增路由）：
 *  1. 计划列表：创建拼车计划、设置拼车通知（独立 webhook，见 notification-dialog.tsx）。
 *  2. 计划详情：订阅以「小轿车卡片」网格呈现（一行 2-3 辆，结构固定），点整张卡片打开弹窗管理。
 *
 * 付款金额按人民币录入（按成员扣费周期），换算成订阅货币写入 cost_sharing；卡片与「月应收合计」统一按
 * 月均展示（订阅整期价与成员整期付款都折算成每月），应收由后端按币种分桶、这里用实时汇率折成人民币。
 * 车辆有 gpt账号 + 信用卡尾数两项。微信/邮箱/账号/卡号可一键复制。全部经 `/api/custom/carpool/*`，不改上游。
 *
 * 编辑弹窗的草稿结构与保存前校验在 carpool-draft.ts，表单渲染在 carpool-editor.tsx。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Bot, CarFront, ChevronLeft, CreditCard, Loader2, Mail, MessageCircle, Plus, Trash2 } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { useExchangeRates } from "@/hooks/use-exchange-rates";
import { NotificationDialog } from "@/custom/carpool/notification-dialog";
import { CopyButton } from "@/custom/carpool/copy-button";
import { CarpoolEditor } from "@/custom/carpool/carpool-editor";
import { buildMembersPayload, newDraftMember, toDraft, type Draft, type DraftMember } from "@/custom/carpool/carpool-draft";
import {
  addSubscriptionToPlan,
  createCarpoolPlan,
  deleteCarpoolPlan,
  fetchCarpoolPlanDetail,
  fetchCarpoolPlans,
  fetchCarpoolSubscriptions,
  removeSubscriptionFromPlan,
  renewCarpoolMember,
  saveCarpoolMembers,
  type CarpoolMember,
  type CarpoolMemberStatus,
  type CarpoolPlanStats,
  type CarpoolSubscription,
} from "@/custom/carpool/api";

const PLANS_KEY = ["carpool", "plans"] as const;
const ACTIVE_SUBS_KEY = ["carpool", "active-subscriptions"] as const;
const planKey = (planId: string) => ["carpool", "plan", planId] as const;
const CNY = "CNY";

const STATUS_LABEL: Record<CarpoolMemberStatus, string> = { active: "使用中", paused: "暂停", expired: "已过期" };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}
function formatCny(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function expiryBadge(member: CarpoolMember): { text: string; className: string } | null {
  const expiry = member.effectiveExpiry;
  if (!expiry) return null;
  const days = daysUntil(expiry);
  if (days === null) return null;
  if (days < 0) return { text: "已过期", className: "bg-destructive/10 text-destructive" };
  const withinReminder = member.reminderDays >= 0 && days <= member.reminderDays;
  if (withinReminder) return { text: `${days}天后到期`, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  return { text: `到期 ${expiry}`, className: "text-muted-foreground" };
}

function memberPayText(member: CarpoolMember, currency: string): string {
  if (member.monthlyAmountCny != null) return `${formatCny(member.monthlyAmountCny)}/月`;
  return `${formatMoney(member.amount, currency)}/月`;
}

export default function CarpoolPage() {
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  return (
    <>
      <Header />
      <main className="app-main mx-auto max-w-5xl px-4 pb-16">
        {openPlanId ? (
          <PlanDetailView planId={openPlanId} onBack={() => setOpenPlanId(null)} />
        ) : (
          <PlanListView onOpenPlan={setOpenPlanId} />
        )}
      </main>
    </>
  );
}

/**
 * 计划统计条。应收由后端按币种分桶返回，这里用**实时汇率**折成人民币合计——均摊的车没有人民币原值，
 * 后端换算不了（Worker 侧没有汇率源），只在前端才能算对。
 */
function StatRow({ stats }: { stats: CarpoolPlanStats }) {
  const { convert, error: ratesError } = useExchangeRates();
  const receivable = Object.entries(stats.receivableByCurrency).reduce(
    (total, [currency, amount]) => total + (currency === CNY ? amount : convert(amount, currency, CNY)),
    0,
  );
  const items: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "总车数", value: String(stats.totalCars) },
    { label: "进行中的拼车", value: String(stats.activeCars), accent: true },
    { label: "空车", value: String(stats.emptyCars) },
    { label: "月应收合计", value: formatCny(receivable) },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border bg-card px-3 py-2">
            <div className={`text-xl font-semibold ${item.accent ? "text-primary" : ""}`}>{item.value}</div>
            <div className="text-xs text-muted-foreground">{item.label}</div>
          </div>
        ))}
      </div>
      {ratesError ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">汇率获取失败，外币金额按内置快照折算，可能与实时汇率有差异。</p>
      ) : null}
    </div>
  );
}

// ---------------- 计划列表 ----------------

function PlanListView({ onOpenPlan }: { onOpenPlan: (planId: string) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: PLANS_KEY, queryFn: fetchCarpoolPlans });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notifyOpen, setNotifyOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: (planName: string) => createCarpoolPlan(planName),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
      setCreating(false);
      setName("");
      if (plan) onOpenPlan(plan.id);
    },
    onError: (error: unknown) =>
      toast.error("创建失败", { description: error instanceof Error ? error.message : "请重试" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deleteCarpoolPlan(planId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: PLANS_KEY }),
    onError: (error: unknown) =>
      toast.error("删除失败", { description: error instanceof Error ? error.message : "请重试" }),
  });

  const plans = query.data ?? [];

  return (
    <>
      <div className="mb-6 mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CarFront className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">拼车</h1>
            <p className="text-sm text-muted-foreground">创建拼车计划（如 TEAM 计划），把要拼的订阅归到计划里管理。</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setNotifyOpen(true)}>
            <Bell className="mr-1 h-4 w-4" /> 设置拼车通知
          </Button>
          {!creating && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" /> 创建拼车计划
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <div className="min-w-[12rem] flex-1">
              <Label className="text-xs">计划名称</Label>
              <Input autoFocus value={name} placeholder="例如：TEAM 计划" onChange={(e) => setName(e.target.value)} />
            </div>
            <Button size="sm" disabled={createMutation.isPending || name.trim().length === 0} onClick={() => createMutation.mutate(name.trim())}>
              {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              创建
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setName(""); }}>取消</Button>
          </CardContent>
        </Card>
      )}

      {query.isPending ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
        </div>
      ) : query.isError ? (
        <div className="py-16 text-center text-destructive">加载失败，请刷新重试。</div>
      ) : plans.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          还没有拼车计划。点击右上角「创建拼车计划」开始。
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                <button className="truncate text-left text-base font-semibold hover:text-primary" onClick={() => onOpenPlan(plan.id)}>
                  {plan.name}
                </button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => onOpenPlan(plan.id)}>进入</Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="删除计划"
                    disabled={deleteMutation.isPending}
                    onClick={() => { if (window.confirm(`删除计划「${plan.name}」？订阅本身不会被删除。`)) deleteMutation.mutate(plan.id); }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <StatRow stats={plan.stats} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NotificationDialog open={notifyOpen} onOpenChange={setNotifyOpen} />
    </>
  );
}

// ---------------- 计划详情 ----------------

function PlanDetailView({ planId, onBack }: { planId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { convert } = useExchangeRates();
  const planQuery = useQuery({ queryKey: planKey(planId), queryFn: () => fetchCarpoolPlanDetail(planId) });
  const activeSubsQuery = useQuery({ queryKey: ACTIVE_SUBS_KEY, queryFn: fetchCarpoolSubscriptions });
  const [subToAdd, setSubToAdd] = useState("");
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: planKey(planId) });
    void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
    void queryClient.invalidateQueries({ queryKey: ACTIVE_SUBS_KEY });
  };
  const onMutationError = (title: string) => (error: unknown) =>
    toast.error(title, { description: error instanceof Error ? error.message : "请重试" });

  const addMutation = useMutation({
    mutationFn: (subscriptionId: string) => addSubscriptionToPlan(planId, subscriptionId),
    onSuccess: () => { invalidate(); setSubToAdd(""); },
    onError: onMutationError("添加订阅失败"),
  });
  const removeMutation = useMutation({
    mutationFn: (subscriptionId: string) => removeSubscriptionFromPlan(planId, subscriptionId),
    onSuccess: () => { invalidate(); setEditingSubId(null); setDraft(null); },
    onError: onMutationError("移除订阅失败"),
  });
  const deletePlanMutation = useMutation({
    mutationFn: () => deleteCarpoolPlan(planId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: PLANS_KEY }); onBack(); },
    onError: onMutationError("删除计划失败"),
  });
  const saveMembersMutation = useMutation({
    mutationFn: (variables: { id: string; input: Parameters<typeof saveCarpoolMembers>[1] }) =>
      saveCarpoolMembers(variables.id, variables.input),
    onSuccess: () => { invalidate(); setEditingSubId(null); setDraft(null); toast.success("已保存拼车信息"); },
    onError: onMutationError("保存失败"),
  });
  const renewMemberMutation = useMutation({
    mutationFn: (variables: { subscriptionId: string; memberId: string }) => renewCarpoolMember(variables.subscriptionId, variables.memberId),
    onSuccess: (result, variables) => {
      invalidate();
      // 同步更新打开中的草稿，避免丢失其他未保存改动。
      setDraft((c) => (c ? { ...c, members: c.members.map((m) => (m.id === variables.memberId ? { ...m, expiryDate: result.newExpiry ?? m.expiryDate, autoCalcExpiry: false, status: "active" } : m)) } : c));
      toast.success(result.newExpiry ? `已续费，新到期日 ${result.newExpiry}` : "已续费");
    },
    onError: onMutationError("续费失败"),
  });
  // 只让正在续费的那一行转圈；用一个全局 isPending 会把同车其他车友的按钮一起变灰。
  const renewingMemberId = renewMemberMutation.isPending ? renewMemberMutation.variables?.memberId ?? null : null;

  const startEditing = (subscription: CarpoolSubscription) => {
    setEditingSubId(subscription.id);
    setDraft(toDraft(subscription, (amount) => convert(amount, subscription.currency, CNY)));
  };
  const closeEditor = () => { setEditingSubId(null); setDraft(null); };
  const updateMember = (memberKey: string, patch: Partial<DraftMember>) =>
    setDraft((current) => (current ? { ...current, members: current.members.map((m) => (m.key === memberKey ? { ...m, ...patch } : m)) } : current));

  const save = (subscription: CarpoolSubscription) => {
    if (!draft) return;
    // 校验放在这里而不是「静默丢掉不合格的成员」：以前姓名留空的车友会连同日期/微信/金额一起被悄悄
    // 删掉，还提示「已保存」。
    const built = buildMembersPayload(draft, (cny) => convert(cny, CNY, subscription.currency));
    if (!built.ok) {
      toast.error("还不能保存", { description: built.message });
      return;
    }
    saveMembersMutation.mutate({ id: subscription.id, input: built.payload });
  };

  const plan = planQuery.data;
  const planSubIds = new Set((plan?.subscriptions ?? []).map((s) => s.id));
  const available = (activeSubsQuery.data ?? []).filter((s) => !planSubIds.has(s.id));
  const editingSubscription = plan?.subscriptions.find((s) => s.id === editingSubId) ?? null;

  return (
    <>
      <div className="mb-4 mt-4 flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> 返回计划列表
        </Button>
        {plan && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            disabled={deletePlanMutation.isPending}
            onClick={() => { if (window.confirm(`删除计划「${plan.name}」？订阅本身不会被删除。`)) deletePlanMutation.mutate(); }}
          >
            <Trash2 className="mr-1 h-4 w-4" /> 删除计划
          </Button>
        )}
      </div>

      {planQuery.isPending ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
        </div>
      ) : planQuery.isError ? (
        // 加载失败和「真的被删了」必须分开说：以前网络/登录出问题也显示「已被删除」，很吓人。
        <div className="py-16 text-center">
          <p className="text-destructive">加载失败：{planQuery.error instanceof Error ? planQuery.error.message : "请稍后重试"}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void planQuery.refetch()}>重试</Button>
        </div>
      ) : !plan ? (
        <div className="py-16 text-center text-destructive">计划不存在或已被删除。</div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CarFront className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">{plan.name}</h1>
          </div>

          <div className="mb-6"><StatRow stats={plan.stats} /></div>

          <Card className="mb-6">
            <CardContent className="flex flex-wrap items-end gap-3 py-4">
              <div className="min-w-[12rem] flex-1">
                <Label className="text-xs">把订阅加入本计划</Label>
                <select
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={subToAdd}
                  onChange={(e) => setSubToAdd(e.target.value)}
                >
                  <option value="">{available.length ? "选择一个正在续费的订阅…" : "没有可添加的订阅"}</option>
                  {available.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}（{formatMoney(s.price, s.currency)}/月）</option>
                  ))}
                </select>
              </div>
              <Button size="sm" disabled={!subToAdd || addMutation.isPending} onClick={() => addMutation.mutate(subToAdd)}>
                {addMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                添加
              </Button>
            </CardContent>
          </Card>

          {plan.subscriptions.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-muted-foreground">
              这个计划还没有订阅。用上面的下拉框把订阅加进来。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {plan.subscriptions.map((subscription) => (
                <CarCard key={subscription.id} subscription={subscription} onManage={() => startEditing(subscription)} />
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={editingSubId !== null} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        {/* explicit：编辑器里全是手输内容，误按 Esc / 点弹窗外面不能把整份草稿丢掉。 */}
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto" dismissMode="explicit">
          <DialogHeader>
            <DialogTitle>管理拼车{editingSubscription ? ` · ${editingSubscription.name}` : ""}</DialogTitle>
          </DialogHeader>
          {draft && editingSubscription ? (
            <CarpoolEditor
              draft={draft}
              currency={editingSubscription.currency}
              saving={saveMembersMutation.isPending}
              removing={removeMutation.isPending}
              cnyToCurrency={(cny) => round2(convert(cny, CNY, editingSubscription.currency))}
              onAccount={(account) => setDraft((c) => (c ? { ...c, account } : c))}
              onCardLast4={(cardLast4) => setDraft((c) => (c ? { ...c, cardLast4 } : c))}
              onToggleEnabled={(enabled) => setDraft((c) => (c ? { ...c, enabled } : c))}
              onSplitMode={(splitMode) => setDraft((c) => (c ? { ...c, splitMode } : c))}
              onAddMember={() => setDraft((c) => (c ? { ...c, members: [...c.members, newDraftMember()] } : c))}
              onRemoveMember={(memberKey) => setDraft((c) => (c ? { ...c, members: c.members.filter((m) => m.key !== memberKey) } : c))}
              onUpdateMember={updateMember}
              onRenewMember={(memberId) => renewMemberMutation.mutate({ subscriptionId: editingSubscription.id, memberId })}
              renewingMemberId={renewingMemberId}
              onRemoveFromPlan={() => { if (window.confirm(`把「${editingSubscription.name}」移出本计划？订阅本身不会被删除。`)) removeMutation.mutate(editingSubscription.id); }}
              onCancel={closeEditor}
              onSave={() => save(editingSubscription)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** 小轿车样式卡片：结构固定（车顶 + 车厢滚动 + 车底），整张卡片可点击进入管理。 */
function CarCard({ subscription: sub, onManage }: { subscription: CarpoolSubscription; onManage: () => void }) {
  const occupied = sub.enabled && sub.members.length > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onManage}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onManage(); } }}
      className="flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition hover:border-primary/60 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="bg-gradient-to-b from-primary/15 to-transparent px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CarFront className="h-5 w-5 shrink-0 text-primary" />
            <span className="truncate font-semibold">{sub.name}</span>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${occupied ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {occupied ? `拼车中·${sub.members.length}人` : "空车"}
          </span>
        </div>
        {sub.account || sub.cardLast4 ? (
          <div className="mt-2 space-y-1">
            {sub.account ? (
              <div className="flex items-center gap-1.5 text-xs">
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono" title={sub.account}>{sub.account}</span>
                <CopyButton value={sub.account} />
              </div>
            ) : null}
            {sub.cardLast4 ? (
              <div className="flex items-center gap-1.5 text-xs">
                <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">尾号 {sub.cardLast4}</span>
                <CopyButton value={sub.cardLast4} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="max-h-52 flex-1 space-y-1.5 overflow-y-auto px-4 pb-2">
        {sub.members.length > 0 ? (
          sub.members.map((member) => {
            const badge = expiryBadge(member);
            // 已过期的人不再显示「使用中」——否则同一行会同时挂着「使用中」和「已过期」两个互相矛盾的标签。
            const statusChip = member.status !== "active" ? STATUS_LABEL[member.status] : member.collectible ? STATUS_LABEL.active : null;
            return (
              <div key={member.id} className="border-t py-1.5 text-sm first:border-t-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{member.name}</span>
                    {statusChip ? <span className="shrink-0 rounded bg-muted px-1 text-[11px] text-muted-foreground">{statusChip}</span> : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    <span>{memberPayText(member, sub.currency)}</span>
                    {badge ? <span className={`rounded px-1 text-[11px] ${badge.className}`}>{badge.text}</span> : null}
                  </span>
                </div>
                {/* 固定两行：第一行微信、第二行邮箱，各占一行并截断超长内容，缺失时占位「—」，保证每张卡片等高。 */}
                <div className="mt-0.5 space-y-0.5 text-[11px] text-muted-foreground">
                  <div className="flex min-w-0 items-center gap-1">
                    <MessageCircle className="h-3 w-3 shrink-0" />
                    {member.wechat ? (
                      <>
                        <span className="truncate">{member.wechat}</span>
                        <CopyButton value={member.wechat} />
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                  <div className="flex min-w-0 items-center gap-1">
                    <Mail className="h-3 w-3 shrink-0" />
                    {member.email ? (
                      <>
                        <span className="truncate">{member.email}</span>
                        <CopyButton value={member.email} />
                      </>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="py-2 text-sm text-muted-foreground">还没有车友，点击卡片添加</p>
        )}
      </div>

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        总价 {formatMoney(sub.price, sub.currency)}/月 · 你承担 {formatMoney(sub.yourShare, sub.currency)}/月
      </div>
    </div>
  );
}
