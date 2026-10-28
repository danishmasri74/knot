import type { IntegrityReport } from "../services/workspace";

export function IntegrityPanel({
  report,
  busy,
  onClose,
  onCheck,
  onBackups,
}: {
  report: IntegrityReport;
  busy: boolean;
  onClose: () => void;
  onCheck: () => void;
  onBackups: () => void;
}) {
  return (
    <section
      className="recovery-panel integrity-panel"
      aria-label="Workspace integrity"
    >
      <h2>Workspace integrity</h2>
      <p>
        Checked {new Date(report.checked_at).toLocaleString()}. This report
        describes saved data at that time. No files were changed or removed.
      </p>
      <button disabled={busy} onClick={onCheck}>
        Check again
      </button>{" "}
      <button disabled={busy} onClick={onBackups}>
        Recovery backups
      </button>{" "}
      <button disabled={busy} onClick={onClose}>
        Close report
      </button>
      <p>
        {report.checked} asset records checked; {report.missing.length} missing,{" "}
        {report.corrupt.length} corrupt, {report.orphan_files.length} unindexed
        files.
      </p>
      <h3>Database and relationships</h3>
      {report.database_issues.length ? (
        <ul>
          {report.database_issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p>SQLite integrity and stored relationships passed.</p>
      )}
      <h3>Attachment issues</h3>
      {!report.affected_attachments.length && (
        <p>No missing or corrupt indexed attachments found.</p>
      )}
      {report.affected_attachments.map((asset) => (
        <details key={asset.key}>
          <summary>
            {report.missing.includes(asset.hash) ? "Missing" : "Corrupt"}:{" "}
            {asset.name} · {asset.documents.length} associated documents
          </summary>
          <p>
            Attachment key: <code>{asset.key}</code>
            <br />
            SHA-256: <code>{asset.hash}</code>
          </p>
          <ul>
            {asset.documents.map((doc) => (
              <li key={doc.id}>
                {doc.title}
                {doc.deleted ? " (in Trash)" : ""} · <code>{doc.id}</code>
              </li>
            ))}
          </ul>
          {!asset.documents.length && <p>No stored document associations.</p>}
        </details>
      ))}
      <p>
        Associations include retained import history and Trash; they do not
        prove an attachment is still visible in a document. Shared placements
        may display attachments from their source document.
      </p>
      <details>
        <summary>Unindexed files ({report.orphan_files.length})</summary>
        <p>
          Files found in the asset folder without a matching index entry at that
          location. They may be interrupted imports or recovery material. They
          are retained.
        </p>
        <ul>
          {report.orphan_files.map((file) => (
            <li key={file}>
              <code>{file}</code>
            </li>
          ))}
        </ul>
      </details>
      <p>
        For damaged or missing data, verify a known backup, then restore it into
        a separate workspace to inspect its content. The current workspace is
        retained. A new backup may fail if indexed attachments are damaged.
      </p>
      <p>
        This check does not decode document content or validate shared document
        targets. It scans indexed attachment bytes and files directly inside the
        asset folder and its immediate subfolders; nested folders and symbolic
        links are not audited.
      </p>
    </section>
  );
}
