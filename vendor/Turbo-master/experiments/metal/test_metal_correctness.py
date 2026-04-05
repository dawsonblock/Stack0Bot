import os

import mlx.core as mx

from turboquant.config import TurboQuantConfig
from turboquant.core.quantizer import GroupScalarQuantizer
from turboquant.experimental.kernels.metal.runtime import decode_k_metal
from turboquant.kernels.decode import decode_k_fallback

os.environ["TQ_USE_METAL"] = "1"

cfg = TurboQuantConfig(
    k_bits=3,
    k_group_size=64,
    residual_topk=0,
    v_bits=4,
    v_group_size=64,
    mode="research",
)

q = GroupScalarQuantizer(n_bits=3, group_size=64)
q_res = GroupScalarQuantizer(n_bits=3, group_size=64)

data = mx.random.normal((1, 8, 256, 128))
packed, scales = q.encode(data)
mx.eval(packed, scales)

d_head = 128

out_fallback = decode_k_fallback(packed, scales, None, None, cfg, d_head)
out_metal = decode_k_metal(packed, scales, None, None, cfg, d_head)

mx.eval(out_fallback, out_metal)

print("Max diff:", mx.max(mx.abs(out_fallback - out_metal)))
