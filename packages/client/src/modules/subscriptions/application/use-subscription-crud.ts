/**
 * 订阅 CRUD application hook。
 *
 * 架构位置：
 * - React Query hooks 负责远端写入和缓存失效。
 * - 这里只管理页面层的编辑弹窗上下文，避免列表页重复处理编辑态。
 */
import { useState } from "react";
import {
  useCreateSubscription,
  useDeleteSubscription,
  useUpdateSubscription,
} from "@/hooks/use-subscriptions";
import { useDeferredDialogCleanup } from "@/hooks/use-deferred-dialog-cleanup";
import type { Subscription, SubscriptionDraft } from "@/types/subscription";

/** 订阅 CRUD 的页面级交互控制器。 */
export function useSubscriptionCrud(subscriptions: readonly Subscription[]) {
  const createSubscription = useCreateSubscription();
  const updateSubscription = useUpdateSubscription();
  const deleteSubscription = useDeleteSubscription();
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { scheduleCleanup: scheduleEditCleanup, cancelCleanup: cancelEditCleanup } = useDeferredDialogCleanup(() => {
    setEditingSubscription(null);
  });

  const handleAddSubscription = (newSubscription: SubscriptionDraft) => {
    createSubscription.mutate(newSubscription);
  };

  const handleDeleteSubscription = (id: string) => {
    deleteSubscription.mutate(id);
  };

  const handleEditSubscription = (id: string) => {
    // 编辑弹窗使用当前列表快照，避免额外请求；列表缓存由 mutations 成功后统一刷新。
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) return;
    cancelEditCleanup();
    setEditingSubscription(subscription);
    setEditDialogOpen(true);
  };

  const handleSaveSubscription = (updatedSubscription: Subscription) => {
    updateSubscription.mutate(updatedSubscription);
  };

  const handleEditDialogOpenChange = (nextOpen: boolean) => {
    setEditDialogOpen(nextOpen);
    if (nextOpen) {
      cancelEditCleanup();
      return;
    }
    scheduleEditCleanup();
  };

  return {
    editingSubscription,
    editDialogOpen,
    setEditDialogOpen,
    handleAddSubscription,
    handleDeleteSubscription,
    handleEditSubscription,
    handleSaveSubscription,
    handleEditDialogOpenChange,
  };
}
