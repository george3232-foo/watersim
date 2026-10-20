# Stillwater — interactive physically-based pond

## Research & plan
- [x] Research real-time shallow-water / wave solvers, buoyancy coupling, water optics
- [x] Write the detailed implementation plan (`PLAN.md`)
- [x] Scaffold Vite + Three.js project

## Water simulation
- [x] GPU virtual-pipes shallow water solver (height + flux, wet/dry, volume conserving)
- [x] Wind stress, rain forcing, friction, boundary absorption
- [x] Interaction impulses (stir, throw impacts, fish, rain)
- [x] Displacement / foam field
- [x] Async CPU readback of height + velocity for buoyancy
- [x] Water surface rendering: refraction, planar reflections, Fresnel, absorption, foam
- [ ] Caustics projected on bed and underwater objects — tuning brightness

## World & rendering
- [x] Procedural pond terrain, bed, shoreline base shader
- [x] Sky + sun + clouds + time of day + night
- [x] Distant landscape / hills / forest ring to hide terrain edge
- [x] Instanced grass, wildflowers, reeds shoreline planting
- [x] Trees + framing foreground silhouettes
- [x] Jetty, lantern, lily pads, driftwood, shoreline rocks
- [ ] Golden-hour palette, exposure and water optics calibration
- [x] Postprocessing: HDR bloom, ACES, grade, vignette, grain, FXAA

## Life & interaction
- [x] Procedural koi/minnow geometry + swimming shader
- [x] Fish boids AI: wander, shoal, avoid, startle, feed, surface
- [x] Fish ripples and reaction to player
- [x] Rigid bodies: pebbles, stone, apple, duck, ball, leaf; buoyancy, drag, ground/bed rest
- [ ] Splash droplets, bubbles, rain splash particles (ripples exist)
- [x] Throw/stir/feed interaction modes + trajectory preview
- [x] Procedural audio: ambience, splashes, stir, fish plops, birds/frogs
- [x] UI: title, toolbar, sliders, help, stats, loading

## Milestones
- [ ] M1 — believable still frame: sky, landscape, trees, vegetation, water optics (props in; tuning)
- [ ] M2 — koi + food + startle behaviour (implemented; visual verification in progress)
- [ ] M3 — throwable rigid bodies with two-way buoyancy (implemented; verification in progress)
- [ ] M4 — touch/stir, splashes, rain, audio (implemented; verifying)
- [ ] M5 — presets, quality scaling, final verification

## Verification
- [x] Browser test with Playwright, console clean (verify + interaction harness)
- [ ] Interaction test: throw/stir/feed counts + screenshots
- [ ] Screenshots across presets/time of day
- [ ] Physical behavior sanity checks
- [ ] README + final polish
