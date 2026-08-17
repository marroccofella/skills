# Promptus Design System

## Which theme should new apps use?

Use the **live application theme** for tools that sit inside or beside Promptus. It was measured directly from `app.promptus.ai` on 2026-08-15 and is implemented in the included starter.

Promptus also has a pink-led marketing website and an older press-kit palette. Those are documented below, but mixing all three in one product makes the brand feel inconsistent.

## Live application theme — exact core tokens

| Token | Value | Observed role |
|---|---|---|
| `app-dark-blue` | `#190A4E` | Sidebar, dominant panels, dark text on light active items. |
| `app-dark-purple` | `#34206D` | Secondary purple, active text, gradient/panel variation. |
| `app-medium-blue` | `#2A1B83` | Hover/secondary action surface. |
| `app-yellow` | `#FFB02E` | Primary CTA, active icon, progress, highlight. |
| `app-yellow-deep` | `#FF9500` | Accent border/edge and stronger amber state. |
| `app-cyan` | `#12CEC6` | Fine borders, focus states, service/status accent. |
| `app-icon-muted` | `#D1CEDC` | Inactive navigation icon strokes. |
| `app-white` | `#FFFFFF` | Main text, active navigation surface, input background. |
| `app-border` | `rgba(18, 206, 198, .50)` | Standard dark-panel outline. |
| `app-panel` | `rgba(25, 10, 78, .80)` | Primary glass panel. |
| `app-panel-soft` | `rgba(25, 10, 78, .30)` | Inactive navigation/status background. |
| `app-surface` | `rgba(52, 32, 109, .40)` | Selects/secondary input surfaces. |
| `danger` | `#EF4444` | Error/destructive state. |
| `success` | `#22C55E` | Success/online state. |
| `warning` | `#FBBF24` | Limited/attention badge. |

### Exact background

The live app uses a fixed, full-viewport contour-map image:

`combined_background.6f051d49bb37a4201852.jpg`

It is included as `template/assets/promptus-background.jpg`. Use it with `background-size: cover` for responsive apps; the live CSS uses 100% 100%, which can distort on unusual aspect ratios.

## Typography

The live app loads Titillium Web, but every audited rendered element resolved to this body stack:

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif
```

For an exact Windows match, use the system stack above (Segoe UI will normally render). Titillium Web can be used as an intentional future brand choice, but it is not the computed typeface of the audited screen.

Observed scale:

| Role | Size / line-height | Weight |
|---|---|---|
| App/brand title | 24 / 32px | 700 |
| Page title | 20 / 28px | 700 |
| Section title | 18 / 28px | 700 |
| Body / navigation | 16 / 24px | 400–700 |
| Small labels/buttons | 12–14 / 16–20px | 600–700 |

Use sentence case for page titles and labels. Reserve uppercase for narrow utility labels such as `COSYTEMPLATES`, status captions, and compact credit indicators.

## Shape and spacing

- 4px radius: compact tags/select library internals.
- 8px radius: navigation rows, inputs, buttons, standard controls.
- 12px radius: tool panels, status tiles, header control groups.
- 16px radius: prominent cards and drawers.
- 9999px radius: switches, dots, pills, round actions.
- Primary spacing rhythm: 4, 8, 12, 16, 20, 24, 32px.
- Sidebar rows use 16px internal padding and bold labels.
- Main glass panels generally use 12px radius, cyan 50% borders, and dark-blue 80% fill.

## Layout grammar

### Desktop

- Persistent left sidebar, approximately 292px in the 1280px audited viewport.
- Scrollable main work area.
- Large prompt input first, followed by a compact tool grid and expandable model/options panel.
- Cards float over the contour background rather than using a flat page fill.
- Active navigation is white with dark-purple text; inactive navigation is translucent white with white text.

### Mobile and narrow windows

- Collapse the sidebar into a menu/drawer.
- Keep the primary prompt/action controls above model configuration.
- Stack card grids and form columns.
- Preserve 44px minimum target size even when labels become smaller.
- Avoid stretching the background asset; use cover and anchor it centrally.

## Components

### Primary button

- Amber fill `#FFB02E`.
- Dark-purple text `#34206D`.
- 8px radius, bold label.
- Hover: slightly reduced amber opacity or small lift/brightness increase.
- Focus: visible cyan or amber ring.

### Secondary button

- Medium-blue 50% fill.
- Cyan 30% border.
- White 80% text.
- Hover: medium-blue solid with amber text/border.

### Glass panel

- `rgba(25, 10, 78, .80)` fill.
- `1px solid rgba(18, 206, 198, .50)`.
- 12px radius.
- Optional 8px backdrop blur.

### Navigation row

- Inactive: white 30% fill, white label, muted-white icon.
- Active: white fill, dark-purple label/icon.
- Hover: white fill and dark-purple content.

### Input

- Main prompt input: white background, dark-blue text, 8px radius, 16px horizontal padding.
- Dark form input: dark-purple 40% background, white text, white 20% border.
- Focus: yellow border with one-pixel yellow 50% ring.

### Status tile

- Soft dark-blue translucent fill.
- 12px radius.
- Small status dot: green online, amber working, gray unavailable, red error.
- Make state text explicit; color alone is not enough.

### Workflow/model badge

- 4px radius.
- 12px text.
- Semi-transparent semantic fill and border.
- Examples: amber Limited, cyan Local, green Installed, purple API.

### Drawer/modal

- Dark-blue to dark-purple gradient.
- 16px rounded outer corner.
- Strong shadow (`0 25px 50px -12px rgba(0,0,0,.25)`).

## Motion

- Standard transition: 150–300ms.
- Hover lifts and small icon shifts are acceptable.
- Use progress spinners with amber active segments.
- Respect the app's “Enable Animations” setting and `prefers-reduced-motion`.

## Accessibility rules

- Use white on dark purple and dark-purple on amber/white.
- Do not use amber as body text on white.
- Do not rely on the cyan border alone to communicate selection.
- Give every icon action an accessible name and visible keyboard focus.
- Use status text alongside colored dots.
- Preserve the trust distinction for bundled, imported, local, and cloud workflows.

## Current marketing website theme

The official homepage was separately measured on 2026-08-15:

- Primary font: Inter.
- Hero: dark navy/purple/blue/pink atmospheric gradient.
- Main pink: `#FF6496`.
- Strong pink: `#FF196E`.
- Dark surface: `#111111`.
- Supporting off-white: `#F2F4F8` / `#F7F6FB`.
- Common radii: 10px, 14px, 999px.
- Tone: editorial landing page, large 800-weight headlines, high-contrast white hero copy.

Use this for public campaigns and product marketing, not for embedded Promptus tools unless the product team explicitly wants a marketing-led surface.

## Legacy press-kit palette

The public press-kit page lists:

- `#220B13` background primary;
- `#FF196E` secondary;
- `#FF759F` tertiary;
- white, black, `#F7F7F7`, and `#56595A` neutrals.

This aligns more closely with the marketing family than the current application UI. Treat it as legacy/communications guidance, not the source for new in-app controls.

## Copy voice

Promptus UI copy is short, direct, and action-led: “Enter your Prompt”, “Enhance Prompt”, “Model & Options”, “Start”, “Stop”, “Get started”. New apps should:

- lead with what the user can make or do;
- explain dependency/offline blockers in plain language;
- keep model jargon in details, not the first instruction;
- distinguish cost, privacy, and execution location before Run;
- prefer “ready”, “installed”, “requires”, and “available” over vague technical states.
