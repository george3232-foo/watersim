# Stillwater improvement implementation plan

## Goal and execution contract

Improve the existing procedural Three.js pond, rather than replace it. Complete the
previous review's correctness, performance, interaction, physics, visual, audio,
and testing recommendations as a connected, verifiable application flow.

Keep Vite, Three.js, JavaScript ES modules, procedural assets, and GitHub Pages.
Do not introduce a framework, external art assets, a backend, or new dependencies.
Preserve unrelated/untracked work. The user explicitly requires local-only changes:
do not commit, push, publish, or open a pull request.

This is the execution plan and self-prompt for this implementation session. Read
it before integration, execute phases in dependency order, keep the live todo list
current, and append actual verification results rather than inferred successes.

## Baseline evidence

- `npm test` is a failing placeholder; browser scripts print reports but do not
  assert success. Deployment currently builds without behavioral checks.
- Existing browser checks render without console errors. Throw, stir, and feed
  create state changes, but throwing fires on press rather than release.
- Night at 22.2 h has a night factor of only 0.028 because solar elevation is
  clamped above the horizon. Sound button, R shortcut, and photo exit are unwired.
- Low-quality automated Chromium runs reported approximately 5–17 FPS on this
  environment's Intel UHD 630. This is not a general hardware benchmark.
- Draw statistics show only the final fullscreen pass, not the complete frame.
- Raw signed solver data cannot work in the advertised unsigned-byte fallback.
- `levelOffset` never changes; throwable integration is frame-dependent; fish
  depth uses a static waterline. Several documentation claims are therefore stale.

## Completion criteria

1. Sun elevation is positive by day and negative by night, continuous at sunrise,
   sunset, and midnight; night controls stars, moonlight, lantern, and audio.
2. Sound button and M agree; R updates rain and its slider; photo mode has a
   working exit; hints reflect throw/touch/feed; keyboard shortcuts respect forms.
3. Pressing begins a throw charge, release creates exactly one body, cancellation
   creates none, a quick tap still works, and two-finger camera gestures do not
   throw accidentally. Target marker and trajectory share the launch solution.
4. Fast stirring produces a bounded, continuous series of impulses. Sound is
   throttled rather than allocating a noise burst for every pointer event.
5. High/medium/low change real GPU work: render scale, simulation grid, surface
   grid, reflection resolution/cadence, shadow resolution, foliage, and bloom.
   Auto quality has warm-up, hysteresis, cooldown, and explicit manual override.
6. Resolution changes preserve the current solver field and actors. All shader
   texel/domain calculations use the actual configuration, not hardcoded sizes.
7. Unsupported WebGL2/float-target combinations display an accessible error and
   do not start an invalid unsigned-byte or HDR pipeline. Float linear filtering
   is used only when supported; half-float remains a valid supported path.
8. Frame statistics include all passes. CPU submission timings are labeled as
   such; GPU timing, if supported, is asynchronous and separately labeled.
9. Throwable integration is fixed-step; floaters align with local slope; displaced
   volume produces a bounded uniform level offset; fish respect the local surface.
10. Impact effects differ by object type; rings and returning droplets follow the
    sampled water height, including wave and displaced-level changes.
11. Vegetation silhouettes are less spherical/repetitive, chromatic aberration is
    restrained, presets are distinct, and near-surface koi remain readable without
    making the entire pond transparent. No new scene clutter is required.
12. Splash/stir/plop audio pans and attenuates relative to the camera; audio starts
    on a gesture, can resume, and is suspended while the document is hidden.
13. Unit tests, browser assertions, production build, mobile/layout checks, and
    short water-health checks all run successfully. Console errors are failures.
14. README, TODO, this plan, and a resumable handoff describe the implementation
    and actual checks, including remaining physical/performance limitations.

## Work ownership and integration boundaries

Independent implementation can proceed concurrently, but only one owner edits a
given file. The coordinator owns App.js, main.js, index.html, styles.css, final
documentation, and combined verification. Delegated owners do not edit those.

- Rendering/performance: Engine, WaterSim, WaterSurface, Terrain, BedTexture,
  and a pure `src/core/Quality.js` module.
- Physics/audio: Throwables, Fish, Food, SplashFX, PondAudio, and focused helper
  modules if needed. No App or DOM changes.
