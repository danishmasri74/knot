// Opt-in paid evaluation. This file is compiled ONLY into the test binary.
// Ordinary cargo test never runs it. Responses here belong to synthetic fixtures,
// not the application's private diagnostics database.
#[test]
#[ignore = "PAID evaluation: requires explicit budget, model, and acknowledgement; see tests/benchmarks/README.md"]
fn live_quality_benchmark() {
    use crate::diagnostics::{estimate, Composition, Diagnostics, Measurement, Usage};
    use std::io::Write;
    assert_eq!(
        std::env::var("KNOT_BENCHMARK_APPROVED").as_deref(),
        Ok("paid-synthetic-evaluation"),
        "Explicit approval is required"
    );
    let budget: f64 = std::env::var("KNOT_BENCHMARK_BUDGET_USD")
        .expect("Set a spending limit before execution")
        .parse()
        .expect("Numeric USD budget");
    assert!(budget.is_finite() && budget > 0.0);
    let model = std::env::var("KNOT_BENCHMARK_MODEL").expect("Explicit model required");
    assert!(MODELS.contains(&model.as_str()));
    // Per-case input reservation. The largest v1 case used 1,219 input tokens
    // (5 November 2026); 20,000 leaves a 16x margin, and any request reporting
    // more stops the run. Maximum output is capped by the request (6,000).
    const INPUT_RESERVE: u64 = 20_000;
    // Reserve the input bound at the highest cache-write rate and maximum output.
    // User must configure STANDARD service and a matching provider project cap.
    let reserve = estimate(
        &model,
        &Usage {
            input: Some(INPUT_RESERVE),
            cached: Some(0),
            output: Some(6000),
            cache_write: Some(INPUT_RESERVE),
            cache_write_30m: Some(0),
            cache_write_12h: Some(INPUT_RESERVE),
            ..Usage::default()
        },
        Some("default"),
    )
    .unwrap();
    // KNOT_BENCHMARK_SUITE=routing runs the automatic-routing cases instead.
    let routing = std::env::var("KNOT_BENCHMARK_SUITE").as_deref() == Ok("routing");
    let suite: Value = serde_json::from_str(if routing {
        include_str!("../../tests/benchmarks/routing.v1.json")
    } else {
        include_str!("../../tests/benchmarks/cases.v1.json")
    })
    .unwrap();
    let cases = suite["cases"].as_array().unwrap();
    assert_eq!(cases.len(), if routing { 27 } else { 60 });
    assert!(
        reserve * cases.len() as f64 <= budget,
        "Budget is below the conservative full-suite reservation; no calls made"
    );
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/benchmarks");
    let results = root.join("results");
    std::fs::create_dir_all(&results).unwrap();
    let resume = std::env::var("KNOT_BENCHMARK_RESUME")
        .ok()
        .map(|id| uuid::Uuid::parse_str(&id).expect("Resume must be an existing run UUID"));
    let run_id = resume.unwrap_or_else(uuid::Uuid::new_v4);
    let result_path = results.join(format!("{run_id}.jsonl"));
    let prior: Vec<Value> = if resume.is_some() {
        std::fs::read_to_string(&result_path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    } else {
        Vec::new()
    };
    if let Some(header) = prior.first() {
        assert_eq!(header["model"], model);
        assert_eq!(header["suite"], suite["version"]);
        assert_eq!(header["budget_usd"].as_f64(), Some(budget));
    }
    let mut spent = prior
        .iter()
        .skip(1)
        .map(|row| row["cost_usd"].as_f64().unwrap_or(reserve))
        .sum::<f64>();
    let completed: std::collections::HashSet<String> = prior
        .iter()
        .skip(1)
        .filter(|row| row["success"] == true)
        .filter_map(|row| row["case"].as_str().map(str::to_owned))
        .collect();
    assert!(
        spent + reserve * (cases.len() - completed.len()) as f64 <= budget,
        "Remaining suite exceeds remaining approved budget"
    );
    let mut file = std::fs::OpenOptions::new()
        .create_new(resume.is_none())
        .append(true)
        .open(&result_path)
        .unwrap();
    if resume.is_none() {
        writeln!(file,"{}",json!({"run":run_id,"suite":suite["version"],"model":model,"budget_usd":budget,"reserved_usd":reserve*cases.len() as f64,"kind":"live","quality_status":"ungraded","pricing_version":crate::diagnostics::PRICING_VERSION,"label":std::env::var("KNOT_BENCHMARK_LABEL").ok(),"input_reserve_tokens":INPUT_RESERVE})).unwrap();
    }
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let temporary = tempfile::tempdir().unwrap();
        let store = Diagnostics::open(temporary.path().join("disabled.sqlite"));
        // Measurement is used in-memory only; save/finish are deliberately not called.
        for case in cases {
            if completed.contains(case["id"].as_str().unwrap()) { continue; }
            assert!(spent + reserve <= budget, "Spending limit reached");
            let messages: Vec<Message> = serde_json::from_value(case["messages"].clone()).unwrap();
            let context = case["context"].to_string();
            let asset = |key: &str| case[key].as_str().map(|name| {
                assert!(["diagram.data","report.data"].contains(&name));
                std::fs::read_to_string(root.join("assets").join(name)).unwrap()
            });
            let image = asset("image_asset"); let pdf = asset("pdf_asset");
            let mode = case["mode"].as_str().unwrap();
            let tools: Vec<String> = serde_json::from_value(case["tools"].clone()).unwrap_or_default();
            // A completed search, to check results are accepted and used.
            let searches: Vec<SearchResult> = serde_json::from_value(case["searches"].clone()).unwrap_or_default();
            let body = if mode == "auto" { tool_request_body(&model,&messages,&context,&tools,&searches,image.as_deref(),pdf.as_deref()) } else { request_body(&model,&messages,&context,mode,image.as_deref(),pdf.as_deref()) };
            assert!(context.len() + messages.iter().map(|m|m.content.len()).sum::<usize>() < 100_000);
            let output = Arc::new(Mutex::new(String::new())); let copy = output.clone();
            let route = Arc::new(Mutex::new(String::from("answer"))); let called = route.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                    let v: Value = serde_json::from_str(&s).unwrap();
                    if let Some(name) = v["call"].as_str() { name.clone_into(&mut called.lock().unwrap()); }
                    if let Some(delta) = v["delta"].as_str() { copy.lock().unwrap().push_str(delta); }
                } Ok(())
            });
            store.test_enabled(true);
            let mut measurement = Measurement::new(&store,&uuid::Uuid::new_v4().to_string(),&model,mode,None,Composition::context(&context));
            let start = std::time::Instant::now();
            // Same production transport and stream consumer; no auto-retries.
            let result = async {
                let response = client()?.post("https://api.openai.com/v1/responses").bearer_auth(key()?).json(&body).send().await.map_err(|_|"Connection failed".to_string())?;
                if !response.status().is_success() { return Err(response_error(response).await); }
                consume_response(response,channel,&mut measurement,&tools).await
            }.await;
            let cost = estimate(&model,&measurement.attempt.usage,measurement.attempt.service_tier.as_deref());
            // Unknown pricing consumes the full reservation. Continue only when
            // reported standard-tier input/output proves it is within that bound.
            spent += cost.unwrap_or(reserve);
            writeln!(file,"{}",json!({"case":case["id"],"category":case["category"],"model":model,"output":*output.lock().unwrap(),"usage":measurement.attempt.usage,"service_tier":measurement.attempt.service_tier,"cost_usd":cost,"elapsed_ms":start.elapsed().as_millis(),"success":result.is_ok(),"failure":result.as_ref().err(),"spent_or_reserved_usd":spent,"rubric":case["rubric"],"scores":null,"route":*route.lock().unwrap(),"expected_route":case["expected_route"],"route_ok":case.get("expected_route").map(|e| e == &json!(*route.lock().unwrap()))})).unwrap();
            file.flush().unwrap();
            println!("{}: success={}, accounted USD {:.6}/{:.2}",case["id"],result.is_ok(),spent,budget);
            let bounded = matches!(measurement.attempt.service_tier.as_deref(), Some("default" | "standard"))
                && measurement.attempt.usage.input.is_some_and(|n| n <= INPUT_RESERVE)
                && measurement.attempt.usage.output.is_some_and(|n| n <= 6000);
            assert!(result.is_ok() && bounded && cost.is_none_or(|n| n <= reserve), "Request failed or reservation cannot be verified; stopped, results are partial and ungraded");
        }
    });
}
