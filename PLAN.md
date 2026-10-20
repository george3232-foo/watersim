# STILLWATER — Implementation Plan / Self-Prompt

> Build an interactive, physically-grounded pond in Three.js. The water must behave like real
> water at pond scale: gravity waves, dispersive ripples, reflections, refraction, shoreline
> run-up, wind chop, rain rings, buoyancy, wakes, spray, foam, and light caustics. Fish must
> live in it, shoal, feed, startle, and respond to the player's touch. Everything procedural,
> no external art assets required.

This document is both the design brief and the working prompt followed during implementation.
It records the research, the mathematics, the rendering pipeline, the interaction design, the
file layout, the milestones and the verification strategy.

---

## 0. Vision & success criteria

**One sentence:** A golden-hour wildlife pond you can reach into, disturb, feed and throw things
into — where the water answers with believable waves and the koi answer with believable fear and
curiosity.

Success criteria:

1. **Water looks and moves like water.** Calm pond with wind chop; a thrown pebble produces a
   crater, crown splash, expanding ring, reflections, and a wake that persists for seconds.
   Throw a heavy stone: a deeper crater, bigger wave, spray, foam. Drag a hand through the water:
   a turbulent wake with real advection. Rain produces hundreds of independent impact rings.
2. **Two-way coupling.** Floating objects bob on the actual simulated surface, tilt with the
   local slope, drift with wave slope, push water when they move, and splash on entry. Sinking
   objects drag, create wakes, and settle on the bed.
3. **Fish are alive.** Koi and minnows wander, shoal, avoid banks and each other, investigate
   food, rise to sip at the surface, flee disturbances, and cautiously return. A stone landing
   scatters them. Food brings them to the surface and they create real ripples.
4. **A place, not a demo.** Procedural banks, pebbles, reeds, lilies, grass, trees, a jetty,
   lantern, dragonflies, birds, fireflies, layered sky, fog, ambient audio. Time of day changes
   the entire mood. The UI is quiet and beautiful.
5. **Runs smoothly.** 60 fps on a normal discrete/integrated GPU at 1080p, adaptive quality
   fallback, clean console, responsive to resize.
6. **Verifiable.** Deterministic seed, headless screenshot script, debug API, no external assets.

Non-goals: full 3D volumetric fluid (SPH/FLIP) at millions of particles. The chosen
heightfield approach is the correct real-time approximation for a pond surface; vertical splash
is represented by a GPU/CPU spray layer. Document this trade-off in the help panel.

---

## 1. Research summary (what informed the design)

- **Virtual pipes shallow-water solver** (Mei et al.; lisyarus). Stores water surface height and
  face fluxes, accelerates flux from surface-height differences, scales outgoing flux so a cell
  can never go negative, then integrates height from flux divergence. Volume-conserving, stable,
  naturally handles wet/dry shorelines and reflections. It is the right bulk solver.
- **Heightfield wave equation** (Tessendorf, Müller, Evan Wallace). Used for the small-scale
  ripple layer. Short gravity–capillary waves are dispersive; a bulk SWE layer would propagate
  them at `sqrt(g h)` (≈3.7 m/s) which looks wrong. The ripple layer travels at ~0.45–0.8 m/s,
  matching the minimum phase speed of water waves (~0.23 m/s) and small-wave dispersion.
