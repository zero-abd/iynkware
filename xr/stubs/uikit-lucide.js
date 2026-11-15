// Stand-in for `@pmndrs/uikit-lucide` in the build (vite.config.ts aliases the bare package name here).
// The package is ~1,700 icon classes (4.5 MB) and IWSDK's uikit-horizon imports only these two. iynkware draws its
// own UI (xr/src/ui) and runs with `spatialUI: false`, so no other icon is ever looked up.
export { CheckIcon } from '@pmndrs/uikit-lucide/dist/Check.js';
export { ChevronDownIcon } from '@pmndrs/uikit-lucide/dist/ChevronDown.js';
