"use client";

import { Button, Icon, Menu, type MenuItem } from "@/components/ui";
import type { Messages } from "@/i18n/namespaces";

export interface ProjectMenuProps {
  strings: Messages["studio"];
  /** False when no board of the project runs an Arduino sketch. */
  canExportIno: boolean;
  /** False for a project opened read-only. */
  canImportIno: boolean;
  onSaveFile(): void;
  onShare(): void;
  onExportIno(): void;
  onImportIno(): void;
  onImportWokwi(): void;
  onExportKicad(): void;
  onExportSpice(): void;
  onExportCsv(): void;
  onOpenHistory(): void;
  /** The classroom entries: making an assignment from this project, and grading what students handed in. */
  classroom: { makeLabel: string; gradeLabel: string; onMake(): void; onGrade(): void };
}

export function ProjectMenu({ strings, canExportIno, canImportIno, onSaveFile, onShare, onExportIno, onImportIno, onImportWokwi, onExportKicad, onExportSpice, onExportCsv, onOpenHistory, classroom }: ProjectMenuProps) {
  const items: MenuItem[] = [
    { id: "save", label: strings.projectMenu.saveFile, icon: "download", onSelect: onSaveFile },
    { id: "share", label: strings.projectMenu.share, icon: "share", onSelect: onShare },
    { id: "import", label: strings.ino.import, icon: "arrow-right", onSelect: onImportIno, disabled: !canImportIno },
    { id: "wokwi", label: strings.interop.menu.wokwi, icon: "arrow-right", onSelect: onImportWokwi, disabled: !canImportIno },
    { id: "ino", label: strings.ino.export, icon: "code", onSelect: onExportIno, disabled: !canExportIno },
    { id: "kicad", label: strings.interop.menu.kicad, icon: "board", onSelect: onExportKicad },
    { id: "spice", label: strings.interop.menu.spice, icon: "bolt", onSelect: onExportSpice },
    { id: "csv", label: strings.ino.wiringCsv, icon: "link", onSelect: onExportCsv },
    { separator: true },
    { id: "history", label: strings.projectMenu.history, icon: "rotate-left", onSelect: onOpenHistory },
    { separator: true },
    { id: "assignment", label: classroom.makeLabel, icon: "book", onSelect: classroom.onMake },
    { id: "grade", label: classroom.gradeLabel, icon: "people", onSelect: classroom.onGrade },
  ];

  return (
    <Menu
      label={strings.projectMenu.label}
      items={items}
      trigger={
        <Button variant="ghost" size="sm">
          {strings.projectMenu.label}
          <Icon name="chevron-down" size={16} aria-hidden="true" />
        </Button>
      }
    />
  );
}
