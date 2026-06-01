import { Image as ImageIcon, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaCandidateGrid } from "@/components/media-candidate-grid";
import { MediaCandidateViewport } from "@/components/media-candidate-viewport";
import type { MediaCandidate } from "@/lib/api/schemas/media";
import type { UseMediaCandidatesResult } from "@/hooks/use-media-candidates";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

interface MediaCandidateSearchPanelProps {
  search: UseMediaCandidatesResult;
  title?: string | undefined;
  placeholder: string;
  prompt: string;
  notFoundLabel: string;
  notFoundHint?: string | undefined;
  selectedValue?: string | null | undefined;
  onSelect: (candidate: MediaCandidate) => void;
  onClose?: (() => void) | undefined;
  size?: "sm" | "md" | undefined;
  columnsClassName?: string | undefined;
  panelClassName?: string | undefined;
  inputRowClassName?: string | undefined;
  inputClassName?: string | undefined;
  searchButtonClassName?: string | undefined;
  resultsClassName?: string | undefined;
  resultsContentClassName?: string | undefined;
  dataTestId?: string | undefined;
  showEmptyIcon?: boolean | undefined;
  autoFocus?: boolean | undefined;
}

export function MediaCandidateSearchPanel({
  search,
  title,
  placeholder,
  prompt,
  notFoundLabel,
  notFoundHint,
  selectedValue,
  onSelect,
  onClose,
  size = "md",
  columnsClassName = "grid-cols-4",
  panelClassName,
  inputRowClassName,
  inputClassName,
  searchButtonClassName,
  resultsClassName,
  resultsContentClassName,
  dataTestId,
  showEmptyIcon = false,
  autoFocus = true,
}: MediaCandidateSearchPanelProps) {
  const { t } = useI18n();
  const hasResults = search.candidates.builtIn.length > 0 || search.candidates.favicon.length > 0;
  const shouldShowResultsArea = hasResults || (!search.isSearching && search.hasSearched);

  return (
    <div className={cn("media-candidate-search-panel gap-3", panelClassName)}>
      {title || onClose ? (
        <div className="flex items-center justify-between">
          {title ? <span className="text-sm font-medium">{title}</span> : <span />}
          {onClose ? (
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={cn("flex items-center gap-2", inputRowClassName)}>
        <Input
          placeholder={placeholder}
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && search.search()}
          className={cn("flex-1 border-border bg-secondary", inputClassName)}
          autoFocus={autoFocus}
        />
        <Button
          type="button"
          size="sm"
          onClick={search.search}
          disabled={search.isSearching || !search.query.trim()}
          className={searchButtonClassName}
          aria-label={t("media.search")}
        >
          {search.isSearching ? (
            <Loader2 className={size === "sm" ? "h-3.5 w-3.5 animate-spin" : "h-4 w-4 animate-spin"} />
          ) : (
            <Search className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          )}
        </Button>
      </div>

      <MediaCandidateViewport
        className={cn("media-candidate-search-results", resultsClassName)}
        contentClassName={resultsContentClassName}
        dataTestId={dataTestId}
      >
        {search.isSearching && !hasResults ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className={size === "sm" ? "h-5 w-5 animate-spin text-primary" : "h-6 w-6 animate-spin text-primary"} />
            {size === "md" ? <span className="ml-2 text-sm text-muted-foreground">{t("media.searching")}</span> : null}
          </div>
        ) : null}

        {shouldShowResultsArea ? (
          <>
            <MediaCandidateGrid
              candidates={search.candidates}
              selectedValue={selectedValue}
              size={size}
              columnsClassName={columnsClassName}
              onSelect={onSelect}
              onError={(candidate) => search.removeCandidate(candidate.url)}
            />

            {search.isSearching && hasResults ? (
              <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin text-primary" />
                {t("media.loadingMore")}
              </div>
            ) : null}

            {!search.isSearching && search.hasSearched && !hasResults ? (
              <div className="py-2 text-center">
                {showEmptyIcon ? <ImageIcon className="mx-auto mb-2 h-10 w-10 text-muted-foreground/50" /> : null}
                <p className={cn(size === "sm" ? "text-xs" : "text-sm", "text-muted-foreground")}>{search.error ?? notFoundLabel}</p>
                {notFoundHint ? <p className="mt-1 text-xs text-muted-foreground">{notFoundHint}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}

        {!search.isSearching && !search.hasSearched ? (
          <p className="media-candidate-message py-2 text-center text-xs text-muted-foreground">{prompt}</p>
        ) : null}
      </MediaCandidateViewport>
    </div>
  );
}
