//! Model-facing compaction of note context.
//!
//! The renderer freezes a full context (plain `text`, `structure` blocks and a
//! `citationSources` table that repeats every block with its document ID and
//! title). That frozen copy stays the authority for citation resolution and is
//! stored unchanged. Only the copy sent to the provider is compacted here: each
//! note block appears once, as a line led by its citation marker.
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// Appended to the instructions only when a context was compacted.
pub(crate) const COMPACT_INSTRUCTIONS: &str = "noteSources holds the cited note blocks: per note, one line per block in order, starting with its citation marker; cite a block by copying that marker. Indentation shows nesting; leading #, -, 1., [ ]/[x], > and code: show heading, list, checklist, quote and code formatting, and block text can state status too. '--- note N ---' separates canvas notes; deeper-indented lines continue the block above. citationSources then lists only website passages.";

/// Appended for edit operations when a context was compacted.
pub(crate) const COMPACT_EDIT_INSTRUCTIONS: &str = "Never copy noteSources line markers such as #, -, 1., [ ] or [x] into generated text; express structure with native block types.";

/// Fields a note citation entry may carry and still be compacted losslessly for
/// the model. `revision` is an internal staleness token the model never needs.
const NOTE_FIELDS: [&str; 13] = [
    "id", "parent", "note", "type", "checked", "text", "document", "title",
    "citation", "kind", "webSource", "attribution", "revision",
];

fn marker(kind: &str, checked: bool) -> String {
    match kind {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => "#".repeat(kind[1..].parse().unwrap_or(1)),
        "bulleted" => "-".into(),
        "numbered" => "1.".into(),
        "todo" if checked => "[x]".into(),
        "todo" => "[ ]".into(),
        "quote" => ">".into(),
        "code" => "code:".into(),
        "" | "text" | "paragraph" | "affine:paragraph" => String::new(),
        other => format!("({other})"),
    }
}

fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn is_note(entry: &Value) -> bool {
    matches!(entry.get("kind"), None | Some(Value::Null)) || str_field(entry, "kind") == Some("note")
}

/// Renders consecutive entries of one document as marker-led lines.
fn render(entries: &[&Value]) -> String {
    let mut depth: HashMap<&str, usize> = HashMap::new();
    let notes: HashSet<Option<&str>> = entries.iter().map(|e| str_field(e, "note")).collect();
    let (mut lines, mut previous_note, mut note_index) = (Vec::new(), None, 0);
    for (index, entry) in entries.iter().enumerate() {
        let note = str_field(entry, "note");
        if notes.len() > 1 && (index == 0 || note != previous_note) {
            note_index += 1;
            lines.push(format!("--- note {note_index} ---"));
        }
        previous_note = note;
        let level = str_field(entry, "parent")
            .and_then(|parent| depth.get(parent))
            .map_or(0, |d| d + 1);
        if let Some(id) = str_field(entry, "id") {
            depth.insert(id, level);
        }
        let kind = marker(
            str_field(entry, "type").unwrap_or_default(),
            entry.get("checked").and_then(Value::as_bool).unwrap_or(false),
        );
        let continuation = format!("\n{}", " ".repeat(level * 2 + 4));
        let text = str_field(entry, "text").unwrap_or_default().replace('\n', &continuation);
        let citation = str_field(entry, "citation").unwrap_or_default();
        let mut line = format!(
            "{}{}{}{}",
            if citation.is_empty() { String::new() } else { format!("{citation} ") },
            "  ".repeat(level),
            if kind.is_empty() { String::new() } else { format!("{kind} ") },
            text
        );
        for (key, label) in [("attribution", "attribution"), ("webSource", "saved web source")] {
            if let Some(extra) = str_field(entry, key) {
                line.push_str(&format!("{continuation}{label}: {}", extra.replace('\n', &continuation)));
            }
        }
        // Keep block text verbatim (including edge spaces); trim only an empty line's marker gap.
        if text.is_empty() {
            line = line.trim_end().to_owned();
        }
        lines.push(line);
    }
    lines.join("\n")
}