- Atmosphere/vegetation: Sky, Landscape, Vegetation; shader changes stay local.
- Verification: test files, reusable browser harness, package scripts, browser
  diagnostics, and CI workflow. Tests target the public contracts below.

The coordinator verifies all delegated results, resolves interface mismatches,
and reruns real browser flows after combining the changes.

## Phase 1 — lighting, controls, and interaction correctness

1. Replace the clamped solar elevation with a continuous 24-hour path. Preserve
   the existing sunrise/sunset composition while letting the sun travel below
   the horizon at night. Add a restrained, shadowless moon light.
2. Centralize UI state setters for mute, rain, photo mode, and conditions. Update
   visible text, pressed/expanded state, slider output, and hints together.
3. Guard keyboard shortcuts while editing inputs/selects/textareas. Escape closes
   help, exits photo mode, and cancels an active charge. Ignore key repeat toggles.
4. Keep OrbitControls right-drag and two-finger orbit/zoom. Track active pointers;
   a second touch cancels the pending single-finger action. Capture the primary
   pointer so release outside the canvas cannot leave stirring/feeding active.
5. Charge is a normalized, clamped function of elapsed monotonic time. A tap gets
   a minimum useful throw; holding increases flight arc/effort. Use one ballistic
   solver for spawning, trajectory, and impact marker. No random aiming error.
6. Write trajectory positions directly into the geometry's position attribute;
   mutating the original Vector3 array alone does not update a BufferGeometry.
7. Intersect the pointer against the current level plane and validate wet terrain.
   Keep aim feedback hidden outside valid water. Cancel on blur/visibility/mode
   change; never throw on pointercancel, lost capture, or a multitouch transition.

Acceptance: direct DOM/pointer tests verify controls, charge down/up/cancel,
keyboard form guards, mode hints, and photo exit at desktop and mobile widths.

## Phase 2 — capabilities, profiling, and meaningful quality

### Public contracts

`src/core/Quality.js` exports `QUALITY_PRESETS` and `QualityController`:

- `new QualityController(mode = 'auto', initialTier = 'high')`.
- `.mode` is auto/high/medium/low; `.tier` is the active concrete tier.
- `.settings` is the current preset; `.setMode(mode)` changes selection.
- `.update(fps, dt)` returns true only when the concrete tier changes.
- Preset keys: `scale`, `maxDpr`, `macroSize`, `microSize`, `waterRes`,
  `reflectionScale`, `reflectionInterval`, `shadowSize`, `bloom`, `foliage`.
- Initial targets: low 128/256/128 grids, 512 shadows, 0.35 reflections every
  third frame, no bloom; medium 192/384/192, 1024 shadows, 0.45 reflections every
  second frame; high 256/512/256, 2048 shadows, 0.6 reflections every frame.
- Auto: allow startup warm-up, sustained low FPS before downgrading, a longer
  sustained high-FPS interval before upgrading, and a cooldown after switches.

### Three.js implementation sequence

1. Probe render-target and texture-filter capabilities immediately after renderer
   creation, before generating the world. Use half-float if supported; otherwise
   stop with a user-facing unsupported-device error. Do not encode signed solver
   state into RGBA8 without a complete representation change.
2. `Engine.setQuality(settings)` applies render settings; App performs resize.
   Recreate and dispose size-dependent targets safely. Invalidate reflection on
   resize; when reflection is skipped retain BOTH its texture and texture matrix.
3. `Engine.beginFrame()` resets renderer info once; `Engine.endFrame()` stores
   `.frameStats`. Disable auto-reset between passes. Record `.timings` as CPU
   submission milliseconds; optional `.gpuTimings` uses nonblocking disjoint timer
   queries, with bounded outstanding queries and no blocking result reads.
4. `WaterSim(renderer, hf, bed, domain, opts)` accepts macroSize/microSize.
   `setResolution(macroSize, microSize)` resamples existing ping-pong state into
   the new targets, updates uniforms, and disposes old targets. No actor reset.
5. Replace hardcoded solver/world dimensions with domain/half/texel uniforms.
   Preserve the fixed 1/120 s timestep and bounded catch-up. Expose update timing,
   readback latency/failure state, and pending-impulse count in the debug stats.
6. `WaterSurface.setResolution(n)` swaps/disposes geometry. Finite differences
   use sim.macroSize/microSize; add reduced chromatic-aberration controls locally.
