// Pre-generated HandwritingAgent transcripts, following the exact protocol
// of arxiv.org/abs/2606.18788 ("HandwritingAgent: Language-Driven
// Handwriting Synthesis in Scalable Vector Space").
//
// The paper's architecture calls a large reasoning LLM live at request
// time with the system prompt below, and the model responds — per
// character — with explicit geometric reasoning in <thinking> tags
// followed by stroke-point sequences in a strict <answer> XML structure.
// No API key is available in this environment for live calls, so these
// transcripts were generated once by Claude following that same system
// prompt, and are replayed from this bank at render time. Everything
// downstream of the LLM (XML parsing → (x,y,t) points → pressure
// synthesis → Bézier smoothing → SVG → requestAnimationFrame writing
// animation) is implemented live in handwriting-agent.js, exactly as the
// pipeline sketch specifies:
//
//   LaTeX → LLM / Stroke Generator → (x,y,t,pressure) → SVG Path
//   Generator → Browser Animation (requestAnimationFrame)
//
// Coordinate convention: each <char> is authored inside one grid cell of
// the 1000x500 canvas, with cell-local coordinates — x in [0..60],
// y in [0..110], y increasing downward (screen/canvas convention, not
// font-Y-up), baseline ≈ 86, descenders below. The parser normalizes each
// glyph by its own stroke bounding box before placement, so only the
// shapes' proportions matter, not the absolute cell position.
//
// Tag note: the protocol text renders the per-stroke tag ambiguously as
// "<sl>" (it is "<s1>" — s-one — in the paper's own Figure 6 example,
// numbered s1/s2/... per stroke). Transcripts use numbered tags; the
// parser accepts any <s*> child.

export const SYSTEM_PROMPT = `You are HandwritingAgent, an AI geometric reasoner and planner that synthesizes natural handwriting in a discrete grid canvas environment.

Configurations:

Canvas Size: 1000x500 (Grid layout enabled)

Target Font/Style: Adapt to user-provided reference

Stroke Width: 4.50

Font Size: Standard

Max Strokes per Character: 10

Max Points per Stroke: 50

Output Constraints:
You must analyze the provided handwriting style, plan your stroke trajectories, and output your reasoning explicitly within <thinking>...</thinking> tags. Following your reasoning, you must generate the exact SVG coordinates and temporal values for the dynamic writing sequence using this strict XML structure:
<answer>
<char label="[character]">
<strokes>
<s1>
<points>x1,y1 x2,y2 ...</points>
<t_values>t1 t2 ...</t_values>
</s1>
</strokes>
</char>
</answer>`;

