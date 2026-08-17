# Promptus App Starter

This is a framework-neutral reference implementation of the visual system measured from the live Promptus application on 2026-08-15.

## Files

- `index.html` — component and layout demo.
- `promptus-theme.css` — reusable tokens and components.
- `app.js` — small progressive interactions for the demo.
- `design-tokens.json` — portable design tokens.
- `tailwind.preset.js` — optional Tailwind theme extension.
- `assets/` — exact public Promptus background and logo snapshots from the audited app build.

## Use in a new app

1. Copy `promptus-theme.css` and `assets/` into the app.
2. Add `class="promptus-app"` to the top-level application element.
3. Compose the supplied `p-*` component classes or map the JSON tokens into the target framework.
4. Keep the active navigation, primary button, input, status, and trust-state rules intact.
5. Replace demo labels/content; do not hard-code the audited model list or pricing.

## Tailwind

Merge `tailwind.preset.js` into the project's presets or copy its `theme.extend` values into the active Tailwind configuration. The live application is Tailwind-based, but this starter avoids requiring Tailwind at runtime.

## Brand assets

The included logo and contour background are exact snapshots from the public Promptus app. Use them only for Promptus-owned or authorized products. If a third-party app merely integrates with Promptus, use the token system and clearly label the integration instead of implying that the app is an official Promptus product.

## Intentional differences from the live CSS

- The background uses `cover` instead of forced `100% 100%` to avoid distortion.
- Focus styles and reduced-motion handling are more explicit.
- Component class names are semantic and framework-neutral instead of copied compiled utilities.
- The template includes text labels for status/trust states so meaning does not depend on color alone.
