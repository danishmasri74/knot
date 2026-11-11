import { useEffect, useRef, useState } from "react";
import { ShellIcon } from "./ShellIcon";

export function AnimatedFavorite({ favorite }: { favorite: boolean }) {
  const previous = useRef(favorite);
  const [motion, setMotion] = useState<"on" | "off" | null>(null);
  useEffect(() => {
    if (previous.current === favorite) return;
    previous.current = favorite;
    setMotion(favorite ? "on" : "off");
  }, [favorite]);
  return (
    <span
      className="animated-favorite"
      data-favorite={favorite}
      data-motion={motion ?? undefined}
      aria-hidden="true"
      onAnimationEnd={() => setMotion(null)}
    >
      <ShellIcon name="star" />
    </span>
  );
}