- **Frequency splitting** (SIGGRAPH 2023 "Generalizing Shallow Water Simulation with Dispersive
  Surface Waves"): combine a low-frequency shallow-water solve with a high-frequency dispersive
  layer. This project adopts the same split with a hand-tuned ripple layer.
- **Evan Wallace's WebGL Water / threejs-water**: refraction with depth-based Beer–Lambert
  absorption, Fresnel mix, planar/raytraced reflection, caustics by differential area. Our
  implementation uses a planar reflection pass, screen-space refraction of the scene buffer,
  and sim-curvature-driven caustics.
- **Buoyancy**: Archimedes (submerged volume × ρ × g), quadratic drag, added mass, 4-point
  surface sampling for pitch/roll, wave-slope force. Async GPU readback of a low-res packed
  field supplies the exact rendered surface to the CPU (three.js `readRenderTargetPixelsAsync`).
- **Water optics**: extinction coefficients of fresh water are strongly wavelength dependent.
  Use `sigma ≈ (0.35, 0.10, 0.055) /m` for a clear but green-ish pond, plus in-scattering,
  Fresnel F0=0.02, GGX sun specular, and distance-based roughness to avoid aliasing.
- **Acoustics**: procedural WebAudio (filtered noise, sine drops, noise-burst splashes) with a
  generated reverb impulse, stereo panning and a limiter.

---

## 2. Technology

- **Three.js r186**, WebGL2 renderer, ES modules, Vite.
- **No external textures or models** — every mesh, texture and sound is generated.
- Custom GLSL for simulation, water, sky, terrain details, fish, particles.
- Playwright + headless Chromium for visual/functional verification.
- Target: Chrome/Firefox/Safari desktop, WebGL2. Graceful precision fallback (HalfFloat).

---

## 3. World layout & scale (meters, y up)

- Water plane at **y = 0**. Pond center (0,0). Pond radius ≈ 6–7 m, max depth ≈ 1.45 m.
- Simulation domain **20 × 20 m**, centered. Pond is fully interior; dry border prevents
  domain-boundary reflections.
- Terrain mesh **32 × 32 m**, 256² segments, procedural height function; banks rise ~0.6 m,
  meadow beyond; fog and a distant tree line hide the edge.
- Macro water grid **256²** (7.8 cm cells); micro ripple grid **512²** (3.9 cm cells).
- Water render mesh **256²** (131k triangles), displaced in the vertex shader.
- Jetty on the west bank extending ~3.2 m over the water at deck height 0.52 m.
- Camera: orbit around pond center, default at ~(9, 3.8, 11.5), FOV 42°, aspect 16:9.
  Golden-hour default sun azimuth from the west/southwest, elevation ~16°.

Deterministic seed: 1337. All noise, placement and fish personalities use seeded RNG.

### Terrain height function

```
r = length(x,z); theta = atan2(z,x)
R(theta) = 6.35 + 0.55 sin(3θ+1.7) + 0.33 sin(5θ+0.3) + 0.22 sin(8θ+2.1)
          + 0.18 fbm2(cosθ*1.4, sinθ*1.4)
F = R(theta) - r                      // signed "inside" distance in metres
shoreNoise = 0.10 * fbm(x*0.7, z*0.7)
if F > 0 (inside):  bed = -depthProfile(F) + detail
if F <= 0 (outside): bank = 0.55 * smoothstep(0, 2.2, -F) + meadow(x,z)
```

Depth profile: `1.45 * smoothstep(0, 1.35, F)^0.82 * (0.9 + 0.1 noise)`, plus a deeper
hole (`-0.3 * exp(-((x-1.6)²+(z+0.9)²)/5)`) and gentle bed ripples. Outside: meadow rises
with low-frequency fbm; flatten a small sandy beach on the south bank.

Bed height is sampled for: terrain mesh, bed texture, water-mesh depth/discard, object
collisions, fish avoidance. Single source of truth in `Terrain.js` (`heightAt(x,z)`).

---

## 4. Water physics — two coupled layers

### 4.1 Macro layer: virtual pipes SWE (surface height form)

State texture `RGBA32F/16F`, 256²: `R = η` (absolute water surface y), `G = Qx`, `B = Qy`,
`A = foam`. Bed texture `R32F/16F`, sampled bilinearly. Depth `h = max(0, η - bed)`.

Per substep (fixed `dt`, e.g. 1/90 s):

1. **Flux acceleration** at cell faces (stored as right/down face flux at the cell):
   ```
   Qx += dt * g * A_pipe * (η_left - η) / dx * damping
   Qy += dt * g * A_pipe * (η_up   - η) / dy * damping
   ```
   with `A_pipe = dx * h_face`, `g = 9.81`. Boundary faces = 0 (walls; but domain edges are dry).
   Friction: `Q *= exp(-frictionCoeff * dt)` with depth-dependent bottom friction:
   `frictionCoeff = 0.10 + 0.55 * exp(-h/0.12)` (shallow water is much lossier).
2. **Outflow scaling**: for each cell sum outgoing fluxes (positive Qx at right face, negative
   Qx at left face, etc.); if `out * dt > h * cellArea`, scale all outgoing fluxes so
   `out = h*cellArea/dt`. This guarantees `h >= 0`.
3. **Height update**: `η += dt/dx/dy * (inflow - outflow)`.
4. **Wet/dry**: `h = max(0, η - bed)`; if h < 0.0004 m, set η = bed and flows to 0.
5. **Foam**: `foam = max(foam*exp(-dt*0.6), foamSource)`; sources from impacts, shoreline
   convergence, high flux. Stored to advect visually later.

Forcing:
- **Interactions** (up to 8 per frame): crater + rim displacement with net-zero volume,
  directional flux injection, hand pressure. Applied to η and Q with Gaussian falloff.
- **Wind**: anisotropic gust pressure added to flux; long-fetch setup + micro wind waves.
- **Rain**: adds tiny volume to wet cells.
- **Fish / floating-object wakes**: small dipoles / flux pushes.
- **Global level offset**: uniform offset from displaced object volume, not fed back into the
  gradient solver (it is a constant), used by rendering and CPU queries.

`dt` fixed, accumulator, max 4 substeps/frame to avoid spiral of death. Clamp `η` for safety
(|η| < 2 m) and fluxes.

### 4.2 Micro layer: dispersive ripple heightfield

State `RGBA16F`, 512²: `R = ηr`, `G = vr` (vertical surface velocity), `B = foamRipple`,
`A = spare`. At rest 0.

Per 1/60 step:
```
c    = 0.42 + 0.30 * smoothstep(0.0, 1.2, h)        // 0.42..0.72 m/s, dispersive tuning
lap  = (ηrL+ηrR+ηrU+ηrD - 4ηr) / dx²
acc  = c² * lap - 2.1 * vr + windForcing + rainForcing
vr   = (vr + acc*dt) * exp(-0.55*dt)
ηr   = (ηr + vr*dt) * exp(-0.10*dt)
```
Wet mask: where macro depth < 0.01, damp `ηr` and `vr` hard (shoreline absorption); near the
shore, lower `c` and increase damping to emulate run-up/breaking. Clamp |ηr| to 0.18 m.

Rain: per-cell stochastic drop events driven by `hash(cell, floor(time*30))`; a small sharp
bump (2–3 cell Gaussian) into `vr`. Density ∝ rain intensity. This yields independent rings.

Wind: sum of 3 travelling wave trains with different directions/wavelengths/phase speeds,
amplitude ∝ wind², applied as acceleration; plus gust noise. This creates realistic wind chop.

Interactions: same events as macro but with a much sharper Gaussian; crater impulse into `vr`.

Render surface: `y = η_macro + ηr + levelOffset`. Normal from finite differences of the combined
field (macro sampled at 256, micro at 512), plus procedural capillary detail for sub-grid waves.
Depth for optics/discard: `h = η_macro + levelOffset - bed` (micro is small; include for shading).

### 4.3 Volume conservation & object displacement

- Recompute total submerged volume `Vsub` of all dynamic objects each frame (spherical-cap /
  box approximations). Uniform level offset `Vsub / pondArea` clamped to ±0.03 m. This is
  physically the pond level rising when an object is placed in it.
- Objects do not carve the surface (a floating body does not depress the free surface except by
  its meniscus); instead their motion injects wakes and pressure disturbances.
- Entry: crater (negative) + rim (positive) with net zero, impulse ∝ `m * v_impact`.
- Exit/oscillation: small volume source ∝ `-dVsub/dt` spread around the body, causing rings.

### 4.4 CPU readback

Every frame (or every 2nd frame) render a 128² RGBA8 pack target:
`R,G = 16-bit surface height η + levelOffset` over [-2, 2] m; `B = 8-bit foam/depth cue`;
`A = 8-bit micro amplitude` (optional). `renderer.readRenderTargetPixelsAsync` (fallback sync
64²). Keep one read in flight; decode and flip rows. Bilinear sample on CPU for buoyancy,
surface height, slope, ripple bobbing. Sim height rendered directly, so floating objects sit on
the exact visible surface (≤2 frames lag).

---

## 5. Water rendering

HDR pipeline, linear space, `NoToneMapping` until the final pass.

Passes per frame:
1. **Planar reflection** (half res, RGBA16F): mirrored camera across y=0, global clipping plane
   keeps only above-water geometry, water hidden. Sky, trees, jetty, rocks, above-surface spray
   reflected. Texture matrix for projected sampling.
2. **Scene** (full internal res, RGBA16F + depth texture, MSAA 4): sky, terrain, vegetation,
   jetty, fish, objects, underwater bubbles. No water.
3. **Water composite** (RGBA16F): fullscreen copy of scene colour, then draw the water mesh with
   scene colour + depth as inputs (no depth buffer; manual depth compare/discard).
4. **Above-water spray/rain** drawn into composite.
5. **Post**: bright pass → 3-level blur bloom; final ACES + sRGB + colour grade + vignette +
   grain + chromatic aberration + FXAA to screen.

Water vertex shader: sample macro/micro height, displace, pass world position, projected
reflection coords, screen UV, depth, foam.

Water fragment shader:
- Discard dry (`h < 0.0025`), manual depth test against scene depth with bias.
- Normal: finite differences of combined height (multi-scale taps) + 2 layers of animated
  procedural capillary normals; wind-streaked roughness.
- **Reflection**: sample planar RT at projected coords + normal.xz * strength; fade by Fresnel.
- **Refraction**: 3-tap chromatic screen-space offset (normal.xz * thickness * k); depth check to
  avoid sampling above-surface pixels. Sample scene colour.
- **Absorption**: optical path `≈ h / max(dot(V,N),0.25)` (×2 for down/up), transmittance
  `exp(-σ * path)`, σ = (0.34, 0.09, 0.055). Body colour = refracted × T + scatterColor × (1-T).
- **Fresnel**: Schlick, F0 = 0.02; mix reflection/refraction.
- **Sun**: GGX specular with low roughness + micro-sparkle; sun colour warm; broad sky sheen.
- **Foam**: shoreline band (depth < 0.06 m, noise-modulated), impact foam from macro `A`,
  crest foam (high micro velocity/curvature), procedural fbm. White but sky-tinted, soft.
- **SSS**: crest translucency when backlit: add teal/green glow ∝ wave height × sun transmission.
- **Debris/pollen**: sparse floating specks advected by wind for scale.
- **Sun glitter**: sharp high-frequency glints only along the sun reflection lobe.
- Waterline: alpha = 1; soft contact via depth clip and shoreline foam; slight normal-based
  alpha at very shallow depth to avoid hard mesh edges.

**Caustics** on terrain/rocks/fish: sample macro surface Hessian near the fragment's xz to
compute focusing `1 + k·∇²η` (clamped), modulate an animated procedural caustic network
(world-space voronoi/warped noise) by sun elevation and depth; add as extra irradiance.
Attenuate with `exp(-σ_c * depth)` and fade above water. Fish get a subtle moving light pattern.
Rocks and jetty posts include it via shared GLSL injection.

**Mist**: low-lying animated fog plane / billboard sprites near the water at dawn/dusk.

---

## 6. Physical objects & buoyancy

Rigid bodies approximated as spheres (position, velocity, angular velocity, quaternion, radius,
mass, volume, drag coefficients, shape type). Integrate at fixed 120 Hz substeps.

Forces:
- Gravity `m g`.
- **Buoyancy** from the sampled surface y and spherical cap submerged volume:
  `Vsub = π t² (3r - t)/3`, `F = ρ g Vsub`; box approximation for the jetty/plank.
- **Drag**: `F = -0.5 ρ Cd A |v_rel| v_rel`, using local water velocity ≈ surface slope-induced
  + a small orbital estimate; linear damping near equilibrium for stability.
- **Wave slope**: `Fxz += -m g ∇η` (object slides down the local surface), plus a small current.
- **Torque** from 4-point surface sampling: align local up to water normal, angular damping.
- **Wakes**: inject a flux push at the object's footprint proportional to relative horizontal
  movement; inject rings on vertical acceleration/entry/exit.
- **Bed & rock collisions**: height function + analytic sphere colliders; restitution 0.25,
  friction. **Object–object** sphere collisions with impulse response.
- **Volume → global water level** offset.

Object types:
| Object | Mass | Density | Behaviour |
|---|---|---|---|
| pebble | 0.045 kg | 2.6 | sinks, small splash |
| stone | 0.9 kg | 2.6 | sinks, big crater + spray |
| apple | 0.14 kg | 0.82 | floats low, bobs |
| rubber duck | 0.08 kg | 0.22 | floats high, rights itself |
| beach ball | 0.05 kg | 0.08 | floats very high, wind-driven |
| leaf | 0.003 kg | 0.35 | light, drifts, rides ripples |
| fish food | 0.0005 kg | 0.9 | tiny, floats, attracts fish, expires |

Rendering: procedural geometry, physically based materials with caustics; sinking objects get
bubbles; floating objects reflect in the planar pass; above-water objects cast shadows.
Duck: body + head + beak + eyes + tail. Apple: dimple + stem + leaf. Ball: spherical colour
panels via shader. Pebble/stone: deformed icosahedra, flat-ish shading. Leaf: curved blade with
vein geometry.

Throw: pointer down in Throw mode → charge (0.25–1) while aiming; trajectory preview line with
gravity and predicted water intersection + target ring. Release → spawn at camera, initial
velocity aimed at the target with extra upward arc. Object pool max 28; oldest fades and recycles.
Impact triggers: crater + rim impulse, spray droplet burst (count/size/velocity ∝ energy),
bubbles, foam, sound, fish startle event.

---

## 7. Fish

### Species & rendering
- **Koi** ×12: body 0.28–0.48 m, procedural ring-lofted body, flowing tail/dorsal/pectoral fins.
  Colour variants: white with vermilion patches, gold, platinum, black-and-white; pattern via
  object-space 3D noise; scales as subtle procedural normal; eyes as dark glossy spheres;
  fins semi-translucent, backlit rim.
- **Minnows** ×42: 0.06–0.10 m, silver-blue, dark dorsal stripe; two shoals.
- Instanced meshes with per-instance phase/speed/seed attributes. Vertex shader lateral
  travelling wave `sin(k u - ωt + φ) * A(u)`; amplitude grows toward the tail, speed-dependent;
  fins flex more; body banks into turns. Custom depth material supports instancing.
- Real shadows into the pond bed (directional shadow map) + subtle caustics.
- Two meshes (koi/minnow) with separate custom ShaderMaterials for colour/pattern/fins.

### Behaviour (fixed 60 Hz)
Each fish: position, velocity, forward, desired speed, preferred depth, personality
(boldness, curiosity, sociability), state, timers, fear, hunger.

- **Wander**: smooth-noise heading + waypoint seeking within the pond; preferred depth band;
  avoid banks (bed clearance), surface, rocks, jetty posts, floating objects.
- **Shoal** (minnows strongly, koi weakly): separation, alignment, cohesion within radius; koi
  avoid crowding.
- **Startle**: disturbance events (impact, stir, fish splash) add fear scaled by distance and
  personality; flee vector away from source at 2–3× cruise speed for 1.5–5 s, then cautious
  return with a "curiosity" pass near the site after 4–10 s.
- **Feed**: food events spawn pellets; hungry fish switch to approach, rise, nibble at the
  surface (head tilt), consume, emit a real ripple event + tiny plop. Multiple fish converge.
- **Surface**: occasional idle rise/sip, creating rings; more likely at dusk.
- **Hand/obstacle avoidance**: fish within ~1.2 m of the pointer's water position during stir
  flee; near-surface fish may breach slightly with a splash.
- **Currents**: gentle advection/drift near strong wakes.
- Motion integration: steering forces (arrive, avoid, separate), drag, speed clamp, smooth
  yaw/pitch, turn banking, depth spring. World bounds hard-clamped.

Disturbance bus: impacts, stir path, food, fish splashes. Fish reaction and water ripples come
from the same events.

---

## 8. Interaction design

- **Camera**: right-drag orbit (or left-drag on non-water/empty UI), wheel/double-finger zoom,
  middle/right+shift pan; damped. Left-drag is reserved for water interaction. Touch: 1 finger
  interacts over water, 2 fingers orbit/zoom.
- **Modes** (toolbar + keys):
  - `1 / Throw` — hold to charge, aim with cursor, release to throw selected object. Throwable
    chips (pebble, stone, apple, duck, ball, leaf).
  - `2 / Touch` — drag through water: press, push, swirl, lift; strong localized forces; fish
    flee. Cursor becomes a hand/ripple.
  - `3 / Feed` — click to scatter food; fish converge.
  - `4 / View` (or right-drag) — orbit camera.
- **Hover ring** projected on the water, scaled by charge; trajectory preview dotted arc.
- **Conditions panel**: Time of day (6–23 h), Wind (0–100%), Rain (0–100%), Water clarity
  (absorption), Quality (Auto/High/Medium/Low), Sound. Presets: Golden Hour, Misty Dawn,
  Overcast, Rain, Moonlit.
- **Keys**: 1–3 modes, Space throw charge? (avoid), H help, P photo mode, M mute, R rain toggle,
  Esc close panel, Shift+drag = camera.
- **Feedback**: subtle toast/flavour text; stats (fps, sim, fish count, object count); debug
  panel `?debug=1` with height/velocity view, wireframe.
- No accidental camera motion when interacting with water.

---

## 9. Environment & atmosphere

- **Sky**: analytic single-scattering-ish gradient (Rayleigh + Mie), sun disc with limb glow,
  moon at night, procedural clouds (2D fbm advected, sun-lit edges), stars (hash), milky way
  hint, horizon haze. Sky drives fog colour, sun colour/intensity, water scatter colour, ambient.
- **Time of day**: continuous sun path; golden hour default. At night: moonlight, stars, lantern
  point light, fireflies, cooler water, frogs, mist.
- **Terrain material**: layered albedo (submerged silt, wet pebbles/sand, dry bank, grass,
  meadow), slope/height blending, procedural pebble/sand normal, grass clumps via instancing,
  small flowers, fallen leaves. Wetness and foam at the waterline. Caustics underwater. Shadows.
- **Vegetation**: 14–18 stylized trees (tapered trunk, branch cylinders, deformed foliage
  clusters) with wind sway; reeds/cattails in clusters near the banks; lily pads with flowers;
  grass blades; shoreline rocks/boulders; fallen branches; a jetty with lantern, rope and
  bucket; a small wooden rowboat? (stretch).
- **Life**: dragonflies with flapping wings; butterflies over the meadow; distant birds circling;
  fireflies at dusk/night. Mosquito-like specks near water at dusk (subtle).
- **Mist**: animated low fog sprites over water at dawn/dusk/raincool.
- **Weather**: rain streaks (instanced), ripple field, surface darkening, cloud cover increase,
  audio layer, wind gusts.

---

## 10. Audio (procedural, WebAudio)

- Master chain: sum → convolver reverb (procedural 1.8 s noise IR) → compressor/limiter → gain.
- Ambient: wind (filtered brown noise, slow LFO), water lapping (band-passed noise with
  irregular amplitude), daytime birds (occasional FM chirps), crickets/frogs at night.
- Events: splash (noise burst with fast decay + low thump), plop (sine pitch drop), bubble (short
  rising sine), fish surface (tiny plop), rain (noise bed + sparse droplet ticks), impact thud
  for stones on the jetty. Stereo pan by screen position/distance, gain by energy.
- Start after first user gesture; mute toggle; fade in/out.

---

## 11. UI / art direction

- Typography: self-hosted serif display (elegant, e.g. Cormorant Garamond) + clean sans
  (Inter/Manrope). Offline fallbacks. Warm off-white text.
- Quiet glass panels with hairline borders, soft blur, low opacity. Minimal chrome.
- Top-left: "STILLWATER" wordmark, "a living pond" subtitle. Top-right: clock/weather +
  sound/help buttons.
- Bottom-center: mode pills + throwable chips. Bottom-left: conditions panel (collapsible).
  Bottom-right: stats/quality.
- Intro: slow fade from dark, title, subtle hint; no blocking modal. Sound prompt on first tap.
- Responsive: panels collapse on mobile, touch-friendly 44 px targets.
- Photo mode hides all UI except a small exit hint.

---

## 12. Code layout

```
index.html
src/main.js                 bootstrap, loop, quality, debug API
src/App.js                  orchestration
src/core/Engine.js          renderer, cameras, resize, post pipeline
src/core/Noise.js           seeded value/simplex/fbm noise, RNG
src/core/Shaders.js         shared GLSL chunks (noise, caustics, packing)
src/world/Terrain.js        height function, mesh, material
src/world/Sky.js            sky shader, sun/moon, env map, lights, fog
src/world/Vegetation.js     grass, reeds, lilies, trees, flowers, rocks
src/world/Jetty.js          dock, posts, lantern
src/world/Life.js           dragonflies, butterflies, birds, fireflies, mist
src/water/WaterSim.js       macro + micro GPU solvers, impulses, readback
src/water/WaterSurface.js   water mesh, reflection, shaders
src/water/Caustics.js       shared caustic GLSL/helper
src/physics/Physics.js      rigid bodies, buoyancy, collisions, events
src/physics/Objects.js      procedural object meshes + pooling
src/fish/FishSystem.js      boids/AI, events, ripples
src/fish/FishGeometry.js    procedural fish/fins
src/fx/Particles.js         splashes, bubbles, rain
src/interaction/Interaction.js pointer modes, throwing, stirring, feeding
src/audio/Audio.js          procedural sound engine
src/ui/UI.js + styles.css   overlay, controls, help, stats
src/utils/*                 math, pooling
PLAN.md, TODO.md, README.md
scripts/verify.mjs          Playwright screenshots/console checks
```

---

## 13. Performance plan

- Sim: 256² macro + 512² micro, 1–2 substeps/frame, negligible fragment cost.
- Render targets: internal resolution = min(DPR, 1.75), scene MSAA 4 (high); reflection 0.5×;
  bloom at 1/4.
- Instancing for fish (2 draw calls), reeds/grass/lilies/leaves, droplets, rain.
- Shadow map 2048 high / 1024 low, tight 26 m ortho frustum.
- Object/fish updates: fixed timestep, spatial hashing only where needed (fish neighbor checks
  n≈54 are cheap).
- Adaptive quality: watch rolling FPS; step down DPR → reflection → MSAA → micro sim res.
  Pause simulation when tab hidden. Clamp substeps to avoid death spiral.
- No per-frame allocations in hot loops. Reuse vectors/matrices.
- Quality presets and URL `?quality=low|medium|high` for testing.

---

## 14. Milestones (implementation order)

1. Scaffold, HTML/CSS shell, renderer, camera, resize, loop, debug hooks.
2. Terrain height function + mesh + bed texture; sky + sunlight + fog; basic water plane.
3. Macro sim (virtual pipes) + micro ripple sim + impulse system + surface mesh displacement.
4. Water optics: scene RT, depth, planar reflection, refraction, absorption, normals, foam.
5. Caustics, shoreline wetness, post pipeline (bloom, ACES, AA).
6. Environment: vegetation, rocks, jetty, lilies, grass, distant trees, life.
7. Objects + physics + buoyancy + readback + wakes + sprays/bubbles.
8. Fish geometry + swimming shader + AI + events + shadows.
9. Interaction modes, throwing/charge/preview, stirring, feeding, UI.
10. Audio, presets, time of day, rain/wind, night.
11. Performance tuning, screenshots, bug fixing, documentation.

---

## 15. Verification plan

- `npm run dev`; Playwright script opens the page, waits for `window.__pond.ready`, asserts no
  console errors/page errors, captures 1440×900 screenshots:
  golden hour default, close-up ripples after stone throw, duck floating, feeding fish,
  rain, night. Use `window.__pond` debug API to set state deterministically.
- Screenshot review by image inspection; iterate on composition, exposure, water look.
- Physics checks:
  - Ripple ring expands and reflects from shore; amplitudes decay.
  - Floating object sits at expected waterline (duck high, apple low); tilts on waves.
  - Stone creates crater/crown/foam; floaters bob after impact.
  - Fish flee the impact and return; food attracts them; ripples appear.
  - Rain produces many rings; wind produces directional chop.
  - No NaNs (`window.__pond.stats.nan`), no negative volume, no console warnings.
- Performance: report FPS at 1080p high/medium/low in the UI; ensure headless low quality
  screenshots complete in reasonable time.
- Resize, mobile-ish viewport, pointer/touch interactions.

### Risks & mitigations
- **Planar reflection cost / artifacts** → half-res, clipping plane, normal perturbation, sky
  fallback; toggle off in low quality.
- **Async readback unavailable/slow** → sync 64² fallback, 2-frame interval, simulation-only
  fallback for buoyancy if no float render targets.
- **Two layers disagree visually** → combined height everywhere (render + CPU), wet masks and
  damping near shore; tune micro speed/amplitude.
- **Shader compilation on Safari/ANGLE** → avoid exotic features, test WebGL2, guard float
  extension, no textureLod in vertex unless supported.
- **Too many draw calls** → merge/instance vegetation, object pooling, fish instancing.
- **Scene looks like a tech demo** → art direction first: fog, golden light, quiet UI, life,
  audio, composition; iterate via screenshots.

---

## 16. The self-prompt (execution contract)

> You are building Stillwater, an interactive physically-based pond in Three.js. Follow this
> plan rigorously. Build incrementally, test in a real browser, and inspect screenshots. The
> water is the protagonist: every interaction must produce a physically plausible response, with
> no visible popping, instability, or fake scrolling normals. Floating objects must follow the
> exact rendered surface. Fish must respond to the same disturbance events that move the water.
> Keep the code modular and readable. Never sacrifice stability for amplitude. Use the todo list
> continuously. When a choice arises between a simple visual trick and a correct simulation,
> implement the correct simulation at the lowest affordable resolution. The final result should
> feel calm, alive, and expensive — a place someone wants to sit beside.
