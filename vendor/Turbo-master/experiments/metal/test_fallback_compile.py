import time

import mlx.core as mx

from turboquant.config import TurboQuantConfig
from turboquant.core.quantizer import GroupScalarQuantizer
from turboquant.kernels.decode import dequantize_groups

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


def my_fallback(packed, scales):
    d_pad = 128
    return dequantize_groups(packed, scales, 3, 64, d_pad)


comp_my_fallback = mx.compile(my_fallback, shapeless=False)

test_uncomp = my_fallback(packed, scales)
test_comp = comp_my_fallback(packed, scales)
mx.eval(test_uncomp, test_comp)

start = time.perf_counter()
for _ in range(50):
    o = my_fallback(packed, scales)
    mx.eval(o)
end = time.perf_counter()
print("Uncompiled:", (end - start) * 1000 / 50, "ms")

start = time.perf_counter()
for _ in range(50):
    o = comp_my_fallback(packed, scales)
    mx.eval(o)
end = time.perf_counter()
print("Compiled:", (end - start) * 1000 / 50, "ms")
