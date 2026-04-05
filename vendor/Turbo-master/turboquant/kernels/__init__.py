# turboquant/kernels
#
# Platform: Apple Silicon (MLX / Metal)
# Status:   vectorised MLX ops are the supported kernel layer.
#
# ── What this directory is for ─────────────────────────────────────────────
#
# On CUDA/Triton, custom kernels would live here.  On Apple Silicon, the
# supported runtime uses MLX-backed vectorised ops in turboquant/core/.
# Handwritten Metal or raw shader paths are experimental only — no release
# claim depends on them.  Experimental work lives in
# turboquant/experimental/ and is NOT part of the supported runtime path.
#
# The vectorised pack / unpack / quantise ops in turboquant/core/quantizer.py
# are dispatched as MLX ops.  No hand-written shaders are part of the core
# package.

__all__: list = []
