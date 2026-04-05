import benchmarks.run_final_eval as test

test.B, test.H_q, test.H_kv, test.L, test.D = 1, 32, 8, 4096, 128
mem, t = test.measure_tq_attention(1, 32, 8, 4096, 128)
print("Default block size:", t * 1000, "ms")
