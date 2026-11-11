import { useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { ShellIcon } from "./ShellIcon";
import type { KnowledgeObject } from "../services/workspace";

export function Favorites({
  items,
  renderNotebook,
  dropProps,
  dropIndicator,
}: {
  items: KnowledgeObject[];
  dropProps?: HTMLAttributes<HTMLElement>;
  dropIndicator?: string;
  renderNotebook: (item: KnowledgeObject) => ReactNode;
}) {
  const [open, setOpen] = useState(true);
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
          onClick={() => setOpen(!open)}
        >
          <span className="collection-chevron" aria-hidden="true">
            <ShellIcon name="chevron" />
          </span>
          <span className="collection-name">Favorites</span>
        </button>
      </div>
      <div id={id} className="collection-group-notebooks" hidden={!open}>
        {!items.length && (
          <div className="sidebar-empty-state">
            <ShellIcon name="star" />
            <span>No favorites</span>
          </div>
        )}
        {items.map(renderNotebook)}
      </div>
    </section>
  );
}
