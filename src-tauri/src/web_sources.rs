//! Public, unauthenticated source capture. Never shares the AI or browser client.
use futures_util::{stream, StreamExt};
use reqwest::{header, redirect::Policy, Url};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    net::{IpAddr, SocketAddr},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, State};
use tokio::sync::Notify;

const MAX_URLS: usize = 8;
const CONCURRENCY: usize = 3;
const MAX_BODY: usize = 4 * 1024 * 1024;
const MAX_BATCH: usize = 16 * 1024 * 1024;
const SOURCE_SECONDS: u64 = 20;
const BATCH_SECONDS: u64 = 60;
const REDIRECTS: usize = 5;
#[derive(Default)]
struct FetchPolicy {
    #[cfg(test)]
    fixture_address: Option<SocketAddr>,
}

#[derive(Default)]
pub struct Requests(Mutex<HashMap<String, Arc<Notify>>>);
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct Event {
    url: String,
    status: &'static str,
    result: Option<Outcome>,
}
#[derive(Debug)]
struct Failure {
    code: &'static str,
    message: String,
    retry: bool,
    delay: u64,
}
fn fail(code: &'static str, message: &str) -> Failure {
    Failure {
        code,
        message: message.into(),
        retry: false,
        delay: 0,
    }
}
fn network(error: reqwest::Error) -> Failure {
    // Do not expose reqwest's URL-bearing Display output to the shell/logs.
    let certificate = format!("{error:?}").to_lowercase().contains("certificate");
    Failure {
        code: if certificate { "tls" } else { "network" },
        message: if certificate {
            "TLS certificate validation failed."
        } else {
            "The website could not be reached. Check the address or retry."
        }
        .into(),
        retry: !certificate && (error.is_connect() || error.is_timeout() || error.is_body()),
        delay: 1,
    }
}

pub(crate) fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v) => {
            // Only global unicast, excluding transition, documentation and special ranges.
            let s = v.segments();
            (s[0] & 0xe000) == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}
