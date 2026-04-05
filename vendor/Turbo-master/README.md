<div align="center">

# ⚡ TurboQuant

**Research-grade KV-cache compression for Apple Silicon MLX LLMs**

[![Python](https://img.shields.io/badge/python-3.9%2B-blue)](https://python.org)
[![MLX](https://img.shields.io/badge/MLX-0.30.0%2B-orange)](https://github.com/ml-explore/mlx)
[![Platform](https://img.shields.io/badge/platform-Apple%20Silicon-black)](https://apple.com/mac)

*3-bit keys · 4-bit values · deterministic rotation · top-k sparse residual · no numpy in the hot path*

</div>

---

## What

TurboQuant compresses the KV cache of transformer models running on Apple Silicon via [mlx-lm](https://github.com/ml-explore/mlx-lm). It targets memory reduction first. End-to-end latency depends on model, shape, and decode length, and is not publicly certified by generic CI.

> **⚠️ Current status:** Serious prototype.
> TurboQuant is a research-grade KV-cache compression package for Apple-Silicon MLX inference. The supported runtime path is local Apple-Silicon validation for selected Llama-family and Gemma-family models. Custom Metal kernels are experimental and not part of the default supported runtime.
> Supported surface is documented in [docs/supported-surface.md](docs/supported-surface.md). Release gating is documented in [docs/release-checklist.md](docs/release-checklist.md).

### 🚀 **Illustrative local memory examples**

These numbers are local examples intended to show the shape of the compression tradeoff.
They are not release-certified benchmarks unless matched by saved runtime-certification artifacts
for the exact commit and hardware used.

The examples below should be read as sanity-check calculations and local observations, not as
published performance guarantees.

| Type | Precision | Tokens | Total MB | Bytes / Token | Ratio vs Dense |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Dense** | `float16` | 1024 | 2.10 MB | 2048 | 1.0x |
| **TurboQuant** (k=4b, g=64) | 4-bit | 1024 | 0.61 MB | 592 | **3.5x smaller** |
| **TurboQuant** (k=3b, g=64) | 3-bit | 1024 | 0.57 MB | 560 | **3.7x smaller** |
| **TurboQuant** (k=2b, g=64) | 2-bit | 1024 | 0.48 MB | 464 | **4.4x smaller** |

Artifact-backed release measurements belong under `artifacts/runtime-cert/<timestamp>/` and should
be treated as authoritative over any README example.

*Breakdown for 3-bit K, group=64, 1024 tokens:*

- `k_packed`: ~229.4 kB
- `resid_vals` + `resid_idx`: ~49.2 kB
- `v_packed`: ~262.1 kB
- **Total:** ~573.4 kB (compared to 2048.0 kB Dense)

---

## How it works

```text
                       K  path
┌──────────┐    ┌───────────────┐    ┌──────────────────────┐    ┌────────┐
│ raw keys │───▶│ FixedRotation   │───▶│ GroupScalarQuantizer │───▶│  packed  │
│ [B,H,T,D]│    │ Hadamard / QR   │    │ N-bit, per-group     │    │  codes   │
└──────────┘    └───────────────┘    └──────────────────────┘    └────────┘
                                               │ residual
                                               ▼
                                    ┌──────────────────────┐
                                    │  encode_topk_residual│
                                    │  top-k values+indices│
                                    └──────────────────────┘

                       V  path
┌────────────┐    ┌──────────────────────┐    ┌────────┐
│ raw values │───▶│ GroupScalarQuantizer │───▶│  packed  │
│ [B,H,T,D]  │    │ M-bit, per-group     │    │  codes   │
└────────────┘    └──────────────────────┘    └────────┘

Decode K (streaming attention)
  packed_codes ──▶ dequant ──▶ + topk_residual ──▶ crop ──▶ [B,H,T,D]
  (queries are rotated with the same FixedRotation before the matmul)
```

**Key design choices:**

- **Hadamard-family whitening** — exact dense Hadamard matrix for power-of-two head dims, or a deterministic Hadamard-derived orthogonal fallback otherwise; the rotation equalises per-dimension variance while preserving `R.T @ R = I`. *Not* a fast butterfly transform — cost is O(d²) per token.
- **Top-k sparse residual** — stores the k=2 largest-magnitude quantisation errors per group (fp16 value + uint8 index); recovers the dominant signal the main quantiser misses
- **Two-phase bit-packing** — pad to group boundary, then to word boundary; handles any bit-width (including 3-bit) for any head-dim
- **Single execution path & Pre-allocation** — the `.build()` pipeline pre-allocates everything ahead-of-time. The config selects operations once at init to guarantee zero runtime branches in the hot-paths.
- **Versioned state schema** — `state()` dicts carry `schema_version: 2`; `validate_state()` enforces correctness on restore.

---

## Install

```bash
git clone https://github.com/dawsonblock/TurboQuant
cd TurboQuant
python -m pip install -e '.[apple]'
```

`mlx` only installs on Apple Silicon. On non-Apple runners, use the packaging and syntax checks only.

---

## Quick start

### Core interface

```python
from turboquant import KVCompressor, TurboQuantConfig

# Defaults: 3-bit K, 4-bit V, Hadamard-family rotation, k=2 sparse residual
config = TurboQuantConfig()
cache  = KVCompressor(config, layer_id=0)

# Each decode step:
view, v_cur = cache.update_and_fetch(keys, values)  # keys/values: [B, H, T, D]
q_rot       = cache.rotate_queries(queries)          # rotate Q into K's frame

for start, end, k_blk, v_blk in cache.iter_rotated_kv_blocks(view):
    # standard online-softmax attention over (q_rot, k_blk, v_blk)
    ...
```

### Wiring into mlx-lm generation

```python
from mlx_lm.models.cache import make_prompt_cache
from integrations.mlx.upgrade import upgrade_cache_list
from turboquant.config import TurboQuantConfig

cache = make_prompt_cache(model)
# ... run prefill ...

cfg    = TurboQuantConfig(k_bits=3, k_group_size=64, rotation="hadamard")
events = upgrade_cache_list(cache, k_start=64, config=cfg, model_family="llama")
# decode loop continues with TurboQuant cache
```

### Optional: offline calibration

```python
from turboquant.calibration import calibrate

calibrate(
    cache.pipeline,
    data_loader,
    extract_kv=lambda batch: (batch["keys"], batch["values"]),
    mode="both",        # "k", "v", or "both"
    max_batches=64,
)
# pipeline now uses fitted per-group scales → lower quantisation error
```

### Tune the config

```python
config = TurboQuantConfig(
    k_bits=4,                          # increase for higher K quality
    residual_topk=4,                   # more residual components → lower error
    rotation="random_orthogonal",      # alternative to Hadamard
    rotation_seed=1337,
    v_enabled=False,                   # disable V compression if headroom exists
)
```

### Legacy mlx-lm cache

`turboquant_return_mode` and `turboquant_resid_scale_bits` remain only for backward-compatible state and config loading. The production upgrade path ignores `return_mode` and always returns a `TurboQuantKeysView`. Real residual behavior is controlled by `residual_topk`.

```python
from mlx_lm.models.cache import TurboQuantConfig, TurboQuantKCache

cache = TurboQuantKCache(
    TurboQuantConfig(main_bits=3, group_size=64, rotation="hadamard",
                     return_mode="view", v_bits=4, v_enabled=True)
)
```

---

## Running tests

```bash
# Static tests — safe on any platform (no MLX needed)
make test-static

# MLX-dependent tests — Apple Silicon only
make test-mlx

# Structural integration tests (no model weights, ~1 second)
make test-structural

# Path-proof tests (verify TQ path is active, not silent dense fallback)
make test-path-proof
```

### Model-weight tests

Some tests require real model weights. Set these environment variables:

```bash
# Any small Llama-family HF model (e.g. TinyLlama/TinyLlama-1.1B-Chat-v1.0)
export TQ_TEST_LLAMA_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

# Any small Gemma-family HF model (e.g. google/gemma-2b)
export TQ_TEST_GEMMA_MODEL="google/gemma-2b"

# Run the model-dependent tests
python -m pytest tests/integration_mlx/ -v --tb=short
```

Without these variables, model-dependent tests are automatically skipped.

### Full runtime certification

```bash
# Structural certification only (no weights needed)
make certify-structural

# Full certification (requires TQ_TEST_LLAMA_MODEL / TQ_TEST_GEMMA_MODEL)
make certify-apple-runtime
```

See [docs/validation-local.md](docs/validation-local.md) for details.

---

## Benchmarks

```bash
# Memory footprint table (bit-width × sequence length)
python benchmarks/bench_memory_footprint.py

# Encode latency: dense vs TurboQuant
python benchmarks/bench_dense_vs_turboquant.py

# Streaming attention throughput
python benchmarks/bench_decode_streaming.py

# Classic per-step latency
python benchmarks/decode_latency.py
```

Sample output from `bench_memory_footprint.py`:

```text
type                      bits  group  tokens   total_MB   bytes/tok   vs_dense
-------------------------------------------------------------------------------
dense (float16)             16     --    1024       2.10        2048       1.0x
TurboQuant k=4b g=64         4     64    1024       0.61         592       3.5x
TurboQuant k=3b g=64         3     64    1024       0.57         560       3.7x
TurboQuant k=2b g=64         2     64    1024       0.48         464       4.4x
TurboQuant k=4b g=32         4     32    1024       0.67         656       3.1x
TurboQuant k=3b g=32         3     32    1024       0.64         624       3.3x
```

Sample output from `bench_dense_vs_turboquant.py`:

```text
=== Dense vs TurboQuant: memory & encode latency ===

config                          tokens  dense_MB    tq_MB   ratio   ms_dense    ms_tq
-------------------------------------------------------------------------------------
k_bits=4  k_group_size=64         1024      2.10     0.61     3.5x      0.422    2.474
k_bits=3  k_group_size=64         1024      2.10     0.57     3.7x      0.477    1.532
k_bits=2  k_group_size=64         1024      2.10     0.48     4.4x      0.448    0.960
k_bits=3  k_group_size=32         1024      2.10     0.64     3.3x      0.400    0.854
```

---

## Evaluation

```python
from turboquant.config import TurboQuantConfig
from turboquant.eval import perplexity_report, drift_report, memory_report

cfg = TurboQuantConfig(k_bits=3, k_group_size=64)

# Perplexity delta vs dense
ppl = perplexity_report(model, input_ids, turboquant_config=cfg)
# → {'dense_ppl': 12.3, 'tq_ppl': 12.6, 'delta_ppl': 0.3, 'n_tokens': 63}

# Logit-distribution KL divergence
drift = drift_report(model, input_ids, turboquant_config=cfg)
# → {'mean_kl': 0.004, 'max_kl': 0.021, 'n_tokens': 63}

# Cache memory comparison
mem = memory_report(model, input_ids, turboquant_config=cfg)
# → {'dense_cache_bytes': 2097152, 'tq_cache_bytes': 524288, 'ratio': 4.0}
```

See [docs/evaluation.md](docs/evaluation.md) for interpretation guidance.

---

## Memory breakdown

```text
1024 tokens · 2 KV heads · head_dim=128

  k_packed           ~96 KB    3-bit packed uint32
  k_scales            8 KB    per-group fp16 scales
  k_resid_values      8 KB    top-k fp16 residual values  (k=2)
  k_resid_indices     4 KB    top-k uint8 indices
  v_packed           128 KB    4-bit packed uint32
  v_scales            8 KB    per-group fp16 scales
  ──────────────────────────
  total            ~252 KB    vs 1024 KB dense  (4.1× compression)
```

---

## Project layout

```text
turboquant/
├── __init__.py                Lazy-import entry point (MLX-free on import)
├── _deps.py                   has_mlx() / is_apple_silicon() / require_mlx()
├── config.py                  TurboQuantConfig — production schema
├── core/
│   ├── rotation.py            FixedRotation (Hadamard / QR / identity)
│   ├── quantizer.py           GroupScalarQuantizer + vectorised pack/unpack
│   ├── residual.py            encode_topk_residual / decode_topk_residual
│   └── pipeline.py            TurboQuantPipeline — single encode/decode path
├── runtime/
│   ├── layout.py              ensure_layout [B, H, T, D]
│   ├── kv_interface.py        KVCompressor + TurboQuantKeysView
│   ├── attention.py           turboquant_streaming_attention (shared adapter)
│   └── state.py               STATE_SCHEMA_VERSION + validate_state()
├── eval/
│   ├── perplexity.py          perplexity_from_logits(), perplexity_report()
│   ├── generation_drift.py    logit_kl_divergence(), drift_report()
│   └── memory.py              peak_memory_bytes(), memory_report()
├── calibration/
│   └── fit_quantizer.py       calibrate() over any data iterator
└── kernels/
    └── __init__.py            MLX/Metal dispatch note + shader roadmap

mlx_lm/                        patched mlx-lm
├── models/
│   ├── cache.py               TurboQuantKCache adapter + KVCache helpers
│   ├── gemma.py               wired → turboquant_streaming_attention
│   └── llama.py               wired → turboquant_streaming_attention
├── cache_upgrade.py           upgrade_cache_list() — canonical upgrade API
└── generate.py                maybe_turboquant_k_cache (deprecated compatibility shim)

tests/
├── unit_static/               Import + version tests (no MLX needed)
├── unit/                      38 turboquant package tests (MLX required)
└── integration/               20 mlx_lm integration tests (MLX required)

benchmarks/
├── decode_latency.py
├── bench_memory_footprint.py
├── bench_dense_vs_turboquant.py
└── bench_decode_streaming.py

docs/
├── architecture.md            Component map, data-flow, memory model
├── cache-format.md            State dict schema v2, packed uint32 layout
├── integration.md             Step-by-step wiring guide for new models
└── evaluation.md              Metrics reference, benchmark workflow, thresholds
```

---

## Status

| Component | Status |
|---|:---:|
| `KVCompressor` | ✅ tests 38 / 38 |
| `TurboQuantPipeline` | ✅ single path, no branches |
| `FixedRotation` (Hadamard / QR / identity) | ✅ deterministic, save / load |
| `GroupScalarQuantizer` + offline calibration | ✅ dynamic + calibrated |
| Top-k sparse residual | ✅ per-group, configurable k |
| Pure-MLX bit-packing | ✅ vectorised, no numpy sync |
| Versioned state schema (`schema_version: 2`) | ✅ `validate_state()` enforced |
| `TurboQuantKCache` adapter (legacy API) | ✅ tests 20 / 20 |
| Shared streaming attention adapter | ✅ `turboquant.runtime.attention` |
| Gemma streaming attention | ✅ wired |
| Llama streaming attention | ✅ wired |
| `upgrade_cache_list` cache upgrade API | ✅ canonical, idempotent |
| Eval suite (perplexity / KL drift / memory) | ✅ `turboquant.eval` |
| Quality gates (Δppl ≤ 0.5, mean_kl ≤ 0.1) | ✅ `run_quality_eval.py` |
| MLX version bounds (`[0.30.0, 1.0.0)`) | ✅ enforced at import |
| Structured logging (`turboquant.*`) | ✅ 6 modules |
| NaN/overflow guards | ✅ encode + attention |
| Path-proof tests (no silent dense fallback) | ✅ 9 tests |
| Deterministic benchmarks (seeded) | ✅ `mx.random.seed()` |
| Apple runtime CI | ✅ `.github/workflows/` |
| Benchmarks (memory / latency / streaming) | ✅ `benchmarks/` |
| Architecture + integration docs | ✅ `docs/` |
| Other architectures (Mistral, Phi, …) | ⬜ needs per-arch patch |
| Fused Metal kernel (decode & dequant) | ⬜ experimental, not certified |
| Perplexity / quality benchmarks at scale | ⬜ not yet measured |

---

## Limitations

- **Quality gated but not yet measured at scale** — `run_quality_eval.py` enforces Δppl ≤ 0.5 and mean_kl ≤ 0.1 gates. Run `make certify-apple-runtime` with model weights to validate.
- **Gemma- and Llama-family adapter paths exist in this repository. Actual support is established only by successful Apple-Silicon runtime certification for the specific model path being used.** Adding a new architecture is a [one-function change](docs/integration.md#adding-a-new-model-family).
- **Hadamard is O(d²)** — not a fast butterfly transform. For very large head-dims, `rotation="identity"` is faster with marginally worse compression.

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Component map, data-flow diagram, memory model |
| [docs/cache-format.md](docs/cache-format.md) | State dict schema v2, uint32 packing layout |
| [docs/integration.md](docs/integration.md) | Step-by-step wiring guide for new models |
| [docs/evaluation.md](docs/evaluation.md) | Metrics reference, benchmark workflow, thresholds |

---

## Requirements

| | |
|---|---|
| Platform | macOS · Apple Silicon (M1 / M2 / M3 / M4) |
| Python | ≥ 3.9 |
| MLX | ≥ 0.30.0, < 1.0.0 |
| mlx-lm | vendored v0.29.1 (see [VENDORED_MLX_LM.md](VENDORED_MLX_LM.md)) |

---

## Development & Testing

This project uses `nox` and `uv` to manage isolated build matrices and testing environments.

First, ensure `uv` or `nox` is installed:

```bash
pip install uv nox
```

To run static tests (safe on any platform):

```bash
make test-static
# Or directly: nox -s tests_static
```

To run MLX-dependent tests (Apple Silicon only):

```bash
make test-mlx
# Or directly: nox -s tests_mlx
```

To run all static code analysis (formatting with `ruff` and type-checking with `mypy`):

```bash
make lint
make typecheck
# Or: nox -s lint typecheck
```
