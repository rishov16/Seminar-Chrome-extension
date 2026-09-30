# Evaluations

Preliminary component checks for SEMINAR. Each runs on a small fixture set, so treat the results as sanity checks rather than benchmarks. Raw outputs are committed under each `results/` directory.

| Eval | Script | Needs | Last result |
|---|---|---|---|
| Narration structure + quality | `narration/run.mjs` | Gemini API key | 8/8 structural pass; faithfulness 4.13, naturalness 4.25, notation 4.63 (1–5) |
| Intelligibility (TTS → ASR WER) | `narration/run-wer.mjs` | Gemini API key with TTS quota | 14.3% WER on 1 slide |
| Handwriting shape (DTW) | `handwriting/run-dtw.mjs` | MathWriting excerpt (see below) | 1.34× human-to-human variability, 29 glyphs |

## Narration

The fixtures in `narration/testset.mjs` are 8 hand-built slides (10 board units). They were chosen to cover the cases the Narrator must handle carefully: multi-row derivations, escaped set-builder braces, named-group abbreviations, bullet lists, and diagram captions.

### `run.mjs`: structure and LLM-judge rubric

```bash
GEMINI_API_KEY=... node evals/narration/run.mjs
```

1. **Structural checks (deterministic).** These confirm four things:
   - the number of narration segments matches the number of board units;
   - the fragment reconstruction invariant holds (board slices concatenate back to the source line);
   - no LaTeX delimiters leak into spoken text;
   - multi-row and diagram units are never fragmented.
2. **LLM-judge rubric.** Scores each narration from 1 to 5 on faithfulness, naturalness, and notation accuracy.
   - The judge is `gemini-3.1-flash-lite`, the same model family as the Narrator. Its naturalness score is therefore a *proxy*, not a human MOS.
   - Faithfulness deductions come mostly from connective words ("Now,", "Consider") that the Narrator adds beyond the board text.

Result: `narration/results/2026-08-31T14-55-13-824Z.json`.

### `run-wer.mjs`: TTS → ASR round-trip word error rate

```bash
GEMINI_API_KEY=... node evals/narration/run-wer.mjs      # WER_SLIDE_IDS=id1,id2 to pick fixtures
```

The pipeline is:

1. The Narrator produces a script.
2. Gemini TTS (`gemini-3.1-flash-tts-preview`) speaks it.
3. Gemini transcribes the audio back (`gemini-3.1-flash-lite`).
4. Word error rate is computed against the original script.

The transcription prompt forbids converting spoken math back into symbols. Otherwise "a plus b squared" might come back as `(a+b)^2` and inflate the error rate for reasons unrelated to narration quality.

**Only 1 of 8 fixtures completed.** The Gemini free tier's TTS quota blocked the rest, so the 14.3% figure comes from a single slide ("Inner product of two vectors"). Running with a billing-enabled key should complete all 8.

For context only, MathReader reports 28.1% WER on its own corpus ([arXiv:2501.07088](https://arxiv.org/abs/2501.07088), Table 2). This is a different corpus and pipeline, not a head-to-head comparison.

Sample narration audio is in `narration/results/audio/`.

## Handwriting

### `run-dtw.mjs`: DTW against human ink

```bash
node evals/handwriting/run-dtw.mjs
```

This compares SEMINAR's glyph strokes against real handwriting from Google's [MathWriting](https://arxiv.org/abs/2404.10690) dataset. It uses the small public excerpt, which is gitignored and must be fetched first:

```bash
mkdir -p evals/handwriting/mathwriting-data
curl -L https://storage.googleapis.com/mathwriting_data/mathwriting-2024-excerpt.tgz \
  | tar -xz -C evals/handwriting/mathwriting-data/
```

- **Coverage:** 29 characters appear both in the excerpt and in SEMINAR's glyph bank.
- **Preparing our strokes:** `glyph-geometry.mjs` reproduces the renderer's stroke geometry (parsing, Catmull–Rom smoothing, resampling) in plain Node.
- **Comparison:** both our ink and the human ink are normalized to a unit square before DTW is computed.
- **Baseline:** where a character has two or more human samples, human-to-human DTW is also computed as a variability baseline.

Result (`handwriting/results/dtw-2026-09-01T06-15-09-735Z.json`): average ratio to human variability is **1.34×** across the 10 glyphs that have a baseline.

**One outlier: `r`, at 5.41×.** The MathWriting writers draw `r` as one continuous stroke, while our glyph bank uses two strokes (stem, then arch). DTW compares the order in which points are traversed, so a different stroke decomposition of a visually similar letter produces a large distance.

## Not yet evaluated

- end-to-end latency (time to first stroke, interruption response time);
- API cost;
- TikZ diagram compile rates;
- human MOS ratings;
- learning outcomes;
- baselines such as Amazon Polly or slide-generation pipelines.

The proposed Lean 4 verification filter is not implemented, so it has no evaluation.
