# QuantMind System Analysis and Ground-Up Redesign

## 1) Current System Purpose

QuantMind is a read-only crypto market intelligence dashboard. It scans a watchlist, computes indicators/structure signals, scores directional bias, optionally generates AI commentary, and creates risk-planned directional predictions. The UI is optimized for rapid trader interpretation rather than automated execution.

## 2) File-by-File Analysis (project source)

> Scope note: `node_modules/` is third-party vendor code and is intentionally excluded from domain analysis.

### Root / Build / Runtime Files

- **`README.md`**
  - Basic setup/run instructions and AI Studio link.
  - Missing architecture and operational guidance.
- **`TECHNICAL_REVIEW.md`**
  - Existing diagnostic review identifying calibration, modularity, and performance gaps.
  - Strongly aligns with introducing probabilistic modeling and typed event contracts.
- **`package.json`**
  - Lean runtime/development dependency profile (React + Vite + Recharts + Gemini SDK).
- **`tsconfig.json`**
  - Standard TS settings for modern ES module output.
- **`vite.config.ts`**
  - Injects Gemini API key into client build-time env; configures host/port and aliasing.
- **`index.html`**
  - Tailwind CDN configuration and application root.
  - Includes custom visual style system and import map.
- **`index.tsx`**
  - Minimal React root mounting logic.
- **`metadata.json`**
  - Product metadata declaration.
- **`constants.ts`**
  - Global watchlist/default timeframe and legacy scoring constants.
- **`types.ts`**
  - Core domain contracts for market analysis, events, alerts, and predictions.
  - Serves as the canonical inter-module interface.

### API / Services

- **`api/coinex.ts`**
  - Server-side/proxy route to safely relay CoinEx requests.
  - Security-aware endpoint shaping, prevents arbitrary absolute URL abuse.
- **`services/coinex.ts`**
  - Client adapter for market data retrieval (candles, ticker, order book imbalance, top markets, links).
  - Includes fail-safe parsing and normalization.
- **`services/indicators.ts`**
  - Numeric engine for SMA/EMA/RSI/StochRSI/MACD/BB/ATR and market-structure helpers (SR/order blocks).
  - Foundational layer used by analyzer and chart prep.
- **`services/analyzer.ts`**
  - Main deterministic multi-factor scorer (`scoreMarket`), event flag emitter, institutional/perfect-trade overlays.
  - Large, high-responsibility module (feature extraction + scoring + policy rules).
- **`services/predictor.ts`**
  - Converts analysis + levels + recent candles into directional bias, probability, RR plan, reasoning, and audit trail.
  - Historically heuristic-weighted; now upgraded with a probabilistic ensemble core.
- **`services/probabilisticEngine.ts`** *(new)*
  - Bayesian-like ensemble utility converting weighted directional factors into bull/bear/neutral probabilities.
  - Adds uncertainty attenuation, contradiction penalties, and interpretable diagnostics.
- **`services/geminiService.ts`**
  - AI summarization wrapper.
- **`services/i18n.ts`**
  - Translation dictionaries and reason-code mapping.
- **`services/telegram.ts`**
  - Alert formatting, gating/throttling, Telegram dispatch.
- **`services/opposite.ts`**
  - Inversion utilities for opposite-mode interpretation.

### UI Components / Utils

- **`App.tsx`**
  - Monolithic orchestration shell handling scan loop, market list, detail chart loading, alert workflows, prediction modal, and settings.
  - Contains rich UX logic but mixes data orchestration and presentational concerns.
- **`components/Chart.tsx`**
  - Time-series chart rendering with overlays.
- **`components/OrderBlockHeatmap.tsx`**
  - Visual overlay for order-block/heatmap contextualization.
- **`utils/formatters.ts`**
  - Numeric display formatting helpers.

## 3) Current Interactions, Data Flow, and Responsibilities

1. **Polling loop (App)** fetches watchlist candles/tickers/order-book proxies via `services/coinex.ts`.
2. **Indicator layer** (`services/indicators.ts`) computes technical and structural primitives.
3. **Analysis layer** (`services/analyzer.ts`) transforms primitives into scored `MarketAnalysis` and event flags.
4. **Prediction layer** (`services/predictor.ts`) generates directional forecast + risk plan using `MarketAnalysis`, SR levels, and candles.
5. **Alerting layer** (`services/telegram.ts`) gates/sends formatted events.
6. **Presentation layer** (`App.tsx`, `components/*`) renders cards, charts, modals, and translated rationale.
7. **Optional GenAI commentary** via `services/geminiService.ts` enriches user understanding.

