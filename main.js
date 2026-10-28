import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.min(1, Math.max(0, x));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const rand = (a, b) => a + Math.random() * (b - a);
// shape params are either a number or a [closed, open] pair
const at = (x, k) => (Array.isArray(x) ? lerp(x[0], x[1], k) : x);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // AO runs per pixel; 1.5 keeps it smooth on laptops
renderer.toneMapping = THREE.NeutralToneMapping; // keeps reds red, ACES drifts them to orange
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
camera.position.set(0, 1.6, 13.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, -1.6, 0);
Object.assign(controls, {
  enableDamping: true, enablePan: false, minDistance: 7, maxDistance: 18,
  minPolarAngle: 0.5, maxPolarAngle: 1.55, autoRotate: !reduceMotion, autoRotateSpeed: 0.4,
});

// soft morning light from a window on the right
const key = new THREE.DirectionalLight(0xfff4e6, 2.8);
key.position.set(4, 7, 3);
key.target.position.set(0, -1.6, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 25 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.01;
key.shadow.radius = 6;
const rim = new THREE.DirectionalLight(0xffe2ee, 1.4);
rim.position.set(-4, 3, -4);
scene.add(key, key.target, rim, new THREE.HemisphereLight(0xffffff, 0xe6d6cc, 0.9));

// ---------- procedural textures ----------
function canvasTexture(w, h, draw) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// fine veins running from the petal claw to its edge (uv space; geometry fans them out)
const petalTex = canvasTexture(256, 512, (g, w, h) => {
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * w;
    g.strokeStyle = `rgba(80,30,40,${rand(0.01, 0.035)})`;
    g.lineWidth = rand(0.5, 1.6);
    g.beginPath();
    g.moveTo(x, h);
    g.bezierCurveTo(x + rand(-6, 6), h * 0.66, x + rand(-8, 8), h * 0.33, x + rand(-10, 10), 0);
    g.stroke();
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.012})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
});

// tulip leaf: parallel veins in uv space; the tapering geometry draws them together at the tip
const leafTex = canvasTexture(256, 512, (g, w, h) => {
  g.fillStyle = '#b8b8b8';
  g.fillRect(0, 0, w, h);
  for (let x = 8; x < w; x += rand(9, 15)) {
    g.strokeStyle = `rgba(255,255,240,${rand(0.12, 0.3)})`;
    g.lineWidth = rand(0.8, 1.6);
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x, 0);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,240,.45)';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(w / 2, h);
  g.lineTo(w / 2, 0);
  g.stroke();
});

