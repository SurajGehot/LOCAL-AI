// SpaceEngine.ts file

import * as THREE from "three";
type Palette = {
  primary: THREE.Color;
  secondary: THREE.Color;
  accent: THREE.Color;
  hot: THREE.Color;
};

type NebulaData = {
  position: THREE.Vector3;
  scale: THREE.Vector2;
  rotation: number;
  seed: number;
  depth: number;
  intensity: number;
};

/* ------------------------------------------------------------------ *
 * Interaction tuning — everything cinematic lives here.
 * ------------------------------------------------------------------ */

// Mouse disturbance
const MOUSE_ACTIVE_WINDOW = 1.8; // seconds after the last move before things relax
const MOUSE_RISE_RATE = 2.4; // how softly the disturbance builds
const MOUSE_FALL_RATE = 0.9; // how slowly everything settles back
const MOUSE_FOLLOW_RATE = 3.0; // how lazily the repel point follows the cursor

// Beam
const BEAM_SPEED = 78; // cruise speed, world units / second
const BEAM_EASE = 0.4; // seconds to reach cruise speed (soft launch)
const BEAM_LIFE = 2.2; // seconds. Also the cooldown: one shot at a time.
const BEAM_LENGTH = 30; // visual length of the streak
const BEAM_TARGET_DISTANCE = 95; // distance along the click ray the beam aims through

// Shockwave
const MAX_SHOCKS = 3; // overlapping waves allowed (older waves keep fading)
const SHOCK_LIFE = 6; // seconds before a wave is fully retired
const SHOCK_STRENGTH = 9; // world-unit push at full amplitude

// Sparkles trailing the beam
const SPARKLE_COUNT = 160;
const SPARKLE_RATE = 50; // per second while the beam is flying

const shockHeadDistance = (t: number): number =>
  BEAM_SPEED * (t - BEAM_EASE * (1 - Math.exp(-t / BEAM_EASE)));

/* ------------------------------------------------------------------ *
 * Shared GLSL chunks
 * ------------------------------------------------------------------ */

// Pushes things on screen away from the (smoothed) cursor. Only reaches
// distant objects (viewDist ramps in), and falls off smoothly with radius.
const MOUSE_GLSL = /* glsl */ `
uniform vec2 uMouse;
uniform float uInfluence;
uniform float uAspect;

vec2 mouseRepelOffset(vec2 ndc, float viewDist, float radius) {
  if (uInfluence < 0.001) return vec2(0.0);

  vec2 d = (ndc - uMouse) * vec2(uAspect, 1.0);
  float dist = length(d);

  float falloff = 1.0 - smoothstep(0.0, radius, dist);
  falloff *= falloff;

  float far = smoothstep(35.0, 120.0, viewDist);
  float centre = smoothstep(0.0, 0.07, dist);

  vec2 dir = d / max(dist, 0.0001);
  vec2 off = dir * falloff * far * centre * uInfluence * 0.075;

  return vec2(off.x / uAspect, off.y);
}
`;

// A cone-shaped shock front trailing the beam head. Everything near the
// beam path is pushed radially away from the beam axis, the ring widens and
// weakens as it travels outward. Returns (displacement.xyz, energy).
const SHOCK_GLSL = /* glsl */ `
uniform vec3 uShockOrigin[${MAX_SHOCKS}];
uniform vec3 uShockDir[${MAX_SHOCKS}];
uniform vec4 uShockState[${MAX_SHOCKS}]; // x age, y head distance, z strength, w active

vec4 shockField(vec3 wp) {
  vec3 total = vec3(0.0);
  float energy = 0.0;

  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShockState[i];
    if (s.w < 0.5) continue;

    vec3 r = wp - uShockOrigin[i];
    float along = dot(r, uShockDir[i]);
    vec3 perp = r - uShockDir[i] * along;
    float dist = length(perp);

    float behind = s.y - along;
    float lead = smoothstep(-8.0, 2.0, behind);

    float ringR = max(behind, 0.0) * 0.30;
    float width = 5.0 + ringR * 0.5;
    float x = (dist - ringR) / width;
    float ring = exp(-x * x);

    float decay = exp(-s.x * 0.62) / (1.0 + ringR * 0.045);
    float amp = ring * lead * decay;

    vec3 pdir = perp / max(dist, 0.001);
    total += (pdir + uShockDir[i] * 0.12) * amp * s.z;
    energy = max(energy, amp);
  }

  return vec4(total, energy);
}
`;

class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state =
      (this.state * 1664525 + 1013904223) >>> 0;

    return this.state / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(array: T[]): T {
    return array[
      Math.floor(this.next() * array.length)
    ];
  }
}

export class SpaceEngine {
  private container: HTMLElement;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;

  private universeRoot!: THREE.Group;
  private starSystem!: THREE.Group;
  private dustSystem!: THREE.Group;
  private nebulaSystem!: THREE.Group;
  private eventSystem!: THREE.Group;
  private fxSystem!: THREE.Group;

  private starMaterials: THREE.ShaderMaterial[] = [];
  private dustMaterials: THREE.ShaderMaterial[] = [];
  private nebulaMaterials: THREE.ShaderMaterial[] = [];

  private nebulaObjects: THREE.Object3D[] = [];

  private clock = new THREE.Clock();

  private animationFrame = 0;
  private resizeObserver?: ResizeObserver;

  private destroyed = false;
  private visible = false;

  private seed = 1;
  private random = new Random(this.seed);

  private pointer = new THREE.Vector2();
  private smoothPointer = new THREE.Vector2();

  private cameraTarget = new THREE.Vector3();
  private cameraVelocity = new THREE.Vector3();
  private cameraDelta = new THREE.Vector3();

  private eventTimer = 0;

  // Avoid repeating the same palette on consecutive departures.
  private previousPaletteIndex = -1;
  private previousFrameTime = 0;
  private readonly cameraLookTarget = new THREE.Vector3(0, 0, -60);
  private readonly cameraLookDesired = new THREE.Vector3();

  private shootingStars: {
    line: THREE.Line;
    velocity: THREE.Vector3;
    life: number;
    maxLife: number;
  }[] = [];

  /* ---------------- interaction state ---------------- */