## 4) Architectural Issues Identified

- Overloaded core modules (`App.tsx`, `analyzer.ts`, `predictor.ts`) reduce testability.
- Multiple rule stacks can double-count latent signals.
- Historical probability formulation lacked explicit uncertainty model.
- Client polling and enrichment can become stale under network/API latency.
- Limited explicit data-quality and observability contracts.

## 5) Ground-Up Superior Architecture (proposed)

```text
src/
  app/
    AppShell.tsx
    routes/
    state/
  domain/
    entities/
    valueObjects/
    events/
  data/
    coinex/
      restClient.ts
      mapper.ts
      schemas.ts
    cache/
    telemetry/
  features/
    indicators/
    structure/
    orderflow/
    volatility/
  models/
    probabilistic/
      ensemble.ts
      calibration.ts
      diagnostics.ts
  risk/
    planner.ts
    constraints.ts
    portfolio.ts
  alerts/
    rules.ts
    transports/
  i18n/
  ui/
    components/
    charts/
```

### Why this is superior
- **Cleaner boundaries:** Data adapters, feature calculators, probabilistic model, and risk policies are independently testable.
- **Scalable:** Bounded-concurrency scan workers and rolling caches become natural in `data/cache` and scheduler modules.
- **Maintainable:** Typed event contracts flow through alert/UI layers instead of string parsing.
- **Performant:** Incremental indicator updates and decoupled view-model transforms reduce recomputation.
- **Robust:** Explicit uncertainty + data quality can down-weight confidence under partial data.

## 6) New Core Algorithm Implemented

A new mathematically grounded ensemble (`services/probabilisticEngine.ts`) was implemented and integrated into `services/predictor.ts`.

### Algorithm design

1. **Factor standardization**
   - Each factor score is centered/scaled around 50 into a bounded z-like evidence value.
2. **Weighted directional evidence accumulation**
   - Bull/bear logits are built from direction-signed, reliability-adjusted evidence.
3. **Uncertainty modeling**
   - Uncertainty increases with low-magnitude disagreement, volatile regimes, and contradiction penalties.
4. **Confidence attenuation**
   - Logits are shrunk under high uncertainty to prevent overconfident tails.
5. **Probabilistic normalization**
   - Softmax converts logits to `P(BULL)`, `P(BEAR)`, `P(NEUTRAL)`.
6. **Decision rule**
   - Direction is classified by directional edge threshold and neutral dominance check.
7. **Explainability output**
   - Predictor now emits `modelDiagnostics` (probabilities, uncertainty, edge, ensemble confidence).

### Mathematical assumptions

- Factor scores are monotonic proxies of directional evidence.
- Reliability priors approximate historical factor trustworthiness.
- Uncertainty penalties act as Bayesian-style shrinkage under noisy/conflicting evidence.
- Softmax probabilities provide stable relative confidence between competing hypotheses.

## 7) Refactored Core Components (implemented in this iteration)

- Added reusable probabilistic engine module.
- Replaced purely heuristic direction selection with ensemble-driven direction classification.
- Replaced probability scalar computation with probabilistic + confluence blended estimate.
- Added model diagnostics contract in prediction output type.

## 8) Step-by-Step Design Decisions

1. Preserve all existing signal factors to avoid functionality regression.
2. Convert those factors into probabilistic evidence instead of replacing with black-box ML.
3. Keep deterministic validation/risk gates (`RR`, confirmations, confluence) for operational safety.
4. Introduce uncertainty-aware penalties so contradiction and volatility reduce confidence.
5. Add diagnostics to make model behavior didactic and auditable.

## 9) Future Scalability / Production Improvements

- Add rolling outcome logger and offline calibration (Brier/log-loss/reliability curves).
- Support per-symbol quantile normalization and regime-conditioned priors.
- Move scan scheduler to bounded concurrency worker pool with timeout budgets.
- Add portfolio-level risk engine (aggregate beta, drawdown brakes, exposure caps).
- Introduce property-based tests for indicator math invariants and prediction monotonicity.
- Add typed `dataQuality` state to every analysis and propagate to UI/alerts.

