import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32Hex } from "./src/model/signature.js";
import { startUiServer } from "./src/ui/server.js";

const data = `{"nodes":[{"__type__":"Track","id":"track-1","volume":1.0,"clips":[{"id":"video-1"},{"id":"video-2"},{"id":"video-3"}]},{"__type__":"PanoramaVideo","id":"video-1","time_range":[0,1000],"freedom_view_id":"view-1"},{"__type__":"PanoramaVideo","id":"video-2","time_range":[1000,2000],"freedom_view_id":"view-2"},{"__type__":"PanoramaVideo","id":"video-3","time_range":[2000,3000],"freedom_view_id":"view-3"},{"__type__":"PanoramaViewData","id":"view-1","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]},{"__type__":"PanoramaViewData","id":"view-2","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,1.0,0.0,0.0,0.0],"kept":true},{"__type__":"PanoramaViewData","id":"view-3","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]}]}`;

const root = await mkdtemp(path.join(tmpdir(), "frame-desk-apply-"));
const draftPath = path.join(root, "31", "draft.json");
await mkdir(path.dirname(draftPath), { recursive: true });
await writeFile(
  draftPath,
  `{"signature":"${crc32Hex(data)}","signature_method":"crc32","data":${data}}`,
);
await writeFile(
  path.join(root, "library.json"),
  JSON.stringify({
    version: 1,
    presets: [
      {
        name: "wide-left",
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      },
    ],
  }),
);
const ui = await startUiServer({
  port: 0,
  homeRoot: root,
  projectRoot: root,
  libraryPath: path.join(root, "library.json"),
  checkStudio: false,
});
process.stdout.write(`${ui.url}\n${draftPath}\n`);