// warm ivory wall with a peach glow where the light comes in and a lilac shade opposite
scene.background = canvasTexture(1024, 1024, (g, w, h) => {
  g.fillStyle = '#f6efe7';
  g.fillRect(0, 0, w, h);
  for (const [x, y, r, col] of [[0.8, 0.2, 0.75, 'rgba(255,212,190,.8)'], [0.15, 0.9, 0.7, 'rgba(222,210,245,.75)'], [0.5, 0.5, 0.4, 'rgba(255,255,255,.7)']]) {
    const glow = g.createRadialGradient(w * x, h * y, 0, w * x, h * y, w * r);
    glow.addColorStop(0, col);
    glow.addColorStop(1, 'rgba(246,239,231,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
  }
  // sunlight through a four-pane window, slanted across the wall. The panes are drawn off-canvas so
  // only their blurred shadow lands (shadowBlur works everywhere, ctx.filter does not)
  g.shadowColor = 'rgba(255,253,246,.95)';
  g.shadowBlur = 45;
  g.shadowOffsetX = w * 2;
  g.fillStyle = '#000';
  for (const [x, y] of [[0.66, 0.04], [0.82, 0.04], [0.66, 0.34], [0.82, 0.34]]) {
    g.setTransform(1, 0.1, -0.35, 1, w * x - w * 2, h * y);
    g.fillRect(0, 0, w * 0.145, h * 0.28);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
});

// ---------- GPU-shaped surfaces (petals, sepals, leaves) ----------
// Each instance is a grid bent along a curved midrib (tilt + bend), cupped across its width (curl),
// with rolled-back upper edges, a ruffle and fine crinkles. Shaping on the GPU keeps ~500 animated
// petals smooth; the CPU only writes 8 floats per instance while the bouquet opens.
const SURFACE_GLSL = /* glsl */ `
attribute vec4 aP0; // length, half-width, tilt, bend
attribute vec4 aP1; // curl, edge roll, ruffle, seed
attribute vec4 aP2; // top rounding, notch, profile (0 petal, 1 sepal, 2 leaf), ring (0 heart .. 1 outer)
varying vec4 vPetal;
float surfaceWidth(float v) {
  if (aP2.z < 0.5) return 0.16 + 0.84 * pow(sin(1.5708 * min(1.0, v / 0.7)), 0.8);
  if (aP2.z < 1.5) return pow(max(sin(3.14159 * pow(v, 0.55)), 0.0), 0.9);
  return pow(max(sin(3.14159 * pow(v, 0.75)), 0.0), 0.75) * (1.0 + 0.08 * fract(v * 13.0));
}
vec3 surfacePoint(vec2 q) {
  float L = aP0.x, W = aP0.y, tilt = aP0.z, bend = aP0.w;
  float R = W / max(aP1.x, 1e-3);
  float s = q.x * 2.0 - 1.0, v = q.y, as = abs(s);
  float xf = s * W * surfaceWidth(v);
  float t = v * (1.0 - aP2.x * s * s) * (1.0 - aP2.y * exp(-30.0 * s * s) * pow(v, 8.0));
  float y = 0.0, z = 0.0;
  for (int j = 0; j < 12; j++) {
    float f = (float(j) + 0.5) / 12.0 * t;
    float a = tilt + bend * f * f;
    y += cos(a);
    z += sin(a);
  }
  y *= t * L / 12.0;
  z *= t * L / 12.0;
  float a = tilt + bend * t * t;
  float n = -(1.0 - cos(xf / R)) * R
    + aP1.y * W * smoothstep(0.45, 1.0, v) * pow(as, 2.5)
    + aP1.z * W * sin(s * 7.0 + v * 5.0 + aP1.w) * v * v * v * (0.25 + as)
    + 0.005 * W * sin(s * 19.0 + v * 6.0 + aP1.w) * sin(v * 13.7 - s * 4.0 + aP1.w * 1.3) * v;
  return vec3(sin(xf / R) * R, y - sin(a) * n, z + cos(a) * n);
}
`;
// meshes without the instance attributes read aP0 = 0 and keep their own vertices
// (lets the AO pass draw the whole scene with one patched override material)
const SURFACE_NORMAL = /* glsl */ `
vec3 surfacePos = position;
vec3 objectNormal = normal;
if (aP0.x > 0.0) {
  surfacePos = surfacePoint(uv);
  vec2 qn = clamp(uv, 0.01, 0.99);
  vec3 p0 = surfacePoint(qn);
  objectNormal = normalize(cross(surfacePoint(qn + vec2(0.005, 0.0)) - p0, surfacePoint(qn + vec2(0.0, 0.005)) - p0));
}
vPetal = vec4(uv.x * 2.0 - 1.0, uv.y, aP2.w, aP1.w);
`;

function deform(material, cacheKey, extra) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
      .replace('#include <beginnormal_vertex>', SURFACE_NORMAL)
      .replace('#include <begin_vertex>', 'vec3 transformed = surfacePos;');
    extra?.(shader);
  };
  // closures share one source string, so three needs an explicit key to keep the programs apart
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
depthMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
    .replace('#include <begin_vertex>', 'vec3 transformed = surfacePoint(uv);');
};
depthMat.customProgramCacheKey = () => 'surface-depth';

