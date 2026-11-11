import "../styles/mascot.css";

export function Mascot({
  mood,
  className = "",
}: {
  mood: "sleep" | "explore" | "write";
  className?: string;
}) {
  if (mood === "write") {
    return (
      <div
        className={`mascot-scene mascot-write ${className}`}
        aria-hidden="true"
      >
        {["body", "pencil", "eyes"].map((part) => (
          <img
            key={part}
            className={`writing-${part}`}
            src={`/mascot/writing-${part}.webp`}
            alt=""
            width={492}
            height={450}
            draggable={false}
          />
        ))}
      </div>
    );
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
