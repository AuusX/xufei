/**
 * 拼车通知设置弹窗（独立 webhook）+ 发送历史（含失败原因）。
 * 从 carpool-page.tsx 拆出，避免单文件过长。
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  fetchCarpoolNotification,
  fetchCarpoolNotificationLog,
  saveCarpoolNotification,
  testCarpoolNotification,
  type CarpoolNotification,
} from "@/custom/carpool/api";

const NOTIFICATION_KEY = ["carpool", "notification"] as const;
const NOTIFICATION_LOG_KEY = ["carpool", "notification", "log"] as const;
const SELECT_CLASS = "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const EMPTY_NOTIFICATION: CarpoolNotification = { enabled: false, webhookUrl: "", webhookMethod: "POST", webhookHeaders: "", webhookPayload: "" };

export function NotificationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: NOTIFICATION_KEY, queryFn: fetchCarpoolNotification, enabled: open });
  const logQuery = useQuery({ queryKey: NOTIFICATION_LOG_KEY, queryFn: fetchCarpoolNotificationLog, enabled: open });
  const [form, setForm] = useState<CarpoolNotification>(EMPTY_NOTIFICATION);
  /** 表单只在「本次打开」第一次拿到配置时灌入。 */
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (!open) {
      // 关闭即丢弃未保存的编辑：否则「取消」后再打开，之前放弃的内容还在，一保存就写进去了。
      setSeeded(false);
      setForm(EMPTY_NOTIFICATION);
      return;
    }
    // 后台刷新（窗口重新聚焦等）会产生新的 query.data 引用；不加这个闸门，正在输入的内容会被覆盖回旧值。
    if (!seeded && query.data) {
      setSeeded(true);
      setForm(query.data);
    }
  }, [open, query.data, seeded]);

  const refreshLog = () => void queryClient.invalidateQueries({ queryKey: NOTIFICATION_LOG_KEY });
  const saveMutation = useMutation({
    mutationFn: (config: CarpoolNotification) => saveCarpoolNotification(config),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEY }); toast.success("已保存拼车通知设置"); onOpenChange(false); },
    onError: (error: unknown) => toast.error("保存失败", { description: error instanceof Error ? error.message : "请重试" }),
  });
  const testMutation = useMutation({
    mutationFn: (config: CarpoolNotification) => testCarpoolNotification(config),
    onSuccess: () => { toast.success("测试通知已发送，请到 webhook 目标查收"); refreshLog(); },
    onError: (error: unknown) => { toast.error("测试失败", { description: error instanceof Error ? error.message : "请检查配置" }); refreshLog(); },
  });

  const update = (patch: Partial<CarpoolNotification>) => setForm((f) => ({ ...f, ...patch }));
  const log = logQuery.data ?? [];
  // 配置没读出来之前不许保存：表单此时是空的，保存会把线上正常的 webhook 覆盖成空配置。
  const configReady = query.isSuccess && seeded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* explicit：这里全是手输的 URL / 请求头 / 模板，误按 Esc 不能把没保存的内容丢掉。 */}
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" dismissMode="explicit">
        <DialogHeader><DialogTitle>设置拼车通知（Webhook）</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          拼车到期提醒走这里配置的 webhook（独立于系统订阅通知）。URL 必须是 <b>HTTPS</b> 且非内网/本机地址。
          提醒在**你所在时区的每天上午 9 点**推送。
        </p>
        {query.isError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            配置读取失败：{query.error instanceof Error ? query.error.message : "请稍后重试"}。为避免覆盖已有配置，保存已暂时禁用。
          </p>
        ) : null}
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.enabled} onCheckedChange={(v) => update({ enabled: v })} />
            启用拼车到期推送
          </label>
          <div>
            <Label className="text-xs">Webhook URL</Label>
            <Input value={form.webhookUrl} placeholder="https://example.com/webhook" onChange={(e) => update({ webhookUrl: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">请求方法</Label>
            <select className={SELECT_CLASS} value={form.webhookMethod} onChange={(e) => update({ webhookMethod: e.target.value === "GET" ? "GET" : "POST" })}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">请求头（JSON，可留空；值里也支持 {"{title}"} / {"{timestamp}"} 占位符，如 ntfy 的 Title 头）</Label>
            <Textarea rows={2} value={form.webhookHeaders} placeholder={'{"Title":"{title}","Content-Type":"text/plain"}'} onChange={(e) => update({ webhookHeaders: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">请求负载模板（可用 {"{title}"} / {"{content}"} 占位符）</Label>
            <Textarea rows={3} value={form.webhookPayload} placeholder={'{"text":"{title}\\n{content}"}'} onChange={(e) => update({ webhookPayload: e.target.value })} />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={testMutation.isPending || !form.webhookUrl.trim()} onClick={() => testMutation.mutate(form)}>
            {testMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Bell className="mr-1 h-4 w-4" />}
            发送测试
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
            <Button size="sm" disabled={saveMutation.isPending || !configReady} onClick={() => saveMutation.mutate(form)}>
              {saveMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              保存
            </Button>
          </div>
        </div>

        <div className="mt-4 border-t pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">发送历史</span>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={refreshLog}>刷新</Button>
          </div>
          {logQuery.isPending ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : logQuery.isError ? (
            // 「读不到记录」不能显示成「没有记录」——用户点开就是来看失败原因的。
            <p className="text-xs text-destructive">发送历史读取失败：{logQuery.error instanceof Error ? logQuery.error.message : "请稍后重试"}</p>
          ) : log.length === 0 ? (
            <p className="text-xs text-muted-foreground">还没有发送记录。配置好后点「发送测试」，或等到期提醒触发。</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {log.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2">
                  {entry.ok ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <span className="text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.context ? <span className="ml-2 text-muted-foreground">· {entry.context}</span> : null}
                    {!entry.ok && entry.error ? <div className="break-words text-destructive">{entry.error}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