// four pastel varieties (lilac, apricot, butter, white flamed pink); the variety is the tens digit of
// each petal's seed. Yellow heart inside, green flush outside at the base, a second colour at the rim.
const petalUniforms = {
  uBase: { value: new THREE.Color('#e8c048') }, uGreen: { value: new THREE.Color('#9aa65a') },
  uBody: { value: ['#a46ad0', '#f78e66', '#f5c84a', '#f8eef0'].map(c => new THREE.Color(c)) },
  uEdge: { value: ['#e6cdf7', '#ffd8bc', '#fff3c4', '#e2587c'].map(c => new THREE.Color(c)) },
};
const petalMat = deform(new THREE.MeshPhysicalMaterial({
  map: petalTex, bumpMap: petalTex, bumpScale: 0.08,
  roughness: 0.5, sheen: 0.6, sheenColor: 0xffd9e4, sheenRoughness: 0.4, side: THREE.DoubleSide,
}), 'petal', (shader) => {
  Object.assign(shader.uniforms, petalUniforms);
  shader.fragmentShader = `uniform vec3 uBase, uGreen, uBody[4], uEdge[4];\nvarying vec4 vPetal;\n${shader.fragmentShader}`
    .replace('#include <color_fragment>', `#include <color_fragment>
    {
      float ax = abs(vPetal.x), pv = vPetal.y;
      int hue = int(vPetal.w / 10.0);
      vec3 body = uBody[hue] * mix(0.78, 1.0, smoothstep(0.15, 0.65, pv)); // deeper colour low in the cup
      vec3 col = mix(body, uEdge[hue], 0.6 * smoothstep(0.6, 1.0, max(pv, ax * 0.85)));
      col = mix(gl_FrontFacing ? uGreen : uBase, col, smoothstep(0.03, 0.3, pv)); // front face is the outside
      col *= 0.9 + 0.2 * fract(sin(vPetal.w * 91.7) * 43758.5); // no two petals alike
      if (gl_FrontFacing) col = mix(col, col * 1.2 + 0.01, 0.3); // outer face of a petal is paler
      col *= mix(0.4, 1.0, smoothstep(0.0, 0.5, pv)) * mix(0.75, 1.0, vPetal.z); // baked occlusion in the cup
      diffuseColor.rgb *= col;
    }`)
    // thin petals: key/rim light hitting the far side scatters through to the viewer
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      float through = saturate( dot( -geometryNormal, directionalLights[ i ].direction ) );
      reflectedLight.directDiffuse += material.diffuseColor * directionalLights[ i ].color * through * 0.45;
    }
    #endif`);
});
// tulip foliage is a waxy blue-green
const greenMat = deform(new THREE.MeshPhysicalMaterial({
  color: 0x4b6f40, map: leafTex, bumpMap: leafTex, bumpScale: 1.2,
  roughness: 0.55, sheen: 0.35, sheenColor: 0xa8c4b4, side: THREE.DoubleSide,
}), 'green');
const stemMat = new THREE.MeshPhysicalMaterial({ color: 0x3f5e2e, roughness: 0.5, clearcoat: 0.2 });
const antherMat = new THREE.MeshPhysicalMaterial({ color: 0x2a1a24, roughness: 0.7 });
const pistilMat = new THREE.MeshPhysicalMaterial({ color: 0xd8d49a, roughness: 0.6 });
// single-sided and no depth write, so neither its own back wall nor the water get hidden behind it
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transmission: 1, thickness: 0.3, roughness: 0.04, ior: 1.5,
  depthWrite: false,
});
const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0xcfeee6, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false,
});

// ---------- bouquet layout ----------
const bouquet = new THREE.Group();
scene.add(bouquet);
const DOME_C = V(0, -1.35, 0), DOME_R = 1.45; // tulip heads sit on a dome around this centre
const VASE_Y = -3.9; // the table top
const NECK = V(0, -2.05, 0); // stems cross here, just inside the vase mouth

// matrix whose local +Y is `up` and local +Z leans towards `out`
function frame(pos, up, out, scale) {
  const y = up.clone().normalize();
  const x = new THREE.Vector3().crossVectors(y, out).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).scale(V(scale, scale, scale)).setPosition(pos);
}
// uniform-area direction on a spherical cap around +Y
function capDir(f, phi, maxTheta) {
  const th = Math.acos(1 - f * (1 - Math.cos(maxTheta)));
  return V(Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi));
}

const tulips = [], petalItems = [], greenItems = [], receptacles = [], stamens = [], pistils = [];

// six tepals: three outer ones wrapped around three inner ones. Closed they bend inward into an
// egg-shaped bud; open they lean out into a cup. Outer tepals open first so the inner ring stays inside.
function addTulip(m, open, delay, hue) {
  const tulip = { m, open, delay, o: 0 };
  tulips.push(tulip);
  const turn = rand(0, Math.PI * 2);
  for (let i = 0; i < 6; i++) {
    const outer = i % 2 === 0;
    const phi = turn + (i / 6) * Math.PI * 2 + rand(-0.05, 0.05);
    const r = outer ? 0.07 : 0.035;
    const L = (outer ? 1 : 0.94) * rand(0.96, 1.04);
    const local = new THREE.Matrix4().makeRotationY(phi).setPosition(Math.sin(phi) * r, 0, Math.cos(phi) * r);
    petalItems.push({
      flower: tulip, matrix: m.clone().multiply(local), start: outer ? 0 : 0.1, span: 0.9,
      L: [L * 0.88, L], W: L * (outer ? 0.34 : 0.31),
      tilt: outer ? [0.5, 0.52 + rand(-0.05, 0.05)] : [0.42, 0.44],
      bend: outer ? [-1.2, 0.2] : [-1.1, -0.05],
      curl: outer ? [1.15, 0.95] : [1.25, 1.15],
      roll: [0, outer ? 0.12 : 0.06],
      ruffle: 0.02, seed: hue * 10 + rand(0, 9.9), round: 0.5, notch: 0, profile: 0, ring: outer ? 1 : 0.6,
    });
  }
  // six dark anthers around a pale pistil; only seen once the cup opens
  for (let i = 0; i < 6; i++) {
    const a = turn + (i / 6) * Math.PI * 2;
    stamens.push(m.clone().multiply(frame(V(Math.sin(a) * 0.04, 0.02, Math.cos(a) * 0.04), V(Math.sin(a) * 0.2, 1, Math.cos(a) * 0.2), V(Math.sin(a), 0, Math.cos(a)), 1)));
  }
  pistils.push(m);
  // swollen stem tip that closes the base of the cup
  receptacles.push(m.clone().multiply(new THREE.Matrix4().makeScale(0.55, 0.4, 0.55)));
}

