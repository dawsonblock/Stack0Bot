def measure_tq_attention_large(B, H_q, H_kv, L, D):
    import time

    import mlx.core as mx

    from turboquant.config import TurboQuantConfig
    from turboquant.runtime.attention import turboquant_streaming_attention
    from turboquant.runtime.kv_interface import KVCompressor

    cfg = TurboQuantConfig(
        k_bits=3,
        k_group_size=64,
        residual_topk=0,
        v_bits=4,
        v_group_size=64,
        mode="fast",
        rotation="identity",
    )
    comp = KVCompressor(cfg)
    k = mx.random.normal((B, H_kv, L, D)).astype(mx.float16)
    v = mx.random.normal((B, H_kv, L, D)).astype(mx.float16)
    q = mx.random.normal((B, H_q, 1, D)).astype(mx.float16)
    keys_view, vals = comp.update_and_fetch(k, v)
    mx.eval(comp._k_packed, comp._k_scales)
    start = time.perf_counter()
    for _ in range(50):
        out = turboquant_streaming_attention(q, keys_view, scale=(D**-0.5))
        mx.eval(out)
    mx.metal.device_info()
    end = time.perf_counter()
    return (end - start) / 50


t = measure_tq_attention_large(1, 32, 8, 4096, 128)
print("Large block size (4096):", t * 1000, "ms")
