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


def test_shape():
    for _ in range(50):
        out = decode_k_fallback(packed, scales, None, None, cfg, 128)
        mx.eval(out)


test_shape()

start = time.perf_counter()
test_shape()
end = time.perf_counter()
print("Uncompiled:", (end - start) * 1000 / 50, "ms")

compiled_fallback = mx.compile(decode_k_fallback, shapeless=True)


def test_shape_compiled():
    for _ in range(50):
        out = compiled_fallback(packed, scales, None, None, cfg, 128)
        mx.eval(out)


test_shape_compiled()
start = time.perf_counter()
test_shape_compiled()
end = time.perf_counter()
print("Compiled  :", (end - start) * 1000 / 50, "ms")
