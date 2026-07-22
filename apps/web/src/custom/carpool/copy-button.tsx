/** 点击复制字段内容的小图标按钮（在可点击卡片内用 stopPropagation 阻止冒泡打开编辑器）。从 carpool-page.tsx 拆出。 */
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function CopyButton({ value }: { value: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      aria-label="复制"
      className="shrink-0 text-muted-foreground transition hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        if (!navigator.clipboard) {
          toast({ title: "复制失败", description: "浏览器不支持或非安全上下文", variant: "destructive" });
          return;
        }
        void navigator.clipboard.writeText(value).then(
          () => toast({ title: "已复制" }),
          () => toast({ title: "复制失败", variant: "destructive" }),
        );
      }}
    >
      <Copy className="h-3 w-3" />
    </button>
  );
}
