import {
  readingOrder,
  sceneSummary,
  type Scene,
  type SceneObject,
} from "../features/editor/blocksuite/scene";

const kindLabel: Record<SceneObject["kind"], string> = {
  card: "Card",
  text: "Text",
  shape: "Shape",
  frame: "Section",
  mindmap: "Mind map",
};

/**
 * What a scene will add, before it's applied: the structure Ask Knot chose
 * (its plan), a count, and an outline of sections and what they hold.
 */
export function ScenePreview({ scene }: { scene: Scene }) {
  const titleOf = (o: SceneObject) =>
    o.text || (o.kind === "mindmap" ? o.nodes[0]?.text : "") || kindLabel[o.kind];
  const outline = (container: string, depth: number): React.ReactNode[] =>
    readingOrder(scene.objects.filter((o) => o.in === container)).flatMap((o) => [
      <li key={o.id} className="ask-scene-item" data-kind={o.kind} style={{ paddingLeft: depth * 14 }}>
        <span className="ask-scene-kind">{kindLabel[o.kind]}</span>
        <span>{titleOf(o)}</span>
      </li>,
      ...(o.kind === "frame" ? outline(o.id, depth + 1) : []),
    ]);
  return (
    <div className="ask-scene-preview">
      {scene.plan && <p className="ask-scene-plan">{scene.plan}</p>}
      <p className="ask-scene-count">Create {sceneSummary(scene)}.</p>
      <ul className="ask-scene-outline">{outline("", 0)}</ul>
    </div>
  );
}
