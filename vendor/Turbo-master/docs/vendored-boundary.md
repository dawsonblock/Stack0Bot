# Vendored upstream boundary

> **Status**: reference — read before touching `mlx_lm/`  
> **Upstream**: [ml-explore/mlx-lm](https://github.com/ml-explore/mlx-lm)  
> **Vendored version**: see `mlx_lm/_version.py` and `VENDORED_MLX_LM.md`

---

## Why mlx_lm is vendored

TurboQuant requires surgical modifications to `mlx_lm` that cannot be
expressed as a monkey-patch or plugin:

1. **`generate.py`** — `maybe_turboquant_k_cache()` is wired into the decode
   loop to promote dense `KVCache` entries to `TurboQuantKCache` at a
   configurable token offset.
2. **`models/cache.py`** — `TurboQuantKCache` and the `TurboQuantConfig`
   shim adapter live here for mlx-lm API compatibility.
3. **`models/llama.py` and `models/gemma.py`** — attention dispatch is
   redirected through `turboquant.runtime.attention.maybe_turboquant_attention()`
   for the supported model families.

All other files in `mlx_lm/` are verbatim upstream copies.

---

## Boundary rules

### What TurboQuant owns

| File | Reason for modification |
|:---|:---|
| `mlx_lm/generate.py` | upgrade shim + `model_family` threading |
| `mlx_lm/models/cache.py` | `TurboQuantKCache` adapter |
| `mlx_lm/models/llama.py` | attention dispatch wiring |
| `mlx_lm/models/gemma.py` | attention dispatch wiring |

### What TurboQuant must not touch

- Every other file under `mlx_lm/` is an upstream copy.  Do not modify these
  files for TurboQuant-specific reasons.  If a fix is needed in upstream code,
  submit it to `ml-explore/mlx-lm` first, then pick it up via the upgrade
  process below.
- `mlx_lm/models/` files other than `llama.py` and `gemma.py` must not be
  modified.  The vendored tree includes many other model architectures that
  TurboQuant does not support.  They are present only so that users of the
  vendored `mlx_lm` distribution can still load other models without
  TurboQuant involvement.

---

## Upgrade process

When pulling a new upstream `mlx_lm` release:

1. Identify all files listed in "What TurboQuant owns" above.
2. Apply the upstream delta as a clean diff (e.g. `git diff upstream/old
   upstream/new -- mlx_lm/`) to the vendored tree.
3. Re-apply TurboQuant-specific patches to owned files.
4. Run `make test-static && make test-mlx` to confirm no regressions.
5. Update `mlx_lm/_version.py` and the version in `VENDORED_MLX_LM.md`.
6. Run `scripts/certify_apple_runtime.sh` on Apple Silicon before merging.

See `integrations/mlx/upgrade.py` for the cache-upgrade side of this
boundary.

---

## What the vendor boundary does NOT claim

- The vendored `mlx_lm/models/` tree is **not** TurboQuant-integrated for
  any model family other than Llama and Gemma.
- Loading other models via the vendored `mlx_lm.load()` call will work for
  dense inference but will raise `UnsupportedModelError` if TurboQuant cache
  upgrade is requested.
- Performance or quality claims for other model families are not made and
  must not be inferred from the presence of those model files.

---

## File-level ownership summary

```text
mlx_lm/
├── generate.py          ← TurboQuant-modified (upgrade shim + model_family)
├── models/
│   ├── cache.py         ← TurboQuant-modified (TurboQuantKCache adapter)
│   ├── llama.py         ← TurboQuant-modified (attention dispatch)
│   ├── gemma.py         ← TurboQuant-modified (attention dispatch)
│   └── *.py             ← upstream verbatim — do not modify
└── *.py                 ← upstream verbatim — do not modify
```
