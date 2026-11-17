/**
 * Main-menu globe. The world texture is drawn by the game's own Renderer
 * (stories/menu/MenuGlobe.stories.ts, baked by scripts/bake-menu-globe.mjs);
 * one WebGL2 fragment shader wraps it onto a sphere with an azimuthal
 * equidistant projection, so tiles keep their shape near the focus and fold
 * smoothly toward the limb. Ocean beyond the map repeats the map's own deep
 * water, blended in over the map's last two tiles. The globe sways slowly about its vertical axis.
 *
 * Presentation only: no game state is read. When WebGL2 is unavailable the
 * canvas stays hidden and the backdrop's painted globe remains.
 */
const WORLD_URL = '/assets/ui/main-menu/globe-world.webp';
/** Written by the bake: land centre and extent, art density and a deep-water block. */
const META_URL = '/assets/ui/main-menu/globe-world.json';
interface GlobeMeta { texelsPerTile: number; focus: { x: number; y: number }; landRadius: number; oceanBlock: { x: number; y: number; tiles: number } }
/** The land centroid faces up and left of the disk centre, inside the visible area. */
const FOCUS_VIEW = normalize([-.28, -.5, .82]);
/** Arc (radians) from the land centre to the bake's land radius. Small enough
 * that the whole world sits on the visible face with ocean around it, so the
 * flat map reads as a small world on a large sphere. */
const LAND_ARC = .55;
const SWAY_RADIANS = .14, SWAY_PERIOD_SECONDS = 150, FRAME_MS = 1000 / 30;
/** Halo extent, in disk radii, beyond the rim. */
export const GLOBE_HALO = .085;

export interface GlobePlacement {
  /** Disk centre and radius in viewport CSS pixels. */
  x: number; y: number; radius: number;
  viewportWidth: number; viewportHeight: number;
}

