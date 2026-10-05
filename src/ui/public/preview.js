const yawDegrees = __YAW_DEGREES__;
const pitchDegrees = __PITCH_DEGREES__;
const rollDegrees = __ROLL_DEGREES__;
const flipHorizontal = __FLIP_HORIZONTAL__;
const panSign = __PAN_SIGN__;
const tiltSign = __TILT_SIGN__;
const rollSign = __ROLL_SIGN__;

const missingProxy = "This clip has no .LRF next to its .OSV.";
const noWebgl = "This browser cannot show the preview.";
const remuxFailed = "The preview proxy could not be prepared.";

const vertexSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentSource = `
precision mediump float;
uniform vec2 uResolution;
uniform sampler2D uFrame;
uniform float uPan;
uniform float uTilt;
uniform float uRoll;
uniform float uFov;
uniform float uCorrection;
uniform float uYaw;
uniform float uPitch;
uniform float uRollOffset;
uniform float uPanSign;
uniform float uTiltSign;
uniform float uRollSign;
uniform float uFlip;

vec3 rotateX(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}

vec3 rotateY(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

vec3 rotateZ(vec3 p, float degrees) {
  float a = radians(degrees);
  float c = cos(a);
  float s = sin(a);
  return vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
}

vec3 lensRay(float nx, float ny) {
  float fov = uFov;
  if (!(fov > 0.0001)) fov = 0.0001;
  if (fov > 179.0) fov = 179.0;
  float scale = tan(radians(fov) * 0.5);
  vec2 point = vec2(nx, ny) * scale;
  float radius = length(point);
  if (radius == 0.0) return vec3(0.0, 0.0, 1.0);
  float theta = max(0.0, 1.0 + uCorrection) * atan(radius);
  theta = min(3.141592653589793, theta);
  float spread = sin(theta) / radius;
  return vec3(point.x * spread, point.y * spread, cos(theta));
}

void main() {
  float nx = ((gl_FragCoord.x / uResolution.x) * 2.0 - 1.0) * (16.0 / 9.0);
  float ny = (gl_FragCoord.y / uResolution.y) * 2.0 - 1.0;
  float pan = uPanSign * uPan + uYaw;
  float tilt = uTiltSign * uTilt + uPitch;
  float roll = uRollSign * uRoll + uRollOffset;
  vec3 ray = lensRay(nx, ny);
  ray = rotateZ(ray, -roll);
  ray = rotateX(ray, -tilt);
  ray = rotateY(ray, pan);
  float rayLength = max(length(ray), 0.000001);
  vec3 direction = ray / rayLength;
  float longitude = atan(direction.x, direction.z);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  float u = 0.5 + longitude / (2.0 * 3.141592653589793);
  if (uFlip > 0.5) u = 1.0 - u;
  float v = 0.5 - latitude / 3.141592653589793;
  gl_FragColor = texture2D(uFrame, vec2(u, v));
}
`;

