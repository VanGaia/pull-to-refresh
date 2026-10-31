# Repository Guidelines

## Project Structure & Module Organization

This repository is a Manifest V3 pull-to-refresh extension for desktop Chromium browsers and Firefox 140+. Runtime files live at the repository root:

- `content.js`: gesture recognition, refresh timing, and the in-page indicator.
- `popup.html`, `popup.css`, `popup.js`: settings interface and persistence.
- `manifest.json`: permissions, browser compatibility, and extension metadata.
- `icons/`: SVG artwork and PNG extension icons.
- `tests/*.test.cjs`: gesture and popup regression tests.
- `README.md`: Russian-language installation and usage documentation.

## Build, Test, and Development Commands

No build step or dependency installation is required to load the extension.

- `npm test` or `node --test tests/*.test.cjs`: run all automated tests.
- `npm ci --ignore-scripts`: install development tools from the lockfile.
- `npm run lint`: validate the extension using Mozilla’s pinned `web-ext` linter.
- `TEST_BROWSER=browser node --test tests/gesture.test.cjs`: run all gesture tests with the Firefox API mock.

Use Node.js with built-in `node:test`. Tool versions are pinned in `package.json` and `package-lock.json`; dependencies are for development only.

For local development, load this directory through `chrome://extensions` in developer mode, or select `manifest.json` through Firefox’s `about:debugging#/runtime/this-firefox`. Reload the extension and affected tabs after edits.

## Coding Style & Naming Conventions

Follow the existing plain JavaScript, HTML, and CSS style: two-space indentation, JavaScript semicolons and single-quoted strings, `camelCase` functions and variables, and uppercase constants such as `WHEEL_CONFIRM_DELAY`. Preserve script isolation and the `globalThis.browser ?? globalThis.chrome` compatibility pattern. Keep user-facing text in Russian and retain keyboard accessibility, dark mode, and reduced-motion support. No dedicated formatter is configured.

## Testing Guidelines

Tests use `node:test`, strict assertions, and VM-based browser/DOM mocks. Name files `*.test.cjs` and use descriptive behavior-based test titles. Add regression coverage for gesture timing, cancellation, storage races, and popup changes; exercise both browser API namespaces where relevant. There is no configured coverage percentage requirement. Run tests and lint before submitting, and manually check affected gestures or UI in Chromium and Firefox.

## Commit & Pull Request Guidelines

The short Git history uses plain descriptive subjects; no formal prefix convention is established. Write concise, imperative commit subjects and keep changes focused. PRs should explain the behavior changed, link related issues when applicable, report automated and manual checks, and include screenshots for visible UI changes.

## Privacy & Configuration

Preserve local-only operation: settings use browser storage, with no analytics or remote code. Justify permission changes and keep shared settings defaults consistent between content and popup scripts.

## Gesture Behavior & Documentation

New wheel gestures require more than 120 ms without wheel events; trackpad inertia extends the wait between attempts. Active gestures retain a 260 ms accumulation timeout for slow mouse wheels. Reaching the threshold schedules refresh after 40 ms. Preserve cancellation and protection against refreshing when ordinary scrolling reaches the top. Mock tests do not replace real-device checks.

Keep `README.md` focused on installation, usage, troubleshooting, and privacy in Russian. Put implementation details and development commands here. Keep the README version aligned with `manifest.json`.
