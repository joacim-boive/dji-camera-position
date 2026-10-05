# Live reframe preview

Frame Desk shows a 16:9 monitor of the current clip while the free view is edited. The picture plays the camera’s stitched `.LRF` proxy and aims it with the pan, tilt, roll, FOV, and correction already in the form. The `.OSV` is never decoded, and the draft changes only when Write is pressed.

## Monitor

The monitor sits at the top of the glass, above the spirit level. Play, pause, and a scrubber sit under the picture. Playback loops from the clip’s in point to its out point. Opening another clip loads that clip and seeks to its in point. The monitor has no audio.

A Preview control in the glass head shows or hides the monitor. The choice is stored in `localStorage` under `frame-desk-preview`. The value `"hidden"` hides it. A missing key, or any other value, shows it.

Dragging the spirit level or editing a field updates the picture on the next frame. The debounced change list under the form is unchanged. The picture follows the form’s static view. Keyframes are not animated. The existing note, that Write updates the static view only, stays.

The spirit level, the fields, presets, and Write stay where they are. The Electron window is not resized. The page scrolls.

## Projection

`src/model/reframe.ts` owns the math. The shader is a port of it.

The frame is 16:9. The FOV field is the vertical angle of a rectilinear lens. For a pixel, `nx` runs from `-16/9` on the left to `16/9` on the right, and `ny` runs from `-1` at the bottom to `1` at the top. The sensor point is `(nx, ny)` multiplied by `tan(verticalFov / 2)`. `r` is the length of that point. The ray leaves the lens at

```text
theta = max(0, 1 + correction) * atan(r)
```

`theta` is clamped to `π`. A zero `r` looks straight ahead. Otherwise the camera-space ray is

```text
(sensor.x / r * sin(theta), sensor.y / r * sin(theta), cos(theta))
```

Camera space is `+X` right, `+Y` up, `+Z` forward. The preview clamps the vertical angle to the open interval `(0°, 179°]` before the tangent. The form and Write still use the typed value.

The ray is then aimed in this order: roll, then tilt, then pan, using the aimed angles below. With every sign at `+1` and zero offsets:

- Pan rotates the ray around `+Y` by the aimed pan. A small positive pan aims the center pixel toward `+X` (the view looks right).
- Tilt rotates the ray around `+X` by the negated aimed tilt. A small positive tilt aims the center pixel toward `+Y` (the view looks up).
- Roll rotates the ray around `+Z` by the negated aimed roll. A small positive roll tips the horizon counterclockwise on screen.

A fixture that turns the wrong way flips that one sign and leaves the other two alone.

The equirectangular sample uses longitude `atan2(x, z)` and latitude `asin(y)`. Texture coordinates are `u = 0.5 + longitude / 2π` and `v = 0.5 - latitude / π`, so the forward ray is `u = 0.5` and straight up is `v = 0`. When `flipHorizontal` is set, `u` becomes `1 - u`.

Offsets apply after the axis signs: aimed pan is `panSign * pan + yawDegrees`, aimed tilt is `tiltSign * tilt + pitchDegrees`, and aimed roll is `rollSign * roll + rollDegrees`. The defaults are zero offsets and no flip. The center of the `.LRF` is forward, and image-up is up, until a baseline comparison shows otherwise.

Studio’s Zoom readout, in degrees, is the rectilinear horizontal angle of this 16:9 frame multiplied by `max(0, 1 + correction)`. Rounded to one decimal, the fixture pairs are:

| FOV | Correction | Zoom  |
| --- | ---------- | ----- |
| 60  | 0          | 91.5  |
| 60  | 1          | 183.0 |
| 20  | 0          | 34.8  |
| 20  | 1          | 69.6  |

The monitor is 16:9 because those samples fit that aspect. Other export aspects are out of scope.

`previewOrientation` is the only calibration record:

```ts
{
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 0,
  flipHorizontal: false,
  panSign: 1,
  tiltSign: 1,
  rollSign: 1,
}
```

The server substitutes `__YAW_DEGREES__`, `__PITCH_DEGREES__`, `__ROLL_DEGREES__`, `__FLIP_HORIZONTAL__`, `__PAN_SIGN__`, `__TILT_SIGN__`, and `__ROLL_SIGN__` into `preview.js` the same way it substitutes the page token into `index.html`. The shader uses those values.

## Media

Frame Desk already serves its page from a local process. `pnpm app` starts that process inside Electron and loads the window from it. `pnpm dji ui` starts the same process and opens a browser. There is no separate server and no packaged executable. The page already calls `/api/draft`, `/api/preview`, and `/api/write` on it. `/api/media` is another route in `src/ui/server.ts`. The browser cannot read a `.LRF` on disk directly, so the video element loads the remux through that route. The page token is the same one already injected into the HTML. A video element cannot set the header the other routes use, so this route also accepts the token on the query string.

