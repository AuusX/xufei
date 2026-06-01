import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MediaCandidateViewportProps {
  children: ReactNode;
  className?: string | undefined;
  contentClassName?: string | undefined;
  dataTestId?: string | undefined;
}

export function MediaCandidateViewport({
  children,
  className,
  contentClassName,
  dataTestId,
}: MediaCandidateViewportProps) {
  return (
    <div className={cn("media-candidate-scroll-viewport", className)} data-testid={dataTestId}>
      <div className={cn("media-candidate-scroll-content", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
