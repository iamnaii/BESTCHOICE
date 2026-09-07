# Shared utilities

Keep installment formulas in `src/installment-calc.ts`. The API compatibility
imports and the web app use this implementation.

`npm run build --workspace=@installment/shared` emits CommonJS and declarations
to `dist/` for the API and its production container. The web app resolves source
directly through its existing TypeScript and Vite aliases.

Install runs `prepare`. API `build`, `dev`, `start:dev`, `test`, `test:e2e`,
`test:watch`, and `test:cov` also build shared before starting, as does
`./tools/check-types.sh api` (or `all`). This covers restored dependency caches
that contain no build output.

The root `npm run dev` watches shared source. If working only in the API or
running API tests in watch mode, run `npm run dev --workspace=@installment/shared`
in another terminal when editing shared code. Lifecycle hooks build once when a
command starts; they do not continuously rebuild or restart API/test processes.
