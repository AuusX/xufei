/**
 * 拼车栏目（/carpool）。
 *
 * 列出「正在续费」(active) 的订阅，把它们加入拼车：设置拼车成员、付款金额、上车时间、到期时间。
 * 成员与金额写入订阅的 cost_sharing（与「家庭共享」共用同一份数据，自动同步）；
 * 上车/到期时间存自定义 overlay 表。全部经 `/api/custom/carpool/*`，不改上游任何文件。
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CarFront, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Header } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCarpoolSubscriptions,
  saveCarpoolMembers,
  type CarpoolSplitMode,
  type CarpoolSubscription,
} from "@/custom/carpool/api";

const CARPOOL_QUERY_KEY = ["carpool", "subscriptions"] as const;

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

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useQuery({ queryKey: CARPOOL_QUERY_KEY, queryFn: fetchCarpoolSubscriptions });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const subscriptions = query.data ?? [];
  const summary = useMemo(() => {
    const active = subscriptions.filter((item) => item.enabled && item.members.length > 0);
    const recoverable = active.reduce(
      (sum, item) => sum + item.members.reduce((memberSum, member) => memberSum + member.amount, 0),
      0,
    );
    return { poolCount: active.length, recoverable };
  }, [subscriptions]);

  const mutation = useMutation({
    mutationFn: (variables: { id: string; input: Parameters<typeof saveCarpoolMembers>[1] }) =>
      saveCarpoolMembers(variables.id, variables.input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARPOOL_QUERY_KEY });
      setEditingId(null);
      setDraft(null);
      toast({ title: "已保存拼车信息" });
    },
    onError: (error: unknown) => {
      toast({
        title: "保存失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      });
    },
  });

  const startEditing = (subscription: CarpoolSubscription) => {
    setEditingId(subscription.id);
    setDraft(toDraft(subscription));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraft(null);
  };

  const updateMember = (key: string, patch: Partial<DraftMember>) => {
    setDraft((current) =>
      current
        ? { ...current, members: current.members.map((member) => (member.key === key ? { ...member, ...patch } : member)) }
        : current,
    );
  };

  const save = (subscriptionId: string) => {
    if (!draft) return;
    const members = draft.members
      .filter((member) => member.name.trim().length > 0)
      .map((member) => {
        const amount = Number.parseFloat(member.customAmount);
        return {
          ...(member.id ? { id: member.id } : {}),
          name: member.name.trim(),
          ...(draft.splitMode === "custom" && Number.isFinite(amount) ? { customAmount: amount } : {}),
          ...(member.joinDate ? { joinDate: member.joinDate } : {}),
          ...(member.expiryDate ? { expiryDate: member.expiryDate } : {}),
        };
      });
    mutation.mutate({ id: subscriptionId, input: { enabled: draft.enabled, splitMode: draft.splitMode, members } });
  };

  return (
    <>
      <Header />
      <main className="app-main mx-auto max-w-5xl px-4 pb-16">
        <div className="mb-6 mt-4 flex items-center gap-3">
          <CarFront className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">拼车</h1>
            <p className="text-sm text-muted-foreground">把正在续费的订阅拼给成员，管理付款金额、上车与到期时间。信息与「家庭共享」同步。</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-2xl font-semibold">{summary.poolCount}</div>
                <div className="text-xs text-muted-foreground">进行中的拼车</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-2xl font-semibold">{summary.recoverable.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground">成员应收合计（各订阅币种未折算）</div>
            </CardContent>
          </Card>
        </div>

        {query.isPending ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
          </div>
        ) : query.isError ? (
          <div className="py-16 text-center text-destructive">加载失败，请刷新重试。</div>
        ) : subscriptions.length === 0 ? (
          <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
            没有正在续费（active）的订阅。先在「订阅」页添加或激活订阅，再回到这里拼车。
          </div>
        ) : (
          <div className="space-y-4">
            {subscriptions.map((subscription) => (
              <Card key={subscription.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold">{subscription.name}</span>
                      {subscription.enabled && subscription.members.length > 0 ? (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">拼车中 · {subscription.members.length} 人</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      总价 {formatMoney(subscription.price, subscription.currency)} · 下次续费 {subscription.nextBillingDate?.slice(0, 10)} · 你承担 {formatMoney(subscription.yourShare, subscription.currency)}
                    </div>
                  </div>
                  {editingId === subscription.id ? null : (
                    <Button variant="outline" size="sm" onClick={() => startEditing(subscription)}>管理拼车</Button>
                  )}
                </CardHeader>

                <CardContent>
                  {editingId === subscription.id && draft ? (
                    <CarpoolEditor
                      draft={draft}
                      currency={subscription.currency}
                      saving={mutation.isPending}
                      onToggleEnabled={(enabled) => setDraft((current) => (current ? { ...current, enabled } : current))}
                      onSplitMode={(splitMode) => setDraft((current) => (current ? { ...current, splitMode } : current))}
                      onAddMember={() => setDraft((current) => (current ? { ...current, members: [...current.members, newDraftMember()] } : current))}
                      onRemoveMember={(key) => setDraft((current) => (current ? { ...current, members: current.members.filter((member) => member.key !== key) } : current))}
                      onUpdateMember={updateMember}
                      onCancel={cancelEditing}
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
      </main>
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
  onRemoveMember: (key: string) => void;
  onUpdateMember: (key: string, patch: Partial<DraftMember>) => void;
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
              <Input value={member.name} placeholder="姓名/备注" onChange={(event) => props.onUpdateMember(member.key, { name: event.target.value })} />
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
                onChange={(event) => props.onUpdateMember(member.key, { customAmount: event.target.value })}
              />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs">上车时间</Label>
              <Input type="date" value={member.joinDate} onChange={(event) => props.onUpdateMember(member.key, { joinDate: event.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">到期时间</Label>
              <Input type="date" value={member.expiryDate} onChange={(event) => props.onUpdateMember(member.key, { expiryDate: event.target.value })} />
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
