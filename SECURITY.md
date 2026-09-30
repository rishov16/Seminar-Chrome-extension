# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/rishov16/Seminar-Chrome-extension/security/advisories/new),
or email **rishov.mondal@iairo.ai**. We aim to acknowledge reports within a week.

## Scope

SEMINAR is a client-side Chrome extension with no server of its own. Areas of
particular interest:

- handling of the user's Gemini API key (stored in `chrome.storage.local`);
- data sent to the Google Gemini API (selected text, tab screenshots, microphone audio);
- rendering of model-generated content inside extension pages;
- cross-tab isolation of seminar state.
