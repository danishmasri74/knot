// One-off paid probe (18 November 2026): does the provider's prompt cache
// reuse PDF file inputs? Sends three scene_section-shaped requests to the
// cheapest model: two sections that differ only in their last message, then
// the second one again. Prints each request's input, cached and written
// tokens. Compiled only into the test binary and ignored by default.
#[test]
#[ignore = "PAID probe: set KNOT_CACHE_PROBE=approved"]
fn pdf_inputs_and_the_prompt_cache() {
    assert_eq!(std::env::var("KNOT_CACHE_PROBE").as_deref(), Ok("approved"));
    use base64::Engine;
    let pdf = |path: &str| {
        let bytes = std::fs::read(path).unwrap();
        format!("data:application/pdf;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
    };
    let files = vec![
        PdfFile { name: "ocr-scan.pdf".into(), data: pdf("../tests/fixtures/ocr-scan.pdf") },
        PdfFile { name: "report.pdf".into(), data: pdf("../tests/benchmarks/assets/report.pdf") },
    ];
    let model = "gpt-6-luna";
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    // KNOT_CACHE_PROBE_TEXT=1: a long text context and no files instead.
    let text = std::env::var("KNOT_CACHE_PROBE_TEXT").is_ok();
    let context = if text {
        json!({"sourceType": "note", "text": "Maintenance testing checks that changes to software in production keep it working. ".repeat(120)}).to_string()
    } else { "{}".to_string() };
    let send = |section: &str| {
        let messages = vec![
            Message { role: "user".into(), content: "Make revision notes from these files.".into() },
            Message { role: "user".into(), content: format!("Build section \"{section}\".") },
        ];
        let mut body = request_body(model, &messages, &context, "scene_section", None, None);
        if !text { attach_pdf_files(&mut body, &files); }
        // As respond() sends a section request.
        if std::env::var("KNOT_CACHE_PROBE_BREAKPOINT").is_ok() { cache_shared_prefix(&mut body, model); }
        body["stream"] = json!(false);
        body["max_output_tokens"] = json!(300);
        let body = body.clone();
        runtime.block_on(async move {
            let response = client().unwrap()
                .post("https://api.openai.com/v1/responses")
                .bearer_auth(key().unwrap())
                .json(&body)
                .send().await.unwrap();
            let value: Value = response.json().await.unwrap();
            let usage = &value["usage"];
            println!(
                "{section}: input {} cached {} written {} output {}",
                usage["input_tokens"], usage["input_tokens_details"]["cached_tokens"],
                usage["input_tokens_details"]["cache_write_tokens"], usage["output_tokens"]
            );
            if usage.is_null() { println!("{value}"); }
        });
    };
    send("one");
    std::thread::sleep(std::time::Duration::from_secs(3));
    send("two");
    std::thread::sleep(std::time::Duration::from_secs(3));
    send("two");
}
