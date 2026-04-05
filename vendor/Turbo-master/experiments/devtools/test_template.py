import mlx.core as mx

source = """
    uint elem = thread_position_in_grid.x;
    out[elem] = inp[elem] * (T)VAL;
"""
kernel = mx.fast.metal_kernel(
    name="my_test", input_names=["inp"], output_names=["out"], source=source
)
a = mx.ones((4,))
out = kernel(
    inputs=[a],
    template=[("T", mx.float32), ("VAL", 5)],
    grid=(4, 1, 1),
    threadgroup=(4, 1, 1),
    output_shapes=[a.shape],
    output_dtypes=[mx.float32],
)
print("Success:", out[0])
