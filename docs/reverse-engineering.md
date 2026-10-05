# Reverse engineering notes

Research log for DJI Studio project files. Field meanings stay unconfirmed until a controlled before/after edit shows them.

## 2026-10-04 — first look on this Mac

DJI Studio 1.2.21 (build 30839) is installed at `/Applications/DJI Studio.app`.

| Fact                                                              | Evidence                                         |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Bundle id is `com.light.studio`                                   | `Contents/Info.plist` `CFBundleIdentifier`       |
| The app declares `.osv` and `.lrf` as its video types             | `CFBundleDocumentTypes` in the same plist        |
| Project data is under `~/Library/Application Support/DJI Studio/` | Directory exists and contains `project/<id>/`    |
| A name search for only `dji` would miss the container id          | Bundle id is `com.light.studio`, not `com.dji.*` |

Related locations also present, not yet read for camera state:

- `~/Library/Preferences/com.light.studio.plist`
- `~/Library/Containers/com.light.studio.quicklook*`
- `~/Library/Application Support/DJI Assistant 2` and `DJI Quick Look` (other apps)

Windows comment from a public DJI Osmo 360 thread, not verified here: `%LOCALAPPDATA%\DJI Studio\project\`. The Mac layout above is the one observed locally.

### Project folder

`~/Library/Application Support/DJI Studio/project/<numeric id>/` contains, in the folders that are actually populated:

- `proj.db` — SQLite
- `config.ini` — INI text. The file starts with a `[General]` section. Keys seen there (`key_project_resolution`, `key_project_use_material_proxy`, `.__dummmy_key_create_time__`, and similar) look like project UI state. They are not the reframe tuple.
- `nova/draft.proj/` — a directory, not a single file
  - `manifest.json`
  - `project_settings.json`
  - `project.meta`
  - `<generation>/draft.json`

While DJI Studio was open, project 31's generation directory moved from `176` to `180` and later `193` during the same session. The number is not a stable path. Quit the app before copying a project for a diff. `discover` / `diff` will pair a single `draft.json` on each side when the relative path changed but the file name is unique.

On this machine only projects `30` and `31` contain `nova/draft.proj/`. The older numbered folders have `proj.db` and `config.ini` and no `draft.json`. Treat that as two layouts until a controlled project shows whether Studio still writes the older one.

`project.meta` starts as text:

```text
method=json
version=1.1.0
```

`.bookmark` files start with the bytes `book`. They are macOS bookmarks. This tool does not resolve them.

### `proj.db`

One populated project had a single user table, `mediaAssetInfo_v3`, with columns including:

`id`, `path`, `createTime`, `importTime`, `editorTime`, `size`, `duration`, `fileType`, `panoramaAdjustedJson`, `deviceName`, `viewingMode`, and others.

In that database every `panoramaAdjustedJson` value was empty. That column is not where the reframe lived in this sample. Do not assume it stays empty in every project.

### Draft JSON wrapper

`draft.json`, `manifest.json`, and `project_settings.json` use the same wrapper shape:

```json
{
  "signature": "<8 hex chars>",
  "signature_method": "crc32",
  "data": {}
}
```

`manifest.json` `data` includes `schema_major`, `schema_minor`, `draft_version`, `draft_id`, `project_data_id`, `generation`, and `Skeleton`. Values were not copied into this log.

`project_settings.json` `data` in the sample held proxy and timeline UI fields (`is_enable_proxy`, `preview_quality`, `timeline.*`), not the panorama tuple.

The CRC payload is unknown. Rewriting `data` and leaving `signature` unchanged will probably make Studio reject the file. No writer is implemented.

`draft.json` `data.nodes` is an array of typed objects. `__type__` values seen in one project:

- `Draft`, `DraftSettings`, `Track`, `Asset`, `Metadata`
- `PanoramaVideo`, `PanoramaFilter`, `PanoramaViewData`, `PanoramaViewKeyframes`
- `SourceRangeFilter`, `ColorAdjustFilter`, `AudioBasicFilter`, `Sdr2HlgFilter`, `NdEffectFilter`, `LutRecoveryFilter`

Node ids look like short opaque strings, not UUIDs. The noise filter hides key names `id`, `signature`, and `checksum` when they change. It does not hide `parent_id`.

### Panorama fields that exist

These names were present. Their meanings are not confirmed.

`PanoramaViewData`:

- `view_param`: array of 5 numbers
- `view_offset`: array of 5 numbers

In the sampled project, `view_param` was the same on every clip: `[0, 0, 0, 60, 1]`. `view_offset` varied per clip.

`PanoramaViewKeyframes` sometimes has only `id` and `parent_id`. When keyframes exist, each item has:

- `p`: large integer (the sample was in the 1e8 range, which is consistent with microseconds, not proven)
- `v`: array of 5 numbers
- `e`: small integer (sample value 3)

Some keyframe nodes also have `view_type`.

`PanoramaVideo` points at panorama state with `freedom_view_id` and `freedom_kfs_id`, and lists filters as `{ "k": "<type name>", "v": "<node id>" }`.

`PanoramaFilter` fields seen:

`base_mode`, `de_distortion`, `viewing_mode`, `stitcher_precise`, `stitcher_color_adjust`, `stitcher_sdk`, `stabilize_intra_frame`, `stabilize_inter_frame`, `horizon_correct`, `stabilize_intra_frame_freedom`, `stabilize_inter_frame_freedom`, `horizon_correct_freedom`.

In the sample those integer flags were identical across clips, so they did not explain the per-clip view difference.

### Hypotheses, not confirmed

- The 5-number list is not a quaternion. Quaternion components lie in `[-1, 1]`, and both `view_param[3]` (`60`) and a keyframe `v[3]` (about `70`) are far outside that range. It is also not a 3×3 matrix.
- `view_param` might be a base view and `view_offset` a per-clip adjustment, because only the offset varied in this project. It might instead be unused defaults. A controlled edit has to decide.
- Index 3 might be field of view in degrees, because `60` and about `70` showed up there. Index 2 was `0` on the sampled offsets, so it might be roll, or it might be unused.
- `view_offset[1]` in that project sometimes had magnitude greater than `2π`. Do not assume every component is a single-turn radian angle.
- Direction Lock might be `PanoramaFilter.viewing_mode`, `horizon_correct`, a `*_freedom` flag, or `PanoramaViewKeyframes.view_type`. Nothing here distinguishes those.
- Keyframe `e` might be an interpolation type. One observed value is not enough.

The diff command will print low-confidence notes for `view_param[n]`, `view_offset[n]`, and keyframe `v[n]`. It will not rename them.

## 2026-10-05 — controlled edits in `fixtures/private`

Baseline is one `.OSV` placed twice on the timeline. Clip 2 is the later item. Both views started as `view_param = [0, 0, 0, 60, 1]` and `view_offset = [0, 0, 0, 0, 0]`.

On clip 2, one control at a time:

| Copy         | On-screen control | `view_offset` change          |
| ------------ | ----------------- | ----------------------------- |
| `01-pan`     | Pan angle         | index 1 → about `-π` radians  |
| `03-tilt`    | Tilt angle        | index 0 → about `π/2` radians |
| `04-horizon` | Roll angle        | index 2 → about `π/2` radians |
| `02-fov`     | FOV               | index 3 → `-40`               |

`view_param` stayed `[0, 0, 0, 60, 1]` in every copy. `view_offset` is the per-clip edit. Screenshots in each fixture folder match clip 2 as follows.

Displayed value = `view_param[i] + view_offset[i]`, then converted. Pan and tilt use degrees = radians × 180/π. Roll uses the opposite sign. Correction uses the `1` already stored in `view_param[4]`.

| Index | Screen control   | File                                   | Screen examples            |
| ----- | ---------------- | -------------------------------------- | -------------------------- |
| 0     | Tilt angle       | radians                                | `+π/2` → `90.0°`           |
| 1     | Pan angle        | radians                                | `-π` → `-180.0°`           |
| 2     | Roll angle       | radians, opposite sign from the screen | `+π/2` → `-90.0°`          |
| 3     | FOV row          | degrees added to `60`                  | `-40` → `20.0°`            |
| 4     | Correction angle | added to `1`                           | `0` → `1.00`, `-1` → `0.0` |

The Zoom degree readout is not stored. It follows FOV and Correction angle: `183.0°` at FOV `60` / correction `1.00`, `91.5°` at FOV `60` / correction `0.0`, `34.8°` at FOV `20` / correction `0.0`.

`07-correction-angle` is correction only: offset `[0, 0, 0, 0, -1]`, screen FOV `60.0°`, correction `0.0`, Zoom `91.5°`. `08-zoom` is that same correction plus an FOV change: offset `[0, 0, 0, -40, -1]`, screen FOV `20.0°`, correction `0.0`, Zoom `34.8°`.

`02-fov` is FOV only: offset `[0, 0, 0, -40, 0]`. The screenshot shows FOV `20.0°`, correction `1.00`, Zoom `69.6°`. Compared with `08-zoom` (`[0, 0, 0, -40, -1]`, Zoom `34.8°`), the same FOV with correction `1.00` instead of `0.0` doubles the Zoom readout.

`05-direction-lock` leaves the view tuple unchanged. The perspective menu is Direction Lock, and `proj.db` `viewingMode` is `3` (`0` in the baseline). `06-keyframe` keeps the default angles and adds one keyframe, `p` `4366667`, `v` `[0, 0, 0, 60, 1]`, `e` `3`. `v` is the absolute five-number view, the same numbers as `view_param` when the offset is zero.

## 2026-10-05 — signature and camera model

`signature` is the CRC-32 of the raw `data` JSON value: zlib's `crc32`, as eight lowercase hex digits. That matches `draft.json` and `manifest.json` in the controlled copies. `project_settings.json` in those copies has an empty signature.

Rewriting the file with `JSON.stringify` is unsafe even when the CRC is updated. Studio stores whole numbers as `1.0`, and `JSON.stringify(1)` is `1`. The writer replaces the target `view_offset` array in the original text and recomputes the CRC over `data`. Anything else, including `1.0`, stays as it was.

Screen values:

- tilt degrees = `view_offset[0]` × 180/π
- pan degrees = `view_offset[1]` × 180/π
- roll degrees = − `view_offset[2]` × 180/π
- displayed FOV = `view_param[3]` + `view_offset[3]`
- displayed correction = `view_param[4]` + `view_offset[4]`

Stored angles match float32. `90°` is `1.5707963705062866`, and `−180°` is `-3.1415927410125732`.

`dji view show` prints the screen values. `dji view set` and `dji view copy` update one clip's free view when `--write` is passed. They leave keyframes, direction lock, trim, and filters alone. Zoom stays out of the model.

## 2026-10-05 — Studio kept a written draft

A live project was updated with `dji view set --write`, then reopened in DJI Studio. The Manual Framing change was still there.

Presets store that same screen view: pan, tilt, roll, FOV, and correction. They do not store zoom or the raw `view_offset` tuple.
