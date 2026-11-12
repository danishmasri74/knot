import { useId, type HTMLAttributes, type ReactNode } from "react";
import { ShellIcon } from "./ShellIcon";
import type { KnowledgeObject } from "../services/workspace";

export function Favorites({
  items,
  renderNotebook,
  dropProps,
  dropIndicator,
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: KnowledgeObject[];
  dropProps?: HTMLAttributes<HTMLElement>;
  dropIndicator?: string;
  renderNotebook: (item: KnowledgeObject) => ReactNode;
}) {
  const id = useId();
  return (
    <section
      className="collection-group favorites-group"
      aria-label="Favorites"
      {...dropProps}
    >
      <div className="collection-group-heading" data-drop={dropIndicator}>
        <button
          className="collection-group-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => onOpenChange(!open)}
        >
          <span className="collection-chevron" aria-hidden="true">
            <ShellIcon name="chevron" />
          </span>
          <span className="collection-name">Favorites</span>
        </button>
      </div>
      <div id={id} className="collection-group-notebooks" hidden={!open}>
        {!items.length && (
          <p className="sidebar-empty-state">Star a notebook to keep it here</p>
        )}
        {items.map(renderNotebook)}
      </div>
    </section>
  );
}