// long arching strap leaves, channelled down the middle
function tulipLeaf(pos, up, out, scale) {
  greenItems.push({
    flower: null, matrix: frame(pos, up, out, scale),
    L: 1.5, W: 0.2, tilt: rand(0.1, 0.3), bend: rand(0.5, 0.9), curl: 1, roll: 0,
    ruffle: 0.03, seed: rand(0, 100), round: 0, notch: 0, profile: 2, ring: 1,
  });
}

const TULIPS = 15;
for (let i = 0; i < TULIPS; i++) {
  const dir = capDir((i + 0.5) / TULIPS, i * 2.39996, 0.8);
  dir.x += rand(-0.04, 0.04);
  dir.z += rand(-0.04, 0.04);
  dir.normalize();
  const a = rand(0, Math.PI * 2);
  addTulip(
    frame(DOME_C.clone().addScaledVector(dir, DOME_R + rand(-0.12, 0.12)), dir, V(Math.cos(a), 0, Math.sin(a)), rand(0.55, 0.6)),
    rand(0.6, 1), // some stay half-open buds
    0.3 + Math.acos(dir.y) * 2.2 + rand(0, 0.5), // centre opens first, then the rings around it
    i % 4,
  );
}

// leaves rise out of the vase mouth and arch over its rim
for (let i = 0; i < 9; i++) {
  const phi = (i / 9) * Math.PI * 2 + rand(-0.25, 0.25);
  const out = V(Math.cos(phi), 0, Math.sin(phi));
  tulipLeaf(NECK.clone().addScaledVector(out, 0.28), V(out.x * rand(0.25, 0.45), 1, out.z * rand(0.25, 0.45)), out, rand(0.8, 1));
}

function instanced(geo, material, items) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  for (const name of ['aP0', 'aP1', 'aP2']) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
  }
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    geo.attributes.aP2.setXYZW(i, it.round, it.notch, it.profile, it.ring);
  });
  mesh.customDepthMaterial = depthMat;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // vertices are placed in the shader
  bouquet.add(mesh);
  return { geo, items };
}
const surfaceGroups = [
  instanced(new THREE.PlaneGeometry(1, 1, 24, 32), petalMat, petalItems),
  instanced(new THREE.PlaneGeometry(1, 1, 10, 64), greenMat, greenItems),
];

function updateShapes() {
  for (const { geo, items } of surfaceGroups) {
    const a0 = geo.attributes.aP0, a1 = geo.attributes.aP1;
    items.forEach((it, i) => {
      const k = it.flower ? ease(clamp01((it.flower.o - it.start) / it.span)) : 1;
      a0.setXYZW(i, at(it.L, k), at(it.W, k), at(it.tilt, k), at(it.bend, k));
      a1.setXYZW(i, at(it.curl, k), at(it.roll, k), it.ruffle, it.seed);
    });
    a0.needsUpdate = a1.needsUpdate = true;
  }
}

