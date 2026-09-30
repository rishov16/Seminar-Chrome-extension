#!/usr/bin/env node
// Narration evaluation harness — see ../README.md for scope, methodology,
// and honest gaps against the paper's narration benchmark
// criteria (MOS naturalness, ASR-based WER vs. MathReader/Polly).
//
// This tier covers what's actually runnable here: (1) deterministic
// structural checks against the same invariants agents/narrator-agent.js
// enforces in production, run independently rather than trusted by
// inspection, and (2) an LLM-judge rubric proxying for MOS naturalness and
// notation/phonetic accuracy (explicitly NOT human MOS or real ASR WER —
// see the report's `methodology` block, which is written into every run's
// output so a reader of the JSON never mistakes one for the other).
//
// Usage: GEMINI_API_KEY=... node evals/narration/run.mjs

import { generateForSlide, applyNarrationSegments, getNarrationUnits, serializeBoardContentForNarration } from '../../agents/narrator-agent.js';
import { generateStructured, LlmError } from '../../lib/llm-client.js';
import { isMultiRowEquation } from '../../renderers/latex-utils.js';
import { testSlides } from './testset.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Export it and re-run: GEMINI_API_KEY=... node evals/narration/run.mjs');
  process.exit(1);
}

// LaTeX delimiters the Narrator Agent's own system prompt (rule 7) forbids
// in output — a structural leak, not a judgment call, so checked here
// independently of the judge.
const LEFTOVER_DELIMITER_RE = /\$|\\\(|\\\)|\\\[|\\\]/;

function deepCopySlide(slide) {
  return JSON.parse(JSON.stringify(slide));
}

/** Deterministic checks — no LLM call. Mirrors what applyNarrationSegments
 * already enforces in production, but exercised from outside so a
 * regression there shows up here too rather than being self-certifying. */
function structuralChecks(slide, segments) {
  const issues = [];
  const units = getNarrationUnits(slide);

  if (segments.length !== units.length) {
    issues.push(`segment count ${segments.length} !== narration unit count ${units.length}`);
  }

  const copy = deepCopySlide(slide);
  const applied = applyNarrationSegments(copy, segments);
  if (!applied) {
    issues.push('applyNarrationSegments rejected the generation outright (misaligned segment count)');
    return { pass: false, issues };
  }

  getNarrationUnits(copy).forEach((unit, i) => {
    const block = copy.boardContent.find((b) => b.id === unit.blockId);
    const target = unit.itemId ? block.items.find((it) => it.id === unit.itemId) : block;
    const text = target.narrationText || '';
    if (!text.trim()) issues.push(`unit ${i} (${unit.blockId}${unit.itemId ? '/' + unit.itemId : ''}) has empty narrationText`);
    if (LEFTOVER_DELIMITER_RE.test(text)) issues.push(`unit ${i} narrationText still contains a LaTeX delimiter: ${JSON.stringify(text)}`);

    if (block.type === 'equation' && isMultiRowEquation(block.latex) && target.narrationFragments) {
      issues.push(`unit ${i} is a multi-row derivation but got fragmented anyway (must always collapse to one fragment)`);
    }
    if (block.type === 'diagram' && target.narrationFragments) {
      issues.push(`unit ${i} is a diagram but got fragmented anyway (must always collapse to one fragment)`);
    }
  });

  return { pass: issues.length === 0, issues };
}

const JUDGE_SYSTEM_PROMPT = `You are grading the output of a mathematics narration system. You will be given the exact board content of one seminar slide (verbatim text/LaTeX, "Line N:" numbered) and the spoken narration it generated, in the same order.

Score three dimensions, each 1-5 (5 = best):

1. faithfulness: Does the narration correspond exactly to this slide's board content, with nothing invented, dropped, or independently explained/interpreted? The narrator's job is to speak the notation aloud the way a professor would read it, NOT to add intuition, background, or teaching commentary the board content doesn't contain. Penalize both omissions and additions.
2. naturalness: Would this sound like natural spoken mathematical English if read aloud by a professor, as opposed to a stiff or robotic symbol-by-symbol reading? This is a proxy for Mean Opinion Score (MOS) naturalness ratings used for TTS evaluation.
3. notation_accuracy: Is every piece of mathematical notation converted to how a mathematician would actually say it (e.g. "a transpose b", "d-dimensional real space"), with no raw leftover symbols, no overly literal/verbose readings (e.g. "superscript", "backslash"), and no incorrect mathematical meaning?

Return strict JSON only.`;

