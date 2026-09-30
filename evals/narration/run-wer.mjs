#!/usr/bin/env node
// Real ASR-based WER measurement for our own narration pipeline — the piece
// run.mjs's report explicitly flagged as not implemented. See ../README.md
// for full methodology and its honest limits before reading too much into
// the numbers this prints.
//
// Pipeline per slide: agents/narrator-agent.js generates narrationText ->
// Gemini TTS synthesizes it to speech -> Gemini transcribes that speech back
// to text -> WER between the original narrationText and the transcript.
// This measures how phonetically/lexically recoverable our own generated
// narration is after a real TTS+ASR round trip — NOT a comparison against
// MathReader or Polly run on the same audio (see methodology below for why).
//
// Usage: GEMINI_API_KEY=... node evals/narration/run-wer.mjs

import { generateForSlide } from '../../agents/narrator-agent.js';
import { synthesizeSpeech } from './tts-client.mjs';
import { transcribeAudio } from './asr-client.mjs';
import { wordErrorRate } from './wer.mjs';
import { testSlides } from './testset.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The full 8-fixture testset.mjs set is used by run.mjs (structural checks +
// LLM judge, no quota concerns), but each slide here costs a real TTS call
// against a free-tier quota found live to be far tighter than its own error
// message implies (see the withRetry comment below) — a single opportunistic
// check succeeded, then the very next real call failed again immediately,
// with four ~60s backoff attempts still not clearing it. Restricted to three
// fixtures chosen for structural diversity rather than all eight: plain
// prose, the multi-row derivation (the fixture that surfaced the ASR
// transcription-side symbolic-notation bug — see asr-client.mjs — so it's
// worth re-verifying specifically), and notation-heavy prose with escaped
// set-builder braces. Widen this list (or override via WER_SLIDE_IDS, a
// comma-separated list of slideIds) once quota allows.
const DEFAULT_SLIDE_IDS = ['test-prose-inner-product', 'test-multirow-derivation', 'test-set-builder-braces'];
const selectedSlideIds = process.env.WER_SLIDE_IDS
  ? process.env.WER_SLIDE_IDS.split(',').map((s) => s.trim())
  : DEFAULT_SLIDE_IDS;
const selectedSlides = testSlides.filter((s) => selectedSlideIds.includes(s.slideId));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Export it and re-run: GEMINI_API_KEY=... node evals/narration/run-wer.mjs');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The free-tier TTS quota's 429 message names its own suggested wait
 * ("Please retry in 23.4s"), which this parses and honors rather than
 * guessing a backoff. Its error text claims "limit: 10" but that's not
 * actually 10 requests/day or /minute in practice — found live during
 * development to be far tighter (one opportunistic call succeeded, then the
 * very next real call failed again immediately, and four ~60s backoff
 * attempts still didn't clear it), so don't take the stated limit at face
 * value if this starts failing again. */
async function withRetry(fn, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryMatch = /retry in (\d+(?:\.\d+)?)s/i.exec(e.message || '');
      if (!retryMatch || attempt >= retries) throw e;
      const waitMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000;
      process.stderr.write(`  quota hit, waiting ${(waitMs / 1000).toFixed(0)}s before retry (attempt ${attempt + 1}/${retries})...\n`);
      await sleep(waitMs);
    }
  }
}

// MathReader's own published numbers (arxiv.org/abs/2501.07088, Table 2) —
// cited, not reproduced. Their corpus (manually-authored LaTeX-to-spoken-
// English pairs from arXiv papers/textbooks, read by their own T5+NeMo/VITS
// pipeline) is NOT the same text as this eval's hand-picked fixtures spoken
// by Gemini TTS, so treat any comparison as directional context, not a
// controlled head-to-head — the two numbers were never measured on the same
// input. See ../README.md.
const MATHREADER_PUBLISHED = {
  source: 'arxiv.org/abs/2501.07088, Table 2',
  mathReaderWer: 0.281,
  microsoftEdgeWer: 0.510,
  adobeAcrobatWer: 0.617,
};

async function evalSlideWer(slide) {
  const record = { slideId: slide.slideId, title: slide.title };
  try {
    const { spokenText } = await generateForSlide(slide, { apiKey, includeFillers: true });
    if (!spokenText.trim()) {
      record.skipped = 'empty narration';
      return record;
    }
    record.reference = spokenText;

    const wav = await withRetry(() => synthesizeSpeech(apiKey, spokenText));
    const transcript = await withRetry(() => transcribeAudio(apiKey, wav));
    record.hypothesis = transcript;

    const audioDir = path.join(__dirname, 'results', 'audio');
    mkdirSync(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, `${slide.slideId}.wav`);
    writeFileSync(audioPath, wav);
    record.audioPath = path.relative(path.join(__dirname, '..', '..'), audioPath);

    const { wer, editDistance, referenceWordCount } = wordErrorRate(spokenText, transcript);
    record.wer = wer;
    record.editDistance = editDistance;
    record.referenceWordCount = referenceWordCount;
    return record;
  } catch (e) {
    record.error = `${e.name || 'Error'}: ${e.message}`;
    return record;
  }
}

