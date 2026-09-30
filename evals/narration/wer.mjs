// Standard word-level Word Error Rate: word-level Levenshtein edit distance
// (substitutions + deletions + insertions, unit cost each) divided by the
// reference word count. Matches the methodology MathReader's own paper uses
// to score TTS-then-ASR round trips (arxiv.org/abs/2501.07088) — see
// ../README.md for why MathReader's own published numbers, not a local
// reproduction, are what this eval compares against.

/** Lowercases and strips punctuation so WER measures phonetic/word-choice
 * accuracy, not transcript formatting — ASR output and TTS input punctuate
 * differently even when a human would call them a perfect match. */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[.,!?;:()"'‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** @returns {number} edit distance between two word arrays */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** @returns {{ wer: number, editDistance: number, referenceWordCount: number }} */
export function wordErrorRate(referenceText, hypothesisText) {
  const ref = tokenize(referenceText);
  const hyp = tokenize(hypothesisText);
  const editDistance = levenshtein(ref, hyp);
  const referenceWordCount = ref.length;
  return {
    wer: referenceWordCount ? editDistance / referenceWordCount : (hyp.length ? 1 : 0),
    editDistance,
    referenceWordCount,
  };
}
