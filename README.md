# promptdiff

**The regression-test gate for AI-generated prompts.** Any optimizer (Anthropic's Prompt
Improver, OpenAI's Playground, DSPy, an in-house tool, or Claude itself) can suggest
a new prompt. promptdiff is what you run before you ship it — to prove the new prompt
holds the behaviors you actually care about, and at what cost.

Two modes:

```bash
# Compare two prompt versions against a YAML test suite
promptdiff diff v1.txt v2.txt --suite tests.yaml

# Or: hand it your prompt + suite, get a verified-better candidate back
promptdiff suggest prompt.txt --suite tests.yaml --output improved.txt
```

It does one thing well: **decide whether the new prompt is shippable.** Not a prompt
manager, not a red-teaming tool, not a dashboard.

---

## Contents

- [Try it on the bundled example](#try-it-on-the-bundled-example)
- [Install](#install)
- [`promptdiff suggest` — auto-improve a prompt](#promptdiff-suggest--auto-improve-a-prompt)
- [`promptdiff diff` — compare two prompts](#promptdiff-diff--compare-two-prompts)
- [CLI reference](#cli-reference)
- [Test suite format](#test-suite-format)
- [Supported providers](#supported-providers)
- [Library usage](#library-usage)
- [Cache](#cache)
- [CI integration](#ci-integration)
- [Under the hood](#under-the-hood)
- [What promptdiff doesn't do (by design)](#what-promptdiff-doesnt-do-by-design)

---

## Try it on the bundled example

### `suggest`: rewrite a weak prompt and prove the rewrite is better

Real output from running against a deliberately weak baseline (a generic "be helpful"
prompt) and asking `claude-sonnet-4-5` to fix it:

```
promptdiff suggest: tests/fixtures/prompts/v0-weak.txt
────────────────────────────────────────────────────────────
  Rewriter:          claude-sonnet-4-5
  Verdict:           ACCEPT — suggestion improves baseline
  Score vs baseline: 96 / 100
  Cost (avg/call):   $0.00198 → $0.00076  (-61.7%)

  Baseline weaknesses targeted by the rewriter:
    ✗ late_shipment_refund_request
        must contain "support@lumen.example"
    ✗ bulb_wont_connect_to_wifi
        output length must be under 600 characters
    ✗ angry_repeat_customer
        must contain "support@lumen.example"

  Per-test outcome (suggestion vs baseline):
    ✓ late_shipment_refund_request      98
    ✓ bulb_wont_connect_to_wifi         97
    ✓ non_lumen_product_question        95
    ✓ format_structured_reply           95
    ✓ angry_repeat_customer             93
```

**Every deterministic failure fixed. Every test passes. Cost down 61.7% per call.** The
suggested prompt is saved to the path you pass with `--output`. Exit code is 0 if the
rewrite beats the threshold, 1 if it doesn't (so CI can gate on it).

### `diff`: prove a hand-written v2 holds the behaviors of v1

Same fixture, comparing the bundled terse v1 against the empathy-first v2:

```
promptdiff: tests/fixtures/prompts/v1.txt → tests/fixtures/prompts/v2.txt
────────────────────────────────────────────────────────────
  Verdict:           PASS
  Regression Score:  97 / 100
  Tests:             5 passed, 0 warn, 0 failed (5 total)

  Cost (avg/call):   $0.00051 → $0.00061  (+19.5%)
  Text diff:         +12 / -5 lines, tokens Δ 68 (+79.1%)
────────────────────────────────────────────────────────────

  ✓ late_shipment_refund_request      98
  ✓ bulb_wont_connect_to_wifi         98
  ✓ non_lumen_product_question        95
  ✓ format_structured_reply           95
  ✓ angry_repeat_customer             98
```

v2 holds every policy v1 held (refund escalation, non-Lumen decline) and scores 95–98 on
every judge criterion — but the longer prompt costs **+19.5% per call**. That's the
trade-off you couldn't see without this tool.

Reproduce both:

```bash
git clone https://github.com/ac12644/prompt-diff.git
cd prompt-diff
cp .env.example .env       # then paste your ANTHROPIC_API_KEY into .env
npm install && npm run build

# Demo 1 — auto-improve the weak baseline
node bin/promptdiff.js suggest tests/fixtures/prompts/v0-weak.txt \
  -s tests/fixtures/suites/anthropic-smoke.yaml \
  --suggester claude-sonnet-4-5 --output /tmp/improved.txt --no-cache

# Demo 2 — diff two existing prompts
node bin/promptdiff.js diff \
  tests/fixtures/prompts/v1.txt tests/fixtures/prompts/v2.txt \
  -s tests/fixtures/suites/anthropic-smoke.yaml --no-cache
```

A Gemini equivalent (`tests/fixtures/suites/gemini-smoke.yaml`) ships with the same
scenarios for cross-provider comparison.

---

## Install

```bash
npm install -g promptdiff      # global CLI
# or
npx promptdiff …               # no install, one-off run
# or as a project dep
npm install --save-dev promptdiff
```

Then make API keys available — either via the shell …

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
```

… or drop a `.env` in the project root and `promptdiff` will pick it up automatically.
Copy `.env.example` to `.env` and fill in only the providers you'll use. `.env` is
gitignored and never included in the published package. Explicit shell exports always
override `.env` values, so you can override per-run.

---

## `promptdiff suggest` — auto-improve a prompt

The hero command. Give it one prompt + a suite. It runs the suite against your prompt,
asks a strong LLM (default `claude-opus-4-7`) to rewrite it focused on the failures, runs
the suite against the rewrite, and judges baseline-vs-suggestion using the same pipeline
as `diff`. You get back a **verified** rewrite, not a raw LLM suggestion.

```bash
promptdiff suggest prompts/v1.txt \
  --suite tests/suite.yaml \
  --suggester claude-sonnet-4-5 \
  --output prompts/v1-improved.txt \
  --min-improvement 90
```

| Flag | Default | Purpose |
|---|---|---|
| `--suggester <model>` | `claude-opus-4-7` (or first available) | Strong model used to rewrite the prompt. |
| `-o, --output <path>` | *(stdout only)* | Where to save the accepted suggestion. |
| `--min-improvement <n>` | `90` | Reject the rewrite if the diff score is below this. |
| `--no-cache` | off | Bypass cache. |
| `--format <type>` | `terminal` | `terminal` or `json` for piping. |

**Exit code is 0** if the rewrite is accepted (score ≥ `--min-improvement` and not failed),
**1** if rejected. So you can do:

```bash
promptdiff suggest p.txt -s tests.yaml -o p.improved.txt && mv p.improved.txt p.txt
```

— and your prompt only gets overwritten if the rewrite actually beat the suite.

---

## `promptdiff diff` — compare two prompts

Create `v1.txt` (current prompt) and `v2.txt` (candidate). Real example — a customer
support iteration:

```bash
cat > v1.txt <<'EOF'
You are a customer support agent. Respond in 1–3 sentences. Do not promise
refunds or compensation — escalate to support@example.com.
EOF

cat > v2.txt <<'EOF'
You are a customer support agent. Tone: warm, calm, concise. Acknowledge the
customer's situation in one short sentence before giving the next step. Keep
replies under 80 words. Do not promise refunds — escalate to support@example.com.
EOF
```

Create `tests.yaml` with the scenarios you want to keep working:

```yaml
model: claude-haiku-4-5         # or gpt-4o, gemini-2.5-flash, etc.
judge_model: claude-haiku-4-5   # cheap model used for llm_judge assertions
runs_per_test: 1
concurrency: 5

tests:
  - id: refund_request
    input: "I've waited 18 days for my order. I want a full refund NOW."
    assert:
      - type: contains
        value: "support@example.com"
      - type: not_contains
        value: "we'll refund"
      - type: llm_judge
        criteria: "Calm, does not promise a refund, directs to escalation email"

  - id: tone_under_pressure
    input: "This is the THIRD time I've contacted you. Escalate this NOW."
    assert:
      - type: not_contains
        value: "unfortunately"
      - type: llm_judge
        criteria: "Acknowledges repeated contact, professional, not defensive"
```

Run it:

```bash
promptdiff v1.txt v2.txt --suite tests.yaml
```

Gate CI on `--min-score 80` and you'll catch the moment a tweak silently breaks behavior.

---

## CLI reference

```
promptdiff diff <v1> <v2> --suite <path> [options]
promptdiff suggest <prompt> --suite <path> [options]
```

### `diff` options

```
  -s, --suite <path>  Path to test suite YAML  (required)
  -m, --model <name>  Override model from suite
  --min-score <n>     Exit 1 if regression score is below this (0–100)
  --no-cache          Skip the response cache; always call the provider
  --format <type>     Output format: terminal | json   (default: terminal)
```

### `suggest` options

```
  -s, --suite <path>           Path to test suite YAML  (required)
  --suggester <model>          Rewriter model (default: claude-opus-4-7)
  -o, --output <path>          Save the suggested prompt to this file
  --min-improvement <n>        Reject if diff score is below this (default: 90)
  --no-cache                   Skip the response cache
  --format <type>              terminal | json (default: terminal)
```

### Global

```
  -V, --version       Print version
  -h, --help          Print help
```

### Exit codes

| Code | Meaning |
|------|---------|
| 0    | All good. If `--min-score` was set, score met threshold. |
| 1    | Regression: score is below `--min-score`. |
| 2    | Config/file error (missing suite, malformed YAML, etc.). |
| 3    | Provider API error. |

### Environment variables

| Var                     | Purpose |
|-------------------------|---------|
| `OPENAI_API_KEY`        | Required for `gpt-*`, `o1-*`, `o3-*`, `o4-*` models. |
| `ANTHROPIC_API_KEY`     | Required for `claude-*` models. |
| `GEMINI_API_KEY`        | Required for `gemini-*` models. (`GOOGLE_API_KEY` is accepted as a fallback.) |
| `PROMPTDIFF_CACHE_DIR`  | Override cache directory (default: `.promptdiff-cache`). |

---

## Test suite format

```yaml
model: gpt-4o                # required: main model both prompts run against
judge_model: gpt-4o-mini     # optional: cheap model for llm_judge (default: gpt-4o-mini)
runs_per_test: 1             # optional: 1–10. Use >1 to average over output variance.
concurrency: 5               # optional: 1–20. Max parallel API calls.

tests:
  - id: greeting             # required: unique per test
    input: "Say hello to {{name}}."   # required: supports {{var}} interpolation
    vars:                    # optional: fills {{var}} placeholders in input
      name: "Alex"
    assert:                  # required: one or more assertions
      - type: contains
        value: "hello"
```

> **About `runs_per_test`:** Single calls can swing in length and phrasing. If your
> assertions are sensitive (e.g. `length_under`), set `runs_per_test: 3–5` to average
> across runs and reduce false signals. Cost scales linearly with this number.

### Assertion types

| Type            | Field      | Meaning |
|-----------------|------------|---------|
| `contains`      | `value`    | output must include the substring. |
| `not_contains`  | `value`    | output must not include the substring. |
| `length_under`  | `value`    | output length (chars) must be < value. |
| `starts_with`   | `value`    | output (trimmed) must start with value. |
| `regex`         | `value`    | regex must match the output. |
| `llm_judge`     | `criteria` | a cheap judge model scores both outputs against this criterion. |

### How scoring works

For each test pair, every deterministic assertion contributes 100 (pass or non-regression)
or 0 (v2 broke an assertion v1 passed). Each `llm_judge` assertion contributes the judge's
score for v2 (0–100). The per-test score is the mean of these; the top-level score is the
mean across all tests.

| Aggregate score | Verdict |
|-----------------|---------|
| ≥ 90            | `pass`  |
| 70 – 89         | `warn`  |
| < 70            | `fail`  |

The top-level verdict is also pushed to **fail** if a majority of individual tests failed,
or to at-least-**warn** if any test failed — so a single catastrophic test doesn't get
averaged away. A test where v2 returns a run error always reports `fail` regardless of
score.

---

## Supported providers

| Model prefix                    | Provider  | Env var(s)                            |
|---------------------------------|-----------|---------------------------------------|
| `gpt-*`, `o1-*`, `o3-*`, `o4-*` | OpenAI    | `OPENAI_API_KEY`                      |
| `claude-*`                      | Anthropic | `ANTHROPIC_API_KEY`                   |
| `gemini-*`                      | Google    | `GEMINI_API_KEY` *(or `GOOGLE_API_KEY`)* |

Mix freely: e.g. `model: claude-opus-4-7` with `judge_model: gemini-2.5-flash-lite`.

---

## Library usage

Beyond the CLI, promptdiff exports `orchestrate()` so you can embed it in your own tooling
or test harnesses. The compiled package ships TypeScript declaration files.

```typescript
import { orchestrate } from 'promptdiff'

const report = await orchestrate(
  'prompts/v1.txt',
  'prompts/v2.txt',
  'tests/suite.yaml',
  {
    apiKeys: {
      openai:    process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini:    process.env.GEMINI_API_KEY,
    },
    format: 'json',    // suppresses the terminal reporter
    noCache: false,
  },
)

console.log(`Score: ${report.regressionScore}, verdict: ${report.verdict}`)
if (report.regressionScore < 85) process.exit(1)
```

The full `DiffReport` shape (cost delta, per-test results, assertion outcomes, text diff)
is exported from `promptdiff` as well — see `dist/types.d.ts` for the complete type
surface.

---

## Cache

Responses are cached by `sha256(model + prompt + input)` under `.promptdiff-cache/`
(gitignore it). A second run with unchanged prompts and inputs is **instant and free**.
Bypass with `--no-cache`. Override the directory with `PROMPTDIFF_CACHE_DIR`.

---

## CI integration

```bash
promptdiff prompts/v1.txt prompts/v2.txt \
  --suite tests/suite.yaml \
  --min-score 85 \
  --format json > diff-report.json
```

Exit code is 1 if the aggregate score drops below 85. The JSON output is suitable for
posting as a PR comment or uploading as a build artifact.

---

## Under the hood

### How pricing stays fresh

None of OpenAI, Anthropic, or Google return cost in their API responses — only token
counts. So promptdiff computes USD cost client-side from a price table. Rather than
hand-maintain that table (which silently goes stale), we bundle a filtered snapshot of
[LiteLLM's community-maintained registry](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json),
which tracks 2,700+ models and updates within days of any provider price change.

```bash
npm run refresh-prices   # re-downloads upstream, writes src/providers/prices.json
```

The snapshot ships at `src/providers/prices.json` (~26 KB, 170 entries filtered to
chat-mode OpenAI/Anthropic/Gemini models). Unknown models fall back to a
$1/$3-per-million estimate so reports always show a non-zero cost — better than a
silently-wrong `$0.00000`.

### Architecture

Three layers with one-way dependencies (inward only):

- **IO** (`cli/`, `config/`, `providers/`, `reporters/`) — touches the outside world.
- **Core** (`core/differ/`, `core/runner/`, `core/judge/`, `core/scorer/`) — pure
  functions, fully tested without mocks or network.
- **Infra** (`infra/cache`, `infra/dotenv`, `infra/errors`, `infra/logger`) —
  cross-cutting concerns.

`src/orchestrate.ts` is the only place that wires modules together. Each module has
exactly one job, and assertions are data dispatched by a single `evaluate()` switch — so
adding a new assertion type is a 5-file change with a well-defined surface.

---

## What promptdiff doesn't do (by design)

- No prompt storage or versioning database
- No real-time streaming
- No multi-agent or chain evaluation
- No automatic test case generation
- No web UI

Run it from the CLI, gate CI on the score, move on.

---

## License

[MIT](./LICENSE)
