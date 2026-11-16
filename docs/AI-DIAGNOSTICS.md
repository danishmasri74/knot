# AI measurement baseline (Milestone 1)

Settings → AI → Usage & diagnostics provides collection control, counts, usage and
cost coverage, model/operation/status/time filters, recent attempts, context sizes,
application outcomes, JSON export and confirmed clear. Collection defaults on.
It is independent of the AI feature visibility switch. Disabling collection does
not erase existing records; clear removes them and invalidates in-flight writes.

## Data and isolation

`ai-diagnostics.sqlite` lives directly in the application local-data directory,
outside every workspace. Workspace backup/export only includes its manifest,
workspace database and referenced assets, so diagnostics are excluded. Moving,
restoring and switching workspaces do not move or reset diagnostics. The database
does not contain workspace identities, document IDs, names, paths or content.

Each request has a random attempt UUID, approved model and operation, UTC start,
elapsed and first-text timing, response byte count, coarse failure category,
HTTP status and terminal status. Retry/regeneration/edited-prompt links contain
only attempt UUIDs, never chat or note identifiers. Start and finish upsert one
row. Process-interrupted running rows become `interrupted` at next startup.
Provider usage is copied only from allowlisted numeric fields of terminal events.
Missing usage remains null, including cancelled and failed requests without usage.

Source composition records UTF-8 context/message byte sizes, serialized sizes of
text/structure/citation table/surrounding context/runs/added notes, item counts and
encoded image/PDF transport sizes. These are not token estimates. Composition
sizes describe the frozen renderer context. Since 11 November 2026, note context
is compacted before sending (see [AI.md](AI.md)), so `payload_bytes` (the request
actually sent) can be much smaller than the sum of these components. Counters contain no ordinary prompts, answers, note
contents/titles, attachments, file paths, API keys or provider error bodies.

Answer display, proposal validation, successful/failed Apply, Dismiss and
successful/failed guarded Undo are separate application outcomes. Each outcome
kind is recorded once per attempt, so repeat clicks do not inflate counts.
Generic editor Undo outside the Ask Knot button is not attributed to an AI
attempt. Preflight failures before `ai_respond` (for example unavailable source
attachments) are not provider attempts and are not collected.

One dedicated thread owns SQLite. A 256-item nonblocking queue bounds memory;
overflow drops measurements rather than delaying AI. SQLite has a 100 ms busy
timeout. Queue drops and storage failures appear as session counters. AI does not
await disk writes. Retention runs on startup, writes, reads and exports: 90 days
or the newest 20,000 attempts, with cascading outcome deletion. Export is an
explicit user action. Secure-delete and clear/VACUUM remove retained records;
this is not a guarantee against forensic recovery or copies of prior exports.
Shutdown/crashes may lose queued measurements; diagnostics are best effort.

## Pricing provenance

Version `openai-standard-2026-11-05-v1`, verified November 5, 2026 from official
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4), and
[cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching).

USD per million tokens, standard processing, at most 272,000 input tokens:

| Model | Input | Cached read | Output |
| --- | ---: | ---: | ---: |
| gpt-6-luna | 0.10 | 0.01 | 0.50 |
| gpt-6.1-terra | 1.00 | 0.05 | 5.00 |
| gpt-6.1-sol | 2.00 | 0.10 | 10.00 |
| gpt-6-astra | 10.00 | 1.00 | 50.00 |
| gpt-5.4-mini | 0.75 | 0.075 | 4.50 |
| gpt-5.4 | 2.50 | 0.25 | 15.00 |

GPT-6 cache writes use 1.25× input for 30 minutes and 2.5× for 12 hours. Ordinary
input = input − cached reads − cache writes. The two write lifetimes sum to cache
writes. Reasoning is already in output. Never add total tokens or reasoning again.
Missing GPT-6 write breakdown for positive writes, missing required usage, unrecognized models,
nonstandard/unknown service tiers and long context produce unknown estimates.
Older GPT-5.4 models have no separate cache-write charge. Stored estimates retain
their pricing version; changes must introduce a new version rather than silently
repricing historical attempts. Estimates exclude taxes and account-specific terms.
Coverage counts known estimates/usage over all filtered attempts, including
failures and cancellations. Application outcomes never add cost.
When the provider explicitly reports zero cache writes, omitted lifetime subsets
have zero cost; their raw diagnostic fields remain null.

Version `openai-standard-2026-11-11-v2` (11 November 2026) keeps v1's prices.
Knot never requests a 12-hour cache TTL, so a positive GPT-6 cache-write total
reported with *both* lifetime fields missing is priced as 30-minute writes.
A partial or contradictory breakdown stays unknown. Raw lifetime fields remain
null in diagnostics. Attempts estimated under v1 keep their stored version and
unknown cost; they are not repriced.

Version `openai-standard-2026-11-13-v3` (13 November 2026): every short-context
price above was re-verified against the official pricing page and is unchanged.
Requests above 272,000 input tokens now use the published long-context rates
(USD per million: input / cached read / output; cache writes stay 1.25× and 2.5×
of the long-context input price):

| Model | Input | Cached read | Output |
| --- | ---: | ---: | ---: |
| gpt-6-luna | 0.20 | 0.02 | 0.75 |
| gpt-6.1-terra | 2.00 | 0.10 | 7.50 |
| gpt-6.1-sol | 4.00 | 0.20 | 15.00 |
| gpt-6-astra | 20.00 | 2.00 | 75.00 |
| gpt-5.4 | 5.00 | 0.50 | 22.50 |

GPT-5.4 mini publishes no long-context rate, so those requests stay unknown.
Regional-processing and FedRAMP uplifts are not applied; Knot uses the global
endpoint. The same estimate is shown per answer in Ask Knot (docs/AI.md), computed
from the stream even when diagnostics are off; diagnostics still store nothing
unless enabled.

## Prompt caching (16 November 2026)

The overview's **Prompt caching** tile shows what caching saved or cost for the selected
attempts: read savings (cached input at its lower rate, against ordinary input) minus the
write extra (cache writes above ordinary input: 25% for 30-minute writes, 150% for
12-hour writes). **Prompt caching by operation** lists the share of input read from the
cache, write extra and savings per operation, plus how many first questions paid to
write and how many follow-up turns there were. Figures come from `cache_effect` in
`src-tauri/src/diagnostics.rs` and are computed when diagnostics are read, at current
rates, so older records are included; attempts without complete usage are left out.
Automatic-mode operations (`auto:answer`, `auto:canvas` and so on) and suggestions now
have labels and appear in the Operation filter.

## Verification and quality

Rust tests compare serialized outgoing bodies against the frozen pre-measurement
builder for six models × four operations × two image variants × three PDF variants
with collection on/off. Backend HTTP tests exercise byte-fragmented SSE, Unicode,
LF/CRLF boundaries, completion/failure/incomplete streams. Storage tests cover
content exclusion in exports/database bytes, retention, upsert, queue saturation,
unavailable SQLite and clear while an attempt is in flight. Frontend tests cover
summary coverage and the 60-case manifest; native tests exercise real IPC/settings.

The versioned [quality suite](../tests/benchmarks/README.md) is separate from these
offline regression checks. Paid execution requires an approved spending limit and
explicit opt-in. No live quality baseline is claimed by this implementation.
