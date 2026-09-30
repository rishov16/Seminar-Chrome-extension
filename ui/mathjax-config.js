// MathJax configuration must be defined before vendor/mathjax/es5/tex-mml-svg.js
// loads. This has to live in its own file loaded via <script src="...">, not
// an inline <script> block in sidepanel.html: MV3 extension pages get a
// default Content-Security-Policy of `script-src 'self'` (manifest.json
// declares no override), which silently drops inline scripts — no thrown
// error, just a CSP violation logged to the console — leaving window.MathJax
// unset before the library reads it. MathJax then falls back to its own
// built-in default (tex.inlineMath: [['\(','\)']] only), which does NOT
// include $...$ , so every inline-math token written as $...$ in prose
// blocks (the Head Agent's and Narrator Agent's convention throughout this
// project) silently never gets typeset and shows up as raw LaTeX source on
// the chalkboard. Equation blocks (renderers/chalkboard/chalkboard-renderer.js
// wraps them in \[...\]) aren't affected by this specific bug, since \[...\]
// is part of MathJax's default displayMath config regardless of this file.
window.MathJax = {
  tex: { inlineMath: [['$', '$'], ['\\(', '\\)']] },
  svg: { fontCache: 'none' },
};