const judgeResponseSchema = {
  type: 'object',
  properties: {
    faithfulness: { type: 'integer' },
    naturalness: { type: 'integer' },
    notation_accuracy: { type: 'integer' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['faithfulness', 'naturalness', 'notation_accuracy', 'issues'],
};

async function judgeNarration(slide, spokenText) {
  const sourceContent = serializeBoardContentForNarration(slide);
  const userContent = `BOARD CONTENT:\n${sourceContent}\n\nGENERATED NARRATION:\n${spokenText}`;
  const result = await generateStructured(apiKey, {
    systemPrompt: JUDGE_SYSTEM_PROMPT,
    userContent,
    responseSchema: judgeResponseSchema,
  });
  return result;
}

async function evalSlide(slide) {
  const record = { slideId: slide.slideId, title: slide.title };
  try {
    const { spokenText, segments } = await generateForSlide(slide, { apiKey, includeFillers: true });
    record.spokenText = spokenText;
    record.segments = segments;

    const structural = structuralChecks(slide, segments);
    record.structural = structural;

    const judged = await judgeNarration(slide, spokenText);
    record.judge = judged;

    return record;
  } catch (e) {
    record.error = e instanceof LlmError ? `LlmError: ${e.message}` : `${e.name || 'Error'}: ${e.message}`;
    return record;
  }
}

function summarize(results) {
  const ok = results.filter((r) => !r.error);
  const structuralPassCount = ok.filter((r) => r.structural?.pass).length;
  const avg = (key) => {
    const vals = ok.filter((r) => r.judge && typeof r.judge[key] === 'number').map((r) => r.judge[key]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    totalSlides: results.length,
    erroredSlides: results.length - ok.length,
    structuralPassRate: ok.length ? structuralPassCount / ok.length : null,
    avgFaithfulness: avg('faithfulness'),
    avgNaturalness: avg('naturalness'),
    avgNotationAccuracy: avg('notation_accuracy'),
  };
}

async function main() {
  const results = [];
  for (const slide of testSlides) {
    process.stderr.write(`Evaluating: ${slide.title}...\n`);
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose:
    // narrator-agent.js's own retry-on-count-mismatch path already issues a
    // second call per slide, and running slides in parallel here would make
    // failures harder to attribute to a specific fixture in the console log.
    results.push(await evalSlide(slide));
  }

  const summary = summarize(results);
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      note: 'This is NOT the paper\'s full proposed narration benchmark. It covers: (1) deterministic structural invariant checks, and (2) an LLM-judge rubric that PROXIES for MOS naturalness and notation/phonetic accuracy. It does not include real human MOS ratings, real ASR-based WER, or a comparison against the MathReader/Polly baselines the paper names — those require synthesized audio for all three systems plus an ASR pass and are not implemented here.',
      judgeModel: 'gemini-3.1-flash-lite (lib/llm-client.js DEFAULT_GEMINI_MODEL)',
      scoreScale: '1-5, 5 = best, for faithfulness/naturalness/notation_accuracy',
    },
    summary,
    results,
  };

  const resultsDir = path.join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== Narration Eval Summary ===');
  console.log(`Slides evaluated: ${summary.totalSlides} (${summary.erroredSlides} errored)`);
  console.log(`Structural pass rate: ${summary.structuralPassRate === null ? 'n/a' : (summary.structuralPassRate * 100).toFixed(0) + '%'}`);
  console.log(`Avg faithfulness: ${summary.avgFaithfulness?.toFixed(2) ?? 'n/a'} / 5`);
  console.log(`Avg naturalness (MOS proxy): ${summary.avgNaturalness?.toFixed(2) ?? 'n/a'} / 5`);
  console.log(`Avg notation accuracy: ${summary.avgNotationAccuracy?.toFixed(2) ?? 'n/a'} / 5`);
  console.log(`\nFull report written to: ${outPath}`);

  for (const r of results) {
    if (r.error) {
      console.log(`\n[ERROR] ${r.title}: ${r.error}`);
    } else if (!r.structural.pass) {
      console.log(`\n[STRUCTURAL FAIL] ${r.title}:`);
      r.structural.issues.forEach((i) => console.log(`  - ${i}`));
    }
  }
}

main();
