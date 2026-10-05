# Apply a preset to several clips

Frame Desk can write one saved preset onto every clip you check, in one step. The draft still changes only from Apply or from Write, and only after DJI Studio has quit. The live preview spec is unchanged and is not part of this work. The command-line `preset apply` stays one clip.

## Desk

Each clip in the row is a checkbox plus the existing clip button. The button opens that clip in the form. The checkbox only marks the clip for Apply. Opening a project starts with nothing checked. Switching clips inside the project keeps the checks. Opening another project clears them.

**All** sits with the clip row. It is checked when every clip is checked, mixed when only some are, and clear when none are. Activating it while any clip is unchecked checks every clip. Activating it while every clip is checked clears them.

Each preset keeps Load and Delete. Load still only fills the form. Apply writes that preset. Apply is disabled when no project is open, no clip is checked, DJI Studio is running, or the draft signature does not match. Its label stays Apply. There is no second confirmation.

After a successful Apply, the form reloads from the draft, as it does after Write. The checked set stays, so the same clips can take another preset. The existing Write button still stores the form on the one open clip only.

The toast names clips in ascending order. Two or more numbers use commas, with “and” before the last. One number stands alone.

| Result                                         | Toast                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Clips 2 and 4 updated                          | Applied wide-left to clips 2 and 4.                                       |
| Only clip 2 updated                            | Applied wide-left to clip 2.                                              |
| Clips 2 and 4 updated, clips 1 and 3 unchanged | Applied wide-left to clips 2 and 4. Clips 1 and 3 already have that view. |
| Only clip 2 updated, clip 4 unchanged          | Applied wide-left to clip 2. Clip 4 already has that view.                |
| Nothing changed, several clips                 | Clips 2 and 4 already have that view.                                     |
| Nothing changed, one clip                      | Clip 2 already has that view.                                             |

## Write

`writeClipViews` in `src/model/draft-document.ts` takes a draft path, clip indexes, and one `CameraView`. It checks every index before it edits. An unknown clip throws the existing error, `Clip <n> is not in this draft. Clips: <list>.`, and the file is untouched. Duplicate indexes are ignored.

A clip whose `view_offset` would not change is skipped. The others are replaced in one pass over the original text, the crc32 is recomputed once, and one backup is written beside the draft as `draft.json.backup-<YYYYMMDD>T<HHMMSS>-<4 hex chars>`. If no clip changes, there is no backup and `changed` is false. `updated` lists the clips that were written. `unchanged` lists the requested clips that already had that offset. Clips left out of the request appear in neither list. The preservation check allows `view_offset` on the updated view ids, and the leading signature. Everything else stays byte-for-byte. Keyframes and direction lock are not modified. A signature that does not match still refuses with `The crc32 signature does not match this draft. Refusing to write.`

The result lists `updated` and `unchanged` clip numbers in ascending order, and `backupPath` only when a backup was written.

## Request

`POST /api/presets/apply` accepts the page token the same way Write does. The JSON body is the draft path, the preset name, and `clips`, an array of clip numbers. The server loads the preset from the library and writes that view. The page does not send the five numbers.

Each clip number follows the existing rule: an integer starting at 1. After duplicates are removed, an empty list is `Check at least one clip.` A missing preset is `No preset named <name>.` The draft must sit inside the allowed folder. DJI Studio must have quit, or the response is `DJI Studio is running. Quit it before writing a project.` A missing token is `403`. Every other refusal is `400` with `{ "error": "<sentence>" }`. Success returns `changed`, `updated`, `unchanged`, `backupPath` when present, and `draft` in the shape the page already draws.

## Tests

A draft with three clips is updated on clips 1 and 3. Clip 2 is absent from the request and stays byte-for-byte, including its `view_offset`. One backup exists, and the crc32 matches. A second call with the same preset and the same clips writes nothing and creates no backup. An unknown clip index writes nothing. An empty `clips` array is refused. A missing token is `403`. An unknown preset is refused and writes nothing. The current single-clip Write test still passes.

Applying from the desk is checked by hand: check two clips, Apply one preset, confirm both clips show that view, and confirm an unchecked clip does not.
