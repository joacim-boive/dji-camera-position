# DJI Studio tools

Tooling for reading DJI Studio virtual-camera settings and copying them between clips without re-encoding video.

`discover`, `inspect`, `keys`, `search`, and `diff` only read files. `view set` and `view copy` write `draft.json` only when `--write` is passed.

## Safety

- Quit DJI Studio before `--write`. The command refuses to write while the app is running, because an open project rewrites `draft.json` into a new numbered directory.
- `--write` copies the original to `draft.json.backup-<timestamp>` in the same folder, updates that clip's free-view `view_offset`, and recomputes the `crc32` signature. Other fields stay byte-for-byte.
- Do not commit DJI media. `.OSV`, `.MP4`, `.MOV`, `.LRV`, `.THM`, and `.LRF` files are gitignored, as is `fixtures/private/`.

## Commands

```bash
pnpm install
pnpm test

pnpm dji discover
pnpm dji inspect ~/Library/Application\ Support/DJI\ Studio/project/<id>
pnpm dji keys <file>
pnpm dji search <file-or-directory> view_offset
pnpm dji diff <before> <after>
pnpm dji diff <before> <after> --show-noise

pnpm dji view show <project-or-draft>
pnpm dji view set <project-or-draft> --clip 2 --pan=-180
pnpm dji view set <project-or-draft> --clip 2 --fov 20 --correction 0 --write
pnpm dji view copy <project-or-draft> --from 2 --to 1 --write

pnpm dji preset list
pnpm dji preset save wide-left <project-or-draft> --clip 2
pnpm dji preset apply wide-left <project-or-draft> --clip 1 --write

pnpm dji ui
pnpm app
```

`discover` only looks in:

- `/Applications` and `~/Applications` (app bundles named DJI or Osmo, plus their bundle ids)
- `~/Library/Application Support`
- `~/Library/Containers`
- `~/Library/Group Containers`
- `~/Library/Preferences`
- `~/Movies`
- `~/Documents`

It does not walk the rest of the home directory. Cache, crash, and log directories are not entered.

`diff` compares JSON, plist, SQLite, and small text files. It hides likely noise such as `signature`, `id`, ISO timestamps, and filesystem paths. Hidden paths are counted and can be printed with `--show-noise`. If `draft.json` moves between numbered save directories, and each side has exactly one file of that name, those files are paired and the path difference is reported.

`view show` prints the on-screen pan, tilt, roll, FOV, and correction for each timeline clip. Angles are degrees. Roll on screen is the opposite sign of the stored radians. FOV and correction are `view_param` plus `view_offset`. Zoom is not stored.

`view set` and `view copy` change the free view (`freedom_view_id`) only. They do not copy keyframes, direction lock, trim, speed, filters, or paths. Without `--write` they print the change and leave the file alone. Negative numbers need an equals sign, as in `--pan=-180`.

`preset save` reads one clip and stores the on-screen pan, tilt, roll, FOV, and correction in `presets/library.json`. `preset apply` writes that view onto a clip when `--write` is passed. Presets do not store zoom, keyframes, or direction lock.

`pnpm app` opens Frame Desk in its own window. It lists DJI Studio projects, edits one clip’s free view, and saves presets. Apply writes a preset onto every clip you check, in one backup. The draft changes only when you press Write or Apply, and only after DJI Studio has quit. `pnpm dji ui` opens that same desk in a browser.

## Reverse engineering status

The free-view tuple in `draft.json` is confirmed against the controlled fixtures. See [docs/reverse-engineering.md](docs/reverse-engineering.md).

What is known on this Mac, as of DJI Studio 1.2.21 (`com.light.studio`):

- Projects live under `~/Library/Application Support/DJI Studio/project/<id>/`.
- The editable document is `nova/draft.proj/<generation>/draft.json`.
- That JSON is a wrapper: `signature`, `signature_method`, `data`. The signature is the CRC-32 of the raw `data` JSON.
- `view_offset` is the per-clip edit. Indexes are tilt radians, pan radians, roll radians (opposite of the screen), FOV degrees added to `view_param[3]`, and correction added to `view_param[4]`.

Named presets live in `presets/library.json` as those screen values. Backups are written beside the draft when `--write` runs.

## Tests

```bash
pnpm test
pnpm typecheck
```

Fixtures in `fixtures/synthetic/` are invented examples for the diff tests. They are not copies of a DJI Studio project. Put real project-folder copies in `fixtures/private/`, which git ignores.

## Reverse engineering notes

The running research log is [docs/reverse-engineering.md](docs/reverse-engineering.md).
