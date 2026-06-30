import { renewletExportV1Schema, type RenewletExportAsset } from "@/lib/api/schemas/import-export";
import { getAuthHeader } from "@/lib/pocketbase";
import { downloadFile } from "@/shared/browser/download-file";
import type { CustomConfig } from "@/types/config";
import type { AppSettings, Subscription } from "@/types/subscription";
import {
  privateAssetIdFromLogo,
  sanitizeSettingsForExport,
  subscriptionToExportRow,
} from "./import-export-model";

/**
 * exportRenewletBackup 生成 Renewlet v1 ZIP 备份。
 *
 * data.json 是正式互导契约，manifest.json 只服务人工检查；私有资产会带认证读取后放入 assets/，
 * settings secret 默认剔除，只有用户显式选择时才进入备份。
 */
export async function exportRenewletBackup(options: {
  subscriptions: readonly Subscription[];
  settings: AppSettings;
  customConfig: CustomConfig;
  includeSecrets: boolean;
}) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const assets: RenewletExportAsset[] = [];
  const subscriptions = [];
  for (const subscription of options.subscriptions) {
    const row = subscriptionToExportRow(subscription);
    const assetId = privateAssetIdFromLogo(subscription.logo);
    if (assetId) {
      const asset = await fetchPrivateAsset(subscription.logo);
      if (asset) {
        const path = `assets/${assetId}${extensionFromMime(asset.type)}`;
        zip.file(path, asset);
        row.logo = path;
        assets.push({ id: assetId, path, mimeType: asset.type, sizeBytes: asset.size });
      }
    }
    subscriptions.push(row);
  }

  const exportedAt = new Date().toISOString();
  const data = renewletExportV1Schema.parse({
    kind: "renewlet-export",
    schemaVersion: 1,
    exportedAt,
    data: {
      subscriptions,
      settings: sanitizeSettingsForExport(options.settings, options.includeSecrets),
      customConfig: options.customConfig,
      assets,
    },
  });
  zip.file("manifest.json", JSON.stringify({
    kind: data.kind,
    schemaVersion: data.schemaVersion,
    exportedAt: data.exportedAt,
    subscriptions: data.data.subscriptions.length,
    assets: assets.length,
  }, null, 2));
  zip.file("data.json", JSON.stringify(data, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  downloadFile(blob, `renewlet-export-v1-${exportedAt.slice(0, 10)}.zip`);
}

async function fetchPrivateAsset(url: string | undefined): Promise<Blob | null> {
  if (!url) return null;
  try {
    // 导出私有资产必须复用当前认证头；裸 fetch 在 Cloudflare/PocketBase 两端都会丢登录态边界。
    const response = await fetch(url, {
      headers: getAuthHeader(),
      credentials: "include",
    });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("svg")) return ".svg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("jpeg")) return ".jpg";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("icon")) return ".ico";
  return "";
}
