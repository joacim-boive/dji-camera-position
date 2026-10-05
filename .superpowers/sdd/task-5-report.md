# Task 5 Report: Monitor in the glass

## Status

DONE

## Changes

- Added the Preview toggle to the glass head.
- Added the 16:9 canvas picture, hidden source video, status message, playback controls, and scrubber above the spirit level.
- Loaded `preview.js` before `app.js`.
- Added the specified picture, transport, hidden-video, message, and toggle styles.
- Mounted `FramePreview` once with the existing token and new picture controls.
- Persisted picture visibility with the `frame-desk-preview` localStorage key; only the value `hidden` hides it.
- Sent live form values to `FramePreview.setView` from `paintLevel`.
- Sent the current clip to `FramePreview.showClip` after draft and clip changes.
- Left the debounced `/api/preview` change flow and `src/app/main.ts` unchanged.

## Verification

Command:

`pnpm typecheck && pnpm test`

Output:

- `tsc --noEmit`: passed.
- Vitest: 11 test files passed, 39 tests passed.
- Duration: 592 ms (2.359 seconds for the complete command).
- IDE lint diagnostics: no errors in the three changed files.
- `git diff --check`: passed.

## Files Changed

- `src/ui/public/index.html`
- `src/ui/public/app.css`
- `src/ui/public/app.js`

## Commit

- `cba11df Show the live reframe above the spirit level.`

## Self-review

- Confirmed the scrubber keeps `step="0.01"`.
- Confirmed `preview.js` loads before code that consumes `window.FramePreview`.
- Confirmed mounting occurs once and picture visibility is applied at startup.
- Confirmed reopening a hidden picture loads the current clip.
- Confirmed `showCurrentClip` does not run while the picture is hidden or no draft is open.
- Confirmed live shader updates do not call or alter `schedulePreview`.
- Confirmed the existing `/api/preview` request payload and debounce remain unchanged.
- Confirmed only the three brief-named implementation files are in the commit.
- Confirmed `src/app/main.ts` was not modified.

No concerns found.

## Fix: Keep the current preview playing

- Remembered the last shown draft path, clip index, and `proxyReady` state.
- Skipped `FramePreview.showClip` when that identity is unchanged.
- Cleared the remembered identity while the picture is hidden so showing it reloads the current clip.

### Verification

Command:

`pnpm exec vitest run tests/ui-server.test.ts`

Output:

```text
RUN  v3.2.7 /Users/jocke/Repos/dji-camera-position/.worktrees/live-reframe-preview

✓ tests/ui-server.test.ts (8 tests) 111ms

Test Files  1 passed (1)
Tests       8 passed (8)
Duration    482ms
```

Command:

`pnpm typecheck`

Output:

```text
$ tsc --noEmit
```
