---
name: ui-design-language
description: Maintain visual alignment with existing UI color themes, typography, spacing, and interaction style. Use when refining or extending interface design language (color choices, chart styling, readability overlays, component polish) so new work matches established aesthetics and remains legible across responsive sizes.
---

# UI Design Language

## Audit First

- Identify existing color tokens, typography choices, spacing rhythm, and card chrome before styling new UI.
- Reuse established visual primitives (accent hues, muted text tone, border alpha, shadow style) instead of inventing a parallel palette.
- Confirm the target context (phase UI, HUD canvas, three-test dock) and match its local contrast level.

## Header-First Widgets

- For compact dock widgets, keep a persistent header visible in all states.
- Structure headers as: indicator on the left, title in the center/left flow, actions on the right.
- Keep primary actions (`pin`, `minimize`) visible in the header; avoid burying them in expanded-only content.
- Use header clicks for expand/collapse and keep action clicks isolated from header toggles.

## Minimize vs Close

- In persistent dock patterns, do not fully remove widgets unless an explicit reopen affordance exists.
- If a close icon is visually required, map it to `minimize/collapse` behavior and label it accordingly in tooltip/ARIA.
- Preserve existing state models when possible (for example: minimized, hover, pinned) instead of introducing hidden states by default.

## Apply Styling Decisions

- Choose chart or panel domains for comparability across time; avoid auto-rescaling that changes interpretation frame-to-frame.
- Add semantic scaffolding for dense visuals: threshold lines, categorical bands, and axis labels where users need quick state reading.
- Keep color meaning consistent:
  - Cool tones for lower intensity.
  - Warm/amber for medium intensity and active marker states.
  - Hot/red tones for high danger.
- Preserve hierarchy: background layers first, guides second, data series third, active marker last.
- Replace ambiguous abbreviations (`CL`, `TM`, `MP`) with meaningful, live indicators tied to current state.

## Readability Rules

- Guarantee label contrast against the actual panel background, not against a neutral canvas assumption.
- Reserve explicit chart margins for axes and labels; avoid drawing text inside dense line paths.
- Throttle X-axis labels by available width to prevent overlap on smaller docks.
- Use short uppercase or compact labels for categorical axes when space is constrained.
- Move frequently referenced status context into headers when it increases chart/body readability.

## Responsiveness and Fit

- Size chart containers to support overlays (bands + both axes + marker) without clipping.
- Recheck small-width breakpoints after visual changes; adjust paddings and label density rather than removing meaning.
- Keep hover/focus/interactive states visually coherent with existing button and card treatments.

## Validation Checklist

- Verify fixed domains remain stable when values fluctuate.
- Verify threshold bands and axis labels remain visible in all relevant modes.
- Verify seasonal or timeline labels align with the data window offset.
- Verify marker position tracks current forecast index correctly.
- Verify widget transitions across minimized, hover, and pinned states remain coherent.
- Verify header actions are visible and usable in all visible states.
- Verify minimize behavior never leaves users without access to the widget.
- Run `npm run check` after TypeScript/CSS changes.
