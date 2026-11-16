/**
 * Reroute points: small dots on the canvas that arrows pass through, so a
 * user can tidy crossing arrows or bundle several arrows into one. An arrow
 * through dots is stored as segments (A → • → • → B); this module reads the
 * segments back as the links the user means (A → B). It works on plain data
 * so it can be unit tested; reroute.ts applies it to the editor.
 */

export type Segment = {
  id: string;
  /** Element at the start, if attached; a dot or a real object. */
  from?: string;
  /** Element at the end, if attached. */
  to?: string;
  label: string;
  /** Arrowhead style at the start ("None" for no head). */
  front: string;
  /** Arrowhead style at the end. */
  rear: string;
};

export type Route = {
  /** The real object at the start, or undefined for a loose end. */
  from?: string;
  to?: string;
  /** The nearest label to the end; segments after a dot carry it. */
  label: string;
  front: string;
  rear: string;
  /** Dots passed through, in order. */
  via: string[];
  /** Segment IDs, in order. */
  segments: string[];
};

/** Enough for any canvas a person would tidy by hand. */
const MAX_ROUTES = 2000;

function index(segments: Segment[]) {
  const into = new Map<string, Segment[]>();
  const out = new Map<string, Segment[]>();
  for (const s of segments) {
    if (s.to) into.set(s.to, [...(into.get(s.to) ?? []), s]);
    if (s.from) out.set(s.from, [...(out.get(s.from) ?? []), s]);
  }
  return { into, out };
}

/**
 * The links segments make once dots are looked through. Each route starts
 * at a segment whose start isn't a dot (or at a dot nothing leads into) and
 * follows every branch to the first end that isn't a dot. A dot that leads
 * nowhere ends the route at a loose end. Cycles of dots are cut.
 */
export function resolveRoutes(segments: Segment[], dots: Set<string>): Route[] {
  const { into, out } = index(segments);
  const routes: Route[] = [];
  const walk = (path: Segment[], via: string[]) => {
    if (routes.length >= MAX_ROUTES) return;
    const last = path[path.length - 1];
    const next = last.to && dots.has(last.to) ? last.to : undefined;
    const onward = next && !via.includes(next) ? (out.get(next) ?? []) : [];
    if (next && onward.length) {
      for (const s of onward) walk([...path, s], [...via, next]);
      return;
    }
    const first = path[0];
    const label = [...path].reverse().find((s) => s.label)?.label ?? "";
    routes.push({
      from: first.from && !dots.has(first.from) ? first.from : undefined,
      to: last.to && !dots.has(last.to) ? last.to : undefined,
      label,
      front: first.front,
      rear: last.rear,
      via: next && !via.includes(next) ? [...via, next] : via,
      segments: path.map((s) => s.id),
    });
  };
  for (const s of segments) {
    const start = !s.from || !dots.has(s.from) || !(into.get(s.from)?.length);
    if (start) walk([s], s.from && dots.has(s.from) ? [s.from] : []);
  }
  return routes;
}

/**
 * The real objects reached from a dot or a segment, following arrows
 * forward ("target") or back ("source") through any dots.
 */
export function routeEnds(
  segments: Segment[],
  dots: Set<string>,
  start: string,
  direction: "target" | "source",
): string[] {
  const { into, out } = index(segments);
  const forward = direction === "target";
  const ends = new Set<string>();
  const seen = new Set<string>();
  const visitDot = (dot: string) => {
    if (seen.has(dot)) return;
    seen.add(dot);
    for (const s of (forward ? out : into).get(dot) ?? []) visitEnd(forward ? s.to : s.from);
  };
  const visitEnd = (id?: string) => {
    if (!id) return;
    if (dots.has(id)) visitDot(id);
    else ends.add(id);
  };
  if (dots.has(start)) visitDot(start);
  else {
    const segment = segments.find((s) => s.id === start);
    if (segment) visitEnd(forward ? segment.to : segment.from);
  }
  return [...ends];
}

/**
 * Rejoining a dot with more direct arrows than this removes its arrows
 * instead (undo brings them back); it only guards against huge fans.
 */
export const MAX_REJOINED = 50;

/**
 * What removing a dot does to its arrows: every arrow into it is joined to
 * every arrow out of it, so A → • → B becomes A → B and three arrows
 * bundled into one become three direct arrows. Joins above MAX_REJOINED,
 * and dots with arrows on one side only, leave nothing to join; their
 * arrows are removed with the dot.
 */
export function rejoinPlan(segments: Segment[], dot: string) {
  const incoming = segments.filter((s) => s.to === dot && s.from !== dot);
  const outgoing = segments.filter((s) => s.from === dot && s.to !== dot);
  const loops = segments.filter((s) => s.from === dot && s.to === dot);
  const count = incoming.length * outgoing.length;
  const joins =
    count && count <= MAX_REJOINED
      ? incoming.flatMap((a) => outgoing.map((b) => ({ incoming: a, outgoing: b })))
      : [];
  return {
    joins,
    /** Every segment touching the dot; all are removed. */
    remove: [...incoming, ...outgoing, ...loops].map((s) => s.id),
    /** True when arrows are removed without being joined. */
    dropped: count > MAX_REJOINED,
  };
}

/**
 * Dots that no longer route anything: no arrows, or arrows on one side only
 * (the object at the other end was deleted). Each comes with the segments
 * removed along with it.
 */
export function orphanDots(segments: Segment[], dots: Set<string>) {
  const { into, out } = index(segments);
  const orphans: { dot: string; remove: string[] }[] = [];
  for (const dot of dots) {
    const incoming = (into.get(dot) ?? []).filter((s) => s.from !== dot);
    const outgoing = (out.get(dot) ?? []).filter((s) => s.to !== dot);
    if (incoming.length && outgoing.length) continue;
    orphans.push({
      dot,
      remove: [...new Set([...(into.get(dot) ?? []), ...(out.get(dot) ?? [])].map((s) => s.id))],
    });
  }
  return orphans;
}

/**
 * Dots whose every route end is among `ids`, following chains of dots. When
 * those objects are rearranged, these dots would be left behind in the old
 * layout, so they are removed (their arrows rejoined) instead.
 */
export function dotsAmong(segments: Segment[], dots: Set<string>, ids: Set<string>) {
  const result: string[] = [];
  for (const dot of dots) {
    const ends = [
      ...routeEnds(segments, dots, dot, "target"),
      ...routeEnds(segments, dots, dot, "source"),
    ];
    if (ends.length && ends.every((id) => ids.has(id))) result.push(dot);
  }
  return result;
}
