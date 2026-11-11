/** Non-interactive placeholders shared by asynchronously populated lists. */
export function LoadingRows({
  label,
  rows = 4,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div className="loading-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="loading-row" aria-hidden="true" key={index}>
          <span className="loading-row-icon" />
          <span
            className="loading-row-text"
            style={{ width: `${60 + (index % 3) * 12}%` }}
          />
        </div>
      ))}
    </div>
  );
}