fn validate_url(value: &str) -> Result<Url, Failure> {
    let url = Url::parse(value)
        .map_err(|_| fail("address", "Enter a valid public HTTP or HTTPS URL."))?;
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_end_matches('.')
        .to_lowercase();
    if value.len() > 8192
        || !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || host.is_empty()
        || host == "localhost"
        || host == "tauri.localhost"
        || host == "knot.invalid"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".invalid")
    {
        return Err(fail(
            "destination",
            "Only public HTTP/HTTPS websites without credentials can be captured.",
        ));
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        if !public_ip(ip) {
            return Err(fail(
                "destination",
                "Private, local and reserved network addresses cannot be captured.",
            ));
        }
    }
    Ok(url)
}
async fn addresses(url: &Url, _policy: &FetchPolicy) -> Result<Vec<SocketAddr>, Failure> {
    #[cfg(test)]
    if let Some(address) = _policy.fixture_address {
        return Ok(vec![address]);
    }
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    let port = url.port_or_known_default().unwrap_or(443);
    let values: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| fail("dns", "The website address could not be resolved."))?
        .collect();
    validate_addresses(&values)?;
    Ok(values)
}
/// Address and DNS checks for the rendered fallback, which loads the page
/// in a WebView instead of this client.
pub(crate) async fn check_public(value: &str) -> Result<Url, String> {
    let url = validate_url(value).map_err(|e| e.message)?;
    addresses(&url, &FetchPolicy::default())
        .await
        .map_err(|e| e.message)?;
    Ok(url)
}
pub(crate) fn validate_public_url(value: &str) -> Result<Url, String> {
    validate_url(value).map_err(|e| e.message)
}
fn validate_addresses(values: &[SocketAddr]) -> Result<(), Failure> {
    if values.is_empty() || values.iter().any(|v| !public_ip(v.ip())) {
        return Err(fail(
            "destination",
            "The address resolves to a private, local or reserved network.",
        ));
    }
    Ok(())
}
fn redirect_url(current: &Url, location: &str, visited: &HashSet<String>) -> Result<Url, Failure> {
    let next = current
        .join(location)
        .map_err(|_| fail("redirect", "The website returned an invalid redirect."))?;
    let mut next = validate_url(next.as_str())?;
    next.set_fragment(None);
    if current.scheme() == "https" && next.scheme() == "http" {
        return Err(fail(
            "downgrade",
            "The website redirects from HTTPS to insecure HTTP. Capture was stopped.",
        ));
    }
    if visited.contains(next.as_str()) {
        return Err(fail("redirect", "The website returned a redirect loop."));
    }
    Ok(next)
}
fn charge(total: &AtomicUsize, amount: usize) -> Result<(), Failure> {
    if total.fetch_add(amount, Ordering::Relaxed) + amount > MAX_BATCH {
        return Err(fail(
            "batch_limit",
            "The batch exceeds the 16 MiB download limit. Use fewer URLs.",
        ));
    }
    Ok(())
}
fn decode_body(
    raw: &[u8],
    encoding: &str,
    content_type: &str,
    total: &AtomicUsize,
) -> Result<(String, String), Failure> {
    let mut decoded = Vec::new();
    match encoding.trim().to_ascii_lowercase().as_str() {
        "" | "identity" => decoded.extend_from_slice(raw),
        "gzip" => {
            flate2::read::GzDecoder::new(raw)
                .take(MAX_BODY as u64 + 1)
                .read_to_end(&mut decoded)
                .map_err(|_| fail("encoding", "The compressed response is invalid."))?;
        }
        "deflate" => {
            flate2::read::ZlibDecoder::new(raw)
                .take(MAX_BODY as u64 + 1)
                .read_to_end(&mut decoded)
                .map_err(|_| fail("encoding", "The compressed response is invalid."))?;
        }
        "br" => {
            brotli::Decompressor::new(raw, 4096)
                .take(MAX_BODY as u64 + 1)
                .read_to_end(&mut decoded)
                .map_err(|_| fail("encoding", "The compressed response is invalid."))?;
        }
        _ => {
            return Err(fail(
                "encoding",
                "Unsupported response compression. Open the website externally.",
            ))
        }
    }
    if decoded.len() > MAX_BODY {
        return Err(fail("size", "The decoded page exceeds the 4 MiB limit."));
    }
    if !matches!(encoding, "" | "identity") {
        charge(total, decoded.len())?;
    }
    let sample = String::from_utf8_lossy(&decoded[..decoded.len().min(1024)]).to_lowercase();
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if decoded.starts_with(b"%PDF-") || mime == "application/pdf" {
        return Err(fail(
            "pdf",
            "Direct PDF URLs are not supported yet. Open/download the PDF, then attach it in Knot.",
        ));
    }
    let html = sample
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with(['<'])
        && (sample.contains("<html")
            || sample.contains("<!doctype html")
            || sample.contains("<body")
            || sample.contains("<article")
            || sample.contains("<p>"));
    let declared = content_type.split(';').find_map(|p| {
        p.trim()
            .split_once('=')
            .filter(|(key, _)| key.trim().eq_ignore_ascii_case("charset"))
            .map(|(_, value)| value.trim().trim_matches(['\'', '"']))
    });
    if !matches!(
        mime.as_str(),
        "text/html" | "application/xhtml+xml" | "text/plain" | "" | "application/octet-stream"
    ) || (!html
        && !matches!(
            mime.as_str(),
            "text/plain" | "text/html" | "application/xhtml+xml"
        ))
        || decoded.contains(&0)
            && !decoded.starts_with(&[0xff, 0xfe])
            && !decoded.starts_with(&[0xfe, 0xff])
            && !declared.is_some_and(|label| label.to_lowercase().starts_with("utf-16"))
    {
        return Err(fail("type", "This response is not readable HTML or plain text. Open it externally or attach a supported document."));
    }
    let meta = sample.find("charset=").map(|index| {
        sample[index + 8..]
            .trim_start_matches(['\'', '"', ' '])
            .split(['\'', '"', ' ', '>', ';'])
            .next()
            .unwrap_or_default()
    });
    let charset = declared.or(meta).unwrap_or("utf-8");
    let encoding = encoding_rs::Encoding::for_label(charset.as_bytes()).ok_or_else(|| {
        fail(
            "encoding",
            "The website declares an unsupported character encoding.",
        )
    })?;
    let (text, _, errors) = encoding.decode(&decoded);
    if errors {
        return Err(fail(
            "encoding",
            "The website text could not be decoded reliably. Open it externally.",
        ));
    }
    if text.len() > MAX_BODY {
        return Err(fail("size", "Decoded text exceeds the 4 MiB limit."));
    }
    Ok((
        text.into_owned(),
        if html || mime.contains("html") {
            "text/html"
        } else {
            "text/plain"
        }
        .into(),
    ))
}

