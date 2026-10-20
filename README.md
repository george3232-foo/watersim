# Stillwater

An interactive, physically-grounded pond rendered with Three.js and WebGL2. Everything —
terrain, plants, trees, fish, props, sky and sound — is generated procedurally; there are no
textured or modelled assets.

Throw pebbles, stones, apples, a rubber duck, a beach ball or a leaf into the water. Drag a
finger (or the mouse) through the surface to stir it. Sprinkle food and watch the koi rise,
nibble — and scatter when something hits the pond.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

Requires a WebGL2 browser. The simulation uses float render targets; on devices without
`EXT_color_buffer_float` it falls back to half-float, then to RGBA8.

## Controls

| Input | Action |
| --- | --- |
| Left click / tap | Use the active mode (throw · stir · feed) |
| Drag (touch mode) | Stir the surface, leaving a turbulent wake |
| Right-drag | Orbit the camera |
| Wheel / pinch | Zoom |
| `1` `2` `3` | Throw / touch / feed modes |
| `H` | Help |
| `P` | Photo mode (hides UI) |
| `M` | Mute |

The conditions panel changes time of day, wind strength and rain. The presets jump to a golden
evening, dawn, overcast, a rainy afternoon or night.

## How the water works

Two coupled GPU solvers run every frame at a fixed 120 Hz timestep:

1. **Macro layer — virtual pipes shallow water, 256² RGBA32F.**
   Per-cell surface height and face fluxes. Fluxes accelerate from surface-height differences
   (`q += g·Δt·h·Δη`), are friction-damped, and are rescaled so no cell can drain below zero.
   Height then integrates flux divergence, so volume is conserved and wet/dry shorelines appear
   naturally. This layer carries the bulk waves (speed `√(g·h)`, ≈ 3.8 m/s at the deepest point)
   with a 2.4× CFL margin at the fixed timestep.
2. **Micro layer — dispersive ripple field, 512² RGBA16F.**
   Short gravity–capillary ripples travel at 0.42–0.72 m/s (the correct order of magnitude for
   waves of a few centimetres), with stronger viscous damping in the shallows. Wind chop is three
   directional wave trains plus gust noise; rain adds stochastic impact rings.

Impulses (throws, stirring, fish, food) are injected into both layers. A 128² RGBA8 packing of
surface height and depth is read back asynchronously twice per frame; buoyancy, lily pads, fish
depth limits and camera-relative effects all sample that CPU mirror of the GPU state.

## Rendering

- HDR scene target with depth, planar reflection target, screen-space refraction.
- Beer–Lambert absorption with path length `2·depth / cos θ`, Fresnel mix, GGX sun highlight,
  foam from impact and shoreline fields, drifting pollen flecks.
- Terrain shader with wet shoreline, silt/algae bed, procedural ground bump and animated
  caustics driven by the macro solver's curvature.
- Sky with sun-positioned scattering, layered clouds, fog; post chain of bloom, ACES tonemap,
  grade, vignette, grain and FXAA.

Debug water buffers with `?debug=N` (1 reflection, 2 refraction, 3 Fresnel, 4 absorption,
5 foam, 6 scene, 7 normals, 8 N·V, 9 depth). `?quality=low|high` scales resolution.

## Fish

Koi and minnows are single instanced geometries with a travelling-wave vertex deformation
(tail amplitude grows toward the peduncle) and procedural colour patterns in the fragment
shader. The CPU brain is a small boids + state machine: wander, shoal (minnows), separation,
shore avoidance, startle (dart away from impacts), feed (rise to food), and surface sipping that
emits real ripples into the solver.

## Throwables

Six body types with mass, drag and buoyancy derived from real units: gravity, displaced-volume
buoyancy by submerged fraction, quadratic drag against the local flow, slosh torque, ground and
bed restitution. Entries splash into the solver proportionally to momentum, startle nearby fish
and trigger audio.

## Project layout

```
src/core/        Engine (HDR pipeline), GLSL helpers, noise
src/water/       WaterSim (macro + micro solvers, readback), WaterSurface (optics)
src/world/       Terrain, TerrainHeight, Landscape, Vegetation, Props, Sky, BedTexture
src/life/        Fish, Food, Throwables
src/audio/       PondAudio (procedural WebAudio)
src/App.js       orchestration, camera, input modes, preview
scripts/         verify.mjs (screenshot + console), interact.mjs (mode tests)
```

## Verification

```bash
node scripts/verify.mjs     # screenshot + console check → /tmp/pond.png
node scripts/interact.mjs   # throw / stir / feed test → /tmp/pond-interact.png
```

Both run headless Chromium with SwiftShader and are expected to report an empty console log.

## Trade-offs

The heightfield approach is the standard real-time approximation for pond-scale water. Vertical
spray is represented by short-lived ripple/foam impulses rather than a volumetric phase, and the
two frequency bands are hand-split rather than solved by a fully dispersive model. Everything is
tuned to look and respond plausibly at pond scale; it is not a Navier–Stokes solver.
