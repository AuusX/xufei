import { useCallback, useState } from "react";
import { useCreatePublicApiToken, useDeletePublicApiToken, usePublicApiTokens } from "@/hooks/use-public-api-tokens";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/I18nProvider";
import { getDisplayErrorMessage } from "@/lib/display-error";
import { copyTextToClipboard, type ClipboardCopyTarget } from "@/shared/browser/clipboard";
import type { ApiToken } from "@/lib/api/schemas/public-api";

export interface SettingsPublicApiController {
  tokens: ApiToken[];
  createdPlainToken: string | null;
  isLoading: boolean;
  isCreating: boolean;
  deletingTokenId: string | null;
  createToken: (name: string) => Promise<boolean>;
  copyPlainToken: (target?: ClipboardCopyTarget | null) => Promise<void>;
  dismissPlainToken: () => void;
  deleteToken: (id: string) => Promise<void>;
}

export function usePublicApiSettingsController(): SettingsPublicApiController {
  const { t } = useI18n();
  const { toast } = useToast();
  const tokensQuery = usePublicApiTokens();
  const createTokenMutation = useCreatePublicApiToken();
  const deleteTokenMutation = useDeletePublicApiToken();
  const [createdPlainToken, setCreatedPlainToken] = useState<string | null>(null);

  const createToken = useCallback(async (name: string) => {
    try {
      const response = await createTokenMutation.mutateAsync(name);
      // plainToken 是一次性明文，离开这一段 UI 后只能重新创建；不要写入 settings 草稿或持久缓存。
      setCreatedPlainToken(response.plainToken);
      toast({
        title: t("settings.publicApiCreated"),
        description: t("settings.publicApiCreatedDescription"),
      });
      return true;
    } catch (error) {
      toast({
        title: t("settings.publicApiCreateFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicApiCreateFailedDescription")),
        variant: "destructive",
      });
      return false;
    }
  }, [createTokenMutation, t, toast]);

  const copyPlainToken = useCallback(async (target?: ClipboardCopyTarget | null) => {
    if (!createdPlainToken) return;
    const copyResult = await copyTextToClipboard(createdPlainToken, { target });
    if (copyResult.ok) {
      toast({
        title: t("settings.publicApiTokenCopied"),
        description: t("settings.publicApiTokenCopiedDescription"),
      });
      return;
    }
    toast({
      title: t("settings.publicApiCopyFailed"),
      description: t("settings.publicApiCopyFailedDescription"),
      variant: "destructive",
    });
  }, [createdPlainToken, t, toast]);

  const deleteToken = useCallback(async (id: string) => {
    try {
      await deleteTokenMutation.mutateAsync(id);
      toast({
        title: t("settings.publicApiDeleted"),
        description: t("settings.publicApiDeletedDescription"),
      });
    } catch (error) {
      toast({
        title: t("settings.publicApiDeleteFailed"),
        description: getDisplayErrorMessage(error, t("settings.publicApiDeleteFailedDescription")),
        variant: "destructive",
      });
    }
  }, [deleteTokenMutation, t, toast]);

  return {
    tokens: tokensQuery.data ?? [],
    createdPlainToken,
    isLoading: tokensQuery.isLoading,
    isCreating: createTokenMutation.isPending,
    deletingTokenId: deleteTokenMutation.isPending ? deleteTokenMutation.variables ?? null : null,
    createToken,
    copyPlainToken,
    dismissPlainToken: () => setCreatedPlainToken(null),
    deleteToken,
  };
}
