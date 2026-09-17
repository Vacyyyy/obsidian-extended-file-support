# PureRef read-only preview proof of concept

Enable `.pur` under **Image formats**, open a `.pur` file, or embed it:

```md
![[references.pur]]
![[references.pur|600x400]]
```

The board initially fits the viewport. Wheel scrolling over it zooms around the
pointer; middle-mouse dragging pans, including when the drag crosses outside the
embed. Left mouse dragging does not pan. Outside the board, wheel scrolling moves
the note, even when keyboard focus remains in the viewer. Touch dragging and pinch
work directly, with no activation step.

The embed is borderless and its canvas follows Obsidian's active light or dark theme.
Small controls appear on hover or keyboard focus, including a movement lock. Right-click
(or Shift+F10) selects None, Lines, or Dots for the grid. Grid positions follow scene
coordinates and density adapts at extreme zoom. With the viewport focused, arrows cycle
through images, `+`/`-` zoom, `F`/`0` fit, `G` toggles the last selected grid style,
and Ctrl/Cmd+G cycles None → Lines → Dots. The latter is handled only by the focused
viewer, leaving Obsidian's Graph view shortcut unchanged everywhere else;
Escape ends a drag and releases keyboard focus. Files are never modified.

The board context menu places **Settings** below the Grid submenu. Toolbar buttons do
not have context menus. Zoom remains available through gestures, keyboard shortcuts,
and commands rather than toolbar buttons.

PureRef actions are also Obsidian commands, so they can be rebound in **Settings →
Hotkeys** without adding shortcut fields to this plugin's settings. Defaults are
Ctrl/Cmd+R for movement lock, Alt+G for the selected image's grayscale, Ctrl/Cmd+Alt+G
for whole-canvas grayscale, and Ctrl/Cmd+plus or minus for zoom. Click an image or cycle
to it with the arrow keys before using per-image grayscale. Grayscale does not apply to
groups, matching PureRef.

Alt+C toggles persistent, Obsidian-styled comment callouts for every commented item in
the focused viewer. The board context menu exposes the same action with a chat-bubble
icon. Comment visibility is saved with that viewer's viewport state.

Ctrl/Cmd+Z undoes viewer changes and Ctrl/Cmd+Shift+Z (or Ctrl+Y on Windows) redoes
them while the viewer is focused. History is local to each viewer and covers pan/zoom,
fit and image cycling, lock, grid, and grayscale changes. A drag or touch gesture is one
entry, and adjacent wheel events are coalesced into one entry. History is kept in memory
and cleared when the viewer is recreated. Undo and redo have no toolbar buttons.

The `.pur` settings follow the existing image formats. A toggle controls the Fit button
and applies to open previews immediately without resetting the viewport. The movement-lock
and desktop external-app buttons are always shown when their toolbar is visible.
On desktop, it opens the `.pur` file with its system association. Its icon is fetched
locally through Electron's file-icon API. If unavailable, the button shows a short,
sanitized application name instead.
Obsidian's private Electron bridge currently corrupts raw `NativeImage` transfers
at fractional display scaling. A small constant main-process helper encodes PNG
before transfer; it receives paths as arguments and returns only a data URL. If
that bridge is unavailable, the button uses text. It does not patch
Obsidian or install native/OS-specific helpers.
On Windows, the plugin makes a best-effort registry lookup for the associated app's
short executable name; it never displays a path. “Default app” is the final fallback.
An optional absolute PureRef executable path overrides the association and uses that
executable's icon and short name. Enter a path without quotes;
on macOS it must be the executable inside the app bundle, not the `.app` directory.
Arguments are passed directly without a shell. The executable path is stored in
plugin settings and may need updating on each computer if settings are synced.
The launcher is desktop-only; preview gestures and other controls remain available
on mobile. No PureRef artwork or OS-specific association helper is bundled.

Successful file reloads retain pan and zoom. File tabs and embeds share the same
renderer. Default embed height is 360px. Explicit width/height use the plugin's
existing embed syntax. The SVG viewport responds to container resizing without a
continuous render loop.

View state is keyed by vault-relative file path. Reload persistence uses window session storage. When
`.pur remember view state` is enabled, a validated, versioned JSON record of the 250
most recently updated files is also stored in the plugin's standard `data.json` so
zoom, position, grid, lock, grayscale, and comment visibility survive app restarts.
Already-open copies remain independent; the last interacted copy supplies the state
for a newly opened preview.

