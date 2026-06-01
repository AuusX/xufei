import { useEffect, useMemo, useState } from "react";
import { Drawer } from "vaul";
import { Filter, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface TagFilterChipProps {
  tag: string;
  selected: boolean;
  onToggle: () => void;
  className?: string;
}

interface SubscriptionTagFilterDrawerProps {
  tags: string[];
  selectedTags: string[];
  onApply: (tags: string[]) => void;
  className?: string;
}

interface SubscriptionTagFilterPopoverProps {
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  className?: string;
}

interface SelectedTagScrollerProps {
  selectedTags: string[];
  onRemoveTag: (tag: string) => void;
  className?: string;
  testId?: string;
}

function toggleTag(tags: string[], tag: string) {
  return tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag];
}

export function TagFilterChip({ tag, selected, onToggle, className }: TagFilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-foreground hover:border-primary/50 hover:bg-secondary/70",
        className,
      )}
      onClick={onToggle}
    >
      <span className="max-w-[10rem] truncate">{tag}</span>
    </button>
  );
}

function SelectedTagPill({ tag, onRemove }: { tag: string; onRemove: () => void }) {
  const { t } = useI18n();

  return (
    <span className="inline-flex h-9 shrink-0 items-center rounded-full border border-primary bg-primary/10 pl-3 pr-1 text-xs font-semibold text-primary">
      <span className="max-w-[8rem] truncate">{tag}</span>
      <button
        type="button"
        aria-label={t("subscription.tags.remove", { tag })}
        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

export function SelectedTagScroller({
  selectedTags,
  onRemoveTag,
  className,
  testId = "mobile-selected-tags",
}: SelectedTagScrollerProps) {
  const { t } = useI18n();

  if (selectedTags.length === 0) {
    return null;
  }

  return (
    <div
      data-testid={testId}
      className={cn(
        "min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      aria-label={t("subscriptions.tags.selectedCount", { count: selectedTags.length })}
    >
      <div className="flex w-max gap-2 pr-1">
        {selectedTags.map((tag) => (
          <SelectedTagPill key={tag} tag={tag} onRemove={() => onRemoveTag(tag)} />
        ))}
      </div>
    </div>
  );
}

export function SubscriptionTagFilterPopover({
  tags,
  selectedTags,
  onToggleTag,
  onClearTags,
  className,
}: SubscriptionTagFilterPopoverProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  const visibleTags = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tags;
    return tags.filter((tag) => tag.toLowerCase().includes(query));
  }, [searchQuery, tags]);
  const triggerLabel =
    selectedTags.length > 0
      ? t("subscriptions.tags.selectedCount", { count: selectedTags.length })
      : t("subscriptions.tags.open");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("shrink-0", className)} data-testid="desktop-tag-filter">
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-10 shrink-0 border-border bg-secondary px-3">
            <Filter className="h-4 w-4" />
            <span>{triggerLabel}</span>
          </Button>
        </PopoverTrigger>
      </div>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden border-border bg-popover p-0 text-popover-foreground"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("subscriptions.tags.drawerTitle")}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-2 h-8 w-8 text-muted-foreground"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("common.close")}</span>
          </Button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("subscriptions.tags.searchPlaceholder")}
              className="h-10 border-border bg-secondary pl-10"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto p-4">
          {visibleTags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {visibleTags.map((tag) => (
                <TagFilterChip
                  key={tag}
                  tag={tag}
                  selected={selectedTags.includes(tag)}
                  onToggle={() => onToggleTag(tag)}
                  className="min-h-9 px-3 text-sm"
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 px-4 text-center text-sm text-muted-foreground">
              {t("subscriptions.tags.emptyMatch")}
            </div>
          )}
        </div>

        {selectedTags.length > 0 && (
          <div className="flex justify-end border-t border-border bg-card px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              className="h-9 text-muted-foreground"
              onClick={onClearTags}
            >
              {t("subscriptions.tags.clearSelection")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SubscriptionTagFilterDrawer({
  tags,
  selectedTags,
  onApply,
  className,
}: SubscriptionTagFilterDrawerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draftTags, setDraftTags] = useState(selectedTags);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftTags(selectedTags);
    setSearchQuery("");
  }, [open, selectedTags]);

  const visibleTags = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tags;
    return tags.filter((tag) => tag.toLowerCase().includes(query));
  }, [searchQuery, tags]);
  const canClearTags = selectedTags.length > 0 || draftTags.length > 0;
  const triggerLabel =
    selectedTags.length > 0
      ? t("subscriptions.tags.selectedCount", { count: selectedTags.length })
      : t("subscriptions.tags.open");

  return (
    <Drawer.Root open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
      <div className={cn("shrink-0", className)} data-testid="mobile-tag-filter">
        <Drawer.Trigger asChild>
          <Button variant="outline" className="h-11 shrink-0 border-border bg-secondary px-3">
            <Filter className="h-4 w-4" />
            <span>{triggerLabel}</span>
          </Button>
        </Drawer.Trigger>
      </div>

      {open && (
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Drawer.Content className="h5-drawer-panel fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-border bg-card text-card-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4">
            <div className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted" />

            <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
              <div>
                <Drawer.Title className="text-base font-semibold text-foreground">
                  {t("subscriptions.tags.drawerTitle")}
                </Drawer.Title>
                <Drawer.Description className="sr-only">
                  {t("subscriptions.tags.drawerTitle")}
                </Drawer.Description>
              </div>
              <Drawer.Close asChild>
                <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-9 w-9 text-muted-foreground">
                  <X className="h-4 w-4" />
                  <span className="sr-only">{t("common.close")}</span>
                </Button>
              </Drawer.Close>
            </div>

            <div className="px-5 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("subscriptions.tags.searchPlaceholder")}
                  className="h-11 border-border bg-secondary pl-10"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
              {visibleTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {visibleTags.map((tag) => (
                    <TagFilterChip
                      key={tag}
                      tag={tag}
                      selected={draftTags.includes(tag)}
                      onToggle={() => setDraftTags((current) => toggleTag(current, tag))}
                      className="min-h-11 px-3 text-sm"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border bg-secondary/40 px-4 text-center text-sm text-muted-foreground">
                  {t("subscriptions.tags.emptyMatch")}
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-border bg-card px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {canClearTags && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 shrink-0 text-muted-foreground"
                  onClick={() => {
                    onApply([]);
                    setOpen(false);
                  }}
                >
                  {t("subscriptions.tags.clearSelection")}
                </Button>
              )}
              <Button
                type="button"
                className="h-11 flex-1 bg-primary text-primary-foreground hover:bg-primary-glow"
                onClick={() => {
                  onApply(draftTags);
                  setOpen(false);
                }}
              >
                {t("subscriptions.tags.apply")}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      )}
    </Drawer.Root>
  );
}