`PanoramaVideo.resource_asset` points at an `Asset`. That asset’s `locator` is the source file. The proxy path is the locator’s directory plus the locator’s basename with the extension replaced by `.LRF`. An absolute locator is used as written. A relative locator resolves from the `draft.json` directory.

A clip with no asset, a missing asset, a locator that is not a string, or a missing `.LRF` still opens. `proxyReady` is false. Finding the proxy does not throw.

The draft JSON for each clip gains:

- `timeStart` and `timeEnd`, the clip range in microseconds
- `proxyReady`, whether the `.LRF` file exists

The filesystem path is not sent.

`GET /api/media?path=<draft>&clip=<index>&t=<token>` serves the proxy. `clip` starts at 1, matching the other clip APIs. The request is authorized when `t` equals the page token or the `x-frame-desk` header does. Otherwise the response is `403` with `Missing frame desk token.` The draft must sit inside the allowed folder, using the same check as the other draft routes. The handler loads the path from the clip. It does not accept a media path from the query.

The handler `realpath`s the `.LRF` and requires the filename to end in `.LRF`, case-insensitive. A resolved name that does not is a missing proxy. `ffmpeg` stream-copies video track 0, drops audio, and writes `+faststart` into the temp cache. The cache file is `os.tmpdir()/frame-desk-proxies/<sha256>.mp4`. The hash is the lowercase hex SHA-256 of the UTF-8 string `realPath + "\0" + size + "\0" + mtimeMs`, where `mtimeMs` is `stats.mtimeMs` truncated toward zero. A remux writes `<hash>.mp4.part` and renames it into place. Concurrent requests for the same hash share one ffmpeg run. The response is `video/mp4`, with `Accept-Ranges: bytes`, `200` for a full read, and `206` for a `Range`.

If the clip’s out point is past the end of the prepared file, the loop ends at the file’s duration. Seeking still starts at the in point, clamped into the file. An empty or inverted range shows the first frame and does not play.

A missing proxy, a missing `ffmpeg`, or a failed remux is a JSON body `{ "error": "<sentence>" }`. Missing proxy is `404`. `ffmpeg` missing or a failed remux is `400`. Spawn error `ENOENT` is the missing-`ffmpeg` sentence. Any other failed remux is the other sentence, and the `.part` file is deleted. The client shows `error` and does not treat the body as video. When `proxyReady` is false, the client shows the missing-proxy sentence without requesting media. An unknown clip index uses the existing error, `Clip <n> is not in this draft. Clips: <list>.` Extra query keys are ignored.

## When the picture cannot be shown

The monitor shows one sentence. The rest of the desk still edits the draft.

| Situation                   | Sentence                                   |
| --------------------------- | ------------------------------------------ |
| No `.LRF` beside the source | This clip has no .LRF next to its .OSV.    |
| `ffmpeg` is not on `PATH`   | ffmpeg is required to prepare the preview. |
| The remux fails             | The preview proxy could not be prepared.   |
| The browser has no WebGL    | This browser cannot show the preview.      |

A draft outside the allowed folder keeps the existing error, `That draft is outside the allowed folder.`

## What this does not do

- Decode or stitch the `.OSV`.
- Match a RockSteady or horizon pass that exists only inside DJI Studio and is absent from the `.LRF`.
- Play keyframe animation.
- Play audio.
- Export a reframed movie.
- Change the monitor to 9:16 or 1:1.

## Tests

`tests/reframe.test.ts` locks the four Zoom rows above after rounding to one decimal. It locks a center pixel at zero angles to the forward ray, the middle of a vertical edge at correction 0 to half the FOV, and the middle of a horizontal edge at correction 0 and at correction 1 to half the Zoom angle. It also locks the three small-angle aims: positive pan toward `+X`, positive tilt toward `+Y`, and positive roll counterclockwise.

`tests/ui-server.test.ts` builds a temp draft whose asset locator points at a temp file. A missing `.LRF` leaves `proxyReady` false, and `GET /api/media` returns `404` with the missing-proxy sentence. A tokenless `GET /api/media` is `403`. An unknown clip index returns the existing clip error. An extra query key does not change the response. Drafts that have no `Asset` node, including the current server fixtures, still open.

Preparing a real proxy and judging aim against Studio is a manual check in Frame Desk: baseline, pan, tilt, horizon, FOV, and correction. The scrubber stays inside the clip. Previewing does not write `draft.json`.
