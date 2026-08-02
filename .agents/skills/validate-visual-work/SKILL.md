---
name: validate-visual-work
description: Guard visual validation according to the current Codex surface. Use when a request depends on visually inspecting localhost, a running browser, WebGL, shaders, weather or cloud effects, rendering output, responsive UI layout, animation, or other live rendered state.
---

# Validate Visual Work

Establish whether live rendered evidence is available before starting a development server, invoking browser tooling, or making appearance-dependent changes.

## Classify the Evidence

- Treat a running page, browser tab, or captured frame from that page as live visual evidence.
- Treat source code, shader text, configuration, console output, and regression results as static or automated evidence, not visual verification.
- Use web search or page fetching for public documentation and source pages when interaction is unnecessary. Do not present it as inspection of the local running app.
- Use local image inspection for screenshots already available on disk. Do not imply that a still image verifies animation, interaction, timing, or responsive behavior that it does not show.

## Check the Codex Surface

1. Identify the current product surface before attempting browser control.
2. If the session is running in the Codex IDE extension or VS Code, treat the built-in Browser as unavailable. Do not infer availability from an enabled Browser plugin or exposed browser-related tool, and do not probe or retry that connection.
3. If the session is running on a surface documented to support Browser and a working Browser capability is available, follow the bundled Browser workflow.
4. If a supported surface fails its initial capability check, stop after that failure. Do not loop through alternate browser-control mechanisms unless the user explicitly requests one.

## Hand Off Unsupported Visual Work

When live visual evidence is required but unavailable, stop before appearance-dependent edits and explain that the limitation belongs to the current Codex surface rather than the app or localhost server. Offer these concrete paths:

- Open the repository in the ChatGPT desktop app or another supported Codex Browser surface and repeat the request there.
- Attach current screenshots or a short recording that shows the relevant state.
- Explicitly authorize source-only analysis or implementation without visual verification.

Do not continue visual tuning until the user selects a path. Read-only source orientation is acceptable only when it helps state the handoff precisely.

## Report Evidence Honestly

- State whether conclusions came from live inspection, supplied imagery, static source analysis, or automated checks.
- Do not claim that an effect looks correct, that a layout fits, or that a shader input is present in a live page unless the available evidence establishes it.
- Do not replace an unavailable visual check with confident art-direction judgments.
- Keep nonvisual compilation and regression checks available for requests that do not depend on rendered appearance.