7. `Terrain.setSimulationSize(n)` updates caustic texel sampling. Bed texture
   filtering is capability-aware rather than assuming float-linear support.
8. App adds an Auto/High/Medium/Low select. `App.setQuality(mode)` immediately
   updates Engine, solver, water geometry, shadow maps, foliage counts, and UI.
9. Do not adapt while hidden or during loading. On visibility return clear time
   debt and restart warm-up; suspend/resume audio. Explicit quality URL/manual
   choices remain stable and never get silently overridden by Auto.

Acceptance: every tier allocates the requested sizes; switching preserves actors
and finite water state; low performs less measured work; frame calls > 1; CPU/GPU
timing labels are honest. Do not promise a universal 60 FPS result.

## Phase 3 — water feel and fixed-step coupling

1. Interpolate stir segments in world space at spacing related to impulse radius.
   Bound samples per pointer event, clamp speed/energy, normalize strength so a
   long segment does not multiply input energy arbitrarily, and preserve queue
   capacity. Generate one fish disturbance and one throttled sound per gesture
   update rather than one for every interpolated sample.
2. Give Throwables its own 1/120 s accumulator and bounded substeps. Keep drag
   integrated implicitly. Reuse scratch vectors/matrices/quaternions in hot paths.
   Separate simulation from the once-per-frame instance-matrix upload.
3. Obtain local surface height and slope for buoyancy, bed clearance, and target
   orientation. Transform local up toward the sampled water normal, with damping
   and bounded angular acceleration. Preserve density distinctions and recycling.
4. Sum submerged volume of active bodies after the fixed steps. WaterSim exposes
   `setDisplacedVolume(volume, dt)`: divide by a sampled wet pond area and smoothly
   approach a bounded level offset (0..0.03 m). No force-driven mass is added to
   the gradient solver. Reconcile readback's captured level with current level
   when sampling so CPU/GPU views do not double-count the offset.
5. Fish sample local height for preferred depth, feeding/nibbling, ripple emission,
   and surface clamps. Preserve bed clearance and current boids behavior. Existing
   pellets follow that same surface and remain bounded by the pool.
6. SplashFX accepts `{ sim, engine, camera, renderer }`. Impact options include
   object `type`, `radius`, and entry `vy`. Distinguish a small sharp pebble crown,
   heavy stone crown/foam, soft floater entry, and light leaf contact.
7. Rings keep their x/z and resample height each frame. Droplets merge at the
   current local water surface, not y=0. Respect manual scene-depth occlusion.
8. Reorder App updates so forces use a completed GPU step, actor impulses enter
   the next bounded step, and rendering sees the latest displacement offset.

Acceptance: equivalent simulated time at 30/60/120 Hz yields matching body state;
floaters settle without explosions and tilt on a sloped surface; a submerged body
raises level; fish remain between bed and water; rings move when surface rises.
Unforced-water tests measure finite values and bounded volume drift. Do not claim
exact volume conservation during clipped shore impulses or numerical safety clamps.

## Phase 4 — atmosphere, vegetation, and spatial audio

1. Keep procedural trees but vary crown proportions, asymmetric lobe placement,
   and silhouette density deterministically. Use smaller overlapping clumps and
   less saturated card colors rather than increasing geometry without a budget.
2. `Landscape.setQuality(settings)` and `Vegetation.setQuality(settings)` adjust
   instance counts non-destructively. Keep hero structure; thin leaf/ground detail
   deterministically and spatially rather than deleting the last forest sector.
3. `Sky.setQuality(settings)` updates shadow-map size and invalidates/disposes an
   old shadow map as necessary. Preserve continuous sun, moon, weather, and fog.
4. Reduce post chromatic aberration and keep lighting/weather presets distinct.
   Improve water's short submerged-path treatment for near-surface fish without
   globally removing absorption or reflection. Check screenshots, not just code.
5. PondAudio exposes `setListener(camera)`, `suspend()`, `resume()`, and `dispose()`.
   Event sounds use camera-relative stereo panning and distance attenuation;
   ambience stays broad. Event coordinates flow through splash/stir/plop methods.
6. Add safe AudioContext resume after gestures and hide/show. Avoid triggering an
   unbounded number of sources during stirring. Disconnect/close owned resources
   on disposal. No external audio files or positional-sound dependencies.