async fn fetch_once(
    value: &str,
    total: &AtomicUsize,
    policy: &FetchPolicy,
) -> Result<Outcome, Failure> {
    let mut url = validate_url(value)?;
    url.set_fragment(None);
    let mut visited = HashSet::new();
    for hop in 0..=REDIRECTS {
        visited.insert(url.to_string());
        let ips = addresses(&url, policy).await?;
        // no_proxy ignores system/env proxies; pinned addresses prevent DNS rebinding.
        let client = reqwest::Client::builder()
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .redirect(Policy::none())
            .referer(false)
            .resolve_to_addrs(url.host_str().unwrap(), &ips)
            .connect_timeout(Duration::from_secs(10))
            .user_agent("Knot/0.1 public-source-capture")
            .build()
            .map_err(|_| fail("client", "Could not create the source client."))?;
        let mut response = client
            .get(url.clone())
            .header(header::ACCEPT, "text/html,text/plain;q=0.9")
            .header(header::ACCEPT_ENCODING, "gzip, deflate, br")
            .send()
            .await
            .map_err(network)?;
        let status = response.status();
        if status.is_redirection() {
            if hop == REDIRECTS {
                return Err(fail("redirect", "The website exceeded 5 redirects."));
            }
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or_else(|| {
                    fail(
                        "redirect",
                        "The website returned a redirect without a valid destination.",
                    )
                })?;
            url = redirect_url(&url, location, &visited)?;
            continue;
        }
        if !status.is_success() {
            let delay = response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|h| h.to_str().ok())
                .and_then(|s| {
                    s.parse::<u64>().ok().or_else(|| {
                        httpdate::parse_http_date(s).ok().map(|time| {
                            time.duration_since(SystemTime::now())
                                .unwrap_or_default()
                                .as_secs()
                        })
                    })
                })
                .unwrap_or(1);
            return Err(Failure {
                code: "http",
                message: format!(
                    "The website returned HTTP {}. Retry or open it externally.",
                    status.as_u16()
                ),
                retry: status.is_server_error() || status.as_u16() == 429,
                delay,
            });
        }
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|h| h.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let encoding = response
            .headers()
            .get(header::CONTENT_ENCODING)
            .and_then(|h| h.to_str().ok())
            .unwrap_or_default()
            .to_string();
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BODY as u64)
        {
            return Err(fail("size", "The page exceeds the 4 MiB response limit."));
        }
        let mut raw = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(network)? {
            charge(total, chunk.len())?;
            if raw.len() + chunk.len() > MAX_BODY {
                return Err(fail("size", "The page exceeds the 4 MiB streaming limit."));
            }
            raw.extend_from_slice(&chunk);
        }
        let (body, content_type) = decode_body(&raw, &encoding, &content_type, total)?;
        return Ok(Outcome {
            url: value.into(),
            final_url: Some(url.to_string()),
            body: Some(body),
            content_type: Some(content_type),
            fetched_at: Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .to_string(),
            ),
            code: None,
            message: None,
        });
    }
    unreachable!()
}
async fn fetch(value: &str, total: &AtomicUsize) -> Outcome {
    fetch_with_policy(value, total, &FetchPolicy::default()).await
}
async fn fetch_with_policy(value: &str, total: &AtomicUsize, policy: &FetchPolicy) -> Outcome {
    let result = tokio::time::timeout(Duration::from_secs(SOURCE_SECONDS), async {
        match fetch_once(value, total, policy).await {
            Err(error) if error.retry && error.delay < SOURCE_SECONDS => {
                tokio::time::sleep(Duration::from_secs(error.delay)).await;
                fetch_once(value, total, policy).await
            }
            other => other,
        }
    })
    .await
    .unwrap_or_else(|_| {
        Err(fail(
            "timeout",
            "Capture exceeded the 20-second deadline. Retry or open the website externally.",
        ))
    });
    result.unwrap_or_else(|e| Outcome {
        url: value.into(),
        final_url: None,
        body: None,
        content_type: None,
        fetched_at: None,
        code: Some(e.code.into()),
        message: Some(e.message),
    })
}