const FramePreview = {
  mount(elements) {
    this.canvas = elements.canvas;
    this.video = elements.video;
    this.message = elements.message;
    this.playButton = elements.playButton;
    this.pauseButton = elements.pauseButton;
    this.scrubber = elements.scrubber;
    this.token = elements.token;
    this.view = null;
    this.clip = null;
    this.draftPath = "";
    this.visible = true;
    this.generation = 0;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.looping = false;
    this.frame = 0;
    const webgl2 = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
    });
    this.gl =
      webgl2 ??
      this.canvas.getContext("webgl", { premultipliedAlpha: false });
    this.isWebgl2 = webgl2 !== null;
    this.video.muted = true;
    this.video.defaultMuted = true;
    this.video.volume = 0;
    this.video.playsInline = true;
    this.playButton.addEventListener("click", () => {
      if (
        this.looping &&
        (this.video.currentTime < this.loopStart ||
          this.video.currentTime >= this.loopEnd)
      ) {
        this.video.currentTime = this.loopStart;
      }
      void this.video.play();
    });
    this.pauseButton.addEventListener("click", () => {
      this.video.pause();
    });
    this.scrubber.addEventListener("input", () => {
      const next = Number(this.scrubber.value);
      if (Number.isFinite(next)) this.video.currentTime = next;
    });
    this.video.addEventListener("timeupdate", () => this.keepInside());
    this.video.addEventListener("ended", () => {
      if (!this.looping) return;
      this.video.currentTime = this.loopStart;
      void this.video.play();
    });
    this.video.addEventListener("seeked", () => {
      this.scrubber.value = String(this.video.currentTime);
    });
    if (this.gl === null) {
      this.showMessage(noWebgl);
      return;
    }
    this.program = this.createProgram(this.gl);
    this.texture = this.gl.createTexture();
    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      this.gl.STATIC_DRAW,
    );
    const position = this.gl.getAttribLocation(this.program, "position");
    this.gl.enableVertexAttribArray(position);
    this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0);
    this.gl.useProgram(this.program);
    this.uniform("uYaw", yawDegrees);
    this.uniform("uPitch", pitchDegrees);
    this.uniform("uRollOffset", rollDegrees);
    this.uniform("uPanSign", panSign);
    this.uniform("uTiltSign", tiltSign);
    this.uniform("uRollSign", rollSign);
    this.uniform("uFlip", flipHorizontal ? 1 : 0);
    this.draw();
  },

  setVisible(visible) {
    this.visible = visible;
    if (!visible) {
      this.video.pause();
      window.cancelAnimationFrame(this.frame);
      return;
    }
    this.draw();
  },

  setView(view) {
    this.view = view;
  },

  showClip(draftPath, clip) {
    const ticket = ++this.generation;
    this.clip = clip;
    this.draftPath = draftPath;
    this.looping = false;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.armScrubber(0, 0, false);
    if (!clip.proxyReady) {
      this.showMessage(missingProxy);
      return;
    }
    if (this.gl === null) {
      this.showMessage(noWebgl);
      return;
    }
    this.showMessage("");
    const url = `/api/media?path=${encodeURIComponent(draftPath)}&clip=${clip.index}&t=${encodeURIComponent(this.token)}`;
    void this.load(url, ticket);
  },

  async load(url, ticket) {
    const probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
    if (ticket !== this.generation) return;
    const type = probe.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = await probe.json();
      this.showMessage(
        typeof body.error === "string" ? body.error : remuxFailed,
      );
      return;
    }
    await probe.arrayBuffer();
    if (ticket !== this.generation) return;
    this.video.src = url;
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        if (ticket !== this.generation) return;
        this.seekToInPoint();
      },
      { once: true },
    );
  },

  seekToInPoint() {
    const duration = this.video.duration;
    const start = this.clip.timeStart / 1_000_000;
    const end = this.clip.timeEnd / 1_000_000;
    if (!(end > start) || !Number.isFinite(duration)) {
      this.video.pause();
      this.video.currentTime = 0;
      this.armScrubber(0, 0, false);
      return;
    }
    const loopStart = Math.min(Math.max(start, 0), duration);
    const loopEnd = Math.min(Math.max(end, 0), duration);
    this.loopStart = loopStart;
    this.loopEnd = loopEnd;
    this.looping = loopEnd > loopStart;
    this.video.pause();
    this.video.currentTime = this.looping ? loopStart : 0;
    this.armScrubber(
      this.looping ? loopStart : 0,
      this.looping ? loopEnd : 0,
      this.looping,
    );
  },

  keepInside() {
    this.scrubber.value = String(this.video.currentTime);
    if (!this.looping || this.video.paused) return;
    if (this.video.currentTime >= this.loopEnd) {
      this.video.currentTime = this.loopStart;
    }
  },

  armScrubber(start, end, enabled) {
    this.scrubber.min = String(start);
    this.scrubber.max = String(end);
    this.scrubber.value = String(start);
    this.scrubber.disabled = !enabled;
    this.playButton.disabled = !enabled;
    this.pauseButton.disabled = !enabled;
  },

  showMessage(text) {
    const empty = text.length === 0;
    this.message.hidden = empty;
    this.message.textContent = text;
    if (!empty) this.armScrubber(0, 0, false);
  },

  draw() {
    window.cancelAnimationFrame(this.frame);
    if (!this.visible || this.gl === null) return;
    this.frame = window.requestAnimationFrame(() => this.draw());
    this.keepInside();
    this.resize();
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    this.uniform("uResolution", this.canvas.width, this.canvas.height);
    const view = this.view ?? {
      pan: 0,
      tilt: 0,
      roll: 0,
      fov: 60,
      correction: 0,
    };
    this.uniform("uPan", view.pan);
    this.uniform("uTilt", view.tilt);
    this.uniform("uRoll", view.roll);
    this.uniform("uFov", view.fov);
    this.uniform("uCorrection", view.correction);
    if (this.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video,
      );
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_S,
        this.isWebgl2 ? gl.REPEAT : gl.CLAMP_TO_EDGE,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  },

  resize() {
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round((width * 9) / 16));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  },

  uniform(name, a, b) {
    const location = this.gl.getUniformLocation(this.program, name);
    if (b === undefined) this.gl.uniform1f(location, a);
    else this.gl.uniform2f(location, a, b);
  },

  createProgram(gl) {
    const program = gl.createProgram();
    gl.attachShader(program, this.compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(
      program,
      this.compile(gl, gl.FRAGMENT_SHADER, fragmentSource),
    );
    gl.linkProgram(program);
    return program;
  },

  compile(gl, type, source) {
    const shader = gl.createShader(type);
    const shaderSource = this.isWebgl2
      ? `#version 300 es
${source
  .replace("attribute vec2 position;", "in vec2 position;")
  .replace(
    "precision mediump float;",
    "precision mediump float;\nout vec4 fragmentColor;",
  )
  .replace("texture2D(", "texture(")
  .replace("gl_FragColor", "fragmentColor")}`
      : source;
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    return shader;
  },
};

window.FramePreview = FramePreview;
