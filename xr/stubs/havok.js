// Stand-in for `@babylonjs/havok` (vite.config.ts aliases it here). IWSDK's physics runtime imports Havok statically
// (a ~2 MB wasm plus its loader) but iynkware runs with `physics: false` and simulates in its own worker (Rapier).
// If the feature is ever turned on, fail loudly rather than load nothing.
export default function HavokPhysics() {
  return Promise.reject(new Error('Havok physics is stubbed out of the iynkware build (xr/stubs/havok.js)'));
}