function instancedParts(geo, material, matrices) {
  const mesh = new THREE.InstancedMesh(geo, material, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.castShadow = mesh.receiveShadow = true;
  bouquet.add(mesh);
}
instancedParts(new THREE.SphereGeometry(0.15, 24, 16), stemMat, receptacles);
instancedParts(mergeGeometries([ // filament + anther
  new THREE.CylinderGeometry(0.01, 0.014, 0.22, 6).translate(0, 0.11, 0),
  new THREE.CapsuleGeometry(0.022, 0.09, 4, 8).translate(0, 0.27, 0),
]), antherMat, stamens);
instancedParts(mergeGeometries([ // column + three-lobed stigma
  new THREE.CylinderGeometry(0.035, 0.045, 0.24, 12).translate(0, 0.12, 0),
  new THREE.SphereGeometry(0.06, 12, 8).scale(1, 0.5, 1).translate(0, 0.25, 0),
]), pistilMat, pistils);

// stems run back from each head, cross in the vase mouth, then splay out across its floor
const stems = new THREE.Mesh(mergeGeometries(tulips.map(({ m }) => {
  const a = rand(0, Math.PI * 2);
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    V(0, 0, 0).applyMatrix4(m), V(0, -1, 0).applyMatrix4(m),
    NECK.clone().add(V(rand(-0.18, 0.18), 0, rand(-0.18, 0.18))), V(Math.cos(a) * 0.35, VASE_Y + 0.08, Math.sin(a) * 0.35),
  ]), 64, 0.03, 8);
})), stemMat);
stems.castShadow = stems.receiveShadow = true;
bouquet.add(stems);

// bubble vase: a lathed glass shell (outer wall up, inner wall back down) with water in its belly
const vaseOutline = new THREE.SplineCurve([[0.5, 0], [0.8, 0.35], [0.93, 0.8], [0.85, 1.25], [0.56, 1.62], [0.43, 1.88], [0.48, 2]]
  .map(([x, y]) => new THREE.Vector2(x, y))).getPoints(64);
const WALL = 0.035, WATER = 0.95;
const vase = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(0, 0), ...vaseOutline,
  ...[...vaseOutline].reverse().map(p => new THREE.Vector2(p.x - WALL, Math.max(p.y, WALL))), new THREE.Vector2(0, WALL),
], 96).translate(0, VASE_Y, 0), glassMat);
const waterSide = vaseOutline.filter(p => p.y > WALL && p.y < WATER).map(p => new THREE.Vector2(p.x - WALL - 0.005, p.y));
const water = new THREE.Mesh(new THREE.LatheGeometry([
  new THREE.Vector2(0, WALL), ...waterSide, new THREE.Vector2(0, waterSide.at(-1).y),
], 96).translate(0, VASE_Y, 0), waterMat);
water.renderOrder = 1;

// the table itself stays invisible; it only catches the shadow
const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
table.position.y = VASE_Y;
table.receiveShadow = true;
scene.add(vase, water, table);

// light focused by the water: a warm bright patch inside the vase's shadow, stretched away from the sun
const caustic = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
  map: canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,240,205,1)');
    grd.addColorStop(1, 'rgba(255,240,205,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }),
  transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending,
}));
caustic.position.set(-0.7, VASE_Y + 0.003, -0.52);
caustic.rotation.y = -Math.atan2(3, 4); // along the key light's direction across the table
caustic.renderOrder = 2;
scene.add(caustic);

// a folded note propped on the table beside the vase
function drawNote(g, w, h) {
  g.fillStyle = '#fffaf4';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(120,90,70,${Math.random() * 0.04})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.strokeStyle = 'rgba(178,80,122,.4)';
  g.lineWidth = 3;
  g.strokeRect(36, 36, w - 72, h - 72);
  g.textAlign = 'center';
  g.fillStyle = '#6a2445';
  g.font = '700 150px "Dancing Script", cursive';
  g.fillText('Para ti, Natali', w / 2, h * 0.52);
  g.fillStyle = '#8a4a68';
  g.font = '700 66px "Dancing Script", cursive';
  g.fillText('con todo mi cariño ♡', w / 2, h * 0.77);
}
const noteTex = canvasTexture(1024, 640, drawNote);
// the script font arrives after the first frame; redraw once it is there
document.fonts.load('700 150px "Dancing Script"').then(() => {
  drawNote(noteTex.image.getContext('2d'), 1024, 640);
  noteTex.needsUpdate = true;
});
const CARD_W = 1.2, CARD_H = 0.76, LEAN = 0.32;
const note = new THREE.Group();
for (const [lean, mat] of [
  [-LEAN, new THREE.MeshPhysicalMaterial({ map: noteTex, roughness: 0.85 })],
  [LEAN, new THREE.MeshPhysicalMaterial({ color: 0xfffaf4, roughness: 0.85, side: THREE.DoubleSide })],
]) {
  // each half hangs from the fold at the top; the front half leans towards the viewer
  const half = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H).translate(0, -CARD_H / 2, 0), mat);
  half.position.y = CARD_H * Math.cos(LEAN);
  half.rotation.x = lean;
  half.castShadow = half.receiveShadow = true;
  note.add(half);
}
note.position.set(1.6, VASE_Y, 0.4);
note.rotation.y = -0.25;
scene.add(note);

