import os

import mlx.core as mx

import turboquant.experimental.kernels.metal.runtime as runtime
from turboquant.config import TurboQuantConfig
from turboquant.core.quantizer import GroupScalarQuantizer
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
data = mx.random.normal((1, 8, 256, 128))
packed, scales = q.encode(data)
mx.eval(packed, scales)

d_head = 128

runtime._kernel_source = """
    uint gid = thread_position_in_grid.x;

    uint d_g = N_GROUPS * GROUP_SIZE;
    uint elements_in_uint = 32u / BITS;

    uint prefix_idx = gid / d_g;
    uint local_idx_in_row = gid % d_g;

    uint g = local_idx_in_row / GROUP_SIZE;
    uint scale_idx = prefix_idx * N_GROUPS + g;

    // unpack
    uint word_idx_in_row = local_idx_in_row / elements_in_uint;
    uint global_word_idx = prefix_idx * N_WORDS + word_idx_in_row;
    uint word = packed[global_word_idx];

    uint shift = (local_idx_in_row % elements_in_uint) * BITS;
    uint code = (word >> shift) & ((1u << BITS) - 1u);

    uint q_max = (1u << (BITS - 1u)) - 1u;
    int signed_code = (int)code - (int)q_max;

    float scale = (float)scales[scale_idx];
    float val = (float((float)signed_code) * scale);

    // residual add
    uint local_idx = local_idx_in_row % GROUP_SIZE;

    // Only do residual if TOPK > 0
    #pragma unroll
    for (uint i = 0; i < TOPK; i++) {
        // TOPK > 0 so this compiles or doesn't depending on TOPK template
        bool match = (resid_idx[scale_idx * TOPK + i] == local_idx);
        val += match ? (float)resid_vals[scale_idx * TOPK + i] : 0.0f;
    }

    out[gid] = half(val);
"""
runtime._kernels = {}


def decode_k_metal_test(
    packed_k: mx.array,
    scales: mx.array,
    resid_vals: mx.array,
    resid_idx: mx.array,
    config,
    d_head: int,
):
    cache_key = (config.k_bits, config.k_group_size, config.residual_topk)

    if cache_key not in runtime._kernels:
        runtime._kernels[cache_key] = mx.fast.metal_kernel(
            name="decode_k",
            input_names=["packed", "scales", "resid_idx", "resid_vals"],
            output_names=["out"],
            source=runtime._kernel_source,
        )

    kernel = runtime._kernels[cache_key]
    threadgroup_size = int(os.getenv("TQ_THREADGROUP_SIZE", "64"))

    if resid_vals is None:
        resid_vals = mx.zeros((1,), dtype=mx.float16)
        resid_idx = mx.zeros((1,), dtype=mx.uint16)

    total_elements = scales.size * config.k_group_size
    grid = (total_elements, 1, 1)
    threadgroup = (threadgroup_size, 1, 1)

    out_shape = packed_k.shape[:-1] + (d_head,)
    n_groups = scales.shape[-1]
    n_words = packed_k.shape[-1]

    out = kernel(
        inputs=[packed_k, scales, resid_idx, resid_vals],
        template=[
            ("BITS", config.k_bits),
            ("GROUP_SIZE", config.k_group_size),
            ("TOPK", config.residual_topk),
            ("N_GROUPS", n_groups),
            ("N_WORDS", n_words),
        ],
        grid=grid,
        threadgroup=threadgroup,
        output_shapes=[out_shape],
        output_dtypes=[mx.float16],
        stream=mx.gpu,
    )

    return out[0]


out_fallback = decode_k_fallback(packed, scales, None, None, cfg, d_head)
out_metal = decode_k_metal_test(packed, scales, None, None, cfg, d_head)
mx.eval(out_fallback, out_metal)

print("Max diff:", mx.max(mx.abs(out_fallback - out_metal)))
print("fallback:", out_fallback[0, 0, 0, :5])
print("metal:", out_metal[0, 0, 0, :5])
