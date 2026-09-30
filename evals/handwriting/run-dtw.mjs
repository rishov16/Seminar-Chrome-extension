#!/usr/bin/env node
// Real DTW comparison of our HandwritingAgent stroke bank against genuine
// human ink from Google's public MathWriting dataset — no baseline model
// needed (unlike the narration WER eval's MathReader/Polly arms), since
// this compares our synthetic ink directly against ground-truth human ink
// for the same character. See ../README.md for full methodology, data
// provenance, and the honest limits (excerpt-only sample size, "Ink-
// Transformer" dropped for lack of any public checkpoint).
//
// For every character our TRANSCRIPTS bank and the MathWriting excerpt's
// symbols/ folder both have real ink for: normalize each to a common
// unit-square/fixed-point-count frame (dtw.mjs) and compute DTW distance
// between our rendered stroke path and each human sample. Where a label has
// 2+ human samples, also computes human-vs-human DTW as a variability
// baseline — the honest way to judge "is our distance from human ink normal
// variation, or a real shape gap" without a competing generative model.
//
// Usage: node evals/handwriting/run-dtw.mjs (no API key needed — pure
// geometry, no LLM calls)

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getOurGlyphPoints } from './glyph-geometry.mjs';
import { parseInkml } from './inkml-parser.mjs';
import { normalizeForComparison, dtwDistance } from './dtw.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYMBOLS_DIR = path.join(__dirname, 'mathwriting-data', 'mathwriting-2024-excerpt', 'symbols');

function loadHumanSamplesByLabel() {
  const byLabel = new Map(); // label -> [{ file, points: [[x,y],...] }]
  for (const file of readdirSync(SYMBOLS_DIR)) {
    if (!file.endsWith('.inkml')) continue;
    const { label, strokes } = parseInkml(path.join(SYMBOLS_DIR, file));
    if (!label) continue;
    // Flatten all strokes' (x,y) points in stroke order, dropping t — same
    // "concatenate strokes in draw order" convention getOurGlyphPoints uses.
    const points = strokes.flatMap((stroke) => stroke.map(([x, y]) => [x, y]));
    if (points.length < 2) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push({ file, points });
  }
  return byLabel;
}

function main() {
  const humanByLabel = loadHumanSamplesByLabel();
  const results = [];

  for (const [label, samples] of humanByLabel) {
    const ours = getOurGlyphPoints(label);
    if (!ours) continue; // no transcript for this character — not in our bank, skip

    const oursNorm = normalizeForComparison(ours);
    const humanNorms = samples.map((s) => ({ file: s.file, norm: normalizeForComparison(s.points) }));

    const oursVsHuman = humanNorms.map((h) => dtwDistance(oursNorm, h.norm));
    const avgOursVsHuman = oursVsHuman.reduce((a, b) => a + b, 0) / oursVsHuman.length;

    // Human-vs-human variability baseline, only computable with 2+ samples.
    let avgHumanVsHuman = null;
    if (humanNorms.length >= 2) {
      const pairs = [];
      for (let i = 0; i < humanNorms.length; i++) {
        for (let j = i + 1; j < humanNorms.length; j++) {
          pairs.push(dtwDistance(humanNorms[i].norm, humanNorms[j].norm));
        }
      }
      avgHumanVsHuman = pairs.reduce((a, b) => a + b, 0) / pairs.length;
    }

    results.push({
      label,
      humanSampleCount: samples.length,
      oursVsHumanDtw: avgOursVsHuman,
      humanVsHumanDtw: avgHumanVsHuman,
      // >1 means our ink deviates from human ink by more than humans
      // typically deviate from each other; <=1 means we're within normal
      // human handwriting variation for this glyph.
      ratioToHumanVariability: avgHumanVsHuman !== null ? avgOursVsHuman / avgHumanVsHuman : null,
    });
  }

  results.sort((a, b) => a.label.localeCompare(b.label));

  const withBaseline = results.filter((r) => r.ratioToHumanVariability !== null);
  const summary = {
    glyphsCompared: results.length,
    glyphsWithHumanVariabilityBaseline: withBaseline.length,
    avgOursVsHumanDtw: results.reduce((s, r) => s + r.oursVsHumanDtw, 0) / results.length,
    avgRatioToHumanVariability: withBaseline.length
      ? withBaseline.reduce((s, r) => s + r.ratioToHumanVariability, 0) / withBaseline.length
      : null,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      note: 'Compares our production stroke geometry (handwriting-agent-transcripts.js, resampled through the exact Catmull-Rom spline handwriting-agent.js uses — see glyph-geometry.mjs) against real human ink from Google\'s public MathWriting dataset excerpt (mathwriting-2024-excerpt, 1.5MB sample, NOT the full 2.9GB dataset). Both are normalized to a unit-square, fixed-point-count representation before DTW (dtw.mjs) so raw scale/device/point-density differences don\'t bias the comparison. No baseline generative model is compared (no public "Ink-Transformer" checkpoint could be found — see ../README.md); instead, human-vs-human DTW variability (computed wherever 2+ human samples of a glyph exist) serves as the reference point for whether our ink\'s distance from human ink is within normal handwriting variation.',
      sampleSizeCaveat: `Only the MathWriting EXCERPT was used (${readdirSync(SYMBOLS_DIR).length} single-symbol inks total, of which ${results.length} overlap with our TRANSCRIPTS bank) — the full dataset (2.9GB) would give more samples per glyph and broader character coverage.`,
      metric: 'DTW distance between two unit-square-normalized, 64-point-resampled 2D ink paths. ratioToHumanVariability = (avg DTW: ours vs. human samples) / (avg DTW: human vs. human samples) for glyphs with 2+ human samples — >1 means further from human ink than humans are from each other.',
    },
    summary,
    results,
  };

  const resultsDir = path.join(__dirname, 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outPath = path.join(resultsDir, `dtw-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== Handwriting DTW Eval Summary ===');
  console.log(`Glyphs compared: ${summary.glyphsCompared} (${summary.glyphsWithHumanVariabilityBaseline} with a human-variability baseline)`);
  console.log(`Avg DTW (ours vs. human): ${summary.avgOursVsHumanDtw.toFixed(3)}`);
  console.log(`Avg ratio to human-vs-human variability: ${summary.avgRatioToHumanVariability !== null ? summary.avgRatioToHumanVariability.toFixed(2) + 'x' : 'n/a'}`);
  console.log(`\nPer-glyph (label: ours-vs-human / human-vs-human / ratio):`);
  for (const r of results) {
    const hh = r.humanVsHumanDtw !== null ? r.humanVsHumanDtw.toFixed(3) : 'n/a';
    const ratio = r.ratioToHumanVariability !== null ? r.ratioToHumanVariability.toFixed(2) + 'x' : 'n/a';
    console.log(`  ${JSON.stringify(r.label)}: ${r.oursVsHumanDtw.toFixed(3)} / ${hh} / ${ratio}`);
  }
  console.log(`\nFull report written to: ${outPath}`);
}

main();
