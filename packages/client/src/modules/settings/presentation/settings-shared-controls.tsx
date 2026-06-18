import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { AppSettings } from '@/types/subscription';

export type UpdateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

export interface LoadingButtonContentProps {
  /** 控制是否显示加载层；原 children 会隐身保留尺寸，避免按钮宽度抖动。 */
  loading: boolean;
  loadingLabel: string;
  children: ReactNode;
}

/**
 * 保持按钮加载前后尺寸稳定的内容包装。
 *
 * 注意：settings 页面大量按钮在网格/弹窗 footer 中并排出现，加载时重新排版会放大移动端误触风险。
 */
export function LoadingButtonContent({ loading, loadingLabel, children }: LoadingButtonContentProps) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span
        aria-hidden={loading ? true : undefined}
        className={cn("inline-flex items-center justify-center gap-2", loading && "invisible")}
      >
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 inline-flex items-center justify-center gap-2" aria-live="polite">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </span>
      ) : null}
    </span>
  );
}

export interface CheckboxSettingRowProps {
  /** label 与控件的稳定关联 id；E2E 布局检查依赖这个显式 for/id 关系。 */
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  className?: string;
  disabled?: boolean;
}

/** 设置页复用的 checkbox 行，固定 label/control 间距并允许描述文本换行。 */
export function CheckboxSettingRow({
  id,
  checked,
  onCheckedChange,
  label,
  description,
  className,
  disabled = false,
}: CheckboxSettingRowProps) {
  return (
    <div className={cn('grid grid-cols-[auto_1fr] gap-x-3', className)}>
      <div className="flex h-5 items-center">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        />
      </div>
      <div className="min-w-0">
        <Label htmlFor={id} className={cn("flex h-5 items-center leading-5", disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer")}>
          {label}
        </Label>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
