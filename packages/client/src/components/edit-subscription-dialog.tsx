/**
 * 编辑订阅弹窗适配器。
 *
 * 架构位置：
 * - 页面控制器持有 editingSubscription/open 状态。
 * - 本组件只把编辑模式参数转发给通用 SubscriptionDialog，避免新增/编辑表单分叉。
 */
import { SubscriptionDialog } from "@/components/subscription-dialog";
import type { Subscription } from "@/types/subscription";

interface EditSubscriptionDialogProps {
  /** 当前正在编辑的订阅（null 表示未选中）。 */
  subscription: Subscription | null;
  /** 弹窗是否打开。 */
  open: boolean;
  /** 弹窗开关回调（由上层控制）。 */
  onOpenChange: (open: boolean) => void;
  /** 保存回调（回传完整 Subscription）。 */
  onSave: (subscription: Subscription) => void;
  /** 当前用户已有标签建议。 */
  availableTags?: readonly string[] | undefined;
}

/** 以 edit mode 渲染通用订阅弹窗。 */
export function EditSubscriptionDialog({ subscription, open, onOpenChange, onSave, availableTags }: EditSubscriptionDialogProps) {
  return (
    <SubscriptionDialog
      mode="edit"
      open={open}
      onOpenChange={onOpenChange}
      subscription={subscription}
      onSubmit={onSave}
      availableTags={availableTags}
    />
  );
}
