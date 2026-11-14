//! YouTube transcripts for the video side panel (docs/YOUTUBE-TRANSCRIPT-PLAN.md).
//!
//! The web player's caption URLs need a proof-of-origin token, so Knot asks
//! YouTube's player endpoint as the Android app does, then reads the chosen
//! caption track (timed text format 3). This is not a documented API: keep
//! every client detail in this file so a fix stays small. Nothing is fetched
//! unless the person asks, and transcripts are saved in the workspace by
//! video ID, so backups include them and every card for a video shares one.
use crate::storage::{Result as StoreResult, Workspace};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

const PLAYER_URL: &str = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CLIENT_NAME: &str = "ANDROID";
const CLIENT_VERSION: &str = "20.10.38";
const USER_AGENT: &str = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PLAYER_BYTES: usize = 6 * 1024 * 1024;
const MAX_TRACK_BYTES: usize = 8 * 1024 * 1024;
const MAX_SEGMENTS: usize = 40_000;
/// Saved transcript JSON. A 3-hour lecture's creator track is well under this.
pub const MAX_TRANSCRIPT_BYTES: usize = 2 * 1024 * 1024;
const MAX_CHAPTERS: usize = 200;

pub const UNAVAILABLE: &str = "This video is private or unavailable";
pub const NO_CAPTIONS: &str = "No captions for this video";
pub const OFFLINE: &str = "You're offline";
pub const UNREADABLE: &str = "Couldn't read captions. Knot may need an update";
pub const TOO_LONG: &str = "This transcript is too long to save";

