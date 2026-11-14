"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type RefObject } from "react";
import { DOCK_TABS, type DockTab, type LabDockProps } from "@/components/dock/types";
import { PanelSkeleton } from "@/components/search/PanelSkeleton";
import { useSearchAvailability } from "@/components/search/shared";
import { Tabs } from "@/components/ui";
import { useCommonT } from "@/i18n/client";
import { useFeatures, type Features } from "@/lib/features";

const TAB_FLAG: Record<DockTab, "hw" | null> = {
  real: null,
  hardware: "hw",
};

const TAB_LABEL = {
  real: "dock.tabs.real",
  hardware: "dock.tabs.hardware",
} as const;

function tabShown(tab: DockTab, features: Features): boolean {
  const flag = TAB_FLAG[tab];
  return flag === null || features[flag] === true;
}

function isDockTab(value: string): value is DockTab {
  return (DOCK_TABS as readonly string[]).includes(value);
}

const loading = () => <PanelSkeleton />;
const HardwareTwinPanel = dynamic(() => import("@/components/hw/HardwareTwinPanel").then((m) => m.HardwareTwinPanel), { loading });
const RealBuildPanel = dynamic(() => import("@/components/search/RealBuildPanel").then((m) => m.RealBuildPanel), { loading });
const NearbyPanel = dynamic(() => import("@/components/search/NearbyPanel").then((m) => m.NearbyPanel), { loading });
const VideoHelp = dynamic(() => import("@/components/search/VideoHelp").then((m) => m.VideoHelp), { loading });

function RealTab(lab: LabDockProps) {
  const search = useSearchAvailability();
  return (
    <div className="flex flex-col gap-6 [&>*+*]:border-t [&>*+*]:border-rule [&>*+*]:pt-6">
      <RealBuildPanel {...lab} />
      {search === "off" ? null : (
        <>
          <NearbyPanel {...lab} />
          <VideoHelp {...lab} />
        </>
      )}
    </div>
  );
}

function TabBody({ tab, ...lab }: LabDockProps & { tab: DockTab }) {
  if (tab === "hardware") return <HardwareTwinPanel {...lab} />;
  return <RealTab {...lab} />;
}

type Props = LabDockProps & {
  open: boolean;
  phone: boolean;
  /** The desk drawer around the tabs; it takes focus when it opens. */
  drawerRef: RefObject<HTMLElement | null>;
};

/**
 * The dock's tabs and what they show. The dock loads this file when it is first opened, so the feature probe,
 * the keys store and the search code stay out of a lab page's first load.
 */
export function LabDockBody({ open, phone, drawerRef, ...lab }: Props) {
  const t = useCommonT();
  const { features } = useFeatures();
  const [tab, setTab] = useState<DockTab | null>(null);
  const [visited, setVisited] = useState<readonly DockTab[]>([]);
  const shown = DOCK_TABS.filter((id) => tabShown(id, features));
  const selected = tab && shown.includes(tab) ? tab : shown[0];
  // A panel's code is fetched the first time its tab is on screen, then it stays mounted.
  if (open && !visited.includes(selected)) setVisited([...visited, selected]);

  // On a desk the drawer takes focus when you open it.
  useEffect(() => {
    if (phone || !open) return;
    const frame = requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer || drawer.contains(document.activeElement)) return;
      drawer.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [phone, open, drawerRef]);

  const tabs = shown.map((id) => ({
    id,
    label: t(TAB_LABEL[id]),
    content: visited.includes(id) ? <TabBody {...lab} tab={id} /> : null,
  }));

  return (
    <Tabs
      label={t("dock.label")}
      tabs={tabs}
      value={selected}
      fill={!phone}
      phoneGrid={phone}
      onChange={(id) => {
        if (isDockTab(id) && shown.includes(id)) setTab(id);
      }}
    />
  );
}
