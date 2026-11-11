import { useId } from "react";
import { mascotParts } from "./mascot-parts";
import "../styles/mascot.css";

type ApprovedMood = "library" | "search" | "ask";

// Whole clean body plates avoid patch seams when the independently cropped
// props move. All layers stay registered to the original 1254px artwork.
const approvedEyes = {
  library: { left: 432, right: 844, y: 501 },
  search: { left: 442, right: 839, y: 518 },
  ask: { left: 417, right: 837, y: 503 },
} as const;

function PropShape({ mood }: { mood: "library" | "search" }) {
  if (mood === "library") {
    return (
      <>
        <path d="M466 628 Q451 626 446 647 L421 845 L421 956 L661 985 Q674 989 678 975 L741 680 Q747 663 730 660 Z" />
        {mascotParts.libraryHands.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </>
    );
  }
  return (
    <>
      {mascotParts.searchParts.map((d, i) => (
        <path key={i} d={d} />
      ))}
      <path d="M221 640 L274 637 L289 680 L303 697 L337 785 L364 838 Q369 857 351 872 Q327 889 309 869 L285 827 L239 700 Z" />
    </>
  );
}

// The pencil is the same raster layer used by the original writing mascot.
// This crop excludes its old hand so the new pose keeps its approved round hand.
function SharedPencil({ id }: { id: string }) {
  return (
    <>
      <defs>
        <clipPath id={`pencil-shaft-${id}`}>
          <path d="M142 238 Q148 235 153 239 Q156 244 158 250 L201 353 L203 369 L199 370 L184 354 L138 250 Q135 242 142 238 Z" />
        </clipPath>
      </defs>
      <image
        href="/mascot/writing-pencil.webp"
        width="492"
        height="450"
        clipPath={`url(#pencil-shaft-${id})`}
      />
    </>
  );
}

function ApprovedMascot({
  mood,
  className,
}: {
  mood: ApprovedMood;
  className: string;
}) {
  const id = useId().replace(/:/g, "");
  const eyes = approvedEyes[mood];
  const source = `/mascot/${mood}-approved.png`;
  return (
    <div
      className={`mascot-scene mascot-approved mascot-${mood} ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1254 1254" focusable="false">
        <defs>
          {mood !== "ask" && (
            <clipPath id={`mascot-prop-${id}`}>
              <PropShape mood={mood} />
            </clipPath>
          )}
          <clipPath id={`mascot-hand-${id}`}>
            <path d={mascotParts.askHand} />
          </clipPath>
          <clipPath id={`mascot-notebook-${id}`}>
            <rect x="0" y="845" width="421" height="409" />
          </clipPath>
          <clipPath id={`mascot-eyes-${id}`}>
            {[eyes.left, eyes.right].map((x) => (
              <ellipse
                key={x}
                cx={x}
                cy={eyes.y}
                rx="44"
                ry={mood === "search" ? 45 : 44}
              />
            ))}
          </clipPath>
        </defs>
        <g className="mascot-rig">
          <image
            href={`/mascot/${mood}-backing.png`}
            width="1254"
            height="1254"
          />
          {mood === "ask" ? (
            <>
              <path
                className="mascot-ink"
                d="M443 803 q8 -6 14 3 t14 3 t14 3"
                pathLength="1"
              />
              <g className="mascot-writing-hand">
                <g transform="translate(78 140) scale(1.8)">
                  <SharedPencil id={id} />
                </g>
                <image
                  href={source}
                  width="1254"
                  height="1254"
                  clipPath={`url(#mascot-hand-${id})`}
                />
              </g>
            </>
          ) : (
            <g
              className={
                mood === "library" ? "mascot-page-hands" : "mascot-glass-hand"
              }
            >
              {/* Complete the page corner originally hidden behind the blue
                  notebook, then put that stationary notebook in front again. */}
              {mood === "library" && (
                <path
                  d="M458 639 L733 671 L670 977 L402 945 Z"
                  fill="#eeedf4"
                  stroke="#222220"
                  strokeWidth="15"
                  strokeLinejoin="round"
                />
              )}
              <image
                href={source}
                width="1254"
                height="1254"
                clipPath={`url(#mascot-prop-${id})`}
              />
            </g>
          )}
          {mood === "library" && (
            <image
              href="/mascot/library-backing.png"
              width="1254"
              height="1254"
              clipPath={`url(#mascot-notebook-${id})`}
            />
          )}
          <g className="mascot-eye-gaze">
            <g
              className="mascot-blink-eyes"
              style={{ transformOrigin: `640px ${eyes.y}px` }}
            >
              <image
                href={source}
                width="1254"
                height="1254"
                clipPath={`url(#mascot-eyes-${id})`}
              />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function WritingMascot({ className }: { className: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div
      className={`mascot-scene mascot-write ${className}`}
      aria-hidden="true"
    >
      <img
        className="writing-body"
        src="/mascot/writing-body.webp"
        alt=""
        width="492"
        height="450"
        draggable={false}
      />
      <img
        className="writing-pencil"
        src="/mascot/writing-pencil.webp"
        alt=""
        width="492"
        height="450"
        draggable={false}
      />
      <svg className="writing-face" viewBox="0 0 492 450" focusable="false">
        {[176, 292].map((x) => (
          <g key={x} transform={`translate(${x} 215) scale(2.3)`}>
            <g className="writing-eyes">
              <image
                href="/mascot/writing-eyes.webp"
                x={-x}
                y="-215"
                width="492"
                height="450"
                clipPath={`url(#writing-eye-local-${id}-${x})`}
              />
              <defs>
                <clipPath id={`writing-eye-local-${id}-${x}`}>
                  <circle r="8" />
                </clipPath>
              </defs>
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function Mascot({
  mood,
  className = "",
}: {
  mood: "sleep" | "explore" | "write" | ApprovedMood;
  className?: string;
}) {
  if (mood === "library" || mood === "search" || mood === "ask") {
    return <ApprovedMascot mood={mood} className={className} />;
  }
  if (mood === "write") {
    return <WritingMascot className={className} />;
  }
  const sleeping = mood === "sleep";
  return (
    <div
      className={`mascot-scene mascot-${mood} ${className}`}
      aria-hidden="true"
    >
      <div className="mascot-sway">
        <img
          className="mascot-image"
          src={`/mascot/${sleeping ? "loading-rest" : "browser-explore"}.png`}
          alt=""
          width={sleeping ? 1312 : 1536}
          height={sleeping ? 1199 : 1024}
          draggable={false}
        />
      </div>
      <div className="mascot-particles">
        <i>{sleeping ? "Z" : ""}</i>
        <i>{sleeping ? "Z" : ""}</i>
        <i>{sleeping ? "Z" : ""}</i>
      </div>
    </div>
  );
}
