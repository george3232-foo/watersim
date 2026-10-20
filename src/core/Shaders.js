// Shared GLSL chunks. All functions prefixed sw_ to avoid collisions with three.js chunks.
export const GLSL_NOISE = /* glsl */`
float sw_hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sw_hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float sw_noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = sw_hash12(i);
  float b = sw_hash12(i+vec2(1.0,0.0));
  float c = sw_hash12(i+vec2(0.0,1.0));
  float d = sw_hash12(i+vec2(1.0,1.0));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float sw_fbm(vec2 p){
  float a = 0.5, s = 0.0;
  mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  for(int i=0;i<5;i++){ s += a * sw_noise(p); p = R * p * 2.03 + 9.2; a *= 0.5; }
  return s;
}
float sw_fbm3(vec2 p){
  float a = 0.5, s = 0.0;
  mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  for(int i=0;i<3;i++){ s += a * sw_noise(p); p = R * p * 2.03 + 9.2; a *= 0.5; }
  return s;
}
`;

export const GLSL_CAUSTIC = /* glsl */`
// Classic iterative water caustic network, in world units.
float sw_caustic(vec2 uv, float time){
  vec2 p = uv * 5.6 - 2.8;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.0055;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.6 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

export const GLSL_WATER_COMMON = /* glsl */`
// Perspective window-space depth [0,1] -> positive view distance in metres.
// (The previous version used the NDC [-1,1] formula, which over-estimated
// every distance behind the water by up to ~2x at typical pond ranges.)
float sw_linearDepth(float d, float near, float far){
  return (near * far) / (far - d * (far - near));
}
vec3 sw_beer(vec3 color, float dist, vec3 sigma){
  return color * exp(-sigma * dist);
}
`;

export const GLSL_SKY_COLOR = /* glsl */`
vec3 sw_skyAmbient(vec3 n, vec3 zenith, vec3 horizon){
  float t = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(horizon, zenith, t);
}
`;

export function hashString(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
	return (h >>> 0);
}