/// Returns a compacted copy of a note context, or `None` when the context has
/// no note citations or carries anything this format would not preserve.
pub(crate) fn compact(context: &str) -> Option<String> {
    let mut value: Value = serde_json::from_str(context).ok()?;
    let object = value.as_object_mut()?;
    if str_field(&Value::Object(object.clone()), "sourceMode") == Some("workspace") {
        return None;
    }
    let table = object.get("citationSources")?.as_array()?.clone();
    let (notes, web): (Vec<&Value>, Vec<&Value>) = table.iter().partition(|e| is_note(e));
    if notes.is_empty() {
        return None;
    }
    for entry in &notes {
        let fields = entry.as_object()?;
        if fields.keys().any(|key| !NOTE_FIELDS.contains(&key.as_str()))
            || str_field(entry, "citation").is_none_or(str::is_empty)
            || str_field(entry, "text").is_none()
        {
            return None;
        }
    }
    // Block IDs are only unique within a document.
    let ids: HashSet<(Option<&str>, &str)> = notes
        .iter()
        .filter_map(|e| Some((str_field(e, "document"), str_field(e, "id")?)))
        .collect();
    let covered = |blocks: Option<&Value>, document: Option<&str>| {
        blocks.and_then(Value::as_array).is_some_and(|blocks| {
            blocks.iter().all(|b| str_field(b, "id").is_some_and(|id| ids.contains(&(document, id))))
        })
    };
    // Group consecutive entries by document; titles appear once per group.
    let mut groups: Vec<(Option<&str>, Vec<&Value>)> = Vec::new();
    for entry in &notes {
        let document = str_field(entry, "document");
        match groups.last_mut() {
            Some((last, entries)) if *last == document => entries.push(entry),
            _ => groups.push((document, vec![entry])),
        }
    }
    let note_sources: Vec<Value> = groups
        .iter()
        .map(|(_, entries)| {
            let mut group = Map::new();
            if let Some(title) = entries.iter().find_map(|e| str_field(e, "title")) {
                group.insert("title".into(), Value::from(title));
            }
            group.insert("blocks".into(), Value::from(render(entries)));
            Value::Object(group)
        })
        .collect();
    // Plain text duplicates the blocks; keep it only if it holds text that no
    // block contains (for example unstructured canvas text).
    let block_lines: HashSet<&str> = notes
        .iter()
        .flat_map(|e| str_field(e, "text").unwrap_or_default().lines().map(str::trim))
        .collect();
    if str_field(&Value::Object(object.clone()), "text").is_some_and(|text| {
        text.lines().map(str::trim).filter(|l| !l.is_empty()).all(|l| block_lines.contains(l))
    }) {
        object.remove("text");
    }
    // The renderer may already have dropped covered structure lists; a missing
    // list counts as covered. Document IDs are never useful to the model.
    let document = object.get("document").and_then(Value::as_str).map(str::to_owned);
    if object.get("structure").is_none() || covered(object.get("structure"), document.as_deref()) {
        object.remove("structure");
        object.remove("document");
    }
    if let Some(Value::Array(added)) = object.get_mut("addedNotes") {
        added.retain(|note| {
            note.get("structure").is_some()
                && !covered(note.get("structure"), str_field(note, "document"))
        });
        if added.is_empty() {
            object.remove("addedNotes");
        }
    }
    if let Some(Value::Array(surrounding)) = object.get("surroundingReadOnly") {
        if surrounding.is_empty() {
            object.remove("surroundingReadOnly");
        } else if surrounding.iter().all(|b| b.get("text").is_some_and(Value::is_string)) {
            // Read-only context is never citable: render it without markers.
            let mut blocks: Vec<Value> = surrounding.clone();
            for block in &mut blocks {
                block["citation"] = Value::from("");
            }
            let lines = render(&blocks.iter().collect::<Vec<_>>());
            object.insert("surroundingReadOnly".into(), Value::from(lines));
        }
    }
    if web.is_empty() {
        object.remove("citationSources");
    } else {
        object.insert("citationSources".into(), Value::Array(web.into_iter().cloned().collect()));
    }
    object.insert("noteSources".into(), Value::Array(note_sources));
    Some(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn block(id: &str, parent: Option<&str>, note: &str, kind: &str, text: &str) -> Value {
        json!({"id": id, "parent": parent, "note": note, "type": kind, "text": text})
    }

    fn context(structure: Vec<Value>, extra: Value) -> String {
        let table: Vec<Value> = structure
            .iter()
            .enumerate()
            .map(|(i, b)| {
                let mut entry = b.clone();
                entry["document"] = json!("doc-1");
                entry["title"] = json!("Project plan");
                entry["citation"] = json!(format!("[S{}]", i + 1));
                entry
            })
            .collect();
        let text = structure.iter().map(|b| b["text"].as_str().unwrap()).collect::<Vec<_>>().join("\n");
        let mut value = json!({"sourceMode": "current", "title": "Project plan", "scope": "Focused note",
            "text": text, "document": "doc-1", "structure": structure, "surroundingReadOnly": [],
            "mode": "ask", "runs": [], "addedNotes": [], "citationSources": table});
        for (key, field) in extra.as_object().unwrap() {
            value[key] = field.clone();
        }
        value.to_string()
    }

    #[test]
    fn note_blocks_are_sent_once_with_markers_nesting_and_tasks() {
        let mut done = block("t2", None, "n1", "todo", "Book venue");
        done["checked"] = json!(true);
        let blocks = vec![
            block("h", None, "n1", "h2", "Goals"),
            block("b1", None, "n1", "bulleted", "Ship beta"),
            block("b2", Some("b1"), "n1", "bulleted", "Fix sync\nthen test"),
            block("t1", None, "n1", "todo", "Email team"),
            done,
            block("p", None, "n1", "text", "Plain paragraph"),
        ];
        let original = context(blocks, json!({}));
        let compacted: Value = serde_json::from_str(&compact(&original).unwrap()).unwrap();
        assert_eq!(
            compacted["noteSources"],
            json!([{"title": "Project plan", "blocks":
                "[S1] ## Goals\n[S2] - Ship beta\n[S3]   - Fix sync\n      then test\n[S4] [ ] Email team\n[S5] [x] Book venue\n[S6] Plain paragraph"}])
        );
        for removed in ["text", "structure", "document", "citationSources", "addedNotes", "surroundingReadOnly"] {
            assert!(compacted.get(removed).is_none(), "{removed}");
        }
        for kept in ["sourceMode", "title", "scope", "mode", "runs"] {
            assert!(compacted.get(kept).is_some(), "{kept}");
        }
        assert!(compact(&original).unwrap().len() * 2 < original.len());
    }

    #[test]
    fn canvas_notes_are_separated_and_uncovered_text_is_kept() {
        let blocks = vec![block("a", None, "n1", "text", "Card one"), block("b", None, "n2", "text", "Card two")];
        let mut original: Value = serde_json::from_str(&context(blocks, json!({}))).unwrap();
        original["text"] = json!("Card one\nCard two\nFree canvas text");
        let compacted: Value = serde_json::from_str(&compact(&original.to_string()).unwrap()).unwrap();
        assert_eq!(compacted["noteSources"][0]["blocks"], "--- note 1 ---\n[S1] Card one\n--- note 2 ---\n[S2] Card two");
        assert_eq!(compacted["text"], "Card one\nCard two\nFree canvas text");
    }

    #[test]
    fn web_entries_stay_in_citation_sources_and_documents_group() {
        let original = json!({"sourceMode": "explicit", "mode": "ask", "citationSources": [
            {"document": "a", "title": "Alpha", "id": "1", "text": "First", "citation": "[S1]", "type": "text", "parent": null, "note": "n"},
            {"document": "b", "title": "Beta", "id": "2", "text": "Second", "citation": "[S2]", "type": "text", "parent": null, "note": "m", "attribution": "Quoted from Ada"},
            {"kind": "web", "document": "w", "id": "w1", "text": "Web text", "title": "Site", "captureId": "c", "sectionId": "s", "ref": "r1", "citation": "[S3]"}
        ], "webOutcomes": [{"url": "https://example.com"}]});
        let compacted: Value = serde_json::from_str(&compact(&original.to_string()).unwrap()).unwrap();
        assert_eq!(compacted["noteSources"], json!([
            {"title": "Alpha", "blocks": "[S1] First"},
            {"title": "Beta", "blocks": "[S2] Second\n    attribution: Quoted from Ada"}
        ]));
        assert_eq!(compacted["citationSources"].as_array().unwrap().len(), 1);
        assert_eq!(compacted["citationSources"][0]["ref"], "r1");
        assert!(compacted["webOutcomes"].is_array());
    }

    #[test]
    fn unsupported_contexts_are_left_unchanged() {
        let mut pdf = block("p", None, "n", "text", "Page text");
        pdf["pdf"] = json!({"page": 3});
        let mut uncited = block("u", None, "n", "text", "Uncited");
        let mut uncited_context: Value = serde_json::from_str(&context(vec![uncited.clone()], json!({}))).unwrap();
        uncited_context["citationSources"][0].as_object_mut().unwrap().remove("citation");
        uncited["citation"] = json!("");
        for original in [
            context(vec![pdf], json!({})),
            uncited_context.to_string(),
            json!({"sourceMode": "workspace", "citationSources": [{"citation": "[S1]", "text": "x"}]}).to_string(),
            json!({"text": "Synthetic note", "structure": [], "citationSources": []}).to_string(),
            "{}".into(),
            "not json".into(),
        ] {
            assert_eq!(compact(&original), None, "{original}");
        }
    }

    #[test]
    fn benchmark_contexts_keep_every_citation_and_block_text() {
        let suite: Value =
            serde_json::from_str(include_str!("../../tests/benchmarks/cases.v1.json")).unwrap();
        let (mut before, mut after, mut compacted_cases) = (0, 0, 0);
        for case in suite["cases"].as_array().unwrap() {
            let original = case["context"].to_string();
            let Some(compacted) = compact(&original) else { continue };
            compacted_cases += 1;
            before += original.len();
            after += compacted.len();
            let sent: Value = serde_json::from_str(&compacted).unwrap();
            let blocks: String = sent["noteSources"].as_array().unwrap().iter()
                .map(|g| g["blocks"].as_str().unwrap()).collect::<Vec<_>>().join("\n");
            for entry in case["context"]["citationSources"].as_array().unwrap() {
                if !is_note(entry) { continue; }
                let citation = entry["citation"].as_str().unwrap();
                let line = blocks.lines().find(|l| l.starts_with(&format!("{citation} "))).unwrap_or_else(|| panic!("{}: {citation}", case["id"]));
                let first = entry["text"].as_str().unwrap().lines().next().unwrap_or_default();
                assert!(line.ends_with(first) || line.contains(first), "{}: {citation}", case["id"]);
            }
        }
        eprintln!("compacted {compacted_cases} benchmark contexts: {before} -> {after} bytes");
        assert!(after < before);
    }

    #[test]
    fn renderer_dropped_copies_and_cross_document_id_collisions() {
        // Renderer already removed covered structure/text: document IDs still go.
        let original = json!({"sourceMode": "current", "document": "doc-1", "addedNotes": [{"document": "doc-2", "title": "Other"}],
            "citationSources": [
                {"document": "doc-1", "title": "Plan", "id": "same", "text": "Mine", "citation": "[S1]"},
                {"document": "doc-2", "title": "Other", "id": "x", "text": "Theirs", "citation": "[S2]"}
            ]});
        let compacted: Value = serde_json::from_str(&compact(&original.to_string()).unwrap()).unwrap();
        assert!(compacted.get("document").is_none() && compacted.get("addedNotes").is_none());
        // An added note's block shares an ID with a cited block of another document: keep it.
        let collision = json!({"sourceMode": "current", "document": "doc-1",
            "structure": [{"id": "same", "text": "Mine"}],
            "addedNotes": [{"document": "doc-2", "title": "Other", "structure": [{"id": "same", "text": "Uncited"}]}],
            "citationSources": [{"document": "doc-1", "title": "Plan", "id": "same", "text": "Mine", "citation": "[S1]"}]});
        let compacted: Value = serde_json::from_str(&compact(&collision.to_string()).unwrap()).unwrap();
        assert!(compacted.get("structure").is_none());
        assert_eq!(compacted["addedNotes"][0]["structure"][0]["text"], "Uncited");
    }

    #[test]
    fn surrounding_context_is_compacted_without_citation_markers() {
        let surrounding = json!([
            {"id": "s1", "parent": null, "note": "n", "type": "h1", "text": "Intro"},
            {"id": "s2", "parent": null, "note": "n", "type": "text", "text": "Nearby"}
        ]);
        let original = context(vec![block("a", None, "n", "text", "Selected")], json!({"surroundingReadOnly": surrounding}));
        let compacted: Value = serde_json::from_str(&compact(&original).unwrap()).unwrap();
        assert_eq!(compacted["surroundingReadOnly"], "# Intro\nNearby");
    }
}
