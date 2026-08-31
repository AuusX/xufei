/** 点击复制字段内容的小图标按钮（在可点击卡片内用 stopPropagation 阻止冒泡打开编辑器）。从 carpool-page.tsx 拆出。 */
import { Copy } from "lucide-react";
import { toast } from "@/components/ui/sonner";

export function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label="复制"
      className="shrink-0 text-muted-foreground transition hover:text-foreground"
      // 卡片整体也是可点击的，且它的 onKeyDown 会 preventDefault：不在这里拦住键盘事件的话，
      // Tab 过来按回车不会复制，反而会打开「管理拼车」弹窗。
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.stopPropagation(); }}
      onKeyUp={(e) => { if (e.key === " ") e.stopPropagation(); }}
      onClick={(e) => {
        e.stopPropagation();
        if (!navigator.clipboard) {
          toast.error("复制失败", { description: "浏览器不支持或非安全上下文" });
          return;
        }
        void navigator.clipboard.writeText(value).then(
          () => toast.success("已复制"),
          () => toast.error("复制失败"),
        );
      }}
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}