#[tauri::command]
pub async fn web_sources_fetch(
    state: State<'_, Requests>,
    id: String,
    session: String,
    urls: Vec<String>,
    on_event: Channel<Event>,
) -> Result<(), String> {
    if id.len() > 80
        || session.is_empty()
        || session.len() > 1024
        || urls.is_empty()
        || urls.len() > MAX_URLS
    {
        return Err("Invalid source batch; use 1–8 URLs.".into());
    }
    let cancel = Arc::new(Notify::new());
    {
        let mut requests = state
            .0
            .lock()
            .map_err(|_| "Source request lock unavailable")?;
        if !requests.is_empty() || requests.contains_key(&id) {
            return Err("Another source batch is still stopping. Retry shortly.".into());
        }
        requests.insert(id.clone(), cancel.clone());
    }
    let total = Arc::new(AtomicUsize::new(0));
    let work = async {
        let mut results = stream::iter(urls.into_iter().map(|url| {
            let total = total.clone();
            let on_event = on_event.clone();
            async move {
                let _ = on_event.send(Event {
                    url: url.clone(),
                    status: "fetching",
                    result: None,
                });
                let result = fetch(&url, &total).await;
                let _ = on_event.send(Event {
                    url: url.clone(),
                    status: "finished",
                    result: Some(result),
                });
            }
        }))
        .buffer_unordered(CONCURRENCY);
        while results.next().await.is_some() {}
    };
    let started = Instant::now();
    let result = tokio::select! {
        _ = cancel.notified() => Err("Capture stopped".into()),
        _ = tokio::time::sleep(Duration::from_secs(BATCH_SECONDS)) => Err("The source batch exceeded its deadline.".into()),
        _ = work => Ok(()),
    };
    let _elapsed = started.elapsed();
    if result.is_ok() {
        let _ = on_event.send(Event {
            url: String::new(),
            status: "complete",
            result: None,
        });
    }
    if let Ok(mut requests) = state.0.lock() {
        requests.remove(&id);
    }
    result
}
#[tauri::command]
pub fn web_sources_cancel(
    state: State<'_, Requests>,
    renders: State<'_, crate::web_render::Renders>,
    id: String,
) {
    if let Ok(requests) = state.0.lock() {
        if let Some(cancel) = requests.get(&id) {
            cancel.notify_one();
        }
    }
    renders.cancel(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn destination_policy() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "::ffff:8.8.8.8",
            "fe80::1",
            "fc00::1",
            "2001:db8::1",
            "2002:0808:0808::1",
        ] {
            assert!(!public_ip(value.parse().unwrap()), "{value}");
        }
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public_ip(value.parse().unwrap()));
        }
        for value in [
            "file:///x",
            "http://knot.invalid",
            "http://tauri.localhost",
            "http://user:secret@example.com",
            "http://127.1",
            "http://[::1]",
        ] {
            assert!(validate_url(value).is_err());
        }
        assert!(validate_addresses(&[
            "8.8.8.8:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap()
        ])
        .is_err());
    }
    #[test]
    fn redirect_policy() {
        let url = Url::parse("https://example.com/a?secret=x").unwrap();
        assert!(redirect_url(&url, "http://example.com", &HashSet::new()).is_err());
        assert!(redirect_url(&url, "http://169.254.169.254", &HashSet::new()).is_err());
        assert!(redirect_url(&url, url.as_str(), &HashSet::from([url.to_string()])).is_err());
        assert_eq!(
            redirect_url(&url, "/b?q=1", &HashSet::new())
                .unwrap()
                .as_str(),
            "https://example.com/b?q=1"
        );
    }
    #[test]
    fn types_encoding_and_limits() {
        let total = AtomicUsize::new(0);
        assert!(decode_body(b"%PDF-1.7", "", "text/plain", &total)
            .unwrap_err()
            .message
            .contains("PDF"));
        assert!(decode_body(b"{\"x\":1}", "", "application/json", &total).is_err());
        assert_eq!(
            decode_body(b"caf\xe9", "", "text/plain; charset=windows-1252", &total)
                .unwrap()
                .0,
            "café"
        );
        assert_eq!(
            decode_body("مرحبا".as_bytes(), "", "text/plain", &total)
                .unwrap()
                .0,
            "مرحبا"
        );
        assert_eq!(
            decode_body(
                &[0x48, 0, 0x69, 0],
                "",
                "text/plain; Charset=utf-16le",
                &total
            )
            .unwrap()
            .0,
            "Hi"
        );
        assert!(decode_body(&vec![b'x'; MAX_BODY + 1], "", "text/plain", &total).is_err());
        let mut compressed = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut compressed, &vec![b'x'; MAX_BODY + 1]).unwrap();
        assert!(decode_body(&compressed.finish().unwrap(), "gzip", "text/plain", &total).is_err());
        assert!(charge(&AtomicUsize::new(MAX_BATCH), 1).is_err());
    }
    fn fixture(responses: Vec<(Duration, Vec<u8>)>) -> (FetchPolicy, Arc<AtomicUsize>) {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        std::thread::spawn(move || {
            for (delay, bytes) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    if let Ok((mut socket, _)) = listener.accept() {
                        socket.set_nonblocking(false).unwrap();
                        socket
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut request = Vec::new();
                        while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                            let mut byte = [0];
                            if socket.read(&mut byte).unwrap_or(0) == 0 {
                                break;
                            }
                            request.push(byte[0]);
                        }
                        calls.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(delay);
                        let _ = std::io::Write::write_all(&mut socket, &bytes);
                        break;
                    }
                    if Instant::now() > deadline {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
        });
        (
            FetchPolicy {
                fixture_address: Some(address),
            },
            count,
        )
    }
    fn http(status: &str, headers: &str, body: &str) -> Vec<u8> {
        format!("HTTP/1.1 {status}\r\nConnection: close\r\n{headers}\r\n{body}").into_bytes()
    }
    #[tokio::test]
    async fn fixture_redirects_streaming_types_and_statuses() {
        let total = AtomicUsize::new(0);
        let (policy, count) = fixture(vec![
            (
                Duration::ZERO,
                http("302 Found", "Location: /final\r\n", ""),
            ),
            (
                Duration::ZERO,
                http(
                    "200 OK",
                    "Content-Type: text/plain\r\nTransfer-Encoding: chunked\r\n",
                    "5\r\nHello\r\n0\r\n\r\n",
                ),
            ),
        ]);
        let result = fetch_once("http://example.com/start", &total, &policy)
            .await
            .unwrap();
        assert_eq!(result.body.unwrap(), "Hello");
        assert_eq!(result.final_url.unwrap(), "http://example.com/final");
        assert_eq!(count.load(Ordering::SeqCst), 2);
        for (status, code) in [
            ("404 Not Found", "http"),
            ("403 Forbidden", "http"),
            ("200 OK", "pdf"),
        ] {
            let body = if code == "pdf" { "%PDF-1.7" } else { "Denied" };
            let (policy, count) = fixture(vec![(
                Duration::ZERO,
                http(status, "Content-Type: text/plain\r\n", body),
            )]);
            let result = fetch_with_policy("http://example.com/", &total, &policy).await;
            assert_eq!(result.code.as_deref(), Some(code));
            assert_eq!(count.load(Ordering::SeqCst), 1);
        }
        let (policy, _) = fixture(vec![(
            Duration::ZERO,
            http(
                "302 Found",
                "Location: http://169.254.169.254/latest\r\n",
                "",
            ),
        )]);
        assert_eq!(
            fetch_once("http://example.com/", &total, &policy)
                .await
                .unwrap_err()
                .code,
            "destination"
        );
        let (policy, _) = fixture(vec![(
            Duration::ZERO,
            http("302 Found", "Location: /\r\n", ""),
        )]);
        assert_eq!(
            fetch_once("http://example.com/", &total, &policy)
                .await
                .unwrap_err()
                .code,
            "redirect"
        );
        let (policy, _) = fixture(vec![(
            Duration::ZERO,
            http(
                "200 OK",
                "Content-Type: text/plain\r\n",
                &"x".repeat(MAX_BODY + 1),
            ),
        )]);
        assert_eq!(
            fetch_once("http://example.com/", &total, &policy)
                .await
                .unwrap_err()
                .code,
            "size"
        );
        let (policy, _) = fixture(vec![(
            Duration::ZERO,
            http("200 OK", "Content-Type: application/json\r\n", "{}"),
        )]);
        assert_eq!(
            fetch_once("http://example.com/", &total, &policy)
                .await
                .unwrap_err()
                .code,
            "type"
        );
    }
    #[tokio::test]
    async fn fixture_bounded_retry_retry_after_and_deadline() {
        for status in ["503 Unavailable", "429 Too Many Requests"] {
            let (policy, count) = fixture(vec![
                (Duration::ZERO, http(status, "Retry-After: 0\r\n", "")),
                (
                    Duration::ZERO,
                    http("200 OK", "Content-Type: text/plain\r\n", "Recovered"),
                ),
            ]);
            assert_eq!(
                fetch_with_policy("http://example.com/", &AtomicUsize::new(0), &policy)
                    .await
                    .body
                    .as_deref(),
                Some("Recovered")
            );
            assert_eq!(count.load(Ordering::SeqCst), 2);
        }
        let (policy, count) = fixture(vec![(
            Duration::ZERO,
            http("429 Too Many Requests", "Retry-After: 120\r\n", ""),
        )]);
        assert_eq!(
            fetch_with_policy("http://example.com/", &AtomicUsize::new(0), &policy)
                .await
                .code
                .as_deref(),
            Some("http")
        );
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let (policy, _) = fixture(vec![(
            Duration::from_millis(200),
            http("200 OK", "Content-Type: text/plain\r\n", "Late"),
        )]);
        assert!(tokio::time::timeout(
            Duration::from_millis(30),
            fetch_once("http://example.com/", &AtomicUsize::new(0), &policy)
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn fixture_untrusted_tls_is_rejected_without_retry() {
        use std::io::BufRead;
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        let mut command = std::process::Command::new("node");
        command.args(["--input-type=module", "-e", "import https from 'node:https'; import fs from 'node:fs'; const s=https.createServer({cert:fs.readFileSync(process.argv[1]),key:fs.readFileSync(process.argv[2])},(_,r)=>r.end('TLS must not be accepted')); s.on('tlsClientError',()=>s.close()); s.listen(0,'127.0.0.1',()=>console.log(s.address().port)); setTimeout(()=>s.close(),5000).unref();"])
            .arg(root.join("browser-test-cert.pem")).arg(root.join("browser-test-key.pem"))
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().expect("Node fixture runtime");
        let mut port = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut port)
            .unwrap();
        let policy = FetchPolicy {
            fixture_address: Some(format!("127.0.0.1:{}", port.trim()).parse().unwrap()),
        };
        let result = fetch_with_policy("https://example.com/", &AtomicUsize::new(0), &policy).await;
        assert_eq!(result.code.as_deref(), Some("tls"));
        assert!(result.body.is_none());
        child.wait().unwrap();
    }
}
