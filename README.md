# DJI Studio tools

Local tools for reading [DJI Studio](https://www.dji.com/) projects and editing a clip’s free-camera view without re-encoding video. Frame Desk is the window. The `dji` command does the same work from a terminal.

A write updates one field in `draft.json`: the free-view offset. Video files are never opened for encoding.

## Requirements

- macOS. Project discovery and the Studio quit check follow the layout used by DJI Studio 1.2.21 (`com.light.studio`) on this platform.
- [Node.js](https://nodejs.org/) 22 or newer.
- [pnpm](https://pnpm.io/).
- [ffmpeg](https://ffmpeg.org/) on `PATH` if you use the live preview. The rest of the desk works without it.

## Install

```bash
pnpm install
```

## Frame Desk

```bash
pnpm app
```

Frame Desk lists projects under `~/Library/Application Support/DJI Studio/project`. Open one to see each clip’s pan, tilt, roll, field of view, and correction. Edit the free view on the spirit level or in the fields, save a named preset, and apply it to the clips you check.

Nothing is written until you press **Write** or **Apply**. Both refuse to run while DJI Studio is open, because an open project rewrites `draft.json` into a new numbered directory. A successful write copies the original to `draft.json.backup-<timestamp>` in the same folder, updates the free-view offset, and recomputes the CRC-32 signature. Every other byte stays as it was.

```bash
pnpm dji ui
```

serves the same desk in a browser at `http://127.0.0.1:3921`. Pass `--port` to choose another port, or `--no-open` to skip launching a browser.

### Preview

The picture above the spirit level is **experimental and very rough**. It reframes the clip’s `.LRF` into a 16:9 frame so you can judge the free view while you edit. It does not decode the `.OSV`, play audio, animate keyframes, or match DJI Studio’s stabilization. Dragging the level or editing a field updates the picture. Previewing does not write `draft.json`.

Hide it with **Experimental preview**. That choice is stored in the browser.

## Command line

Read-only commands never modify a project.

```bash
pnpm dji discover
pnpm dji inspect ~/Library/Application\ Support/DJI\ Studio/project/<id>
pnpm dji keys <file>
pnpm dji search <file-or-directory> view_offset
pnpm dji diff <before> <after>
pnpm dji diff <before> <after> --show-noise
```

`discover` looks in `/Applications`, `~/Applications`, `~/Library/Application Support`, `~/Library/Containers`, `~/Library/Group Containers`, `~/Library/Preferences`, `~/Movies`, and `~/Documents`. It does not walk the rest of your home directory, and it does not enter cache, crash, or log directories.

`diff` compares JSON, plist, SQLite, and small text files. It hides likely noise such as signatures, ids, ISO timestamps, and filesystem paths. `--show-noise` prints those hidden paths. When `draft.json` has moved between numbered save directories, and each side has exactly one file of that name, those files are paired.

View and preset commands print the change and leave the file alone unless you pass `--write`. Negative numbers need an equals sign: `--pan=-180`. Clip numbers start at 1.

```bash
pnpm dji view show <project-or-draft>
pnpm dji view set <project-or-draft> --clip 2 --pan=-180
pnpm dji view set <project-or-draft> --clip 2 --fov 20 --correction 0 --write
pnpm dji view copy <project-or-draft> --from 2 --to 1 --write

pnpm dji preset list
pnpm dji preset save wide-left <project-or-draft> --clip 2
pnpm dji preset apply wide-left <project-or-draft> --clip 1 --write
pnpm dji preset delete wide-left
```

Angles are degrees. Roll on screen is the opposite sign of the stored radians. Field of view and correction are `view_param` plus `view_offset`. Zoom is derived from those two values and is not stored. These commands change the static free view only. They do not copy keyframes, direction lock, trim, speed, filters, or paths.

Presets are the on-screen pan, tilt, roll, field of view, and correction, stored in `presets/library.json`.

Quit DJI Studio before any `--write`.

## Development

```bash
pnpm test
pnpm typecheck
```

`fixtures/synthetic/` holds invented examples for the diff tests. They are not copies of a DJI Studio project. Real project copies belong in `fixtures/private/`, which git ignores, along with `.OSV`, `.MP4`, `.MOV`, `.LRV`, `.THM`, and `.LRF` files.

Field notes from reading Studio’s project files are in [docs/reverse-engineering.md](docs/reverse-engineering.md).

## License

[MIT](LICENSE)
