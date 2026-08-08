import { useEffect, useRef } from 'react';

/**
 * WebGL backdrop for the hero: a receding field of amber points that swell in
 * a slow wave and drift as you scroll.
 *
 * The metaphor is the instrument panel the rest of the site already uses — a
 * signal field being watched, not a decorative blob. It is deliberately low
 * contrast: the h1 in front of it is the LCP element, and a busy background
 * would cost both legibility and Lighthouse points.
 *
 * Everything here is arranged around not being expensive:
 *
 * - three is imported dynamically, so it lands in its own chunk fetched after
 *   hydration and never blocks first paint.
 * - the render loop stops when the hero scrolls out of view or the tab is
 *   hidden. A canvas nobody is looking at should not spend anyone's battery.
 * - it opts out entirely on reduced-motion, on save-data, and on low-memory
 *   devices, falling back to the CSS gradient underneath.
 *
 * Written against raw BufferGeometry and a small ShaderMaterial rather than any
 * three helper, because the helpers pull in loaders and controls that would
 * treble the chunk for no visual gain.
 */

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform float uPixelRatio;
  attribute float aScale;
  varying float vFade;

  void main() {
    vec3 p = position;

    // Two waves at different rates, so the surface never visibly repeats.
    p.y += sin(p.x * 0.28 + uTime * 0.55) * 0.75
         + cos(p.z * 0.24 + uTime * 0.38) * 0.75;

    // Scroll pushes the field back and down: parallax without moving the DOM.
    p.z += uScroll * 14.0;
    p.y -= uScroll * 3.0;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    // Perspective-correct sizing, so distant points genuinely recede.
    //
    // The constant and the pixel ratio both matter. gl_PointSize is in device
    // pixels, not CSS pixels, so on a 2x display a point sized for CSS pixels
    // comes out half the intended size. Getting this wrong once already made
    // the whole field sub-pixel and therefore invisible.
    gl_PointSize = aScale * uPixelRatio * (90.0 / max(-mv.z, 0.1));

    // Fades at both ends: distant points into the background, near ones out of
    // frame rather than sliding past at full brightness. The numbers track the
    // actual depth range the grid occupies from this camera (~21 to ~65) — set
    // wider than the geometry and the far half simply never draws.
    vFade = smoothstep(70.0, 14.0, -mv.z) * smoothstep(16.0, 32.0, -mv.z);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vFade;

  void main() {
    // Rounds the square point sprite off, with a soft edge so it does not
    // alias into a visible pixel grid.
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    float alpha = smoothstep(0.5, 0.08, d) * vFade * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** Reads the live amber out of CSS, so the scene follows the theme toggle. */
function signalColour(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--signal').trim();
  const hex = raw.replace('#', '');
  if (hex.length !== 6) return [1, 0.69, 0.13];
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

/** Cheap enough to run on this device? */
function shouldRender(): boolean {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  if (nav.connection?.saveData) return false;
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return false;

  return true;
}

export function HeroField() {
  const host = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = host.current;
    if (!canvas || !canvas.parentElement || !shouldRender()) return;
    const parent = canvas.parentElement;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void (async () => {
      const THREE = await import('three');
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: false,
          powerPreference: 'low-power',
        });
      } catch {
        // No WebGL. The CSS gradient behind the canvas is the design anyway.
        return;
      }

      // Capped: past 2x the extra pixels are invisible and the fill cost is real.
      const pixelRatio = Math.min(window.devicePixelRatio, 2);
      renderer.setPixelRatio(pixelRatio);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
      camera.position.set(0, 5.5, 17);
      camera.lookAt(0, 0, -14);

      /* A grid of points laid flat, receding from the camera. */
      const COLS = 96;
      // Depth is bounded by what the fade above can actually show; rows beyond
      // that are cost with no picture.
      const ROWS = 48;
      const SPACING = 0.92;
      const count = COLS * ROWS;

      const positions = new Float32Array(count * 3);
      const scales = new Float32Array(count);

      for (let i = 0; i < count; i += 1) {
        const col = i % COLS;
        const row = Math.floor(i / COLS);

        positions[i * 3] = (col - COLS / 2) * SPACING;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = -row * SPACING - 4;

        // Varied so the field reads as a scatter rather than as printed graph
        // paper. Hash rather than random: the layout is then identical on every
        // load, which matters when the same page is prerendered and hydrated.
        const hash = Math.sin(col * 12.9898 + row * 78.233) * 43758.5453;
        scales[i] = 0.55 + (hash - Math.floor(hash)) * 0.75;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

      const [r, g, b] = signalColour();
      const uniforms = {
        uTime: { value: 0 },
        uScroll: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        uColor: { value: new THREE.Color(r, g, b) },
        uOpacity: { value: 0 },
      };

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        // Normal, not additive. Additive blending adds light to what is behind
        // it, which on the light theme's near-white hero means amber plus white
        // is still white — the entire field disappears. Normal blending is
        // slightly less luminous on the dark theme and correct on both.
        blending: THREE.NormalBlending,
      });

      scene.add(new THREE.Points(geometry, material));

      /* The theme toggle swaps the amber under us. */
      const themeWatcher = new MutationObserver(() => {
        const next = signalColour();
        uniforms.uColor.value.setRGB(next[0], next[1], next[2]);
      });
      themeWatcher.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });

      const resize = () => {
        const { clientWidth, clientHeight } = parent;
        if (!clientWidth || !clientHeight) return;
        renderer.setSize(clientWidth, clientHeight, false);
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
      };
      resize();
      const sizeWatcher = new ResizeObserver(resize);
      sizeWatcher.observe(parent);

      /* Scroll drives the field. */
      let scrollTarget = 0;
      const onScroll = () => {
        scrollTarget = Math.min(1, window.scrollY / Math.max(window.innerHeight, 1));
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });

      // Pauses when the hero is off screen.
      let onScreen = true;
      const visibility = new IntersectionObserver(
        ([entry]) => {
          onScreen = entry.isIntersecting;
        },
        { threshold: 0 }
      );
      visibility.observe(parent);

      let frame = 0;
      // performance.now() rather than THREE.Clock: Clock is deprecated in
      // favour of THREE.Timer, and neither is worth importing for a single
      // elapsed-seconds value.
      const started = performance.now();

      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (!onScreen || document.hidden) return;

        uniforms.uTime.value = (now - started) / 1000;
        // Eased towards the target rather than assigned: scroll events are
        // coarse, and stepping between them is visible.
        uniforms.uScroll.value += (scrollTarget - uniforms.uScroll.value) * 0.06;
        // Fades in over about a second, so it arrives rather than pops.
        uniforms.uOpacity.value = Math.min(0.85, uniforms.uOpacity.value + 0.015);

        renderer.render(scene, camera);
      };
      tick(started);

      cleanup = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', onScroll);
        sizeWatcher.disconnect();
        visibility.disconnect();
        themeWatcher.disconnect();
        geometry.dispose();
        material.dispose();
        renderer.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="hero-field" aria-hidden="true">
      <canvas ref={host} />
    </div>
  );
}