## Scope

Verified format: PureRef 2.1.3 (envelope 2.1, database schema 200101).

- Embedded PNG/JPEG resources, reused across instances.
- Affine transforms, nested parents, opacity and crop paths.
- Solid, dashed, and open-arrow straight/cubic drawings, plus individual points.
- Basic HTML notes with Unicode, limited safe typography, fixed sizing, and
  Comfortable/Compact padding. Notes are centred on their stored position.
- Group backgrounds derived from eligible child geometry; drawings stay visible
  but do not enlarge their group's background. Groups add 10 units on every side
  with an 8-unit corner radius capped in screen space.
- Fit uses cropped image geometry and composes parent transforms.
- Damaged/unsupported files produce a visible error. There is no limitations
  dropdown inside the embed; the supported subset and omissions are documented here.

The renderer follows recovered PureRef 2.1.3 geometry: note margins 16/4, corner
radii 4/8 capped in screen space, automatic width capped at 800, and stored note
height as a minimum. Native note exports verify wrapping, rich paragraphs/lists,
and integer-versus-decimal pixel font declarations: Qt ignores `24.0px` but
honors `24px` in both body and span styles. One Open Sans normal variable Latin font
(48,320 bytes before base64) is embedded as a private `@font-face` in generated
`styles.css`, with its OFL license. Italics use browser synthesis. Fontsource is a
build-time dependency; no WOFF file or font bytes are imported into `main.js`.
The browser loads the font face when first needed for notes;
other scripts and unavailable families use installed fallback fonts. There are no
runtime font downloads. Default note/group colors use the standard-dark reference
color `#131518`; PureRef's per-user scene theme is not encoded in these item rows.
Images have a translucent `#15191D` outline along the crop. A one-screen-pixel
stroke at 40% opacity is clipped to the image's interior, avoiding an outside halo
where images overlap. True cubic extrema are used for bounds.

This is not a pixel-identical reproduction of Qt. Font advances/rasterization,
unusual rich text, nonuniformly transformed outlines, and cubic-arrow arc-length
sampling can differ. Unknown
ordering values use a disclosed item-ID fallback for equal `z` values. Linked
resources, animation, image filters, and other PureRef versions
are not supported. No thumbnail fallback or editor is included in this PoC.

For this prototype, input is limited to 128 MiB and 128 parent levels. The
**.pur item limit** setting defaults to 10,000 items per board and accepts a positive
whole number. Reopen the board after changing it; higher limits may increase memory
use and rendering time. Invalid stored values fall back to 10,000.
Image admission uses declared dimensions: at most 64 million pixels per
resource and 128 million total. This is a best-effort memory budget, not a decoder
sandbox; files and images are loaded in memory. Large-board performance needs
more profiling before a production release.

Note HTML goes through Obsidian's `sanitizeHTMLToDom`. An inert template first
restricts it to basic formatting and typography and removes resource-bearing
elements before anything is attached to the document. Link text survives without
clickable links; images, frames, scripts and arbitrary CSS do not. There is no
production DOMPurify dependency added by this feature (upstream's development
dependencies may still include it transitively). Linked image resources are not fetched.

## Dependency and architecture

`pur-2-file-format` is installed from the exact Git commit recorded in
`package.json` and the lockfile. The reader repository's `prepare` hook produces
its ESM JavaScript and TypeScript declarations during Git installation. No sibling
checkout, copied reader source, Python, or PureRef installation is needed to build
or use the plugin. The parser is not yet published on npm.

The installed reader is bundled into `main.js` by esbuild, including its small
hashing dependency. SQLite was already an upstream dependency and is shared.
Panzoom is the only other new runtime package. There are no runtime GitHub/npm
requests and end users need neither Git nor Node. A future npm publication can
replace the immutable Git pin without changing the renderer; no reader-distribution
changes are needed for this installable build.

`styles.source.css` is the editable stylesheet. `scripts/styles.mjs` generates
release `styles.css` with the font and license; both `main.js` and `styles.css` are
build outputs. The release workflow uses `npm ci` and uploads the same three assets
as upstream: `main.js`, `manifest.json`, `styles.css`. Obsidian loads these locally;
gzip measurements describe transfer compression, not the installed size or JS parse cost.

