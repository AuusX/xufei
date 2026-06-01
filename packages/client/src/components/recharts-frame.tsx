import type { ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface RechartsFrameProps {
  children: ReactNode;
  height: number;
  className?: string;
  testId?: string;
}

export function RechartsFrame({ children, height, className, testId }: RechartsFrameProps) {
  return (
    <div className={cn("recharts-frame min-w-0", className)} style={{ height }} data-testid={testId}>
      <ResponsiveContainer
        width="100%"
        height={height}
        minWidth={0}
        // Recharts 3 首轮默认尺寸是 -1/-1；正数初始尺寸能避免访问统计页时先打印尺寸 warning。
        initialDimension={{ width: height, height }}
        debounce={50}
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}