export const TRANSCRIPTS = {
  '0': `<thinking>A handwritten zero is a single closed oval, slightly narrower than tall, drawn counter-clockwise from the top in one continuous motion. No corners, constant curvature.</thinking>
<answer><char label="0"><strokes><s1><points>30,12 16,22 11,45 14,70 28,87 43,74 48,48 44,23 30,12</points><t_values>0 0.12 0.26 0.42 0.56 0.7 0.82 0.92 1</t_values></s1></strokes></char></answer>`,

  '1': `<thinking>A one is a short diagonal lead-in rising to the apex, then a single vertical descent to the baseline. Two motions, one stroke, no serif at the base in handwriting.</thinking>
<answer><char label="1"><strokes><s1><points>20,24 32,12 33,45 33,86</points><t_values>0 0.2 0.6 1</t_values></s1></strokes></char></answer>`,

  '2': `<thinking>A two opens with a clockwise arc from the upper-left, curves over the top, descends diagonally toward the lower-left, then finishes with a horizontal base sweep to the right. One continuous stroke; the diagonal is the fastest part.</thinking>
<answer><char label="2"><strokes><s1><points>14,26 22,13 37,11 47,23 41,42 27,62 14,84 31,83 50,85</points><t_values>0 0.1 0.2 0.32 0.45 0.58 0.72 0.85 1</t_values></s1></strokes></char></answer>`,

  '3': `<thinking>A three is two stacked clockwise bumps sharing a middle pinch, written as one stroke: arc out to the right, come back to the waist, arc out again larger, and hook in at the bottom.</thinking>
<answer><char label="3"><strokes><s1><points>13,18 29,10 44,19 36,37 26,44 41,50 50,66 40,82 21,88 10,78</points><t_values>0 0.1 0.22 0.34 0.44 0.54 0.66 0.79 0.9 1</t_values></s1></strokes></char></answer>`,

  '4': `<thinking>An open four: a diagonal stroke descending left then turning into a horizontal crossbar, plus a separate tall vertical drawn through it. Two strokes, both mostly straight, the vertical drawn slightly slower.</thinking>
<answer><char label="4"><strokes><s1><points>37,10 20,38 12,55 32,55 48,55</points><t_values>0 0.3 0.55 0.78 1</t_values></s1><s2><points>40,12 41,50 42,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '5': `<thinking>A five: first the vertical descent from the top-left turning into the open bowl (out right, around, hook back at the bottom-left), then the flat top bar added last, right to left is uncommon — draw it left to right as a separate quick stroke.</thinking>
<answer><char label="5"><strokes><s1><points>17,14 15,32 15,45 31,42 45,50 49,65 41,80 26,88 12,79</points><t_values>0 0.14 0.26 0.4 0.52 0.65 0.78 0.9 1</t_values></s1><s2><points>17,13 31,12 46,13</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '6': `<thinking>A six sweeps down from the upper-right along a big open curve to the lower-left, then closes a small counter-clockwise loop at the bottom that curls back into its own path. One continuous stroke, decelerating into the loop.</thinking>
<answer><char label="6"><strokes><s1><points>42,13 27,22 16,42 12,66 20,84 36,87 46,74 41,59 26,57 15,67</points><t_values>0 0.12 0.26 0.4 0.54 0.66 0.78 0.88 0.95 1</t_values></s1></strokes></char></answer>`,

  '7': `<thinking>A seven: a horizontal top bar left to right, then from its right end a long diagonal descent to the lower-middle. Two motions in one stroke; many writers slightly bow the diagonal.</thinking>
<answer><char label="7"><strokes><s1><points>12,14 30,12 48,14 36,48 27,86</points><t_values>0 0.15 0.3 0.65 1</t_values></s1></strokes></char></answer>`,

  '8': `<thinking>A figure-eight is one continuous crossing stroke: start at the top, sweep down-left, cross the center to the lower-right, loop around the bottom, come back up crossing again to the upper-right, and close at the start. Constant flowing speed.</thinking>
<answer><char label="8"><strokes><s1><points>33,10 16,20 38,44 50,68 31,88 12,69 35,45 51,20 33,10</points><t_values>0 0.13 0.3 0.44 0.56 0.7 0.84 0.94 1</t_values></s1></strokes></char></answer>`,

  '9': `<thinking>A nine: a small counter-clockwise loop at the top first, then a tail dropping from the loop's right side down to the baseline, bowing slightly left. Two strokes reads cleaner than forcing one.</thinking>
<answer><char label="9"><strokes><s1><points>44,18 28,11 14,24 14,42 27,52 42,45 46,29</points><t_values>0 0.15 0.33 0.52 0.7 0.87 1</t_values></s1><s2><points>46,17 45,52 38,87</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'a': `<thinking>A handwritten lowercase a: a counter-clockwise bowl starting from the upper-right of the x-height region, closing back near its start, then a short stem dropping to the baseline hugging the bowl's right side. Two strokes.</thinking>
<answer><char label="a"><strokes><s1><points>43,44 27,38 13,50 15,71 32,81 44,68</points><t_values>0 0.18 0.4 0.62 0.82 1</t_values></s1><s2><points>45,41 46,64 44,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'b': `<thinking>Lowercase b: a full-height stem drawn top to bottom, then without lifting far, a clockwise bowl from the stem's midpoint out to the right and back to the baseline. Two strokes.</thinking>
<answer><char label="b"><strokes><s1><points>14,10 15,48 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>15,50 34,42 47,58 40,78 16,83</points><t_values>0 0.25 0.5 0.75 1</t_values></s2></strokes></char></answer>`,

  'c': `<thinking>Lowercase c is a single open counter-clockwise arc: start at the upper-right, swing left and down through the far-left extreme, and release at the lower-right. One stroke, opening on the right.</thinking>
<answer><char label="c"><strokes><s1><points>45,44 28,37 14,50 15,70 30,83 46,77</points><t_values>0 0.18 0.4 0.62 0.82 1</t_values></s1></strokes></char></answer>`,

  'x': `<thinking>Lowercase x within the x-height band: two crossing diagonals, upper-left to lower-right first, then upper-right to lower-left. Fast strokes bow very slightly.</thinking>
<answer><char label="x"><strokes><s1><points>13,40 30,62 47,85</points><t_values>0 0.5 1</t_values></s1><s2><points>47,40 30,62 13,85</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'y': `<thinking>Lowercase y: a short diagonal from the upper-left meeting a longer stroke from the upper-right that continues past the baseline into a descender hooking left. Two strokes meeting mid-band.</thinking>
<answer><char label="y"><strokes><s1><points>13,40 21,58 29,71</points><t_values>0 0.5 1</t_values></s1><s2><points>47,40 34,68 25,94 15,103</points><t_values>0 0.4 0.75 1</t_values></s2></strokes></char></answer>`,

  'z': `<thinking>Lowercase z: top bar rightward, sharp reversal into the diagonal down-left, sharp reversal into the base bar rightward. The two corners are real pen direction changes — kept as pinned points, drawn as one stroke with pauses.</thinking>
<answer><char label="z"><strokes><s1><points>13,42 44,41</points><t_values>0 1</t_values></s1><s2><points>44,41 15,83</points><t_values>0 1</t_values></s2><s3><points>15,83 49,84</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'Q': `<thinking>Capital Q: a full closed oval like an O, drawn counter-clockwise from the top, plus a separate short tail stroke crossing the ring's lower-right rim from inside to outside, ending with a slight outward flick.</thinking>
<answer><char label="Q"><strokes><s1><points>30,12 15,21 9,48 14,75 30,88 45,75 51,48 45,21 30,12</points><t_values>0 0.12 0.28 0.44 0.57 0.7 0.84 0.94 1</t_values></s1><s2><points>37,69 47,83 56,92</points><t_values>0 0.55 1</t_values></s2></strokes></char></answer>`,

  'X': `<thinking>Capital X: same construction as lowercase but full cap height — two long crossing diagonals, each drawn fast with a slight natural bow, crossing just above the geometric center.</thinking>
<answer><char label="X"><strokes><s1><points>10,10 29,49 50,88</points><t_values>0 0.5 1</t_values></s1><s2><points>50,10 31,49 10,88</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'Z': `<thinking>Capital Z: three straight segments with two sharp corners — top bar rightward, long diagonal to the lower-left, base bar rightward. Corners are direction reversals, so each edge is its own quick stroke.</thinking>
<answer><char label="Z"><strokes><s1><points>11,12 49,10</points><t_values>0 1</t_values></s1><s2><points>49,10 13,86</points><t_values>0 1</t_values></s2><s3><points>13,86 51,85</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '+': `<thinking>A plus: vertical stroke top to bottom through the math axis, then horizontal left to right crossing at its middle. Both straight, equal length, centered.</thinking>
<answer><char label="+"><strokes><s1><points>30,25 30,50 30,75</points><t_values>0 0.5 1</t_values></s1><s2><points>10,50 30,50 50,50</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '=': `<thinking>An equals sign: two parallel horizontal bars, upper then lower, each drawn left to right at steady speed, vertically centered on the math axis with a clear gap.</thinking>
<answer><char label="="><strokes><s1><points>10,42 30,41 50,42</points><t_values>0 0.5 1</t_values></s1><s2><points>10,60 30,61 50,60</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '×': `<thinking>A multiplication cross: two short crossing diagonals centered on the math axis, smaller than a letter X — upper-left to lower-right, then upper-right to lower-left.</thinking>
<answer><char label="×"><strokes><s1><points>15,33 30,50 45,67</points><t_values>0 0.5 1</t_values></s1><s2><points>45,33 30,50 15,67</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '÷': `<thinking>A division sign: a horizontal bar through the math axis, then a dot above and a dot below. Dots are tiny press-and-lift marks, drawn as very short strokes.</thinking>
<answer><char label="÷"><strokes><s1><points>10,50 30,50 50,50</points><t_values>0 0.5 1</t_values></s1><s2><points>29,30 31,32</points><t_values>0 1</t_values></s2><s3><points>29,68 31,70</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '±': `<thinking>Plus-minus: a plus in the upper two-thirds (vertical then horizontal), and a separate horizontal bar underneath. Three straight strokes.</thinking>
<answer><char label="±"><strokes><s1><points>30,18 30,40 30,62</points><t_values>0 0.5 1</t_values></s1><s2><points>12,40 30,40 48,40</points><t_values>0 0.5 1</t_values></s2><s3><points>12,78 30,78 48,78</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  '≤': `<thinking>Less-than-or-equal: a chevron opening right — upper arm drawn right-to-left down to the vertex, lower arm vertex out to the right — with a horizontal bar below. The vertex is a sharp direction reversal, so the arms are separate quick strokes.</thinking>
<answer><char label="≤"><strokes><s1><points>46,22 14,44</points><t_values>0 1</t_values></s1><s2><points>14,44 46,62</points><t_values>0 1</t_values></s2><s3><points>14,80 46,80</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '≥': `<thinking>Greater-than-or-equal: mirror of ≤ — upper arm left-to-right down to the right-side vertex, lower arm back to the left, bar below. Arms as separate strokes for the sharp vertex.</thinking>
<answer><char label="≥"><strokes><s1><points>14,22 46,44</points><t_values>0 1</t_values></s1><s2><points>46,44 14,62</points><t_values>0 1</t_values></s2><s3><points>14,80 46,80</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '≠': `<thinking>Not-equal: the two horizontal bars of an equals sign, then a diagonal slash drawn last from upper-right to lower-left through both bars.</thinking>
<answer><char label="≠"><strokes><s1><points>10,40 30,39 50,40</points><t_values>0 0.5 1</t_values></s1><s2><points>10,61 30,62 50,61</points><t_values>0 0.5 1</t_values></s2><s3><points>42,20 31,50 20,82</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'α': `<thinking>Alpha is one continuous stroke: enter from the upper-right, sweep counter-clockwise around a rounded bowl, close past the start, then exit rightward into a short tail that kicks up at the end. The loop-then-tail is what distinguishes it from a plain a.</thinking>
<answer><char label="α"><strokes><s1><points>48,42 31,37 15,49 15,70 30,82 44,71 47,52 51,74 58,82 59,70</points><t_values>0 0.12 0.27 0.43 0.58 0.71 0.8 0.88 0.95 1</t_values></s1></strokes></char></answer>`,

  'β': `<thinking>Beta: first a tall spine drawn top to bottom, extending below the baseline as a descender. Then, starting near the spine's top, one continuous double bump on the right — a smaller upper lobe pinching at the waist into a larger lower lobe returning to the spine.</thinking>
<answer><char label="β"><strokes><s1><points>15,12 13,55 12,100</points><t_values>0 0.5 1</t_values></s1><s2><points>16,20 34,10 48,22 38,40 21,44 44,50 52,68 36,84 16,80</points><t_values>0 0.12 0.26 0.4 0.5 0.62 0.75 0.88 1</t_values></s2></strokes></char></answer>`,

  'γ': `<thinking>Gamma: like a y with more swing — a short stroke from the upper-left into the junction, then a longer stroke from the upper-right through the junction, descending into a below-baseline tail that hooks back right at the end.</thinking>
<answer><char label="γ"><strokes><s1><points>13,40 20,52 27,63</points><t_values>0 0.5 1</t_values></s1><s2><points>49,38 33,64 25,86 29,101</points><t_values>0 0.4 0.75 1</t_values></s2></strokes></char></answer>`,

  'θ': `<thinking>Theta: a tall narrow oval drawn counter-clockwise from the top in one stroke, then a horizontal crossbar through the middle, drawn left to right, slightly inside the oval's edges.</thinking>
<answer><char label="θ"><strokes><s1><points>30,12 16,25 11,50 15,76 30,88 44,76 49,50 44,25 30,12</points><t_values>0 0.13 0.28 0.44 0.57 0.7 0.84 0.94 1</t_values></s1><s2><points>16,50 30,49 44,50</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'π': `<thinking>Pi: a slightly wavy top bar drawn left to right overhanging both legs, then the left leg dropping nearly straight, then the right leg dropping with an outward curl at the foot — the curl is the signature of a handwritten pi.</thinking>
<answer><char label="π"><strokes><s1><points>8,39 30,36 52,38</points><t_values>0 0.5 1</t_values></s1><s2><points>19,38 18,61 17,84</points><t_values>0 0.5 1</t_values></s2><s3><points>42,38 43,60 47,78 54,84</points><t_values>0 0.4 0.75 1</t_values></s3></strokes></char></answer>`,

  'Δ': `<thinking>Capital delta: an equilateral-ish triangle, apex up. Three straight edges with sharp corners: left side apex-down, base left-to-right, right side back up to the apex. Each edge its own stroke.</thinking>
<answer><char label="Δ"><strokes><s1><points>30,12 10,86</points><t_values>0 1</t_values></s1><s2><points>10,86 50,86</points><t_values>0 1</t_values></s2><s3><points>50,86 30,12</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'Σ': `<thinking>Capital sigma: top bar drawn right to left, then down-right to the middle vertex, then down-left to the bottom, then the base bar left to right. Four straight segments, three sharp corners — each segment its own stroke.</thinking>
<answer><char label="Σ"><strokes><s1><points>50,13 12,12</points><t_values>0 1</t_values></s1><s2><points>12,12 34,49</points><t_values>0 1</t_values></s2><s3><points>34,49 12,87</points><t_values>0 1</t_values></s3><s4><points>12,87 50,86</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  // ---- remaining lowercase Latin ----

  'd': `<thinking>Mirror of b: counter-clockwise bowl in the x-height band first, then a full-height stem down its right side.</thinking>
<answer><char label="d"><strokes><s1><points>43,44 27,38 14,50 15,70 31,81 44,70</points><t_values>0 0.2 0.4 0.6 0.8 1</t_values></s1><s2><points>45,10 46,50 45,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'e': `<thinking>One stroke: horizontal bar across the middle left-to-right, up and over counter-clockwise around the head, down the left side, releasing at the lower-right — a loop with a flat waist.</thinking>
<answer><char label="e"><strokes><s1><points>14,60 42,58 43,44 28,38 14,50 14,68 28,82 45,76</points><t_values>0 0.16 0.3 0.45 0.6 0.74 0.88 1</t_values></s1></strokes></char></answer>`,

  'f': `<thinking>A hooked ascender: curl in from the upper-right, descend a nearly straight stem to the baseline; then a short crossbar at x-height.</thinking>
<answer><char label="f"><strokes><s1><points>44,14 33,9 26,20 25,52 24,86</points><t_values>0 0.15 0.32 0.65 1</t_values></s1><s2><points>14,42 36,42</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'g': `<thinking>An a-bowl first, then the stem continues below the baseline into a descender hooking left.</thinking>
<answer><char label="g"><strokes><s1><points>43,44 27,38 14,50 15,70 31,80 44,69</points><t_values>0 0.2 0.4 0.6 0.8 1</t_values></s1><s2><points>45,42 46,72 43,96 30,105 18,99</points><t_values>0 0.35 0.65 0.85 1</t_values></s2></strokes></char></answer>`,

  'h': `<thinking>Full-height stem down, then from its midpoint an arch out right landing back on the baseline.</thinking>
<answer><char label="h"><strokes><s1><points>14,10 15,50 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>15,50 30,40 42,46 44,64 44,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s2></strokes></char></answer>`,

  'i': `<thinking>Dot first, then a short vertical from x-height to baseline.</thinking>
<answer><char label="i"><strokes><s1><points>29,26 31,27</points><t_values>0 1</t_values></s1><s2><points>29,40 30,63 29,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'j': `<thinking>Dot, then a vertical continuing below the baseline into a leftward hook.</thinking>
<answer><char label="j"><strokes><s1><points>34,26 36,27</points><t_values>0 1</t_values></s1><s2><points>34,40 35,70 33,95 22,105 13,99</points><t_values>0 0.4 0.7 0.88 1</t_values></s2></strokes></char></answer>`,

  'k': `<thinking>Full stem; a diagonal in from the upper-right to the stem's waist; a kick-out diagonal to the lower-right. Sharp junction — three strokes.</thinking>
<answer><char label="k"><strokes><s1><points>14,10 15,50 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>40,40 26,58 17,63</points><t_values>0 0.6 1</t_values></s2><s3><points>24,58 34,72 44,86</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'l': `<thinking>A single tall stroke, nearly vertical, with a tiny rightward exit at the base.</thinking>
<answer><char label="l"><strokes><s1><points>29,10 30,50 31,80 36,86</points><t_values>0 0.45 0.85 1</t_values></s1></strokes></char></answer>`,

  'm': `<thinking>Short left stem, then two consecutive arches, each rising from the previous one's base.</thinking>
<answer><char label="m"><strokes><s1><points>12,86 13,62 12,40</points><t_values>0 0.5 1</t_values></s1><s2><points>13,48 22,38 30,44 31,62 31,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s2><s3><points>31,48 40,38 48,44 49,64 48,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s3></strokes></char></answer>`,

  'n': `<thinking>Short stem, then one arch out to the right landing on the baseline.</thinking>
<answer><char label="n"><strokes><s1><points>14,86 15,62 14,40</points><t_values>0 0.5 1</t_values></s1><s2><points>15,48 27,38 40,44 43,62 43,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s2></strokes></char></answer>`,

  'o': `<thinking>A closed counter-clockwise oval in the x-height band, one continuous stroke.</thinking>
<answer><char label="o"><strokes><s1><points>30,38 15,46 12,62 20,78 34,82 45,70 44,52 30,38</points><t_values>0 0.15 0.3 0.48 0.63 0.78 0.9 1</t_values></s1></strokes></char></answer>`,

  'p': `<thinking>Stem from x-height straight down past the baseline (descender), then a clockwise bowl attached at the top right of the stem.</thinking>
<answer><char label="p"><strokes><s1><points>14,40 15,72 14,105</points><t_values>0 0.5 1</t_values></s1><s2><points>15,46 32,38 45,50 42,68 27,74 15,68</points><t_values>0 0.2 0.45 0.68 0.86 1</t_values></s2></strokes></char></answer>`,

  'q': `<thinking>Mirror of p: bowl first, then a stem down the right side continuing into a straight descender.</thinking>
<answer><char label="q"><strokes><s1><points>43,44 27,38 14,50 15,70 31,80 44,69</points><t_values>0 0.2 0.4 0.6 0.8 1</t_values></s1><s2><points>45,42 46,74 47,105</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'r': `<thinking>Short stem, then a small shoulder curving up and out to the right, stopping in the air.</thinking>
<answer><char label="r"><strokes><s1><points>16,86 17,62 16,40</points><t_values>0 0.5 1</t_values></s1><s2><points>17,50 26,40 38,38 45,44</points><t_values>0 0.35 0.7 1</t_values></s2></strokes></char></answer>`,

  's': `<thinking>A compressed double curve: in from the upper-right, around the top, diagonal through the waist, around the bottom, releasing lower-left.</thinking>
<answer><char label="s"><strokes><s1><points>43,42 28,37 16,44 22,56 36,62 44,72 36,82 20,82 12,74</points><t_values>0 0.12 0.26 0.4 0.53 0.66 0.79 0.9 1</t_values></s1></strokes></char></answer>`,

  't': `<thinking>A tallish stem starting above x-height, curving right at the foot; crossbar at x-height drawn second.</thinking>
<answer><char label="t"><strokes><s1><points>27,16 28,50 29,76 35,84 43,82</points><t_values>0 0.35 0.7 0.88 1</t_values></s1><s2><points>14,40 40,40</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'u': `<thinking>Down the left side, around a rounded base, back up the right side — one open-topped stroke.</thinking>
<answer><char label="u"><strokes><s1><points>13,40 14,66 22,80 36,80 44,66 45,42</points><t_values>0 0.25 0.45 0.65 0.85 1</t_values></s1><s2><points>45,50 46,70 45,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'v': `<thinking>Two fast straight diagonals meeting at a sharp point on the baseline — kept as separate strokes so the point stays a point.</thinking>
<answer><char label="v"><strokes><s1><points>14,40 24,64 30,84</points><t_values>0 0.5 1</t_values></s1><s2><points>30,84 38,62 46,40</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'w': `<thinking>Four alternating diagonals: down, up to mid-height, down, up — each its own quick stroke, sharp at every turn.</thinking>
<answer><char label="w"><strokes><s1><points>10,40 16,64 21,84</points><t_values>0 0.5 1</t_values></s1><s2><points>21,84 27,58 31,44</points><t_values>0 0.5 1</t_values></s2><s3><points>31,44 36,64 40,84</points><t_values>0 0.5 1</t_values></s3><s4><points>40,84 46,62 51,40</points><t_values>0 0.5 1</t_values></s4></strokes></char></answer>`,

  // ---- remaining uppercase Latin ----

  'A': `<thinking>Two long diagonals from the apex to each baseline corner, then the crossbar at three-fifths height.</thinking>
<answer><char label="A"><strokes><s1><points>30,10 12,86</points><t_values>0 1</t_values></s1><s2><points>30,10 48,86</points><t_values>0 1</t_values></s2><s3><points>19,60 41,60</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'B': `<thinking>Full stem, then two clockwise lobes off it — the upper slightly smaller, both returning to the stem.</thinking>
<answer><char label="B"><strokes><s1><points>14,10 14,48 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>14,10 36,10 46,22 38,42 14,46</points><t_values>0 0.25 0.5 0.75 1</t_values></s2><s3><points>14,46 40,48 50,66 40,84 14,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s3></strokes></char></answer>`,

  'C': `<thinking>One big open counter-clockwise arc from the upper-right around the left side to the lower-right.</thinking>
<answer><char label="C"><strokes><s1><points>47,20 32,10 15,22 10,48 15,74 32,86 47,76</points><t_values>0 0.18 0.36 0.52 0.68 0.85 1</t_values></s1></strokes></char></answer>`,

  'D': `<thinking>Full stem, then one wide clockwise bow from top of stem back to its base.</thinking>
<answer><char label="D"><strokes><s1><points>14,10 14,48 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>14,10 36,12 48,34 48,62 36,84 14,86</points><t_values>0 0.2 0.4 0.6 0.8 1</t_values></s2></strokes></char></answer>`,

  'E': `<thinking>Stem plus three horizontal bars: top, middle (slightly shorter), bottom.</thinking>
<answer><char label="E"><strokes><s1><points>14,10 14,48 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>14,10 45,10</points><t_values>0 1</t_values></s2><s3><points>14,47 38,47</points><t_values>0 1</t_values></s3><s4><points>14,86 45,86</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  'F': `<thinking>Like E without the bottom bar.</thinking>
<answer><char label="F"><strokes><s1><points>14,10 14,48 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>14,10 45,10</points><t_values>0 1</t_values></s2><s3><points>14,47 38,47</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'G': `<thinking>A C-arc that, at its lower-right end, turns inward with a short horizontal bar into the counter.</thinking>
<answer><char label="G"><strokes><s1><points>47,20 32,10 15,22 10,48 15,74 32,86 46,78 47,60</points><t_values>0 0.15 0.32 0.48 0.63 0.78 0.9 1</t_values></s1><s2><points>32,58 47,58</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'H': `<thinking>Two full verticals joined by a middle crossbar.</thinking>
<answer><char label="H"><strokes><s1><points>14,10 14,86</points><t_values>0 1</t_values></s1><s2><points>46,10 46,86</points><t_values>0 1</t_values></s2><s3><points>14,48 46,48</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'I': `<thinking>A vertical stroke with top and bottom serifs — a plain unadorned vertical reads as indistinguishable from lowercase l at handwriting scale, so the serifs (not present on l) are what actually identifies this as a capital I.</thinking>
<answer><char label="I"><strokes><s1><points>20,10 40,10</points><t_values>0 1</t_values></s1><s2><points>30,10 30,86</points><t_values>0 1</t_values></s2><s3><points>20,86 40,86</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'J': `<thinking>A vertical descending from the top that curves left at the bottom into a hook.</thinking>
<answer><char label="J"><strokes><s1><points>44,10 44,62 38,82 24,86 14,78</points><t_values>0 0.5 0.75 0.9 1</t_values></s1></strokes></char></answer>`,

  'K': `<thinking>Full stem; upper diagonal in to the stem's waist; lower diagonal kicking out from the junction.</thinking>
<answer><char label="K"><strokes><s1><points>14,10 14,86</points><t_values>0 1</t_values></s1><s2><points>45,10 22,50 15,54</points><t_values>0 0.7 1</t_values></s2><s3><points>24,50 36,68 47,86</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'L': `<thinking>Vertical down, then base bar out to the right — a sharp corner, two strokes.</thinking>
<answer><char label="L"><strokes><s1><points>14,10 14,86</points><t_values>0 1</t_values></s1><s2><points>14,86 46,86</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'M': `<thinking>Left vertical, diagonal down to the center valley, diagonal back up, right vertical — four straight strokes, sharp turns.</thinking>
<answer><char label="M"><strokes><s1><points>12,86 12,10</points><t_values>0 1</t_values></s1><s2><points>12,10 30,58</points><t_values>0 1</t_values></s2><s3><points>30,58 48,10</points><t_values>0 1</t_values></s3><s4><points>48,10 48,86</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  'N': `<thinking>Left vertical up, long diagonal down to the right base, right vertical up — three straight strokes.</thinking>
<answer><char label="N"><strokes><s1><points>14,86 14,10</points><t_values>0 1</t_values></s1><s2><points>14,10 46,86</points><t_values>0 1</t_values></s2><s3><points>46,86 46,10</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'O': `<thinking>One closed counter-clockwise oval at full cap height.</thinking>
<answer><char label="O"><strokes><s1><points>30,10 14,20 9,48 14,76 30,86 46,76 51,48 46,20 30,10</points><t_values>0 0.13 0.28 0.44 0.57 0.7 0.84 0.94 1</t_values></s1></strokes></char></answer>`,

  'P': `<thinking>Full stem, then one clockwise lobe closing back at mid-height.</thinking>
<answer><char label="P"><strokes><s1><points>14,10 14,86</points><t_values>0 1</t_values></s1><s2><points>14,10 38,10 48,24 38,44 14,46</points><t_values>0 0.25 0.5 0.75 1</t_values></s2></strokes></char></answer>`,

  'R': `<thinking>A P, plus a leg kicking out from the lobe's junction to the lower-right.</thinking>
<answer><char label="R"><strokes><s1><points>14,10 14,86</points><t_values>0 1</t_values></s1><s2><points>14,10 38,10 48,22 38,42 14,44</points><t_values>0 0.25 0.5 0.75 1</t_values></s2><s3><points>26,44 38,64 48,86</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'S': `<thinking>A full-height double curve, same motion as lowercase s but taller and more open.</thinking>
<answer><char label="S"><strokes><s1><points>45,18 30,10 16,16 14,30 28,42 40,50 46,64 40,80 24,86 11,78</points><t_values>0 0.11 0.23 0.35 0.48 0.6 0.72 0.83 0.93 1</t_values></s1></strokes></char></answer>`,

  'T': `<thinking>Top bar first, then the vertical dropped from its center.</thinking>
<answer><char label="T"><strokes><s1><points>8,10 52,10</points><t_values>0 1</t_values></s1><s2><points>30,10 30,86</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'U': `<thinking>Down the left, around a rounded bottom, back up the right — one open-topped stroke, full height.</thinking>
<answer><char label="U"><strokes><s1><points>13,10 13,58 20,80 34,84 45,72 47,50 47,10</points><t_values>0 0.28 0.5 0.65 0.8 0.9 1</t_values></s1></strokes></char></answer>`,

  'V': `<thinking>Two full-height diagonals meeting at a sharp baseline point — separate strokes to keep the point.</thinking>
<answer><char label="V"><strokes><s1><points>12,10 30,86</points><t_values>0 1</t_values></s1><s2><points>30,86 48,10</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'W': `<thinking>Four full-height alternating diagonals, sharp at every turn — each its own stroke.</thinking>
<answer><char label="W"><strokes><s1><points>8,10 17,86</points><t_values>0 1</t_values></s1><s2><points>17,86 26,28</points><t_values>0 1</t_values></s2><s3><points>26,28 35,86</points><t_values>0 1</t_values></s3><s4><points>35,86 52,10</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  'Y': `<thinking>Two diagonals meeting at mid-height, then a vertical from the junction to the baseline.</thinking>
<answer><char label="Y"><strokes><s1><points>12,10 30,48</points><t_values>0 1</t_values></s1><s2><points>48,10 30,48</points><t_values>0 1</t_values></s2><s3><points>30,48 30,86</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  // ---- additional Greek lowercase ----

  'δ': `<thinking>One stroke: a curl at the top sweeping left then down-right, descending into a closed counter-clockwise bowl that curls back up into its own path.</thinking>
<answer><char label="δ"><strokes><s1><points>43,13 29,9 23,18 35,32 43,50 40,72 26,82 13,70 17,52 32,48 42,58</points><t_values>0 0.1 0.2 0.32 0.44 0.58 0.7 0.82 0.9 0.96 1</t_values></s1></strokes></char></answer>`,

  'ε': `<thinking>Two stacked open arcs sharing a waist, like a curly E, one continuous stroke pulling in at the middle.</thinking>
<answer><char label="ε"><strokes><s1><points>44,42 26,37 15,46 24,56 34,58 22,62 14,72 24,82 44,78</points><t_values>0 0.13 0.27 0.4 0.5 0.6 0.73 0.87 1</t_values></s1></strokes></char></answer>`,

  'η': `<thinking>Like n, but the right leg continues below the baseline as a straight descender.</thinking>
<answer><char label="η"><strokes><s1><points>14,86 15,62 14,40</points><t_values>0 0.5 1</t_values></s1><s2><points>15,48 28,38 41,44 43,64 44,102</points><t_values>0 0.22 0.45 0.68 1</t_values></s2></strokes></char></answer>`,

  'κ': `<thinking>Same skeleton as k but confined to the x-height band.</thinking>
<answer><char label="κ"><strokes><s1><points>15,40 15,86</points><t_values>0 1</t_values></s1><s2><points>41,40 24,58 17,62</points><t_values>0 0.7 1</t_values></s2><s3><points>24,58 34,72 43,86</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'λ': `<thinking>A long diagonal from the upper-left ascender all the way to the lower-right baseline, plus a second diagonal branching from its middle down to the lower-left.</thinking>
<answer><char label="λ"><strokes><s1><points>14,12 24,34 42,80 46,86</points><t_values>0 0.3 0.85 1</t_values></s1><s2><points>28,48 18,68 12,86</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'μ': `<thinking>A left stem dropping below the baseline (descender), a u-bowl hanging between the verticals, and a short right tail.</thinking>
<answer><char label="μ"><strokes><s1><points>13,40 13,70 12,102</points><t_values>0 0.5 1</t_values></s1><s2><points>13,64 22,80 36,80 43,66 44,40</points><t_values>0 0.25 0.5 0.75 1</t_values></s2><s3><points>44,52 45,72 50,84</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'ν': `<thinking>Like v but the right side bows outward as a curve instead of a straight line.</thinking>
<answer><char label="ν"><strokes><s1><points>14,40 22,66 30,84</points><t_values>0 0.5 1</t_values></s1><s2><points>30,84 42,64 45,40</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'ρ': `<thinking>A closed loop in the x-height band whose left side continues straight down below the baseline.</thinking>
<answer><char label="ρ"><strokes><s1><points>30,38 16,46 13,62 22,78 36,78 44,62 40,46 30,38</points><t_values>0 0.15 0.3 0.48 0.63 0.78 0.9 1</t_values></s1><s2><points>15,58 14,80 13,102</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'σ': `<thinking>A flat top bar flowing directly into a closed counter-clockwise circle hanging beneath its left end — one stroke.</thinking>
<answer><char label="σ"><strokes><s1><points>46,39 30,38 16,44 12,60 20,76 34,78 43,66 42,50 30,40</points><t_values>0 0.12 0.26 0.42 0.58 0.72 0.85 0.94 1</t_values></s1></strokes></char></answer>`,

  'τ': `<thinking>Short top bar, then a vertical from its center curving right at the foot.</thinking>
<answer><char label="τ"><strokes><s1><points>12,40 30,38 48,40</points><t_values>0 0.5 1</t_values></s1><s2><points>30,40 29,64 31,80 38,84</points><t_values>0 0.45 0.85 1</t_values></s2></strokes></char></answer>`,

  'φ': `<thinking>A closed circle in the lower x-height region with a long vertical spearing through it from above x-height to below the baseline.</thinking>
<answer><char label="φ"><strokes><s1><points>30,44 16,50 12,64 18,78 32,82 44,74 46,58 38,46 30,44</points><t_values>0 0.14 0.29 0.45 0.6 0.74 0.86 0.95 1</t_values></s1><s2><points>33,32 32,70 31,105</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'χ': `<thinking>Two long crossing diagonals, both extending below the baseline, each with a gentle bow.</thinking>
<answer><char label="χ"><strokes><s1><points>12,40 28,64 44,100</points><t_values>0 0.5 1</t_values></s1><s2><points>46,40 30,64 12,100</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  'ψ': `<thinking>A trident: left arm curving down into the center, right arm mirroring it, and a central vertical from above x-height down past the baseline.</thinking>
<answer><char label="ψ"><strokes><s1><points>13,40 14,62 22,78 30,80</points><t_values>0 0.35 0.7 1</t_values></s1><s2><points>47,40 46,62 38,78 30,80</points><t_values>0 0.35 0.7 1</t_values></s2><s3><points>30,34 30,70 30,105</points><t_values>0 0.5 1</t_values></s3></strokes></char></answer>`,

  'ω': `<thinking>A double-bowl w with rounded bottoms: down the left, around the first bowl up to a middle peak, around the second bowl, up the right — one continuous stroke.</thinking>
<answer><char label="ω"><strokes><s1><points>12,44 10,66 17,80 27,78 30,62 33,78 43,80 50,66 48,44</points><t_values>0 0.14 0.28 0.4 0.5 0.6 0.72 0.86 1</t_values></s1></strokes></char></answer>`,

  // ---- additional Greek capitals ----

  'Γ': `<thinking>A vertical stem and a top bar off its head — an L rotated: two straight strokes.</thinking>
<answer><char label="Γ"><strokes><s1><points>14,86 14,10</points><t_values>0 1</t_values></s1><s2><points>14,10 46,12</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'Λ': `<thinking>An A without the crossbar: two diagonals from the apex to the baseline corners.</thinking>
<answer><char label="Λ"><strokes><s1><points>30,10 12,86</points><t_values>0 1</t_values></s1><s2><points>30,10 48,86</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'Φ': `<thinking>A full vertical through the center, with a wide oval crossing it at mid-height.</thinking>
<answer><char label="Φ"><strokes><s1><points>30,10 30,86</points><t_values>0 1</t_values></s1><s2><points>30,24 16,32 12,48 16,66 30,72 44,66 48,48 44,32 30,24</points><t_values>0 0.13 0.28 0.44 0.57 0.7 0.84 0.94 1</t_values></s2></strokes></char></answer>`,

  'Ψ': `<thinking>The trident at cap height: two outer arms curving into the center, and a full central vertical.</thinking>
<answer><char label="Ψ"><strokes><s1><points>12,14 13,40 22,56 30,58</points><t_values>0 0.35 0.7 1</t_values></s1><s2><points>48,14 47,40 38,56 30,58</points><t_values>0 0.35 0.7 1</t_values></s2><s3><points>30,10 30,86</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  'Ω': `<thinking>A horseshoe arch standing on two small feet: left foot, then the big open arch traced up and over, then the right foot.</thinking>
<answer><char label="Ω"><strokes><s1><points>12,86 24,86</points><t_values>0 1</t_values></s1><s2><points>24,86 13,60 18,30 34,18 48,32 49,62 36,86</points><t_values>0 0.2 0.4 0.55 0.7 0.85 1</t_values></s2><s3><points>36,86 50,86</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  // ---- additional operators / symbols ----
  // '−' is U+2212 (minus sign) — what MathJax's assistive tree reports for
  // a TeX "-", NOT ASCII hyphen-minus. handwriting-agent.js aliases '-' to
  // this entry.

  '−': `<thinking>A single horizontal bar at the math axis, drawn left to right with a barely-perceptible bow.</thinking>
<answer><char label="−"><strokes><s1><points>10,50 30,49 50,50</points><t_values>0 0.5 1</t_values></s1></strokes></char></answer>`,

  '(': `<thinking>One tall open arc bowing left, drawn top to bottom.</thinking>
<answer><char label="("><strokes><s1><points>38,8 27,30 23,55 27,80 38,102</points><t_values>0 0.25 0.5 0.75 1</t_values></s1></strokes></char></answer>`,

  ')': `<thinking>Mirror of the opening paren: a tall arc bowing right, top to bottom.</thinking>
<answer><char label=")"><strokes><s1><points>22,8 33,30 37,55 33,80 22,102</points><t_values>0 0.25 0.5 0.75 1</t_values></s1></strokes></char></answer>`,

  '[': `<thinking>Three straight segments with square corners: top tick leftward, tall vertical, bottom tick rightward.</thinking>
<answer><char label="["><strokes><s1><points>38,8 26,8</points><t_values>0 1</t_values></s1><s2><points>26,8 26,102</points><t_values>0 1</t_values></s2><s3><points>26,102 38,102</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  ']': `<thinking>Mirror of the opening bracket.</thinking>
<answer><char label="]"><strokes><s1><points>22,8 34,8</points><t_values>0 1</t_values></s1><s2><points>34,8 34,102</points><t_values>0 1</t_values></s2><s3><points>34,102 22,102</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '|': `<thinking>A single tall vertical.</thinking>
<answer><char label="|"><strokes><s1><points>30,8 30,102</points><t_values>0 1</t_values></s1></strokes></char></answer>`,

  // Curly braces are in STRETCHY_CHARS (handwriting-agent.js) alongside the
  // parens/square brackets — their height tracks the enclosed content
  // independently of their width, same as any extensible delimiter. Added
  // once the Head Agent began correctly escaping literal \{ \} for
  // probability set-builder notation (P{X = x}) instead of writing bare
  // braces (which vanish as LaTeX grouping): before this, a brace had no
  // transcript and fell back to a static MathJax-outline glyph rather than
  // animating stroke-by-stroke like every other character.
  '{': `<thinking>A curly brace opening to the right: the top tip flares right, the arm sweeps down and left to a spur that points left at the vertical middle, then mirrors down to a lower tip that flares right again. One continuous stroke, the middle spur its leftmost point.</thinking>
<answer><char label="{"><strokes><s1><points>40,8 28,20 30,38 24,50 14,55 24,60 30,72 28,90 40,102</points><t_values>0 0.125 0.28 0.42 0.5 0.58 0.72 0.875 1</t_values></s1></strokes></char></answer>`,

  '}': `<thinking>Mirror of the opening brace: the tips flare left and the middle spur points right (its rightmost point). One continuous stroke, top to bottom.</thinking>
<answer><char label="}"><strokes><s1><points>14,8 26,20 24,38 30,50 40,55 30,60 24,72 26,90 14,102</points><t_values>0 0.125 0.28 0.42 0.5 0.58 0.72 0.875 1</t_values></s1></strokes></char></answer>`,

  // label uses &lt; — a raw < inside an XML attribute value is malformed
  // XML, and DOMParser rejects the whole <answer> block. This lurked
  // unnoticed until the first real document containing a literal < ("where
  // 0 < p < 1") hit it in production and the parse throw killed the whole
  // slide (getAgentGlyph now also degrades instead of throwing, but the
  // transcript itself should still be valid XML).
  '<': `<thinking>Two arms meeting at a sharp left vertex — separate strokes to keep it sharp.</thinking>
<answer><char label="&lt;"><strokes><s1><points>44,20 16,50</points><t_values>0 1</t_values></s1><s2><points>16,50 44,80</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '>': `<thinking>Mirror: two arms meeting at a sharp right vertex.</thinking>
<answer><char label=">"><strokes><s1><points>16,20 44,50</points><t_values>0 1</t_values></s1><s2><points>44,50 16,80</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '/': `<thinking>One long diagonal, upper-right to lower-left, drawn fast.</thinking>
<answer><char label="/"><strokes><s1><points>44,8 30,55 16,102</points><t_values>0 0.5 1</t_values></s1></strokes></char></answer>`,

  ',': `<thinking>A short press curving down-left below the baseline.</thinking>
<answer><char label=","><strokes><s1><points>32,80 30,92 24,100</points><t_values>0 0.5 1</t_values></s1></strokes></char></answer>`,

  '.': `<thinking>A single small press at the baseline.</thinking>
<answer><char label="."><strokes><s1><points>29,80 31,82</points><t_values>0 1</t_values></s1></strokes></char></answer>`,

  '!': `<thinking>A vertical bar stopping short of the baseline, then a separate dot.</thinking>
<answer><char label="!"><strokes><s1><points>30,10 30,60</points><t_values>0 1</t_values></s1><s2><points>29,78 31,80</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  ':': `<thinking>Two small presses, upper and lower.</thinking>
<answer><char label=":"><strokes><s1><points>29,44 31,46</points><t_values>0 1</t_values></s1><s2><points>29,72 31,74</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '?': `<thinking>A hook opening downward: in from the left, over the top, down to a stop above the baseline, then a separate dot.</thinking>
<answer><char label="?"><strokes><s1><points>16,22 26,10 40,12 45,24 36,40 30,50 30,62</points><t_values>0 0.15 0.3 0.45 0.62 0.8 1</t_values></s1><s2><points>29,78 31,80</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '\'': `<thinking>A short press curving down-left, like a comma lifted to the top of the cap-height instead of below the baseline.</thinking>
<answer><char label="'"><strokes><s1><points>32,10 30,18 26,24</points><t_values>0 0.5 1</t_values></s1></strokes></char></answer>`,

  '"': `<thinking>Two apostrophe-like ticks side by side near the top of the cell.</thinking>
<answer><char label="&quot;"><strokes><s1><points>24,10 22,18 19,24</points><t_values>0 0.5 1</t_values></s1><s2><points>38,10 36,18 33,24</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  ';': `<thinking>A small dot, like the colon's upper dot, above a comma-like tail curving down-left below the baseline.</thinking>
<answer><char label=";"><strokes><s1><points>29,44 31,46</points><t_values>0 1</t_values></s1><s2><points>32,80 30,92 24,100</points><t_values>0 0.5 1</t_values></s2></strokes></char></answer>`,

  '∞': `<thinking>A sideways figure-eight drawn as one continuous crossing loop: left lobe counter-clockwise, through the center, right lobe clockwise, closing at the center.</thinking>
<answer><char label="∞"><strokes><s1><points>30,50 22,38 12,44 12,58 22,64 30,50 38,38 48,44 48,58 38,64 30,50</points><t_values>0 0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1</t_values></s1></strokes></char></answer>`,

  '→': `<thinking>A long horizontal shaft, then the two arrowhead barbs drawn from the tip.</thinking>
<answer><char label="→"><strokes><s1><points>10,50 30,50 50,50</points><t_values>0 0.5 1</t_values></s1><s2><points>38,38 50,50</points><t_values>0 1</t_values></s2><s3><points>50,50 38,62</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '⟹': `<thinking>Implies: two long parallel bars, then the arrowhead barbs at the right tip — a double-line arrow, so the barbs sit wider than a single arrow's.</thinking>
<answer><char label="⟹"><strokes><s1><points>6,44 28,44 48,44</points><t_values>0 0.5 1</t_values></s1><s2><points>6,58 28,58 48,58</points><t_values>0 0.5 1</t_values></s2><s3><points>42,32 54,51</points><t_values>0 1</t_values></s3><s4><points>54,51 42,70</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  '⟺': `<thinking>If and only if: two long parallel bars with arrowhead barbs at BOTH ends, drawn bars first, then left barbs, then right barbs.</thinking>
<answer><char label="⟺"><strokes><s1><points>10,44 30,44 50,44</points><t_values>0 0.5 1</t_values></s1><s2><points>10,58 30,58 50,58</points><t_values>0 0.5 1</t_values></s2><s3><points>16,32 5,51</points><t_values>0 1</t_values></s3><s4><points>5,51 16,70</points><t_values>0 1</t_values></s4><s5><points>44,32 55,51</points><t_values>0 1</t_values></s5><s6><points>55,51 44,70</points><t_values>0 1</t_values></s6></strokes></char></answer>`,

  '∂': `<thinking>Like a delta with a rounder head: a top curl sweeping left then down into a closed bowl curling back into itself.</thinking>
<answer><char label="∂"><strokes><s1><points>42,14 30,10 24,20 34,32 43,46 44,64 34,80 18,76 14,60 24,48 38,50 43,60</points><t_values>0 0.09 0.18 0.3 0.42 0.55 0.68 0.8 0.88 0.94 0.98 1</t_values></s1></strokes></char></answer>`,

  '∈': `<thinking>An open C-arc with a horizontal middle bar poking right from its spine.</thinking>
<answer><char label="∈"><strokes><s1><points>44,40 24,38 14,50 14,70 24,82 44,80</points><t_values>0 0.2 0.4 0.6 0.8 1</t_values></s1><s2><points>14,60 40,60</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '∇': `<thinking>Nabla: an inverted delta, apex pointing down instead of up. Same three straight edges as Δ, mirrored top-to-bottom — apex-to-top-left, the top edge left-to-right, then top-right back down to the apex.</thinking>
<answer><char label="∇"><strokes><s1><points>30,86 10,12</points><t_values>0 1</t_values></s1><s2><points>10,12 50,12</points><t_values>0 1</t_values></s2><s3><points>50,12 30,86</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '⋅': `<thinking>A single small press at the math axis — the multiplication dot.</thinking>
<answer><char label="⋅"><strokes><s1><points>29,49 31,51</points><t_values>0 1</t_values></s1></strokes></char></answer>`,

  // The radical sign (√) draws only the hook — MathJax's own overbar
  // (a separate <rect> spanning the radicand's width, extracted as a
  // synthetic 'radical-bar' leaf in mathjax-layout.js, same mechanism as a
  // fraction's bar) is drawn separately so it can span whatever width the
  // radicand needs without stretching this glyph. Added to STRETCHY_CHARS
  // in handwriting-agent.js since the hook's height varies with the
  // radicand's height independently of its own width, same as a paren.
  '√': `<thinking>The radical hook: a short downstroke into a sharp valley, then one long diagonal sweeping up and to the right to meet the overbar. Two straight strokes, split at the valley so the direction change stays crisp rather than one curved path through it.</thinking>
<answer><char label="√"><strokes><s1><points>6,45 27,85</points><t_values>0 1</t_values></s1><s2><points>27,85 58,10</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  '′': `<thinking>A short quick tick slanting down-left — the prime mark.</thinking>
<answer><char label="′"><strokes><s1><points>32,10 26,30</points><t_values>0 1</t_values></s1></strokes></char></answer>`,

  '∀': `<thinking>Forall: an inverted A — apex at the bottom instead of the top, two long diagonals splaying up to the top corners, with the crossbar near the top instead of near the bottom.</thinking>
<answer><char label="∀"><strokes><s1><points>30,86 12,10</points><t_values>0 1</t_values></s1><s2><points>30,86 48,10</points><t_values>0 1</t_values></s2><s3><points>19,36 41,36</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '∃': `<thinking>Exists: an E mirrored left-right — stem on the right, three bars reaching left: top, middle (slightly shorter), bottom.</thinking>
<answer><char label="∃"><strokes><s1><points>45,10 45,48 45,86</points><t_values>0 0.5 1</t_values></s1><s2><points>45,10 14,10</points><t_values>0 1</t_values></s2><s3><points>45,47 21,47</points><t_values>0 1</t_values></s3><s4><points>45,86 14,86</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  '∪': `<thinking>Union: an open bowl — one continuous arc from the top-left, down around the bottom, and back up to the top-right, like a rounded U with no lid.</thinking>
<answer><char label="∪"><strokes><s1><points>12,15 11,45 15,70 30,85 45,70 49,45 48,15</points><t_values>0 0.2 0.4 0.55 0.7 0.85 1</t_values></s1></strokes></char></answer>`,

  '∩': `<thinking>Intersection: an arch — mirror of ∪, one continuous arc from the bottom-left, up and over the top, and back down to the bottom-right.</thinking>
<answer><char label="∩"><strokes><s1><points>12,85 11,55 15,30 30,15 45,30 49,55 48,85</points><t_values>0 0.2 0.4 0.55 0.7 0.85 1</t_values></s1></strokes></char></answer>`,

  '∅': `<thinking>Empty set: a zero-like closed oval, then a diagonal slash drawn last through the middle, extending past both edges.</thinking>
<answer><char label="∅"><strokes><s1><points>30,12 16,22 11,45 14,70 28,87 43,74 48,48 44,23 30,12</points><t_values>0 0.12 0.26 0.42 0.56 0.7 0.82 0.92 1</t_values></s1><s2><points>8,90 52,8</points><t_values>0 1</t_values></s2></strokes></char></answer>`,

  'ℏ': `<thinking>H-bar: the same stem-and-arch as h, plus a short horizontal stroke crossing the stem near the top, drawn last.</thinking>
<answer><char label="ℏ"><strokes><s1><points>14,10 15,50 14,86</points><t_values>0 0.5 1</t_values></s1><s2><points>15,50 30,40 42,46 44,64 44,86</points><t_values>0 0.25 0.5 0.75 1</t_values></s2><s3><points>6,24 22,23</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  '…': `<thinking>Ellipsis: three small presses at the baseline, evenly spaced left to right, each a quick dot like the period.</thinking>
<answer><char label="…"><strokes><s1><points>14,80 16,82</points><t_values>0 1</t_values></s1><s2><points>29,80 31,82</points><t_values>0 1</t_values></s2><s3><points>44,80 46,82</points><t_values>0 1</t_values></s3></strokes></char></answer>`,

  // MathJax's \overline{...} renders as the base content plus a separate
  // mo token for the bar, whose bbox genuinely widens with content length
  // (verified: 16.3 wide for \overline{x}, 43.5 for \overline{xyz}) — same
  // "narrower than any real target" story as a paren, so this is in
  // STRETCHY_CHARS in handwriting-agent.js. Unlike the radical's bar, this
  // one IS an ordinary single mo character (no synthetic-leaf plumbing
  // needed), simpler than it first looked.
  '―': `<thinking>Overline: a straight horizontal bar near the top of the cell, drawn left to right with a barely-perceptible bow — same treatment as the minus sign, just positioned higher.</thinking>
<answer><char label="―"><strokes><s1><points>8,12 30,11 52,12</points><t_values>0 0.5 1</t_values></s1></strokes></char></answer>`,

  '∑': `<thinking>The n-ary summation: same skeleton as capital sigma — top bar right-to-left, in to the middle vertex, out to the bottom, base bar — but authored taller, as displayed operators render larger.</thinking>
<answer><char label="∑"><strokes><s1><points>50,9 12,8</points><t_values>0 1</t_values></s1><s2><points>12,8 34,52</points><t_values>0 1</t_values></s2><s3><points>34,52 12,96</points><t_values>0 1</t_values></s3><s4><points>12,96 50,95</points><t_values>0 1</t_values></s4></strokes></char></answer>`,

  '∫': `<thinking>One tall elongated S: a curl at the top right, a long nearly-vertical spine, and a mirrored curl at the bottom left.</thinking>
<answer><char label="∫"><strokes><s1><points>45,12 37,7 32,16 31,50 30,90 25,102 15,97</points><t_values>0 0.1 0.22 0.5 0.78 0.9 1</t_values></s1></strokes></char></answer>`,
};

// Aliases: distinct Unicode codepoints whose handwritten form is the same
// glyph. Keys are what MathJax's assistive tree may report; values are the
// canonical transcript key above.
export const CHAR_ALIASES = {
  '-': '−', // ASCII hyphen-minus → U+2212 minus sign
  '—': '−', // U+2014 em dash → minus sign (prose narration uses these constantly)
  '–': '−', // U+2013 en dash → minus sign
  '·': '⋅', // U+00B7 middle dot → U+22C5 dot operator
  // TeX's \epsilon and \phi produce the variant codepoints (lunate epsilon,
  // phi symbol), not the base Greek letters — the authored strokes suit
  // both variants (the ε entry is a double open arc, the φ entry a
  // loop-with-stem).
  'ϵ': 'ε', // U+03F5 lunate epsilon → ε
  'ϕ': 'φ', // U+03D5 phi symbol → φ
  // Prose text (unlike LaTeX, which MathJax normalizes) is drawn straight
  // from whatever Unicode an LLM's narration text actually contains —
  // curly "smart" quotes are common there and would otherwise miss the
  // plain ASCII ' / " entries above.
  '’': '\'', // U+2019 right single quote → straight apostrophe
  '‘': '\'', // U+2018 left single quote → straight apostrophe
  '“': '"', // U+201C left double quote → straight double quote
  '”': '"', // U+201D right double quote → straight double quote
  // Short double arrows reuse the long forms' strokes — MathJax emits
  // U+21D2 for \Rightarrow and U+21D4 for \Leftrightarrow, vs U+27F9/U+27FA
  // for \implies/\Longrightarrow/\Longleftrightarrow (verified emitted
  // codepoints, not assumed).
  '⇒': '⟹',
  '⇔': '⟺',
};
