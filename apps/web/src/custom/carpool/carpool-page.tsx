/**
 * 拼车栏目（/carpool）。
 *
 * 两个视图（内部 state 切换，不新增路由）：
 *  1. 计划列表：管理员创建拼车计划（如 TEAM 计划），每个计划卡片显示 总车数/进行中/空车/成员应收合计。
 *  2. 计划详情：勾选属于该计划的订阅（每个订阅=一辆车），逐订阅管理拼车成员（付款金额/上车/到期时间）。
 *
 * 成员/金额写入订阅的 cost_sharing（与「家庭共享」共用同一份数据，自动同步）；上车/到期时间存自定义
 * overlay 表；计划分组存自定义 plan 表。全部经 `/api/custom/carpool/*`，不改上游任何文件。
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, ChevronLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  addSubscriptionToPlan,
  createCarpoolPlan,
  deleteCarpoolPlan,
  fetchCarpoolPlanDetail,
  fetchCarpoolPlans,
  fetchCarpoolSubscriptions,
  removeSubscriptionFromPlan,
  saveCarpoolMembers,
  type CarpoolPlanStats,
  type CarpoolSplitMode,
  type CarpoolSubscription,
} from "@/custom/carpool/api";

const PLANS_KEY = ["carpool", "plans"] as const;
const ACTIVE_SUBS_KEY = ["carpool", "active-subscriptions"] as const;
const planKey = (planId: string) => ["carpool", "plan", planId] as const;

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

interface DraftMember {
  key: string;
  id?: string;
  name: string;
  customAmount: string;
  joinDate: string;
  expiryDate: string;
}

interface Draft {
  enabled: boolean;
  splitMode: CarpoolSplitMode;
  members: DraftMember[];
}

function newDraftMember(): DraftMember {
  return { key: crypto.randomUUID(), name: "", customAmount: "", joinDate: "", expiryDate: "" };
}

function toDraft(subscription: CarpoolSubscription): Draft {
  return {
    enabled: subscription.enabled,
    splitMode: subscription.splitMode,
    members: subscription.members.map((member) => ({
      key: member.id,
      id: member.id,
      name: member.name,
      customAmount: member.customAmount != null ? String(member.customAmount) : "",
      joinDate: member.joinDate ?? "",
      expiryDate: member.expiryDate ?? "",
    })),
  };
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

/** 四项统计的展示栏。 */
function StatRow({ stats }: { stats: CarpoolPlanStats }) {
  const items: Array<{ label: string; value: string; accent?: boolean }> = [
    { label: "总车数", value: String(stats.totalCars) },
    { label: "进行中的拼车", value: String(stats.activeCars), accent: true },
    { label: "空车", value: String(stats.emptyCars) },
    { label: "成员应收合计", value: stats.receivableTotal.toFixed(2) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card px-3 py-2">
          <div className={`text-xl font-semibold ${item.accent ? "text-primary" : ""}`}>{item.value}</div>
          <div className="text-xs text-muted-foreground">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- 计划列表 ----------------

function PlanListView({ onOpenPlan }: { onOpenPlan: (planId: string) => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey: PLANS_KEY, queryFn: fetchCarpoolPlans });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const createMutation = useMutation({
    mutationFn: (planName: string) => createCarpoolPlan(planName),
    onSuccess: (plan) => {
      void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
      setCreating(false);
      setName("");
      if (plan) onOpenPlan(plan.id);
    },
    onError: (error: unknown) =>
      toast({ title: "创建失败", description: error instanceof Error ? error.message : "请重试", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deleteCarpoolPlan(planId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: PLANS_KEY }),
    onError: (error: unknown) =>
      toast({ title: "删除失败", description: error instanceof Error ? error.message : "请重试", variant: "destructive" }),
  });

  const plans = query.data ?? [];

  return (
    <>
      <div className="mb-6 mt-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CarFront className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">拼车</h1>
            <p className="text-sm text-muted-foreground">创建拼车计划（如 TEAM 计划），把要拼的订阅归到计划里管理。</p>
          </div>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> 创建拼车计划
          </Button>
        )}
      </div>

      {creating && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <div className="min-w-[12rem] flex-1">
              <Label className="text-xs">计划名称</Label>
              <Input autoFocus value={name} placeholder="例如：TEAM 计划" onChange={(e) => setName(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={createMutation.isPending || name.trim().length === 0}
              onClick={() => createMutation.mutate(name.trim())}
            >
              {createMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              创建
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setName(""); }}>
              取消
            </Button>
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
    </>
  );
}

// ---------------- 计划详情 ----------------

function PlanDetailView({ planId, onBack }: { planId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const planQuery = useQuery({ queryKey: planKey(planId), queryFn: () => fetchCarpoolPlanDetail(planId) });
  const activeSubsQuery = useQuery({ queryKey: ACTIVE_SUBS_KEY, queryFn: fetchCarpoolSubscriptions });
  const [subToAdd, setSubToAdd] = useState("");
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: planKey(planId) });
    void queryClient.invalidateQueries({ queryKey: PLANS_KEY });
  };
  const onMutationError = (title: string) => (error: unknown) =>
    toast({ title, description: error instanceof Error ? error.message : "请重试", variant: "destructive" });

  const addMutation = useMutation({
    mutationFn: (subscriptionId: string) => addSubscriptionToPlan(planId, subscriptionId),
    onSuccess: () => { invalidate(); setSubToAdd(""); },
    onError: onMutationError("添加订阅失败"),
  });
  const removeMutation = useMutation({
    mutationFn: (subscriptionId: string) => removeSubscriptionFromPlan(planId, subscriptionId),
    onSuccess: invalidate,
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
    onSuccess: () => { invalidate(); setEditingSubId(null); setDraft(null); toast({ title: "已保存拼车信息" }); },
    onError: onMutationError("保存失败"),
  });

  const startEditing = (subscription: CarpoolSubscription) => { setEditingSubId(subscription.id); setDraft(toDraft(subscription)); };
  const updateMember = (memberKey: string, patch: Partial<DraftMember>) =>
    setDraft((current) => (current ? { ...current, members: current.members.map((m) => (m.key === memberKey ? { ...m, ...patch } : m)) } : current));
  const save = (subscriptionId: string) => {
    if (!draft) return;
    const members = draft.members
      .filter((m) => m.name.trim().length > 0)
      .map((m) => {
        const amount = Number.parseFloat(m.customAmount);
        return {
          ...(m.id ? { id: m.id } : {}),
          name: m.name.trim(),
          ...(draft.splitMode === "custom" && Number.isFinite(amount) ? { customAmount: amount } : {}),
          ...(m.joinDate ? { joinDate: m.joinDate } : {}),
          ...(m.expiryDate ? { expiryDate: m.expiryDate } : {}),
        };
      });
    saveMembersMutation.mutate({ id: subscriptionId, input: { enabled: draft.enabled, splitMode: draft.splitMode, members } });
  };

  const plan = planQuery.data;
  const planSubIds = new Set((plan?.subscriptions ?? []).map((s) => s.id));
  const available = (activeSubsQuery.data ?? []).filter((s) => !planSubIds.has(s.id));

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
      ) : !plan ? (
        <div className="py-16 text-center text-destructive">计划不存在或已被删除。</div>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <CarFront className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">{plan.name}</h1>
          </div>

          <div className="mb-6">
            <StatRow stats={plan.stats} />
          </div>

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
                    <option key={s.id} value={s.id}>
                      {s.name}（{formatMoney(s.price, s.currency)}）
                    </option>
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
            <div className="space-y-4">
              {plan.subscriptions.map((subscription) => (
                <Card key={subscription.id}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-base font-semibold">{subscription.name}</span>
                        {subscription.enabled && subscription.members.length > 0 ? (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">拼车中 · {subscription.members.length} 人</span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">空车</span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        总价 {formatMoney(subscription.price, subscription.currency)} · 下次续费 {subscription.nextBillingDate?.slice(0, 10)} · 你承担 {formatMoney(subscription.yourShare, subscription.currency)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {editingSubId === subscription.id ? null : (
                        <Button variant="outline" size="sm" onClick={() => startEditing(subscription)}>管理拼车</Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="移出计划"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(subscription.id)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editingSubId === subscription.id && draft ? (
                      <CarpoolEditor
                        draft={draft}
                        currency={subscription.currency}
                        saving={saveMembersMutation.isPending}
                        onToggleEnabled={(enabled) => setDraft((c) => (c ? { ...c, enabled } : c))}
                        onSplitMode={(splitMode) => setDraft((c) => (c ? { ...c, splitMode } : c))}
                        onAddMember={() => setDraft((c) => (c ? { ...c, members: [...c.members, newDraftMember()] } : c))}
                        onRemoveMember={(memberKey) => setDraft((c) => (c ? { ...c, members: c.members.filter((m) => m.key !== memberKey) } : c))}
                        onUpdateMember={updateMember}
                        onCancel={() => { setEditingSubId(null); setDraft(null); }}
                        onSave={() => save(subscription.id)}
                      />
                    ) : subscription.members.length > 0 ? (
                      <ul className="divide-y text-sm">
                        {subscription.members.map((member) => (
                          <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span className="font-medium">{member.name}</span>
                            <span className="flex items-center gap-4 text-muted-foreground">
                              <span>{formatMoney(member.amount, subscription.currency)}</span>
                              <span>上车 {member.joinDate ?? "—"}</span>
                              <span>到期 {member.expiryDate ?? "—"}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">还没有拼车成员。点击「管理拼车」添加。</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

interface CarpoolEditorProps {
  draft: Draft;
  currency: string;
  saving: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onSplitMode: (mode: CarpoolSplitMode) => void;
  onAddMember: () => void;
  onRemoveMember: (memberKey: string) => void;
  onUpdateMember: (memberKey: string, patch: Partial<DraftMember>) => void;
  onCancel: () => void;
  onSave: () => void;
}

function CarpoolEditor(props: CarpoolEditorProps) {
  const { draft, currency, saving } = props;
  return (
    <div className="space-y-4">
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

      <div className="space-y-3">
        {draft.members.map((member) => (
          <div key={member.key} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-3">
              <Label className="text-xs">成员</Label>
              <Input value={member.name} placeholder="姓名/备注" onChange={(e) => props.onUpdateMember(member.key, { name: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs">付款金额 ({currency})</Label>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                disabled={draft.splitMode !== "custom"}
                value={member.customAmount}
                placeholder={draft.splitMode === "custom" ? "0.00" : "均摊自动计算"}
                onChange={(e) => props.onUpdateMember(member.key, { customAmount: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs">上车时间</Label>
              <Input type="date" value={member.joinDate} onChange={(e) => props.onUpdateMember(member.key, { joinDate: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">到期时间</Label>
              <Input type="date" value={member.expiryDate} onChange={(e) => props.onUpdateMember(member.key, { expiryDate: e.target.value })} />
            </div>
            <div className="sm:col-span-1 sm:pb-1">
              <Button variant="ghost" size="icon" aria-label="删除成员" onClick={() => props.onRemoveMember(member.key)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={props.onAddMember}>
          <Plus className="mr-1 h-4 w-4" /> 添加成员
        </Button>
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