type Vec3 = [number, number, number];
function normalize(v: Vec3): Vec3 { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uWorld;
uniform vec2 uWorldSize;
uniform float uTexelsPerTile;
uniform float uOceanBlock;
uniform vec2 uOceanOrigin;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uHeight;
uniform mat3 uRotation;
uniform vec2 uFocus;
uniform float uTileAngle;
uniform float uHalo;
out vec4 outColor;

// Sharp bilinear: crisp art pixels when magnified, filtered (mipmapped) when minified.
vec3 sampleAt(vec2 t, vec2 dx, vec2 dy) {
  vec2 seam = floor(t + 0.5);
  t = seam + clamp((t - seam) / max(abs(dx) + abs(dy), vec2(1e-3)), -0.5, 0.5);
  return textureGrad(uWorld, t / uWorldSize, dx / uWorldSize, dy / uWorldSize).rgb;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  vec2 p = (frag - uCenter) / uRadius;
  float r = length(p);
  // Everything below runs for every fragment so derivatives stay defined.
  vec2 rim = r > .999 ? p * (.999 / r) : p;
  vec3 n = vec3(rim, sqrt(max(0.0, 1.0 - dot(rim, rim))));
  vec3 q = uRotation * n;
  float arc = acos(clamp(q.z, -1.0, 1.0));
  vec2 direction = q.xy / max(length(q.xy), 1e-5);
  vec2 texel = (uFocus + direction * arc / uTileAngle) * uTexelsPerTile;
  vec2 dx = dFdx(texel), dy = dFdy(texel);
  // The map fades into repeated deep water over its last two tiles, so no
  // square edge shows on the open ocean.
  vec2 edge = min(texel, uWorldSize - texel);
  float mapWeight = smoothstep(0.0, uTexelsPerTile * 2.0, min(edge.x, edge.y));
  vec3 ocean = sampleAt(uOceanOrigin + mod(texel, uOceanBlock), dx, dy);
  vec3 color = mix(ocean, sampleAt(clamp(texel, vec2(0.5), uWorldSize - 0.5), dx, dy), mapWeight);

  // Soft key light from the upper left, a cool atmosphere toward the limb and
  // a bright rim line like the menu art.
  vec3 light = normalize(vec3(-0.45, -0.55, 0.70));
  color *= mix(0.70, 1.07, smoothstep(-0.4, 0.95, dot(n, light)));
  color = mix(color, vec3(0.80, 0.96, 1.0), pow(1.0 - n.z, 2.5) * 0.42);
  float inner = (1.0 - r) / uHalo;
  color = mix(color, vec3(1.0, 0.99, 0.93), smoothstep(0.08, 0.0, inner) * 0.85);
  float coverage = clamp((1.0 - r) * uRadius + 0.5, 0.0, 1.0);

  float outer = max(0.0, r - 1.0) / uHalo;
  float glow = (exp(-outer * 5.0) * 0.75 + exp(-outer * 1.8) * 0.22) * smoothstep(1.0, 0.7, outer);
  vec3 haloColor = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.68, 0.32), smoothstep(0.0, 0.45, outer));
  outColor = mix(vec4(haloColor * glow, glow), vec4(color, 1.0), coverage);
}`;

export class MenuGlobe {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext | null = null;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private loading?: Promise<void>;
  private placement?: GlobePlacement;
  private ready = false;
  private running = false;
  private frame = 0;
  private lastDraw = -Infinity;
  private readonly epoch = performance.now();
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly base: number[];

  constructor() {
    this.canvas.className = 'menu-globe';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.ready = false; this.canvas.hidden = true; });
    // Rows map a view-space normal into the map's frame, where the focus is +z.
    const right = normalize(cross([0, 1, 0], FOCUS_VIEW)), down = cross(FOCUS_VIEW, right);
    this.base = [...right, ...down, ...FOCUS_VIEW];
    this.canvas.hidden = true;
  }

  /** Position the canvas over the disk and its halo, clipped to the viewport. */
  place(placement: GlobePlacement): void {
    this.placement = placement;
    const reach = placement.radius * (1 + GLOBE_HALO);
    const left = Math.max(0, Math.floor(placement.x - reach)), top = Math.max(0, Math.floor(placement.y - reach));
    const right = Math.min(placement.viewportWidth, Math.ceil(placement.x + reach)), bottom = Math.min(placement.viewportHeight, Math.ceil(placement.y + reach));
    const width = Math.max(0, right - left), height = Math.max(0, bottom - top), dpr = Math.min(devicePixelRatio || 1, 2);
    Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
    this.canvas.dataset.left = String(left); this.canvas.dataset.top = String(top);
    this.lastDraw = -Infinity;
    if (this.ready) this.draw(performance.now());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void (this.loading ??= this.initialize()).then(() => this.schedule());
  }

  stop(): void { this.running = false; cancelAnimationFrame(this.frame); this.frame = 0; }

  private schedule(): void {
    if (!this.running || !this.ready || this.frame) return;
    const tick = (now: number) => {
      this.frame = 0;
      if (!this.running) return;
      if (now - this.lastDraw >= FRAME_MS) this.draw(now);
      if (!this.reducedMotion.matches) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async initialize(): Promise<void> {
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
    if (!gl) return;
    const image = new Image();
    image.decoding = 'async'; image.src = WORLD_URL;
    let meta: GlobeMeta;
    try { [meta] = await Promise.all([fetch(META_URL).then(response => response.json() as Promise<GlobeMeta>), image.decode()]); } catch { return; }
    const shader = (type: number, source: string) => {
      const result = gl.createShader(type)!;
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'Globe shader failed.');
      return result;
    };
    const program = gl.createProgram()!;
    try {
      gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Globe program failed.');
    } catch (error) { console.warn(error); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner); gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const name of ['uWorld', 'uWorldSize', 'uTexelsPerTile', 'uOceanBlock', 'uOceanOrigin', 'uCenter', 'uRadius', 'uHeight', 'uRotation', 'uFocus', 'uTileAngle', 'uHalo'])
      this.uniforms[name] = gl.getUniformLocation(program, name);
    gl.uniform1i(this.uniforms.uWorld, 0);
    gl.uniform2f(this.uniforms.uWorldSize, image.naturalWidth, image.naturalHeight);
    gl.uniform1f(this.uniforms.uTexelsPerTile, meta.texelsPerTile);
    gl.uniform1f(this.uniforms.uOceanBlock, meta.oceanBlock.tiles * meta.texelsPerTile);
    gl.uniform2f(this.uniforms.uOceanOrigin, meta.oceanBlock.x * meta.texelsPerTile, meta.oceanBlock.y * meta.texelsPerTile);
    gl.uniform2f(this.uniforms.uFocus, meta.focus.x, meta.focus.y);
    gl.uniform1f(this.uniforms.uTileAngle, LAND_ARC / meta.landRadius);
    gl.uniform1f(this.uniforms.uHalo, GLOBE_HALO);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.gl = gl; this.ready = true;
    this.draw(performance.now());
    // Fade in over the backdrop's painted globe once the first frame exists.
    this.canvas.hidden = false;
    requestAnimationFrame(() => this.canvas.classList.add('is-ready'));
  }

  private draw(now: number): void {
    const gl = this.gl, placement = this.placement;
    if (!gl || !placement || !this.canvas.width || !this.canvas.height) return;
    this.lastDraw = now;
    const scale = this.canvas.width / Math.max(1, parseFloat(this.canvas.style.width));
    const left = Number(this.canvas.dataset.left), top = Number(this.canvas.dataset.top);
    const seconds = this.reducedMotion.matches ? 0 : (now - this.epoch) / 1000;
    const yaw = Math.sin(seconds / SWAY_PERIOD_SECONDS * Math.PI * 2) * SWAY_RADIANS;
    // Map frame = base * Ry(yaw); uploaded column-major.
    const c = Math.cos(yaw), s = Math.sin(yaw), b = this.base;
    const rows = [0, 1, 2].map(i => [b[i * 3] * c - b[i * 3 + 2] * s, b[i * 3 + 1], b[i * 3] * s + b[i * 3 + 2] * c]);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uniforms.uCenter, (placement.x - left) * scale, (placement.y - top) * scale);
    gl.uniform1f(this.uniforms.uRadius, placement.radius * scale);
    gl.uniform1f(this.uniforms.uHeight, this.canvas.height);
    gl.uniformMatrix3fv(this.uniforms.uRotation, false, [rows[0][0], rows[1][0], rows[2][0], rows[0][1], rows[1][1], rows[2][1], rows[0][2], rows[1][2], rows[2][2]]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
