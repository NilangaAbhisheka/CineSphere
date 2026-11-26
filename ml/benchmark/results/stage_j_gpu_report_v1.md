# CineSphere Stage 5.0.4-J — CUDA / GPU Embedding Benchmark Report

> **Raw Results:** `ml/benchmark/results/stage_j_gpu_results_v1.json`
> **Model (TD-08 Accepted):** `sentence-transformers/all-mpnet-base-v2` (revision `9a3225965996d404b775526de6dbfe85d3368642`, 768d, `max_seq_length=384`, right-side truncation, L2 normalized)
> **Dataset:** `catalogue_snapshot_v1.jsonl` (2,000 records, SHA-256 `042dccd50ee4f01f9d63f56f3a161aa5c3de9d2ea7ed2a9b6cc6162a0d6d6fe9`)

## 1. Environment & Methodology

- **GPU:** `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6,144 MiB` VRAM, Compute Capability `8.6`, 20 SMs), Driver `616.92`, CUDA UMD `13.4`.
- **Isolated Benchmark Environment:** `torch==2.14.1+cu126`, `cuda_version=12.6`, `cuDNN=91002`, `sentence-transformers==6.3.0`, `transformers==5.24.1` (kept separate from `ml/.venv-baseline`, which remains `torch==2.15.0+cpu`).
- **Execution Protocol:** `device="cuda"`, `model.eval()`, `torch.inference_mode()`, `local_files_only=True`. Each configuration ran model load, 160-item warm-up, `torch.cuda.reset_peak_memory_stats()`, and **3 timed repetitions** over all 2,000 records using `torch.cuda.synchronize()` + `torch.cuda.Event(enable_timing=True)` + `time.perf_counter_ns()`.
- **Memory & Parity:** Peak VRAM measured via `torch.cuda.max_memory_allocated()` / `max_memory_reserved()` and `nvidia-smi`; system RAM via `psutil` (`rss`, `peak_wset`). Outputs compared against preserved CPU reference `embeddings_model_b.npy` (`2000 × 768`, `float32`).

## 2. Measured Performance Results

*(CPU baseline from Stage 5.0.4-I: `1,298.12 s` mean, `1.55 rec/s`, `batch_size=32`, 4 CPU threads.)*

| Configuration | Mean Time (s) | Median Time (s) | Mean Throughput (rec/s) | Speedup vs. CPU | Peak VRAM Alloc / Res (MB) | Stability |
|---|---:|---:|---:|---:|---:|---|
| FP32, batch 16 | 24.6180 | 24.6772 | 81.25 | 52.73× | 885.94 / 1,154.00 | Passed |
| **FP32, batch 32** | **23.1449** | **23.1031** | **86.41** | **56.09×** | **1,763.76 / 2,308.00** | **Passed (Preferred)** |
| FP32, batch 64 | 26.1078 | 26.0423 | 76.61 | 49.72× | 3,100.67 / 4,140.00 | Passed |
| FP32, batch 128 | 41.4372 | 42.2462 | 48.30 | 31.33× | 4,099.70 / 6,762.00 | Passed (WDDM paged) |
| FP16 autocast, batch 32* | 10.7928 | 10.8337 | 185.35 | 120.28× | 1,781.86 / 2,340.00 | Passed (Exploratory) |

*\*FP16 (`torch.amp.autocast`) is exploratory only and not the production default.*

## 3. Numerical Parity vs. CPU Reference

- **FP32 (batch 32) vs. CPU:** Shape `(2000, 768)`, `max_abs_diff = 2.96e-6`, `mean_abs_diff = 4.85e-8`, `cosine_sim_min = 0.99999988`, `top1_exact_match_rate = 1.0` (50/50 probes), `top10_mean_overlap = 1.0` (10/10 across all 50 probes).
- **FP16 (batch 32) vs. CPU:** Shape `(2000, 768)`, `max_abs_diff = 1.33e-3`, `cosine_sim_min = 0.99995154`, `top1_exact_match_rate = 1.0`, `top10_mean_overlap = 1.0`.

## 4. Linear Growth Projections (Estimates Only)

Assuming linear scaling at FP32 batch-32 throughput (`86.41 rec/s`; actual runtimes vary with sequence lengths and thermal/VRAM conditions):
- **2,000 titles (measured):** `23.1 s` | **10,000:** `~1.93 min` | **25,000:** `~4.82 min` | **50,000:** `~9.64 min` | **100,000:** `~19.29 min`
- **Incremental (10 / 50 / 100 / 500 titles):** `~0.12 s` / `~0.58 s` / `~1.16 s` / `~5.8 s` (plus `~1.68 s` model load).
