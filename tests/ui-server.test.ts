import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crc32Hex } from "../src/model/signature.js";
import { startUiServer, type UiServer } from "../src/ui/server.js";

function wrap(data: string): string {
  return `{"signature":"${crc32Hex(data)}","signature_method":"crc32","data":${data}}`;
}

const data = `{"nodes":[{"__type__":"Track","id":"track-1","volume":1.0,"clips":[{"id":"video-1"},{"id":"video-2"}]},{"__type__":"PanoramaVideo","id":"video-1","time_range":[0,8200000],"freedom_view_id":"view-1"},{"__type__":"PanoramaVideo","id":"video-2","time_range":[8200000,16400000],"freedom_view_id":"view-2"},{"__type__":"PanoramaViewData","id":"view-1","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]},{"__type__":"PanoramaViewData","id":"view-2","view_param":[0.0,0.0,0.0,60.0,1.0],"view_offset":[0.0,0.0,0.0,0.0,0.0]}]}`;

describe("framing desk", () => {
  let ui: UiServer | undefined;

  afterEach(async () => {
    await ui?.close();
    ui = undefined;
  });

  it("lists a project, previews without writing, then writes the free view", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-"));
    const draftPath = path.join(
      root,
      "31",
      "nova",
      "draft.proj",
      "8",
      "draft.json",
    );
    await mkdir(path.dirname(draftPath), { recursive: true });
    await writeFile(draftPath, wrap(data));
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
    });

    const page = await fetch(ui.url);
    const html = await page.text();
    const token = html.match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    expect(token).toBeTruthy();
    expect(html).toContain("Frame desk");

    const headers = {
      "content-type": "application/json",
      "x-frame-desk": token ?? "",
    };
    const projects = await fetch(`${ui.url}/api/projects`).then((response) =>
      response.json(),
    );
    expect(projects.projects[0]?.id).toBe("31");
    expect(projects.projects[0]?.clipCount).toBe(2);

    const before = await readFile(draftPath, "utf8");
    const preview = await fetch(`${ui.url}/api/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: path.join(root, "31"),
        clip: 2,
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    }).then((response) => response.json());
    expect(preview.changed).toBe(true);
    expect(preview.lines.join("\n")).toContain("Pan");
    expect(await readFile(draftPath, "utf8")).toBe(before);

    const refused = await fetch(`${ui.url}/api/write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: draftPath,
        clip: 2,
        pan: 0,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    });
    expect(refused.status).toBe(403);

    const written = await fetch(`${ui.url}/api/write`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        path: draftPath,
        clip: 2,
        pan: -180,
        tilt: 0,
        roll: 0,
        fov: 60,
        correction: 1,
      }),
    });
    expect(written.status).toBe(200);
    const body = await written.json();
    expect(body.changed).toBe(true);
    expect(body.draft.clips[1]?.view.pan).toBeCloseTo(-180, 3);
    const text = await readFile(draftPath, "utf8");
    expect(text).toContain('"volume":1.0');
    expect(text).toContain("-3.1415927410125732");

    const outside = await fetch(
      `${ui.url}/api/draft?path=${encodeURIComponent("/etc/hosts")}`,
    );
    expect(outside.status).toBe(400);
  });

  it("returns the folder chosen for the desk", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dji-ui-pick-"));
    const chosen = path.join(root, "32");
    ui = await startUiServer({
      port: 0,
      homeRoot: root,
      projectRoot: root,
      libraryPath: path.join(root, "library.json"),
      checkStudio: false,
      pickFolder: async () => chosen,
    });
    const page = await fetch(ui.url);
    const token = (await page.text()).match(/FRAME_TOKEN = "([0-9a-f]+)"/)?.[1];
    const headers = {
      "content-type": "application/json",
      "x-frame-desk": token ?? "",
    };
    const studio = await fetch(`${ui.url}/api/studio`).then((response) =>
      response.json(),
    );
    expect(studio.pickFolder).toBe(true);
    const picked = await fetch(`${ui.url}/api/pick-folder`, {
      method: "POST",
      headers,
      body: "{}",
    });
    expect(picked.status).toBe(200);
    expect(await picked.json()).toEqual({ path: chosen });
  });
});