Acceptance: noon/night/rain/dawn screenshots are distinct; low has reduced detail
without an empty forest; left/right event positions give opposite pan; moving the
camera changes listener coordinates; mute and visibility do not leak sound.

## Phase 5 — automated verification and local-only delivery

1. Use Node's built-in `node:test` for pure quality, solar/physics, displacement,
   and bounded-pool tests. Keep tests deterministic with seeded data/stub surfaces.
2. Use the existing Playwright package for real browser integration. A reusable
   helper starts an owned Vite server on loopback, waits for readiness, launches
   Chromium, captures console/page errors, and closes browser/server in finally.
   Tests must fail on errors rather than swallow timeouts or screenshot failures.
3. Public browser contracts: `window.__pond.ready`, `getStats()`, `setQuality(mode)`,
   `setTime(hour)`, `setRain(amount)`, `setMode(mode)`, `throwAt(x,z,charge=1)`,
   `feedAt(x,z)`, and `stirAt(x,z,vx,vz,dist)` remain available.
4. `getStats()` includes quality/qualityMode, macroSize/microSize, real frame
   calls/triangles, timings, readback latency, and existing fish/body/pellet counts.
5. Browser tests cover startup, meaningful draw statistics, all controls,
   charge/cancel, feed/stir, quality switching, the half-float/unsupported-device
   path where safely emulated, finite water state, resize, and touch/layout.
6. Update verify/interact scripts to assert behavior and create screenshots in a
   configurable output directory. Add npm test:unit/test:browser/test:all scripts.
7. CI installs Chromium and runs unit/browser checks plus build on pull requests
   and pushes; deployment consumes a successfully verified build. This only edits
   local workflow files; do not trigger, publish, or push anything.
8. Capture matched before/after low-quality measurements with viewport, GPU,
   conditions, warm-up, and wall-clock interval recorded. Report FPS AND simulation
   work so slowing the world is not misrepresented as a free performance gain.
9. Finish with `npm test`, browser suite, build, screenshot inspection, git diff
   review, README/TODO updates, and an evidence-based handoff. If a target remains
   unverified, say so explicitly rather than marking it complete.

## Self-fed implementation prompt

You are implementing this plan in the existing Stillwater Three.js workspace.
Complete one observable flow at a time. Preserve the procedural art direction,
single terrain source of truth, GPU water/CPU actor split, and current dependency
choices. Implement and wire every public contract above through the actual UI.
Use bounded independent owners, inspect their changes, and integrate interfaces
carefully. Test real behavior and inspect screenshots; do not substitute a passing
build for working physics, controls, or supported-device rendering. Use measured
evidence to tune quality without claiming unsupported universal performance.
Update todos when work actually completes. Keep all changes local. Finish with
clear changed-file paths, exact check commands/results, known limits, and how to
try the finished app.

## Verification log

Completed locally on the current workspace. No commit, push, publish, or pull
request was created.

- `npm test`: 19 deterministic unit tests passed.
- `npm run test:all`: 19 unit tests plus 6 Playwright browser tests passed.
- `npm run build`: Vite production build passed; Vite still reports the expected
  large JavaScript chunk advisory (~793 kB minified, ~210 kB gzip).
- `node scripts/verify.mjs`: passed with day/night screenshots, finite water
  health, below-horizon night sun, frame/draw/timing diagnostics, and no unexpected
  browser errors.
- `node scripts/interact.mjs`: passed with charged release, tap throw, feed,
  stirred impulse count, quality changes, and day/night screenshots.
- Browser coverage passed for unsupported float targets, half-float capability
  masking, controls and form guards, photo mode, rain shortcut, charge/cancel,
  feed/stir, quality switching, resize/mobile touch cancellation, and water health.
- Final clean low-quality smoke runs on the local Intel UHD 630 varied roughly from
  10–30 FPS depending on warm-up/scene state, with low-tier frame stats reduced to
  about 0.67M triangles in one captured run. This is environment evidence only.
- Screenshots and JSON reports are in `tests/artifacts/`. They are generated
  verification artifacts and are not intended as source deliverables.

Known limits remaining: the app is still a heightfield approximation rather than
volumetric fluid; asynchronous GPU readback can be stale on slow drivers; the
production JavaScript bundle remains above Vite's default chunk advisory; and
integrated-GPU performance varies significantly with browser/driver state.
