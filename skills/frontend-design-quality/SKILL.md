---
name: frontend-design-quality
description: Use when building or changing a user interface — layout, components, styling, responsive behavior, accessibility — and the result should look considered rather than assembled.
metadata:
  area: engineering-discipline
  side_effects: writes-files
  credentials: none
  runs_scripts: optional
---

# Frontend design quality

## Match what is there

Read the surrounding components before writing a new one. Use the project's
existing spacing scale, color tokens, type scale, and component patterns. A
screen that is individually well designed and unlike every other screen has made
the product worse.

If the project has a design system, its tokens are the vocabulary. Do not
introduce a one-off value where a token exists.

## Fundamentals

- **Spacing.** Use a consistent scale. Related things sit closer together than
  unrelated things; most layouts read as cluttered because that relationship is
  inverted somewhere.
- **Hierarchy.** One primary action per view. Size, weight, and color establish
  what matters; if everything is emphasized, nothing is.
- **Alignment.** Things that belong to the same group share an edge.
- **Type.** A small number of sizes, used consistently. Body text long enough to
  read comfortably and no longer.

## States are not optional

Every view that loads data has four states: loading, empty, error, and loaded.
The empty state is the one that gets skipped and the one users see first.

Every interactive element has hover, focus, active, and disabled. Focus must be
visible — removing the outline without replacing it breaks keyboard use.

## Accessibility

- Semantic elements first. A `<button>` before a `<div>` with a click handler.
- Every input has a label. A placeholder is not a label.
- Text contrast meets WCAG AA.
- The whole flow works from the keyboard, in a sensible order.
- Motion respects `prefers-reduced-motion`.

These are not a later pass. Retrofitting them costs several times what doing
them costs.

## Responsive

Design for the narrow case first; it forces the priority decisions. Check the
real breakpoints the project supports, and check that nothing scrolls sideways.

## Before recording a candidate

Look at it. Run it, resize it, tab through it, and try the empty state. A
screenshot in the evidence entry is worth more than a description.