pub fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Segment {
    /// Milliseconds from the start of the video.
    pub start: u64,
    pub duration: u64,
    pub text: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Chapter {
    pub start: u64,
    pub title: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Track {
    /// YouTube's track identity (`.en`, `a.en`); unique within a video.
    pub id: String,
    pub language: String,
    pub name: String,
    /// "manual" (uploaded by the creator) or "asr" (auto-generated).
    pub kind: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub version: u32,
    pub video_id: String,
    pub title: String,
    pub channel: String,
    /// Seconds.
    pub duration: u64,
    pub track: Track,
    pub tracks: Vec<Track>,
    pub chapters: Vec<Chapter>,
    pub segments: Vec<Segment>,
    pub fetched_at: i64,
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn attribute(attrs: &str, name: &str) -> Option<u64> {
    let key = format!("{name}=\"");
    let start = attrs.find(&key)? + key.len();
    let value = &attrs[start..];
    value[..value.find('"')?].parse().ok()
}

/// Parse timed text format 3: `<p t="ms" d="ms">text</p>`. Auto-generated
/// tracks wrap words in `<s>` tags; those and line breaks are flattened.
pub fn parse_timed_text(xml: &str) -> Result<Vec<Segment>, &'static str> {
    if !xml.contains("<timedtext") {
        return Err(UNREADABLE);
    }
    let mut segments = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find("<p ") {
        rest = &rest[i + 3..];
        let Some(open_end) = rest.find('>') else { break };
        let attrs = &rest[..open_end];
        let self_closing = attrs.ends_with('/');
        let body = &rest[open_end + 1..];
        let inner = if self_closing {
            ""
        } else {
            match body.find("</p>") {
                Some(close) => &body[..close],
                None => break,
            }
        };
        rest = if self_closing { body } else { &body[inner.len() + 4..] };
        let mut text = String::new();
        let mut in_tag = false;
        for c in inner.chars() {
            match c {
                '<' => {
                    in_tag = true;
                    text.push(' ');
                }
                '>' => in_tag = false,
                _ if !in_tag => text.push(c),
                _ => {}
            }
        }
        let text = unescape(&text.split_whitespace().collect::<Vec<_>>().join(" "));
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if text.is_empty() {
            continue;
        }
        let (Some(start), duration) = (attribute(attrs, "t"), attribute(attrs, "d")) else {
            continue;
        };
        segments.push(Segment { start, duration: duration.unwrap_or(0), text });
        if segments.len() > MAX_SEGMENTS {
            return Err(TOO_LONG);
        }
    }
    segments.sort_by_key(|s| s.start);
    Ok(segments)
}

fn parse_clock(value: &str) -> Option<u64> {
    let parts: Vec<&str> = value.split(':').collect();
    if !(2..=3).contains(&parts.len())
        || parts.iter().any(|p| p.is_empty() || p.len() > 2 || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let numbers: Vec<u64> = parts.iter().map(|p| p.parse().unwrap()).collect();
    let (h, m, s) = match numbers[..] {
        [m, s] => (0, m, s),
        [h, m, s] => (h, m, s),
        _ => return None,
    };
    if s >= 60 || (parts.len() == 3 && m >= 60) {
        return None;
    }
    Some(((h * 60 + m) * 60 + s) * 1000)
}

/// Chapters as YouTube reads them from a description: lines that start with
/// a timestamp, the first at 0:00, at least three, in increasing order.
pub fn parse_chapters(description: &str) -> Vec<Chapter> {
    let mut chapters = Vec::new();
    for line in description.lines() {
        let line = line.trim().trim_start_matches(['(', '[']);
        let Some(end) = line.find(|c: char| !(c.is_ascii_digit() || c == ':')) else {
            continue;
        };
        let Some(start) = parse_clock(&line[..end]) else { continue };
        let title = line[end..]
            .trim_start_matches([')', ']'])
            .trim_start_matches(|c: char| c.is_whitespace() || "-–—:|·.".contains(c))
            .trim();
        if title.is_empty() {
            continue;
        }
        if chapters.last().is_some_and(|c: &Chapter| c.start >= start) {
            continue;
        }
        chapters.push(Chapter { start, title: title.chars().take(200).collect() });
        if chapters.len() >= MAX_CHAPTERS {
            break;
        }
    }
    if chapters.len() < 3 || chapters[0].start != 0 {
        return Vec::new();
    }
    chapters
}

fn track_name(value: &Value) -> String {
    value["simpleText"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| {
            value["runs"].as_array().map(|runs| {
                runs.iter().filter_map(|r| r["text"].as_str()).collect::<String>()
            })
        })
        .unwrap_or_default()
}

/// The caption tracks a player response lists, with each one's address.
pub fn tracks(player: &Value) -> Vec<(Track, String)> {
    let Some(list) = player["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"].as_array()
    else {
        return Vec::new();
    };
    list.iter()
        .filter_map(|t| {
            let url = t["baseUrl"].as_str()?.to_owned();
            let language = t["languageCode"].as_str()?.to_owned();
            let kind = if t["kind"].as_str() == Some("asr") { "asr" } else { "manual" };
            let id = t["vssId"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{}.{language}", if kind == "asr" { "a" } else { "" }));
            let mut name = track_name(&t["name"]);
            if name.is_empty() {
                name = language.clone();
            }
            Some((Track { id, language, name, kind: kind.into() }, url))
        })
        .collect()
}

/// The requested track, else creator captions in the preferred language, then
/// English, then auto-generated in those languages, then whatever exists.
pub fn choose<'a>(
    list: &'a [(Track, String)],
    requested: Option<&str>,
    preferred: &str,
) -> Option<&'a (Track, String)> {
    if let Some(id) = requested {
        if let Some(found) = list.iter().find(|(t, _)| t.id == id) {
            return Some(found);
        }
    }
    let base = |code: &str| code.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    let wanted = base(preferred);
    let matches = |t: &Track, lang: &str, kind: &str| base(&t.language) == lang && t.kind == kind;
    for (lang, kind) in [
        (wanted.as_str(), "manual"),
        ("en", "manual"),
        (wanted.as_str(), "asr"),
        ("en", "asr"),
    ] {
        if let Some(found) = list.iter().find(|(t, _)| matches(t, lang, kind)) {
            return Some(found);
        }
    }
    list.iter().find(|(t, _)| t.kind == "manual").or(list.first())
}

fn caption_url(url: &str) -> Option<reqwest::Url> {
    let mut parsed = reqwest::Url::parse(url).ok()?;
    // The address comes from YouTube's response: only follow it to YouTube.
    if parsed.scheme() != "https" || parsed.host_str() != Some("www.youtube.com") || parsed.path() != "/api/timedtext" {
        return None;
    }
    let kept: Vec<(String, String)> = parsed
        .query_pairs()
        .filter(|(k, _)| k != "fmt")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    parsed.query_pairs_mut().clear().extend_pairs(kept).append_pair("fmt", "srv3");
    Some(parsed)
}

fn network(error: reqwest::Error) -> String {
    if error.is_connect() || error.is_timeout() {
        OFFLINE.into()
    } else {
        UNREADABLE.into()
    }
}

async fn read_capped(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(UNREADABLE.into());
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(UNREADABLE.into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network)? {
        if body.len() + chunk.len() > limit {
            return Err(UNREADABLE.into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Fetch a transcript from YouTube. `track` picks a listed track by its ID;
/// otherwise the choice follows `preferred` (the interface language).
pub async fn fetch(video_id: &str, track: Option<&str>, preferred: &str) -> Result<Transcript, String> {
    if !valid_video_id(video_id) {
        return Err(UNAVAILABLE.into());
    }
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| UNREADABLE.to_string())?;
    let body = json!({
        "context": {"client": {
            "clientName": CLIENT_NAME,
            "clientVersion": CLIENT_VERSION,
            "androidSdkVersion": 30,
            "hl": "en",
        }},
        "videoId": video_id,
    });
    let response = client.post(PLAYER_URL).json(&body).send().await.map_err(network)?;
    let player: Value =
        serde_json::from_slice(&read_capped(response, MAX_PLAYER_BYTES).await?).map_err(|_| UNREADABLE.to_string())?;
    match player["playabilityStatus"]["status"].as_str() {
        Some("OK") => {}
        Some(_) => return Err(UNAVAILABLE.into()),
        None => return Err(UNREADABLE.into()),
    }
    let details = &player["videoDetails"];
    if details["videoId"].as_str().is_some_and(|id| id != video_id) {
        return Err(UNREADABLE.into());
    }
    let list = tracks(&player);
    let Some((chosen, url)) = choose(&list, track, preferred) else {
        return Err(NO_CAPTIONS.into());
    };
    let url = caption_url(url).ok_or(UNREADABLE)?;
    let response = client.get(url).send().await.map_err(network)?;
    let xml = String::from_utf8(read_capped(response, MAX_TRACK_BYTES).await?).map_err(|_| UNREADABLE.to_string())?;
    let segments = parse_timed_text(&xml).map_err(str::to_owned)?;
    if segments.is_empty() {
        return Err(NO_CAPTIONS.into());
    }
    Ok(Transcript {
        version: 1,
        video_id: video_id.into(),
        title: details["title"].as_str().unwrap_or_default().chars().take(300).collect(),
        channel: details["author"].as_str().unwrap_or_default().chars().take(200).collect(),
        duration: details["lengthSeconds"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        track: chosen.clone(),
        tracks: list.into_iter().map(|(t, _)| t).collect(),
        chapters: parse_chapters(details["shortDescription"].as_str().unwrap_or_default()),
        segments,
        fetched_at: crate::storage::now(),
    })
}

impl Workspace {
    pub fn video_transcript(&self, video_id: &str) -> StoreResult<Option<String>> {
        if !valid_video_id(video_id) {
            return Err("Invalid video ID".into());
        }
        Ok(self
            .db
            .query_row(
                "SELECT data FROM video_transcripts WHERE video_id=?1",
                [video_id],
                |r| r.get(0),
            )
            .optional()?)
    }
    /// Store (or replace) a video's transcript. Returns the saved JSON.
    pub fn save_video_transcript(&self, transcript: &Transcript) -> StoreResult<String> {
        if !valid_video_id(&transcript.video_id) {
            return Err("Invalid video ID".into());
        }
        let data = serde_json::to_string(transcript)?;
        if data.len() > MAX_TRANSCRIPT_BYTES {
            return Err(TOO_LONG.into());
        }
        self.db.execute(
            "INSERT INTO video_transcripts(video_id,language,kind,fetched_at,data) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(video_id) DO UPDATE SET language=excluded.language, kind=excluded.kind,
               fetched_at=excluded.fetched_at, data=excluded.data",
            params![
                transcript.video_id,
                transcript.track.language,
                transcript.track.kind,
                transcript.fetched_at,
                data
            ],
        )?;
        Ok(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANUAL: &str = r#"<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">
<body>
<p t="1200" d="2160">All right, so here we are, in front of the
elephants</p>
<p t="5318" d="2656">that&#39;s cool &amp; &quot;fun&quot; &#x263A;</p>
<p t="9000" d="100"></p>
<p t="9100"/>
</body></timedtext>"#;

    const ASR: &str = r#"<timedtext format="3"><head><ws id="0"/></head><body>
<w t="0" id="1" wp="1" ws="1"/>
<p t="4320" d="4120" w="1"><s ac="0">This</s><s t="160" ac="0"> is</s><s t="320" ac="0"> a</s><s t="640" ac="0"> three.</s></p>
<p t="6800" d="4400" w="1" a="1">
</p>
<p t="6810" d="4390" w="1"><s ac="0">and</s><s t="240" ac="0"> rendered</s></p>
</body></timedtext>"#;

    #[test]
    fn parses_creator_tracks_and_entities() {
        let segments = parse_timed_text(MANUAL).unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start, 1200);
        assert_eq!(segments[0].duration, 2160);
        assert_eq!(segments[0].text, "All right, so here we are, in front of the elephants");
        assert_eq!(segments[1].text, "that's cool & \"fun\" ☺");
    }

    #[test]
    fn parses_auto_generated_word_tags() {
        let segments = parse_timed_text(ASR).unwrap();
        assert_eq!(
            segments.iter().map(|s| (s.start, s.text.as_str())).collect::<Vec<_>>(),
            vec![(4320, "This is a three."), (6810, "and rendered")]
        );
    }

    #[test]
    fn rejects_responses_that_are_not_timed_text() {
        assert_eq!(parse_timed_text("<!DOCTYPE html><title>Error 404</title>"), Err(UNREADABLE));
        assert_eq!(parse_timed_text("<timedtext><body></body></timedtext>"), Ok(vec![]));
    }

    #[test]
    fn reads_chapters_like_youtube() {
        let description = "Intro text\n0:00 Intro\n1:05 - Vectors\n(12:40) Matrices\n1:02:03 Wrap up\nnot 3:00 a chapter";
        assert_eq!(
            parse_chapters(description),
            vec![
                Chapter { start: 0, title: "Intro".into() },
                Chapter { start: 65_000, title: "Vectors".into() },
                Chapter { start: 760_000, title: "Matrices".into() },
                Chapter { start: 3_723_000, title: "Wrap up".into() },
            ]
        );
        // Not starting at 0:00, or fewer than three: not chapters.
        assert!(parse_chapters("1:00 A\n2:00 B\n3:00 C").is_empty());
        assert!(parse_chapters("0:00 A\n2:00 B").is_empty());
        assert!(parse_chapters("0:00 A\n1:99 B\n2:00 C").is_empty());
    }

    fn player() -> Value {
        json!({"captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
            {"baseUrl": "https://www.youtube.com/api/timedtext?v=x&lang=de", "languageCode": "de", "vssId": ".de", "name": {"runs": [{"text": "German"}]}},
            {"baseUrl": "https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr", "languageCode": "en", "kind": "asr", "vssId": "a.en", "name": {"simpleText": "English (auto-generated)"}},
            {"baseUrl": "https://www.youtube.com/api/timedtext?v=x&lang=en-GB", "languageCode": "en-GB", "vssId": ".en-GB", "name": {"simpleText": "English (United Kingdom)"}},
            {"languageCode": "fr"}
        ]}}})
    }

    #[test]
    fn lists_and_chooses_tracks() {
        let list = tracks(&player());
        assert_eq!(list.len(), 3, "a track without an address is skipped");
        assert_eq!(list[0].0, Track { id: ".de".into(), language: "de".into(), name: "German".into(), kind: "manual".into() });
        assert_eq!(list[1].0.kind, "asr");
        // Creator captions in English beat auto-generated English.
        assert_eq!(choose(&list, None, "en-US").unwrap().0.id, ".en-GB");
        // The interface language wins when it has creator captions.
        assert_eq!(choose(&list, None, "de-DE").unwrap().0.id, ".de");
        // A requested track wins; an unknown request falls back.
        assert_eq!(choose(&list, Some("a.en"), "de").unwrap().0.id, "a.en");
        assert_eq!(choose(&list, Some("zz"), "ja").unwrap().0.id, ".en-GB");
        assert!(choose(&[], None, "en").is_none());
        let only_asr = vec![list[1].clone()];
        assert_eq!(choose(&only_asr, None, "ja").unwrap().0.id, "a.en");
    }

    #[test]
    fn follows_caption_addresses_only_to_youtube() {
        let url = caption_url("https://www.youtube.com/api/timedtext?v=x&fmt=json3&lang=en").unwrap();
        assert_eq!(url.as_str(), "https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=srv3");
        assert!(caption_url("https://evil.example/api/timedtext?v=x").is_none());
        assert!(caption_url("http://www.youtube.com/api/timedtext?v=x").is_none());
        assert!(caption_url("https://www.youtube.com/redirect?q=x").is_none());
        assert!(caption_url("file:///C:/x").is_none());
    }

    #[test]
    fn validates_video_ids() {
        assert!(valid_video_id("jNQXAC9IVRw"));
        assert!(valid_video_id("a-b_c123456"));
        assert!(!valid_video_id("short"));
        assert!(!valid_video_id("jNQXAC9IVR/"));
        assert!(!valid_video_id("jNQXAC9IVRww"));
    }

    fn sample(id: &str) -> Transcript {
        Transcript {
            version: 1,
            video_id: id.into(),
            title: "T".into(),
            channel: "C".into(),
            duration: 19,
            track: Track { id: ".en".into(), language: "en".into(), name: "English".into(), kind: "manual".into() },
            tracks: vec![],
            chapters: vec![],
            segments: vec![Segment { start: 0, duration: 1000, text: "Hi".into() }],
            fetched_at: 1,
        }
    }

    #[test]
    fn saves_and_replaces_one_transcript_per_video() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = Workspace::open(tmp.path().join("w")).unwrap();
        assert_eq!(ws.video_transcript("jNQXAC9IVRw").unwrap(), None);
        let saved = ws.save_video_transcript(&sample("jNQXAC9IVRw")).unwrap();
        assert_eq!(ws.video_transcript("jNQXAC9IVRw").unwrap(), Some(saved));
        let mut other = sample("jNQXAC9IVRw");
        other.title = "Replaced".into();
        ws.save_video_transcript(&other).unwrap();
        let stored: Value = serde_json::from_str(&ws.video_transcript("jNQXAC9IVRw").unwrap().unwrap()).unwrap();
        assert_eq!(stored["title"], "Replaced");
        assert_eq!(stored["videoId"], "jNQXAC9IVRw");
        assert_eq!(stored["fetchedAt"], 1);
        assert!(ws.video_transcript("../etc").is_err());
        let mut huge = sample("jNQXAC9IVRw");
        huge.segments = vec![Segment { start: 0, duration: 0, text: "x".repeat(MAX_TRANSCRIPT_BYTES) }];
        assert!(ws.save_video_transcript(&huge).is_err());
    }

    /// Live check against YouTube; run with `cargo test youtube -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch() {
        let t = fetch("jNQXAC9IVRw", None, "en").await.unwrap();
        assert_eq!(t.title, "Me at the zoo");
        assert!(!t.segments.is_empty());
        assert_eq!(fetch("xxxxxxxxxxx", None, "en").await.unwrap_err(), UNAVAILABLE);
    }
}