- `src/extensions/pur.ts`: Obsidian integration, async reloads, sizing and cleanup.
- `src/pureref/sqlite.ts`: one cached SQLite initialization for PureRef viewers,
  using the plugin's existing bundled `sql.js` WASM asset.
- `src/pureref/scene.ts`: scene construction, resource ownership and visible bounds.
- `src/pureref/notes.ts`: sanitized and restricted rich text.
- `src/pureref/viewer.ts`: controls and SVG pan/zoom through `@panzoom/panzoom`.

The database is closed once scene construction completes. Disposing a viewer
removes gesture handlers, image listeners/timers and object URLs. Generation
checks prevent old async loads from replacing newer content or reviving closed
embeds. The shared file view also disposes its previous component when switching
files, rather than keeping old file listeners alive.

## Build, preview and test

Use Node.js 22+ and npm. A Git installation is required for the pinned dependency.

```sh
npm ci
npm run build
npx playwright install chromium
npm run test:pureref
npm run preview:pureref
```

The standalone preview is at `http://127.0.0.1:4173`. It uses the same reader,
renderer and bundled SQLite as the plugin. Choose a synthetic sample or a local
`.pur` file; local file contents stay in the browser. To use an installed Chrome
instead of Playwright's Chromium, set `PLAYWRIGHT_CHANNEL=chrome` for the tests.
The demo's “Open in PureRef” button only displays a placeholder message; it does
not launch applications. The Obsidian plugin uses a real desktop launcher for
that action. Refreshing the
preview rebuilds its browser bundle so source changes are immediately available.

The browser tests check scene content, centring, crop-aware fitting, nested
transforms, pan/zoom/fit/keyboard/touch gestures, outside scrolling and middle-button pointer capture,
sanitized notes, malformed input, reload ordering, viewport preservation, file
switches, and resource cleanup. A small Obsidian lifecycle/DOM stub exercises the
component and view; this does **not** replace verification inside Obsidian.

Generate or update an ignored test vault containing synthetic fixtures and actual
release files (no symlinks or sibling-library dependencies):

```sh
npm run dev:pureref-vault
```

Open `.test-vault` as an Obsidian vault, trust this locally built plugin, and open
`PureRef preview.md`. Re-running the command updates the plugin artifacts and
fixtures while preserving vault settings and notes. Reload the plugin after updating.

### Adversarial inspection and checks (opt-in)

After `npm run dev:pureref-vault`, open `PureRef adversarial/Start here.md` in
`.test-vault`. Each case has expected behavior, a file-tab link, and large/narrow
embeds for checking independent interaction in Reading view and Live Preview.
The generated `PureRef adversarial/` pages are refreshed on each run; keep your
observations in a separate note. Existing personal notes/settings are preserved.

```sh
npm run test:pureref:adversarial
npm run test:pureref:report
```

Install Chromium once with `npx playwright install chromium`, or select installed
Chrome with `PLAYWRIGHT_CHANNEL=chrome` (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'`). The HTML report lists each case and its
inspection contract. Screenshots on failure are diagnostic only; there are no
pixel comparisons. These tests also run when explicitly invoking `test:pureref`,
but neither tests nor corpus generation are hooked into build or release.

Cases cover mirrored nested crops, Unicode/overflow, hostile rich text, cyclic
and over-deep parents, broken transforms, omitted image resources, 400 shared
instances, item limits, incompatible schema, truncated files, stale failures,
and repeated success/failure cleanup. Fixtures use the upstream Python writer's
known schema; assertions exercise the pinned reader and plugin contract, without
requiring support for upstream's unverified features. See
`tests/pureref/fixtures/README.md` for provenance and optional regeneration.

For opt-in automated desktop checks, start Obsidian with `--remote-debugging-port=9229`,
open this test vault, then run `npm run test:pureref:obsidian` (`OBSIDIAN_CDP` overrides
the endpoint). The script refuses other vault paths. It installs and unloads an
isolated test probe to exercise the **real** Obsidian sanitizer and tests Reading
view, Live Preview, file tabs, sizing, grid/reload state, live toolbar settings,
the native OS icon, and the default-app callback. It intercepts the launch action
so tests do not open external applications. On Windows, these checks passed with
Obsidian 1.13.7. This does not establish macOS, Linux, or mobile compatibility.

Before proposing an upstream PR, also check Canvas, pop-out windows, macOS/Linux,
and real Android/iOS devices. The plugin relies on
Obsidian's internal embed registry, as its other formats do.
