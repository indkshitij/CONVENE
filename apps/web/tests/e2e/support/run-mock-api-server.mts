import { startMockApiServer } from "./mock-api-server.ts";

// Standalone entrypoint (run directly via `node`, see playwright.config.ts's
// webServer entry) — kept separate from mock-api-server.ts so that file stays
// import.meta-free and safe to import from .spec.ts files via Playwright's
// own (CommonJS-oriented) TS transform.
const port = Number(process.env.PORT ?? 3101);
startMockApiServer(port);
console.log(`mock apps/api listening on :${port}`);
