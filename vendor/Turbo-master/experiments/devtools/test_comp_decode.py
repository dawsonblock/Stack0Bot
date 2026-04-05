import time

import mlx.core as mx

from turboquant.config import TurboQuantConfig
from turboquant.core.quantizer import GroupScalarQuantizer
from turboquant.kernels.decode import decode_k_fallback

cfg = TurboQuantConfig(
    k_bits=3,
    k_group_size=64,
    residual_topk=0,
    v_bits=4,
    v_group_size=64,
    mode="research",
)

q = GroupScalarQuantizer(n_bits=3, group_size=64)
data = mx.random.normal((1, 8, 256, 128))
packed, scales = q.encode(data)
mx.eval(packed, scales)


def _inner_decode(
    packed_k,
    scales,
    resid_vals,
    resid_idx,
    k_bits,
    k_group_size,
    d_pad,
    d_head,
    residual_topk,
    is_fast,
):
    from turboquant.core.quantizer import dequantize_groups
    from turboquant.core.residual import decode_topk_residual

    y_hat = dequantize_groups(packed_k, scales, k_bits, k_group_size, d_pad)
    if not is_fast:
        if residual_topk > 0:
            residual = decode_topk_residual(resid_vals, resid_idx, k_group_size)
            y_hat = y_hat + residual[..., :d_pad]
    return y_hat[..., :d_head]


_comp_cache = {}


def my_fallback_fast(packed_k, scales, resid_vals, resid_idx, config, d_head):
    d_pad = (
        (d_head + config.k_group_size - 1) // config.k_group_size * config.k_group_size
    )
    mode = getattr(config, "mode", "research")
    is_fast = mode == "fast"
    key = (
        config.k_bits,
        config.k_group_size,
        d_pad,
        d_head,
        config.residual_topk,
        is_fast,
    )
    if key not in _comp_cache:

        def fn(pk, s, rv, ri):
            return _inner_decode(pk, s, rv, ri, *key)

        _comp_cache[key] = mx.compile(fn, shapeless=False)

    return _comp_cache[key](
        packed_k,
        scales,
        resid_vals if resid_vals is not None else mx.array(0),
        resid_idx if resid_idx is not None else mx.array(0),
    )


test_orig = decode_k_fallback(packed, scales, None, None, cfg, 128)
test_new = my_fallback_fast(packed, scales, None, None, cfg, 128)
mx.eval(test_orig, test_new)

start = time.perf_counter()
for _ in range(50):
    o = decode_k_fallback(packed, scales, None, None, cfg, 128)
    mx.eval(o)
end = time.perf_counter()
print("Original fallback:", (end - start) * 1000 / 50, "ms")

start = time.perf_counter()
for _ in range(50):
    o = my_fallback_fast(packed, scales, None, None, cfg, 128)
    mx.eval(o)
end = time.perf_counter()
print("Compiled fallback:", (end - start) * 1000 / 50, "ms")
