/// <reference types="vite/client" />

// Compile-time constants injected by vite.config.ts → define.
// Format: CalVer YY.M.PATCH (e.g. "26.5.1") bumped in apps/web/package.json
// before each deploy. GIT_COMMIT is the 7-char short SHA in CI, "dev" locally.
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
declare const __GIT_COMMIT__: string;
