import { Skeleton, SkeletonGroup, cx } from "@/components/ui";
import { useCommonT } from "@/i18n/client";

/** Shown while a language's strings load: no text yet, so only the shape of a panel. */
export function PanelSkeleton({ className }: { className?: string }) {
  const t = useCommonT();
  return (
    <SkeletonGroup label={t("state.loading")} className={cx("space-y-3 p-1", className)}>
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-24" />
    </SkeletonGroup>
  );
}