// a few loose petals drifting down through the light, kept clear of the bouquet
const DRIFT = reduceMotion ? 0 : 14;
const driftGeo = new THREE.CircleGeometry(1, 20).scale(0.075, 0.11, 1); // oval petal
const dpos = driftGeo.attributes.position;
for (let i = 0; i < dpos.count; i++) dpos.setZ(i, -9 * dpos.getX(i) ** 2 + 0.03 * dpos.getY(i) / 0.11); // cupped, tip curling back
driftGeo.computeVertexNormals();
const drift = new THREE.InstancedMesh(driftGeo, new THREE.MeshPhysicalMaterial({
  roughness: 0.6, sheen: 0.5, sheenColor: 0xffffff, side: THREE.DoubleSide,
}), DRIFT);
const spawnX = () => (Math.random() < 0.5 ? -1 : 1) * rand(1.4, 4.5);
const drifters = Array.from({ length: DRIFT }, (_, i) => {
  drift.setColorAt(i, petalUniforms.uBody.value[i % 4].clone().lerp(petalUniforms.uEdge.value[i % 4], 0.5));
  return { p: V(spawnX(), rand(-3.5, 2.5), rand(-3, 2)), fall: rand(0.12, 0.25), spin: V(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5)), phase: rand(0, 6) };
});
scene.add(drift);
const dMat = new THREE.Matrix4(), dQuat = new THREE.Quaternion(), dEuler = new THREE.Euler(), dPos = V(0, 0, 0), ONE = V(1, 1, 1);
function updateDrift(t, dt) {
  drifters.forEach((d, i) => {
    d.p.y -= d.fall * dt;
    if (d.p.y < VASE_Y) d.p.set(spawnX(), 2.8, rand(-3, 2));
    dPos.set(d.p.x + Math.sin(t * 0.6 + d.phase) * 0.35, d.p.y, d.p.z);
    dEuler.set(t * d.spin.x + d.phase, t * d.spin.y, t * d.spin.z);
    drift.setMatrixAt(i, dMat.compose(dPos, dQuat.setFromEuler(dEuler), ONE));
  });
  drift.instanceMatrix.needsUpdate = true;
}

// ---------- bloom ----------
const TULIP_BLOOM = 7; // seconds per tulip; delays stagger them across ~10 s
let bloomStart = performance.now() + 600;
let lastSum = -1, lastT = 0;
document.getElementById('replay').addEventListener('click', () => { if (!reduceMotion) bloomStart = performance.now(); });
const bloomEl = document.getElementById('bloom');
document.getElementById('flower-count').textContent = tulips.length;
document.getElementById('petal-count').textContent = petalItems.length;

// ambient occlusion darkens the creases between petals and flowers; its normal/depth pass gets the
// same vertex shaping, otherwise it would see the petals as flat quads
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
const gtao = new GTAOPass(scene, camera, 1, 1);
deform(gtao.normalMaterial, 'surface-normal').side = THREE.DoubleSide;
gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1, thickness: 1, scale: 1.0, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(gtao);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = aspect;
  camera.zoom = Math.min(1, aspect * 1.3);
  // vase sits centred between the title above and the button below
  camera.setViewOffset(w, h, 0, -h * 0.04, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
updateShapes();
console.assert(surfaceGroups.every(({ geo }) => geo.attributes.aP0.array.every(Number.isFinite)), 'surface params have NaN');

renderer.setAnimationLoop((now) => {
  const elapsed = reduceMotion ? Infinity : (now - bloomStart) / 1000;
  let sum = 0;
  for (const r of tulips) {
    const p = ease(clamp01((elapsed - r.delay) / TULIP_BLOOM));
    r.o = r.open * p;
    sum += p;
  }
  if (sum !== lastSum) {
    lastSum = sum;
    updateShapes();
    bloomEl.textContent = `${Math.round((sum / tulips.length) * 100)}%`;
  }
  const t = now / 1000;
  updateDrift(t, Math.min(0.05, t - lastT)); // clamp so a background tab doesn't drop them all at once
  lastT = t;
  controls.update();
  composer.render();
});
