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
    // KNOT_BENCHMARK_SUITE=routing runs the automatic-routing cases instead.
    let routing = std::env::var("KNOT_BENCHMARK_SUITE").as_deref() == Ok("routing");
    // KNOT_BENCHMARK_SUITE=canvas runs the canvas awareness cases (16 November 2026).
    let canvas = std::env::var("KNOT_BENCHMARK_SUITE").as_deref() == Ok("canvas");
    // KNOT_BENCHMARK_SUITE=scenes compares canvas creation on the old path and
    // as composed scenes (17 November 2026).
    let scenes = std::env::var("KNOT_BENCHMARK_SUITE").as_deref() == Ok("scenes");
    // KNOT_BENCHMARK_SUITE=review runs scene reviews generated from a scenes
    // run (tests/benchmarks/review-scenes.mjs); KNOT_BENCHMARK_INPUT names the
    // generated file under tests/benchmarks/results.
    // KNOT_BENCHMARK_SUITE=file runs any generated file the same way (the
    // staged builds of build-scenes.mjs).
    let review = matches!(std::env::var("KNOT_BENCHMARK_SUITE").as_deref(), Ok("review" | "file"));
    // Per-case input reservation. The largest v1 case used 1,219 input tokens
    // (5 November 2026); 20,000 leaves a 16x margin, and any request reporting
    // more stops the run. Maximum output is capped by the request (6,000).
    // Web search results arrive as input tokens, so a case that offers
    // web_search reserves 80,000 input tokens plus three searches.
    // Reserve the input bound at the highest cache-write rate and maximum output.
    // User must configure STANDARD service and a matching provider project cap.
    // A case that may compose a scene reserves the scene's larger output cap.
    // The scenes suite (approved at US$1.20) reserves less: its prompts use
    // about 5,000 input tokens, and scene requests are capped at 12,000 output
    // tokens here so spending can't exceed what is reserved.
    let scene_output: u64 = if scenes { 12_000 } else { SCENE_MAX_OUTPUT };
    // A review reads a whole scene and a picture, and writes only changes.
    // Generated files may say how much input their cases need.
    let input_reserve: u64 = if scenes { 10_000 } else {
        std::env::var("KNOT_BENCHMARK_INPUT_RESERVE").ok().and_then(|n| n.parse().ok()).unwrap_or(20_000)
    };
    let output_cap = |case: &Value| -> u64 {
        if case["mode"] == "scene_review" || case["mode"] == "scene_connect" { 8_000 }
        else if case["mode"] == "scene_section" { 10_000 }
        else if case["tools"].as_array().is_some_and(|tools| tools.iter().any(|t| t == "create_on_canvas")) { scene_output } else { 6000 }
    };
    let limits = |case: &Value| -> (u64, u64, f64) {
        let web = case["tools"].as_array().is_some_and(|tools| tools.iter().any(|t| t == "web_search"));
        let (input, searches) = if web { (80_000, 3) } else { (input_reserve, 0) };
        let output = output_cap(case);
        let usd = estimate(
            &model,
            &Usage {
                input: Some(input),
                cached: Some(0),
                output: Some(output),
                cache_write: Some(input),
                cache_write_30m: Some(0),
                cache_write_12h: Some(input),
                ..Usage::default()
            },
            Some("default"),
        )
        .unwrap()
            + searches as f64 * crate::diagnostics::WEB_SEARCH_USD;
        (input, searches, usd)
    };
    let generated = review.then(|| {
        let name = std::env::var("KNOT_BENCHMARK_INPUT").expect("Name the generated review file");
        assert!(!name.contains(['/', '\\']) && name.ends_with(".json"), "A file name in tests/benchmarks/results");
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/benchmarks/results").join(name)).unwrap()
    });
    let suite: Value = serde_json::from_str(if let Some(text) = &generated {
        text.as_str()
    } else if scenes {
        include_str!("../../tests/benchmarks/scenes.v1.json")
    } else if canvas {
        include_str!("../../tests/benchmarks/canvas.v1.json")
    } else if routing {
        include_str!("../../tests/benchmarks/routing.v1.json")
    } else {
        include_str!("../../tests/benchmarks/cases.v1.json")
    })
    .unwrap();
    let all = suite["cases"].as_array().unwrap();
    if !review {
        assert_eq!(all.len(), if scenes || canvas { 16 } else if routing { 34 } else { 60 });
    }
    // KNOT_BENCHMARK_CASES (comma-separated IDs) repeats a few cases cheaply.
    let only = std::env::var("KNOT_BENCHMARK_CASES").ok();
    let cases: &Vec<Value> = &match &only {
        Some(ids) => {
            let ids: Vec<&str> = ids.split(',').map(str::trim).collect();
            let picked: Vec<Value> = all.iter().filter(|c| ids.contains(&c["id"].as_str().unwrap())).cloned().collect();
            assert_eq!(picked.len(), ids.len(), "Unknown case ID in KNOT_BENCHMARK_CASES");
            picked
        }
        None => all.clone(),
    };
    let reserved = cases.iter().map(|case| limits(case).2).sum::<f64>();
    let largest = cases.iter().map(|case| limits(case).2).fold(0.0, f64::max);
    println!("Conservative reservation for {} cases: US${reserved:.4}", cases.len());
    assert!(
        reserved <= budget,
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
        .map(|row| row["cost_usd"].as_f64().unwrap_or(largest))
        .sum::<f64>();
    let completed: std::collections::HashSet<String> = prior
        .iter()
        .skip(1)
        .filter(|row| row["success"] == true)
        .filter_map(|row| row["case"].as_str().map(str::to_owned))
        .collect();
    assert!(
        spent
            + cases
                .iter()
                .filter(|case| !completed.contains(case["id"].as_str().unwrap()))
                .map(|case| limits(case).2)
                .sum::<f64>()
            <= budget,
        "Remaining suite exceeds remaining approved budget"
    );
    let mut file = std::fs::OpenOptions::new()
        .create_new(resume.is_none())
        .append(true)
        .open(&result_path)
        .unwrap();
    if resume.is_none() {
        writeln!(file,"{}",json!({"run":run_id,"suite":suite["version"],"model":model,"budget_usd":budget,"reserved_usd":reserved,"kind":"live","quality_status":"ungraded","pricing_version":crate::diagnostics::PRICING_VERSION,"label":std::env::var("KNOT_BENCHMARK_LABEL").ok(),"cases":only,"input_reserve_tokens":input_reserve,"scene_output_cap":scene_output,"web_input_reserve_tokens":80_000})).unwrap();
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
            let (input_reserve, search_limit, reserve) = limits(case);
            assert!(spent + reserve <= budget, "Spending limit reached");
            let messages: Vec<Message> = serde_json::from_value(case["messages"].clone()).unwrap();
            let context = case["context"].to_string();
            let asset = |key: &str| case[key].as_str().map(|name| {
                assert!(["diagram.data","report.data"].contains(&name));
                std::fs::read_to_string(root.join("assets").join(name)).unwrap()
            });
            let image = asset("image_asset").or_else(|| {
                // A review's schematic travels in the generated file.
                case["image_data"].as_str().filter(|d| d.starts_with("data:image/png;base64,")).map(str::to_owned)
            });
            let pdf = asset("pdf_asset");
            // The old canvas path was removed in orchestration phase 5: its
            // cases are sent as scenes, and the scenes suite's old-path cases
            // (kept for their recorded results) are skipped.
            if case["path"] == "old" {
                println!("{}: skipped, the old canvas path no longer exists", case["id"]);
                continue;
            }
            let mode = match case["mode"].as_str().unwrap() { "canvas" => "scene", other => other };
            let tools: Vec<String> = serde_json::from_value(case["tools"].clone()).unwrap_or_default();
            // A completed search, to check results are accepted and used.
            let searches: Vec<SearchResult> = serde_json::from_value(case["searches"].clone()).unwrap_or_default();
            let viewed: Vec<ImageResult> = serde_json::from_value(case["viewed"].clone()).unwrap_or_default();
            let mut body = if mode == "auto" { tool_request_body(&model,&messages,&context,&tools,&searches,&viewed,image.as_deref(),pdf.as_deref()) } else { request_body(&model,&messages,&context,mode,image.as_deref(),pdf.as_deref()) };
            // Never let a request produce more output than its reservation.
            let cap = output_cap(case).min(body["max_output_tokens"].as_u64().unwrap_or(u64::MAX));
            body["max_output_tokens"] = json!(cap);
            assert!(context.len() + messages.iter().map(|m|m.content.len()).sum::<usize>() < 100_000);
            let output = Arc::new(Mutex::new(String::new())); let copy = output.clone();
            let route = Arc::new(Mutex::new(String::from("answer"))); let called = route.clone();
            let web = Arc::new(Mutex::new(0u64)); let searched = web.clone();
            let channel = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(s) = body {
                    let v: Value = serde_json::from_str(&s).unwrap();
                    if let Some(name) = v["call"].as_str() { name.clone_into(&mut called.lock().unwrap()); }
                    // A hosted web search is not a function call.
                    if v["status"] == "web" { "web_search".clone_into(&mut called.lock().unwrap()); *searched.lock().unwrap() += 1; }
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
            let searches = *web.lock().unwrap();
            let cost = estimate(&model,&measurement.attempt.usage,measurement.attempt.service_tier.as_deref())
                .map(|usd| usd + searches as f64 * crate::diagnostics::WEB_SEARCH_USD);
            // Unknown pricing consumes the full reservation. Continue only when
            // reported standard-tier input/output proves it is within that bound.
            spent += cost.unwrap_or(reserve);
            writeln!(file,"{}",json!({"case":case["id"],"category":case["category"],"model":model,"output":*output.lock().unwrap(),"usage":measurement.attempt.usage,"service_tier":measurement.attempt.service_tier,"cost_usd":cost,"elapsed_ms":start.elapsed().as_millis(),"success":result.is_ok(),"failure":result.as_ref().err(),"spent_or_reserved_usd":spent,"rubric":case["rubric"],"scores":null,"route":*route.lock().unwrap(),"expected_route":case["expected_route"],"route_ok":case.get("expected_route").map(|e| e == &json!(*route.lock().unwrap()))})).unwrap();
            file.flush().unwrap();
            println!("{}: success={}, accounted USD {:.6}/{:.2}",case["id"],result.is_ok(),spent,budget);
            let bounded = matches!(measurement.attempt.service_tier.as_deref(), Some("default" | "standard"))
                && measurement.attempt.usage.input.is_some_and(|n| n <= input_reserve)
                && searches <= search_limit
                && measurement.attempt.usage.output.is_some_and(|n| n <= output_cap(case));
            assert!(result.is_ok() && bounded && cost.is_none_or(|n| n <= reserve), "Request failed or reservation cannot be verified; stopped, results are partial and ungraded");
        }
    });
}