  // Uniform objects shared by every material that reacts to the mouse / shockwave.
  private readonly fx = {
    uMouse: { value: new THREE.Vector2() },
    uInfluence: { value: 0 },
    uAspect: { value: 1 },
    uShockOrigin: {
      value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector3()),
    },
    uShockDir: {
      value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector3(0, 0, -1)),
    },
    uShockState: {
      value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4()),
    },
  };

  private repelPointer = new THREE.Vector2();
  private pointerIdle = 99;
  private influence = 0;

  private shotCooldown = 0;
  private shockCursor = 0;

  private beamMesh!: THREE.Mesh;
  private beamMaterial!: THREE.ShaderMaterial;
  private beamActive = false;
  private beamAge = 0;
  private readonly beamOrigin = new THREE.Vector3();
  private readonly beamDir = new THREE.Vector3(0, 0, -1);
  private readonly beamHead = new THREE.Vector3();

  private sparkles!: THREE.Points;
  private sparkleMaterial!: THREE.ShaderMaterial;
  private sparklePositions = new Float32Array(SPARKLE_COUNT * 3);
  private sparkleVelocities = new Float32Array(SPARKLE_COUNT * 3);
  private sparkleAges = new Float32Array(SPARKLE_COUNT).fill(1);
  private sparkleSizes = new Float32Array(SPARKLE_COUNT);
  private sparkleLife = new Float32Array(SPARKLE_COUNT).fill(1);
  private sparkleCursor = 0;
  private sparkleCarry = 0;

  constructor(container: HTMLElement) {
    this.container = container;
  }


  create(): void {
    if (this.destroyed || this.renderer) {
      return;
    }

    this.createRenderer();
    this.createScene();
    this.createCamera();

    this.universeRoot = new THREE.Group();

    this.starSystem = new THREE.Group();
    this.dustSystem = new THREE.Group();
    this.nebulaSystem = new THREE.Group();
    this.eventSystem = new THREE.Group();

    this.universeRoot.add(this.nebulaSystem);
    this.universeRoot.add(this.starSystem);
    this.universeRoot.add(this.dustSystem);
    this.universeRoot.add(this.eventSystem);

    this.scene.add(this.universeRoot);

    this.createFx();

    this.installPointer();
    this.installResizeObserver();

    this.newUniverse();
    this.setVisible(false);
  }


  private createRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
    });

    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      1.25
    );

    this.renderer.setPixelRatio(pixelRatio);

    this.renderer.setSize(
      this.container.clientWidth || window.innerWidth,
      this.container.clientHeight || window.innerHeight,
      false
    );

    this.renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    this.renderer.toneMapping =
      THREE.ACESFilmicToneMapping;

    this.renderer.toneMappingExposure = 0.95;

    this.renderer.domElement.style.position =
      "absolute";

    this.renderer.domElement.style.inset = "0";

    this.renderer.domElement.style.width =
      "100%";

    this.renderer.domElement.style.height =
      "100%";

    this.renderer.domElement.style.display =
      "block";

    this.container.appendChild(
      this.renderer.domElement
    );
  }

  private createScene(): void {
    this.scene = new THREE.Scene();

    this.scene.background =
      new THREE.Color(0x000004);

    this.scene.fog = new THREE.FogExp2(
      0x03030b,
      0.0018
    );
  }

  private createCamera(): void {
    const width =
      this.container.clientWidth ||
      window.innerWidth;

    const height =
      this.container.clientHeight ||
      window.innerHeight;

    this.camera =
      new THREE.PerspectiveCamera(
        68,
        width / height,
        0.1,
        400
      );

    this.camera.position.set(0, 0, 7);

    this.camera.lookAt(0, 0, -60);

    this.fx.uAspect.value = width / height;
  }

  private generateSeed(): number {
    const now = Date.now() >>> 0;

    const random =
      Math.floor(Math.random() * 0xffffffff) >>> 0;

    return (
      now ^
      random ^
      ((now << 13) >>> 0) ^
      ((now >>> 17) >>> 0)
    ) >>> 0;
  }

  newUniverse(): void {
    this.seed = this.generateSeed();

    this.random = new Random(this.seed);

    this.clearUniverse();
    this.resetFx();

    const palette = this.generatePalette();

    this.createStars();
    this.createDust();
    this.createNebulae(palette);

    this.eventTimer = this.random.range(2.0, 7.0);

    console.log("Universe generated:", this.seed);
  }

  private clearUniverse(): void {
    this.disposeGroup(this.starSystem);
    this.disposeGroup(this.dustSystem);
    this.disposeGroup(this.nebulaSystem);
    this.disposeGroup(this.eventSystem);

    this.starMaterials = [];
    this.dustMaterials = [];
    this.nebulaMaterials = [];
    this.nebulaObjects = [];
    this.shootingStars = [];
  }

  private disposeGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
      const object = group.children.pop();

      if (!object) {
        continue;
      }

      object.traverse((child) => {
        const mesh = child as THREE.Mesh;

        if (mesh.geometry) {
          mesh.geometry.dispose();
        }

        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) =>
              material.dispose()
            );
          } else {
            mesh.material.dispose();
          }
        }
      });
    }
  }

  // Each universe gets a distinct colour family; nearby hues are blended
  // inside the nebula shader rather than increasing glow or alpha.
  private generatePalette(): Palette {
    const families = [
      ["#1fae9c", "#8a2a3c", "#f4d9a0", "#e8895a"],
      ["#3d6fc9", "#6a3f9e", "#bcd6f2", "#e08a4f"],
      ["#c98f2f", "#8c2626", "#f2e2ab", "#e0673f"],
      ["#3f9e73", "#a3455f", "#e8dba8", "#d97a4f"],
      ["#2fa6c9", "#b5652f", "#cdeaf5", "#e0503f"],
      ["#5a4fae", "#a3397e", "#d8c9f2", "#e0724f"],
      ["#3f7fa6", "#b5502f", "#e6d6b8", "#e08a3f"],
      ["#348cbb", "#7b63bb", "#b4e5dc", "#dca36b"],
      ["#658d48", "#396f89", "#c6d6a2", "#dc9368"],
      ["#a365b1", "#397e9e", "#e2c6ed", "#dba36a"],
      ["#b18b42", "#4b74b1", "#e5d8b0", "#cb7897"],
      ["#477f92", "#9068a8", "#c6e1e3", "#e2a576"],
    ];

    let index = this.random.int(0, families.length - 1);
    if (index === this.previousPaletteIndex) {
      index = (index + this.random.int(1, families.length - 1)) % families.length;
    }
    this.previousPaletteIndex = index;

    const [primary, secondary, accent, hot] = families[index];
    const tint = (hex: string) => {
      const color = new THREE.Color(hex);
      const hsl = { h: 0, s: 0, l: 0 };
      color.getHSL(hsl);
      color.setHSL(
        (hsl.h + this.random.range(-0.025, 0.025) + 1) % 1,
        THREE.MathUtils.clamp(hsl.s * this.random.range(0.88, 1.06), 0, 0.78),
        THREE.MathUtils.clamp(hsl.l * this.random.range(0.92, 1.07), 0.12, 0.78)
      );
      return color;
    };

    return {
      primary: tint(primary),
      secondary: tint(secondary),
      accent: tint(accent),
      hot: tint(hot),
    };
  }

  private createStars(): void {
    const populations = [
      {
        count: this.random.int(1800, 2400),
        depth: 190,
        spread: 150,
        speedMin: 0.5,
        speedMax: 1.65,
        sizeMin: 0.35,
        sizeMax: 1.15,
        brightnessMin: 0.4,
        brightnessMax: 0.78,
      },

      {
        count: this.random.int(900, 1300),
        depth: 150,
        spread: 115,
        speedMin: 1.1,
        speedMax: 2.9,
        sizeMin: 0.5,
        sizeMax: 1.45,
        brightnessMin: 0.48,
        brightnessMax: 0.95,
      },

      {
        count: this.random.int(250, 450),
        depth: 110,
        spread: 90,
        speedMin: 2.0,
        speedMax: 4.2,
        sizeMin: 0.8,
        sizeMax: 2.3,
        brightnessMin: 0.6,
        brightnessMax: 1.15,
      },
    ];

    populations.forEach((population, layerIndex) => {
      const count = population.count;

      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const brightness = new Float32Array(count);
      const speeds = new Float32Array(count);
      const phases = new Float32Array(count);
      const randoms = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const radial = Math.pow(this.random.next(), 0.58);
        const angle = this.random.range(0, Math.PI * 2);
        const spiral =
          angle + radial * 2.4 + this.random.range(-0.5, 0.5);

        const x =
          Math.cos(spiral) *
          radial *
          population.spread *
          this.random.range(0.55, 1.15);

        const y =
          Math.sin(spiral) *
          radial *
          population.spread *
          this.random.range(0.55, 1.15);

        const z = -this.random.range(8, population.depth);

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        sizes[i] = this.random.range(
          population.sizeMin,
          population.sizeMax
        );

        brightness[i] = this.random.range(
          population.brightnessMin,
          population.brightnessMax
        );

        speeds[i] = this.random.range(
          population.speedMin,
          population.speedMax
        );

        phases[i] = this.random.range(0, Math.PI * 2);
        randoms[i] = this.random.next();
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      geometry.setAttribute(
        "aSize",
        new THREE.BufferAttribute(sizes, 1)
      );
      geometry.setAttribute(
        "aBrightness",
        new THREE.BufferAttribute(brightness, 1)
      );
      geometry.setAttribute(
        "aSpeed",
        new THREE.BufferAttribute(speeds, 1)
      );
      geometry.setAttribute(
        "aPhase",
        new THREE.BufferAttribute(phases, 1)
      );
      geometry.setAttribute(
        "aRandom",
        new THREE.BufferAttribute(randoms, 1)
      );

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,

        uniforms: {
          uTime: { value: 0 },
          uDepth: { value: population.depth },
          uPixelRatio: {
            value: Math.min(window.devicePixelRatio || 1, 1.25),
          },
          ...this.fx,
        },

        vertexShader: `
          ${MOUSE_GLSL}
          ${SHOCK_GLSL}

          attribute float aSize;
          attribute float aBrightness;
          attribute float aSpeed;
          attribute float aPhase;
          attribute float aRandom;

          varying float vBrightness;
          varying float vRandom;

          uniform float uTime;
          uniform float uDepth;
          uniform float uPixelRatio;

          void main() {
            vec3 p = position;

            float travel = mod(uTime * aSpeed, uDepth);
            p.z += travel;

            if (p.z > 4.0) {
              p.z -= uDepth;
            }

            p.x += sin(uTime * 0.08 + aPhase) * 0.045;
            p.y += cos(uTime * 0.07 + aPhase * 1.7) * 0.045;

            // Beam shockwave pushes stars away from its path (world space).
            vec4 world = modelMatrix * vec4(p, 1.0);
            world.xyz += shockField(world.xyz).xyz;

            vec4 mvPosition = viewMatrix * world;
            vec4 clip = projectionMatrix * mvPosition;

            // Cursor gently parts the farthest stars (screen space).
            if (clip.w > 0.1) {
              clip.xy += mouseRepelOffset(clip.xy / clip.w, -mvPosition.z, 0.62) * clip.w;
            }

            float depth = 260.0 / max(18.0, -mvPosition.z);

            float twinkle =
              0.90 + 0.10 * sin(uTime * (0.6 + aSpeed * 0.35) + aPhase);

            gl_PointSize = aSize * depth * uPixelRatio * twinkle;
            gl_Position = clip;

            vBrightness = aBrightness * twinkle;
            vRandom = aRandom;
          }
        `,

        fragmentShader: `
          varying float vBrightness;
          varying float vRandom;

          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float distanceFromCenter = length(uv);

            if (distanceFromCenter > 0.5) {
              discard;
            }

            float core =
              1.0 - smoothstep(0.0, 0.16, distanceFromCenter);

            float glow =
              1.0 - smoothstep(0.05, 0.5, distanceFromCenter);

            vec3 color = vec3(0.96, 0.98, 1.0);
            color *= 0.7 + core * 1.6;

            float alpha = glow * vBrightness;

            gl_FragColor = vec4(color, alpha);
          }
        `,
      });

      const stars = new THREE.Points(geometry, material);
      stars.frustumCulled = false;

      this.starSystem.add(stars);
      this.starMaterials.push(material);

      if (layerIndex === 2) {
        this.createBrightStars(population);
      }
    });

    this.createStarClusters();
  }

  private createBrightStars(
    population: { depth: number; spread: number }
  ): void {
    const count = this.random.int(35, 70);

    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.random.range(
        -population.spread,
        population.spread
      );

      positions[i * 3 + 1] = this.random.range(
        -population.spread,
        population.spread
      );

      positions[i * 3 + 2] = -this.random.range(
        15,
        population.depth
      );

      sizes[i] = this.random.range(2.0, 4.4);
      phases[i] = this.random.range(0, Math.PI * 2);
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(phases, 1)
    );

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,

      uniforms: {
        uTime: { value: 0 },
        ...this.fx,
      },

      vertexShader: `
        ${MOUSE_GLSL}
        ${SHOCK_GLSL}

        attribute float aSize;
        attribute float aPhase;

        uniform float uTime;

        varying float vPulse;

        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          world.xyz += shockField(world.xyz).xyz;

          vec4 mv = viewMatrix * world;
          vec4 clip = projectionMatrix * mv;

          if (clip.w > 0.1) {
            clip.xy += mouseRepelOffset(clip.xy / clip.w, -mv.z, 0.62) * clip.w;
          }

          float pulse = 0.88 + 0.12 * sin(uTime * 0.7 + aPhase);

          gl_PointSize =
            aSize * (180.0 / max(25.0, -mv.z)) * pulse;

          gl_Position = clip;

          vPulse = pulse;
        }
      `,

      fragmentShader: `
        varying float vPulse;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);

          if (d > 0.5) {
            discard;
          }

          float core = 1.0 - smoothstep(0.0, 0.08, d);
          float glow = 1.0 - smoothstep(0.04, 0.5, d);

          vec3 color = vec3(1.0, 1.0, 1.0);
          color *= 0.75 + core * 2.2;

          gl_FragColor = vec4(color, glow * vPulse * 0.85);
        }
      `,
    });

    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;

    this.starSystem.add(stars);
    this.starMaterials.push(material);
  }

  private createStarClusters(): void {
    const clusterCount = this.random.int(4, 8);

    for (let c = 0; c < clusterCount; c++) {
      const center = new THREE.Vector3(
        this.random.range(-75, 75),
        this.random.range(-50, 50),
        -this.random.range(55, 150)
      );

      const count = this.random.int(70, 150);
      const positions = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        const radius =
          Math.pow(this.random.next(), 1.8) *
          this.random.range(3, 13);

        const angle = this.random.range(0, Math.PI * 2);

        positions[i * 3] = center.x + Math.cos(angle) * radius;
        positions[i * 3 + 1] = center.y + Math.sin(angle) * radius;
        positions[i * 3 + 2] = center.z + this.random.range(-5, 5);
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );

      const material = new THREE.PointsMaterial({
        size: this.random.range(0.3, 0.65),
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: this.random.range(0.25, 0.6),
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      // Clusters use the stock points material, so the same interaction
      // is injected into its vertex shader.
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.fx);

        shader.vertexShader = shader.vertexShader
          .replace(
            "void main() {",
            `${MOUSE_GLSL}\n${SHOCK_GLSL}\nvoid main() {`
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
             transformed += shockField((modelMatrix * vec4(transformed, 1.0)).xyz).xyz;`
          )
          .replace(
            "#include <project_vertex>",
            `#include <project_vertex>
             if (gl_Position.w > 0.1) {
               gl_Position.xy += mouseRepelOffset(gl_Position.xy / gl_Position.w, -mvPosition.z, 0.62) * gl_Position.w;
             }`
          );
      };

      const cluster = new THREE.Points(geometry, material);
      this.starSystem.add(cluster);
    }
  }

  /*
   * Dust layers.
   *
   * The foreground "impact" layer used to swell up to
   * 8x point size and flash near-full alpha as it
   * passed the camera — that's what was hurting the
   * eyes. The size/alpha ceiling stays capped low, but
   * more particles now travel through at a quicker
   * pace: comfort came from lowering *brightness* and
   * *max size*, not from having fewer of them, so count
   * and speed can go back up without reintroducing the
   * strobing. The unused per-particle "random" attribute
   * (was wired up but never read in the fragment shader)
   * has been dropped — one fewer buffer upload and one
   * fewer varying per particle, which pays for the extra
   * particle count.
   */
  private createDust(): void {
    const layers = [
      {
        count: this.random.int(550, 800),
        depth: 145,
        spread: 90,
        speedMin: 7,
        speedMax: 14,
        sizeMin: 0.25,
        sizeMax: 0.6,
        impact: false,
      },

      {
        count: this.random.int(300, 460),
        depth: 105,
        spread: 60,
        speedMin: 13,
        speedMax: 23,
        sizeMin: 0.3,
        sizeMax: 0.8,
        impact: false,
      },

      {
        count: this.random.int(110, 170),
        depth: 75,
        spread: 45,
        speedMin: 19,
        speedMax: 32,
        sizeMin: 0.35,
        sizeMax: 0.9,
        impact: true,
      },
    ];

    layers.forEach((layer) => {
      const count = layer.count;

      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const speeds = new Float32Array(count);
      const phases = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        positions[i * 3] = this.random.range(
          -layer.spread,
          layer.spread
        );

        positions[i * 3 + 1] = this.random.range(
          -layer.spread,
          layer.spread
        );

        positions[i * 3 + 2] = -this.random.range(3, layer.depth);

        sizes[i] = this.random.range(layer.sizeMin, layer.sizeMax);
        speeds[i] = this.random.range(layer.speedMin, layer.speedMax);
        phases[i] = this.random.range(0, Math.PI * 2);
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3)
      );
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute(
        "aSpeed",
        new THREE.BufferAttribute(speeds, 1)
      );
      geometry.setAttribute(
        "aPhase",
        new THREE.BufferAttribute(phases, 1)
      );

      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,

        uniforms: {
          uTime: { value: 0 },
          uDepth: { value: layer.depth },
          uImpact: { value: layer.impact ? 1 : 0 },
          uPixelRatio: {
            value: Math.min(window.devicePixelRatio || 1, 1.25),
          },
          ...this.fx,
        },

        vertexShader: `
          ${SHOCK_GLSL}

          attribute float aSize;
          attribute float aSpeed;
          attribute float aPhase;

          uniform float uTime;
          uniform float uDepth;
          uniform float uImpact;
          uniform float uPixelRatio;

          varying float vAlpha;
          varying float vImpact;

          void main() {
            vec3 p = position;

            float travel = mod(uTime * aSpeed, uDepth);
            p.z += travel;

            float normalizedDepth =
              clamp((p.z + uDepth) / uDepth, 0.0, 1.0);

            p.x +=
              sin(uTime * 0.17 + aPhase) * (0.08 + uImpact * 0.1);

            p.y +=
              cos(uTime * 0.13 + aPhase * 1.31) * (0.08 + uImpact * 0.08);

            // Dust is swept aside by the shockwave.
            vec4 world = modelMatrix * vec4(p, 1.0);
            world.xyz += shockField(world.xyz).xyz;

            vec4 mv = viewMatrix * world;

            float depth = 250.0 / max(8.0, -mv.z);

            /*
             * Foreground dust still grows as it nears
             * the screen, but the cap is much gentler
             * now (2.6x instead of 8x) so it never
             * turns into a flashing blob.
             */
            float impactScale = 1.0;

            if (uImpact > 0.5) {
              float proximity =
                smoothstep(0.68, 0.98, normalizedDepth);

              impactScale = mix(1.0, 2.6, proximity);
            }

            gl_PointSize = aSize * depth * uPixelRatio * impactScale;
            gl_Position = projectionMatrix * mv;

            float closeFade =
              1.0 - smoothstep(0.97, 1.0, normalizedDepth);

            vAlpha = closeFade;

            vImpact =
              uImpact * smoothstep(0.55, 0.95, normalizedDepth);

          }
        `,

        fragmentShader: `
          varying float vAlpha;
          varying float vImpact;

          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            float d = length(uv);

            if (d > 0.5) {
              discard;
            }

            float glow = 1.0 - smoothstep(0.04, 0.5, d);
            float core = 1.0 - smoothstep(0.0, 0.16, d);

            vec3 color = vec3(0.82, 0.88, 0.95);

            color += vec3(0.08, 0.1, 0.12) * vImpact;

            color *= 0.4 + core * 0.9 + vImpact * 0.7;

            /*
             * Alpha ceiling lowered so even the
             * brightest close-up dust stays soft
             * and never flashes at near-full opacity.
             */
            float alpha = glow * vAlpha * (0.16 + vImpact * 0.32);

            gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.55));
          }
        `,
      });

      const dust = new THREE.Points(geometry, material);
      dust.frustumCulled = false;

      this.dustSystem.add(dust);
      this.dustMaterials.push(material);
    });
  }

  /*
   * Nebula.
   *
   * Tuned toward a calmer "Pillars of Creation" style
   * emission-nebula look (teal ionized gas, crimson
   * dust lanes, warm gold newborn-star glow) and
   * optimized: fbm dropped from 5 to 4 octaves (fewer
   * dependent texture-free noise calls per pixel),
   * fewer nebula planes on lower layer counts, and the
   * overall gas alpha/brightness ceiling is capped
   * lower so it reads as soft glowing gas instead of a
   * harsh bright wash.
   */
  private createNebulae(palette: Palette): void {
    const count = this.random.int(2, 3);

    for (let i = 0; i < count; i++) {
      const data: NebulaData = {
        position: new THREE.Vector3(
          this.random.range(-60, 60),
          this.random.range(-45, 45),
          -this.random.range(35, 115)
        ),

        scale: new THREE.Vector2(
          this.random.range(45, 90),
          this.random.range(28, 70)
        ),

        rotation: this.random.range(0, Math.PI * 2),
        seed: this.random.range(0, 10000),
        depth: this.random.range(0.3, 1),

        // Lower ceiling than before (was 0.75–1.3)
        intensity: this.random.range(0.4, 0.68),
      };

      this.createNebula(data, palette);
    }
  }

  private createNebula(data: NebulaData, palette: Palette): void {
    const geometry = new THREE.PlaneGeometry(2, 2);

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,

      uniforms: {
        uTime: { value: this.random.range(0, 100) },
        uSeed: { value: data.seed },
        uPrimary: { value: palette.primary },
        uSecondary: { value: palette.secondary },
        uAccent: { value: palette.accent },
        uHot: { value: palette.hot },
        uIntensity: { value: data.intensity },
        uPointer: { value: new THREE.Vector2() },
        uScale: { value: data.scale.clone() },
        uRotation: { value: data.rotation },
        ...this.fx,
      },

      vertexShader: `
        varying vec2 vUv;
        varying vec2 vNdc;
        varying vec3 vWorld;

        void main() {
          vUv = uv;

          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;

          vec4 clip = projectionMatrix * viewMatrix * world;
          vNdc = clip.xy / clip.w;

          gl_Position = clip;
        }
      `,

      fragmentShader: `
        ${MOUSE_GLSL}
        ${SHOCK_GLSL}

        varying vec2 vUv;
        varying vec2 vNdc;
        varying vec3 vWorld;

        uniform float uTime;
        uniform float uSeed;
        uniform float uIntensity;

        uniform vec3 uPrimary;
        uniform vec3 uSecondary;
        uniform vec3 uAccent;
        uniform vec3 uHot;

        uniform vec2 uPointer;
        uniform vec2 uScale;
        uniform float uRotation;

        vec2 rot2(vec2 v, float a) {
          float c = cos(a);
          float s = sin(a);
          return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
        }

        float hash(vec2 p) {
          p += uSeed;

          return fract(
            sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123
          );
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);

          f = f * f * (3.0 - 2.0 * f);

          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));

          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        /*
         * Optimized: 4 octaves instead of 5. Barely
         * perceptible loss of fine detail, noticeably
         * cheaper per pixel on integrated GPUs.
         */
        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;

          for (int i = 0; i < 4; i++) {
            value += noise(p) * amplitude;
            p *= 2.05;
            amplitude *= 0.5;
          }

          return value;
        }

        void main() {
          vec2 uv = vUv * 2.0 - 1.0;
          float time = uTime * 0.018;

          vec2 warp;

          warp.x = fbm(uv * 2.0 + vec2(time, -time * 0.7));
          warp.y = fbm(uv * 2.0 + vec2(-time * 0.8, time));

          vec2 p =
            uv + (vec2(warp.x, warp.y) - 0.5) * 0.75;

          p += uPointer * 0.10;

          // The gas parts softly around the cursor, and is shoved aside
          // by the beam's shockwave. Both move the sampling point, so the
          // clouds drift rather than smear.
          vec2 pushScreen = mouseRepelOffset(vNdc, 999.0, 0.95) * 3.2;
          vec4 shock = shockField(vWorld);
          vec2 pushShock = rot2(shock.xy, -uRotation) / uScale * 1.6;
          p -= rot2(pushScreen, -uRotation) + pushShock;

          float large = fbm(p * 1.65);
          float medium = fbm(p * 3.7 - time * 0.7);
          float detail = fbm(p * 8.0 + time);

          float density =
            large * 0.62 + medium * 0.28 + detail * 0.10;

          float edge =
            1.0 - smoothstep(0.25, 1.25, length(uv));

          float clouds = smoothstep(0.39, 0.72, density);
          float wisps = smoothstep(0.48, 0.78, medium);

          /*
           * "Newborn star" cores — small, soft, warm
           * points of light embedded in the gas rather
           * than one big blown-out center.
           */
          float core =
            pow(max(0.0, 1.0 - length(uv)), 4.2);

          // Teal ionized gas -> crimson dust-lane transition
          vec3 color =
            mix(uPrimary, uSecondary, smoothstep(0.25, 0.8, density));

          // Warm gold wisps threaded through the gas
          color = mix(color, uAccent, wisps * 0.3);

          // Small warm-hot glints, not a wash
          float hot =
            smoothstep(0.68, 0.92, medium * large);

          color = mix(color, uHot, hot * 0.4);

          color += uAccent * core * 0.3;

          // Faint light-blue energy where the shock front passes
          color = mix(color, vec3(0.45, 0.78, 1.0), clamp(shock.w, 0.0, 1.0) * 0.3);

          float gas = clouds * edge;
          gas += wisps * edge * 0.08;
          gas *= uIntensity;
          gas *= 1.0 + shock.w * 0.3;

          float pulse =
            0.95 + 0.05 * sin(uTime * 0.12 + uSeed);

          gas *= pulse;

          /*
           * Alpha ceiling lowered from 0.88 to 0.55 —
           * this is the main fix for eye comfort. The
           * nebula now reads as soft glowing gas instead
           * of a bright wash of additive color.
           */
          gl_FragColor = vec4(color, clamp(gas, 0.0, 0.55));
        }
      `,
    });

    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.copy(data.position);
    mesh.scale.set(data.scale.x, data.scale.y, 1);
    mesh.rotation.z = data.rotation;
    mesh.userData.depth = data.depth;

    this.nebulaSystem.add(mesh);
    this.nebulaMaterials.push(material);
    this.nebulaObjects.push(mesh);
  }

  /* ------------------------------------------------------------------ *
   * Beam + sparkles
   * ------------------------------------------------------------------ */

  private createFx(): void {
    this.fxSystem = new THREE.Group();
    this.scene.add(this.fxSystem);

    // Beam: a camera-facing ribbon aligned with its travel direction.
    this.beamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,

      uniforms: {
        uHead: { value: new THREE.Vector3() },
        uDir: { value: new THREE.Vector3(0, 0, -1) },
        uLength: { value: 1 },
        uWidth: { value: 1 },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },

      vertexShader: `
        uniform vec3 uHead;
        uniform vec3 uDir;
        uniform float uLength;
        uniform float uWidth;

        varying vec2 vBeamUv;

        void main() {
          float along = position.x + 0.5;

          vec3 headV = (viewMatrix * vec4(uHead, 1.0)).xyz;
          vec3 dirV = normalize(mat3(viewMatrix) * uDir);

          vec3 center = headV - dirV * uLength * (1.0 - along);
          center.z = min(center.z, -0.4);

          vec3 viewDir = normalize(center);
          vec3 side = cross(dirV, viewDir);
          float sideLen = length(side);
          side = sideLen > 0.0001 ? side / sideLen : vec3(1.0, 0.0, 0.0);

          // Width grows gently with distance so the beam stays
          // elegant up close and visible far away.
          float dist = max(-center.z, 0.4);
          float w = uWidth * clamp(dist * 0.06, 0.1, 3.2);

          vec3 pos = center + side * position.y * 2.0 * w;

          vBeamUv = vec2(along, position.y * 2.0);
          gl_Position = projectionMatrix * vec4(pos, 1.0);
        }
      `,

      fragmentShader: `
        uniform float uFade;
        uniform float uTime;

        varying vec2 vBeamUv;

        void main() {
          float a = vBeamUv.x;
          float av = abs(vBeamUv.y);

          float core = exp(-av * av * 16.0);
          float glow = exp(-av * av * 3.2);

          float tail = pow(a, 2.4);
          float cap = 1.0 - smoothstep(0.94, 1.0, a);
          float shimmer = 0.92 + 0.08 * sin(a * 38.0 - uTime * 9.0);

          float intensity = (core * 1.25 + glow * 0.55) * tail * shimmer * cap;

          float flare =
            exp(-(1.0 - a) * (1.0 - a) * 60.0) * exp(-av * av * 2.2);

          vec3 color = mix(
            vec3(0.30, 0.68, 1.0),
            vec3(0.85, 0.97, 1.0),
            clamp(core + flare, 0.0, 1.0)
          );

          float alpha = (intensity + flare * 1.1) * uFade;

          gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
        }
      `,
    });

    this.beamMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      this.beamMaterial
    );
    this.beamMesh.frustumCulled = false;
    this.beamMesh.renderOrder = 10;
    this.beamMesh.visible = false;
    this.fxSystem.add(this.beamMesh);

    // Sparkles: a small ring-buffer pool of drifting light motes.
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      this.sparklePositions[i * 3 + 2] = 1000;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.sparklePositions, 3)
    );
    geometry.setAttribute(
      "aAge",
      new THREE.BufferAttribute(this.sparkleAges, 1)
    );
    geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(this.sparkleSizes, 1)
    );

    this.sparkleMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,

      uniforms: {
        uTime: { value: 0 },
      },

      vertexShader: `
        attribute float aAge;
        attribute float aSize;

        uniform float uTime;

        varying float vAge;
        varying float vTwinkle;

        void main() {
          vAge = aAge;
          vTwinkle = 0.7 + 0.3 * sin(uTime * 14.0 + aSize * 20.0);

          if (aAge >= 1.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }

          vec4 mv = modelViewMatrix * vec4(position, 1.0);

          gl_PointSize = aSize * (150.0 / max(10.0, -mv.z)) * (1.0 - aAge);
          gl_Position = projectionMatrix * mv;
        }
      `,

      fragmentShader: `
        varying float vAge;
        varying float vTwinkle;

        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);

          if (d > 0.5) {
            discard;
          }

          float core = 1.0 - smoothstep(0.0, 0.14, d);
          float glow = 1.0 - smoothstep(0.03, 0.5, d);

          vec3 color = mix(vec3(0.35, 0.72, 1.0), vec3(0.9, 0.98, 1.0), core);
          float alpha = glow * pow(1.0 - vAge, 1.5) * vTwinkle * 0.9;

          gl_FragColor = vec4(color, alpha);
        }
      `,
    });

    this.sparkles = new THREE.Points(geometry, this.sparkleMaterial);
    this.sparkles.frustumCulled = false;
    this.sparkles.renderOrder = 11;
    this.fxSystem.add(this.sparkles);
  }

  private resetFx(): void {
    if (!this.fxSystem) {
      return;
    }

    this.beamActive = false;
    this.beamMesh.visible = false;
    this.shotCooldown = 0;

    for (const state of this.fx.uShockState.value) {
      state.set(0, 0, 0, 0);
    }

    this.sparkleAges.fill(1);
    (this.sparkles.geometry.getAttribute("aAge") as THREE.BufferAttribute).needsUpdate = true;
  }

  private fireBeam(ndcX: number, ndcY: number): void {
    this.camera.updateMatrixWorld();

    // Ray through the click, in world space.
    const rayDir = new THREE.Vector3(ndcX, ndcY, 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();

    const target = this.camera.position
      .clone()
      .addScaledVector(rayDir, BEAM_TARGET_DISTANCE);

    // The beam leaves from just below and ahead of the camera and
    // travels in a perfectly straight line through the clicked point.
    const origin = new THREE.Vector3(0, -1.6, -2.2)
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);

    const dir = target.sub(origin).normalize();

    this.beamOrigin.copy(origin);
    this.beamDir.copy(dir);
    this.beamAge = 0;
    this.beamActive = true;
    this.beamMesh.visible = true;
    this.beamMaterial.uniforms.uFade.value = 0;

    const slot = this.shockCursor++ % MAX_SHOCKS;
    this.fx.uShockOrigin.value[slot].copy(origin);
    this.fx.uShockDir.value[slot].copy(dir);
    this.fx.uShockState.value[slot].set(0, 0, SHOCK_STRENGTH, 1);
  }

  private emitSparkle(head: THREE.Vector3, length: number): void {
    const i = this.sparkleCursor++ % SPARKLE_COUNT;

    const camDist = head.distanceTo(this.camera.position);
    const spread = 0.35 + camDist * 0.035;
    const drift = 0.4 + camDist * 0.02;

    const back = Math.random() * length * 0.8;

    this.sparklePositions[i * 3] =
      head.x - this.beamDir.x * back + (Math.random() - 0.5) * spread;
    this.sparklePositions[i * 3 + 1] =
      head.y - this.beamDir.y * back + (Math.random() - 0.5) * spread;
    this.sparklePositions[i * 3 + 2] =
      head.z - this.beamDir.z * back + (Math.random() - 0.5) * spread;

    this.sparkleVelocities[i * 3] = (Math.random() - 0.5) * drift;
    this.sparkleVelocities[i * 3 + 1] = (Math.random() - 0.5) * drift;
    this.sparkleVelocities[i * 3 + 2] = (Math.random() - 0.5) * drift;

    this.sparkleAges[i] = 0;
    this.sparkleLife[i] = 1.0 + Math.random() * 0.9;
    this.sparkleSizes[i] = 1.4 + Math.random() * 1.8;
  }

  private updateSparkles(delta: number): void {
    const drag = Math.exp(-1.4 * delta);

    for (let i = 0; i < SPARKLE_COUNT; i++) {
      if (this.sparkleAges[i] >= 1) {
        continue;
      }

      this.sparkleAges[i] += delta / this.sparkleLife[i];

      if (this.sparkleAges[i] >= 1) {
        this.sparkleAges[i] = 1;
        continue;
      }

      for (let k = 0; k < 3; k++) {
        this.sparkleVelocities[i * 3 + k] *= drag;
        this.sparklePositions[i * 3 + k] +=
          this.sparkleVelocities[i * 3 + k] * delta;
      }
    }

    const geometry = this.sparkles.geometry;
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aAge") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateFx(delta: number, time: number): void {
    this.shotCooldown = Math.max(0, this.shotCooldown - delta);

    // Advance shockwaves (they outlive the visible beam and fade slowly).
    for (const state of this.fx.uShockState.value) {
      if (state.w < 0.5) {
        continue;
      }

      state.x += delta;
      state.y = shockHeadDistance(state.x);

      if (state.x > SHOCK_LIFE) {
        state.w = 0;
      }
    }

    if (this.beamActive) {
      this.beamAge += delta;

      if (this.beamAge >= BEAM_LIFE) {
        this.beamActive = false;
        this.beamMesh.visible = false;
      } else {
        const travelled = shockHeadDistance(this.beamAge);
        const length = Math.min(BEAM_LENGTH, travelled);

        this.beamHead
          .copy(this.beamOrigin)
          .addScaledVector(this.beamDir, travelled);

        const u = this.beamMaterial.uniforms;
        u.uHead.value.copy(this.beamHead);
        u.uDir.value.copy(this.beamDir);
        u.uLength.value = length;
        u.uTime.value = time;

        const fadeIn = THREE.MathUtils.smoothstep(this.beamAge, 0, 0.22);
        const fadeOut =
          1 - THREE.MathUtils.smoothstep(this.beamAge, BEAM_LIFE - 0.8, BEAM_LIFE);
        u.uFade.value = fadeIn * fadeOut * 0.95;

        if (this.beamAge > 0.1) {
          this.sparkleCarry += SPARKLE_RATE * delta;

          while (this.sparkleCarry >= 1) {
            this.sparkleCarry -= 1;
            this.emitSparkle(this.beamHead, length);
          }
        }
      }
    }

    this.sparkleMaterial.uniforms.uTime.value = time;
    this.updateSparkles(delta);
  }

  /* ------------------------------------------------------------------ *
   * Input
   * ------------------------------------------------------------------ */

  private installPointer(): void {
    window.addEventListener("pointermove", this.handlePointer);
    window.addEventListener("pointerleave", this.handlePointerLeave);
    window.addEventListener("click", this.handleClick);
  }

  private handlePointer = (event: PointerEvent): void => {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.pointerIdle = 0;
  };

  private handlePointerLeave = (): void => {
    this.pointer.set(0, 0);
    this.pointerIdle = 99;
  };

  // One click anywhere in the space fires a single beam. Clicks on real
  // UI controls are ignored, and a new shot is only accepted once the
  // previous beam has finished its flight.
  private handleClick = (event: MouseEvent): void => {
    if (this.destroyed || !this.visible || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;

    if (
      target?.closest?.(
        "a, button, input, textarea, select, label, [role='button']"
      )
    ) {
      return;
    }

    if (this.shotCooldown > 0) {
      return;
    }

    this.shotCooldown = BEAM_LIFE;

    this.fireBeam(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );
  };

  private installResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });

    this.resizeObserver.observe(this.container);
  }

  private resize(): void {
    if (!this.camera || !this.renderer) {
      return;
    }

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.fx.uAspect.value = width / height;

    this.renderer.setSize(width, height, false);
  }


  private animate = (): void => {
    if (this.destroyed || !this.visible) {
      this.animationFrame = 0;
      return;
    }

    this.animationFrame = requestAnimationFrame(this.animate);

    const time = this.clock.elapsedTime;

    const delta = this.previousFrameTime === 0
      ? 1 / 60
      : THREE.MathUtils.clamp(time - this.previousFrameTime, 0.001, 0.04);
    this.previousFrameTime = time;

    this.updatePointer(delta);
    this.updateCamera(time, delta);
    this.updateShaders(time);
    this.updateNebulaMotion(time);
    this.updateFx(delta, time);
    this.updateCosmicEvents();

    this.renderer.render(this.scene, this.camera);
  };


  private updatePointer(delta: number): void {
    const blend = 1 - Math.exp(-5.5 * delta);
    this.smoothPointer.lerp(this.pointer, blend);

    // The repel point follows the cursor lazily, and its strength only
    // builds while the mouse is actually moving — so disturbed stars and
    // gas drift back to their places once the cursor goes quiet.
    this.repelPointer.lerp(this.pointer, 1 - Math.exp(-MOUSE_FOLLOW_RATE * delta));

    this.pointerIdle += delta;

    const target = this.pointerIdle < MOUSE_ACTIVE_WINDOW ? 1 : 0;
    const rate = target > this.influence ? MOUSE_RISE_RATE : MOUSE_FALL_RATE;
    this.influence += (target - this.influence) * (1 - Math.exp(-rate * delta));

    this.fx.uMouse.value.copy(this.repelPointer);
    this.fx.uInfluence.value = this.influence;
  }

  private updateCamera(time: number, delta: number): void {
    const px = this.smoothPointer.x;
    const py = this.smoothPointer.y;

    // Slow environmental drift; mouse input remains the main steering input.
    const driftX = Math.sin(time * 0.11) * 0.38;
    const driftY = Math.cos(time * 0.14) * 0.26;
    this.cameraTarget.set(px * 3.8 + driftX, py * 2.8 + driftY, 7);

    // Damped spring: acceleration on input, gentle settling when released.
    // Time-based integration avoids frame-rate-dependent camera behaviour.
    this.cameraDelta.copy(this.cameraTarget).sub(this.camera.position);
    this.cameraVelocity.addScaledVector(this.cameraDelta, 42 * delta);
    this.cameraVelocity.multiplyScalar(Math.exp(-10 * delta));
    this.camera.position.addScaledVector(this.cameraVelocity, delta);

    const lookBlend = 1 - Math.exp(-4.5 * delta);
    this.cameraLookDesired.set(px * 5.2, py * 3.2, -60);
    this.cameraLookTarget.lerp(this.cameraLookDesired, lookBlend);
    this.camera.lookAt(this.cameraLookTarget);

    const targetRoll = -px * 0.032;
    this.camera.rotation.z = THREE.MathUtils.lerp(
      this.camera.rotation.z,
      targetRoll,
      1 - Math.exp(-3.5 * delta)
    );

    const worldBlend = 1 - Math.exp(-2.8 * delta);
    this.universeRoot.position.x = THREE.MathUtils.lerp(
      this.universeRoot.position.x, px * 0.8, worldBlend
    );
    this.universeRoot.position.y = THREE.MathUtils.lerp(
      this.universeRoot.position.y, py * 0.55, worldBlend
    );
  }

  private updateShaders(time: number): void {
    for (const material of this.starMaterials) {
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = time;
      }
    }

    for (const material of this.dustMaterials) {
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = time;
      }
    }

    for (const material of this.nebulaMaterials) {
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = time;
      }

      if (material.uniforms.uPointer) {
        material.uniforms.uPointer.value.lerp(
          this.smoothPointer,
          0.025
        );
      }
    }
  }

  private updateNebulaMotion(time: number): void {
    for (let i = 0; i < this.nebulaObjects.length; i++) {
      const object = this.nebulaObjects[i];
      const depth = object.userData.depth ?? 0.5;

      object.position.x +=
        Math.sin(time * 0.025 + i * 3.7) * 0.001 * depth;

      object.position.y +=
        Math.cos(time * 0.021 + i * 2.3) * 0.0008 * depth;

      object.rotation.z += Math.sin(time * 0.03 + i) * 0.000015;

      // Keep the shader's idea of the plane rotation in sync.
      const material = this.nebulaMaterials[i];
      if (material?.uniforms.uRotation) {
        material.uniforms.uRotation.value = object.rotation.z;
      }
    }
  }

  private updateCosmicEvents(): void {
    const delta = this.clock.getDelta();

    this.eventTimer -= delta;

    if (this.eventTimer <= 0) {
      if (this.random.next() > 0.38) {
        this.createShootingStar();
      }

      this.eventTimer = this.random.range(3, 10);
    }

    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const event = this.shootingStars[i];

      event.line.position.addScaledVector(event.velocity, delta);

      event.life -= delta;

      const material = event.line.material as THREE.LineBasicMaterial;

      material.opacity = Math.max(0, event.life / event.maxLife);

      if (event.life <= 0) {
        event.line.geometry.dispose();
        material.dispose();

        this.eventSystem.remove(event.line);
        this.shootingStars.splice(i, 1);
      }
    }
  }

  private createShootingStar(): void {
    const start = new THREE.Vector3(
      this.random.range(-65, 65),
      this.random.range(-40, 40),
      -this.random.range(35, 100)
    );

    const direction = new THREE.Vector3(
      this.random.range(-0.7, 0.7),
      this.random.range(-0.45, 0.45),
      this.random.range(0.8, 1.4)
    ).normalize();

    const length = this.random.range(4, 10);

    const end = start.clone().addScaledVector(direction, length);

    const geometry = new THREE.BufferGeometry().setFromPoints([
      start,
      end,
    ]);

    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);

    this.eventSystem.add(line);

    const maxLife = this.random.range(0.3, 0.8);

    this.shootingStars.push({
      line,
      velocity: direction.multiplyScalar(this.random.range(20, 42)),
      life: maxLife,
      maxLife,
    });
  }


  private startAnimation(): void {
    if (
      this.destroyed ||
      !this.visible ||
      this.animationFrame !== 0
    ) {
      return;
    }

    this.previousFrameTime = 0;
    this.clock.start();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  private stopAnimation(): void {
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }

    this.clock.stop();
  }



  setVisible(visible: boolean): void {
    if (this.destroyed) {
      return;
    }

    this.visible = visible;

    this.container.style.opacity = visible ? "1" : "0";
    this.container.style.visibility = visible ? "visible" : "hidden";
    this.container.style.pointerEvents = "none";

    if (visible) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
  }


  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    this.stopAnimation();

    this.resizeObserver?.disconnect();

    window.removeEventListener("pointermove", this.handlePointer);
    window.removeEventListener("pointerleave", this.handlePointerLeave);
    window.removeEventListener("click", this.handleClick);

    this.clearUniverse();

    if (this.fxSystem) {
      this.beamMesh.geometry.dispose();
      this.beamMaterial.dispose();
      this.sparkles.geometry.dispose();
      this.sparkleMaterial.dispose();
      this.scene.remove(this.fxSystem);
    }

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}