function summarize(results) {
  const ok = results.filter((r) => !r.error && !r.skipped);
  const totalEdits = ok.reduce((sum, r) => sum + r.editDistance, 0);
  const totalRefWords = ok.reduce((sum, r) => sum + r.referenceWordCount, 0);
  const macroAvgWer = ok.length ? ok.reduce((sum, r) => sum + r.wer, 0) / ok.length : null;
  return {
    slidesEvaluated: ok.length,
    slidesErrored: results.filter((r) => r.error).length,
    slidesSkipped: results.filter((r) => r.skipped).length,
    // Corpus-level ("micro") WER — total edits over total reference words —
    // is the standard way WER is reported when aggregating across examples
    // of different lengths, matching how MathReader's own paper aggregates.
    microAvgWer: totalRefWords ? totalEdits / totalRefWords : null,
    macroAvgWer,
  };
}

async function main() {
  const results = [];
  for (const slide of selectedSlides) {
    process.stderr.write(`TTS+ASR round trip: ${slide.title}...\n`);
    // eslint-disable-next-line no-await-in-loop -- sequential so a failure
    // is attributable to a specific fixture in the console log, and so we
    // don't fan out TTS+ASR calls (real $ cost) in a burst.
    results.push(await evalSlideWer(slide));
    // Paced below the observed 10-req/min free-tier TTS quota rather than
    // relying on withRetry alone to dig out of a burst every time.
    // eslint-disable-next-line no-await-in-loop
    await sleep(7000);
  }

  const summary = summarize(results);
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      note: 'Real TTS+ASR round-trip WER for our own narration pipeline only. Polly baseline: not run (no published number exists to cite either — see ../README.md; the user chose to drop this arm rather than fabricate a placeholder). MathReader comparison below is the PUBLISHED number from their paper, not a local reproduction on this eval\'s inputs — no trained checkpoint is publicly available (confirmed via github.com/hyeonsieun/MathReader), and their pipeline (fine-tuned T5 + NVIDIA NeMo/VITS) would need GPU training infrastructure not available here. Treat the comparison as directional, not a controlled same-corpus benchmark.',
      ourPipeline: 'agents/narrator-agent.js narrationText -> Gemini TTS (gemini-3.1-flash-tts-preview) -> Gemini transcription (gemini-3.1-flash-lite) -> word-level WER vs. the original narrationText',
      werFormula: '(substitutions + deletions + insertions) / reference word count, case/punctuation-insensitive',
      slideCoverage: `${selectedSlides.length} of ${testSlides.length} testset.mjs fixtures (${selectedSlideIds.join(', ')}) — restricted by a free-tier TTS quota far tighter than its own error message states; see the withRetry comment in this file. Widen via WER_SLIDE_IDS once quota allows.`,
    },
    mathReaderPublished: MATHREADER_PUBLISHED,
    summary,
    results,
  };

  const resultsDir = path.join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `wer-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== Narration WER Eval Summary ===');
  console.log(`Slides evaluated: ${summary.slidesEvaluated} (${summary.slidesErrored} errored, ${summary.slidesSkipped} skipped)`);
  console.log(`Our system — corpus-level (micro-avg) WER: ${summary.microAvgWer !== null ? (summary.microAvgWer * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log(`Our system — per-slide (macro-avg) WER: ${summary.macroAvgWer !== null ? (summary.macroAvgWer * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log(`\nMathReader published (${MATHREADER_PUBLISHED.source}): MathReader ${(MATHREADER_PUBLISHED.mathReaderWer * 100).toFixed(1)}% | MS Edge ${(MATHREADER_PUBLISHED.microsoftEdgeWer * 100).toFixed(1)}% | Adobe Acrobat ${(MATHREADER_PUBLISHED.adobeAcrobatWer * 100).toFixed(1)}%`);
  console.log('(Different corpus/pipeline than ours — directional context only, not a controlled comparison.)');
  console.log(`\nFull report written to: ${outPath}`);

  for (const r of results) {
    if (r.error) console.log(`\n[ERROR] ${r.title}: ${r.error}`);
    else if (!r.skipped) console.log(`[${(r.wer * 100).toFixed(1)}% WER] ${r.title}`);
  }
}

main();
