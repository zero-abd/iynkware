import { config } from "zod/v4/core";

// zod otherwise probes `new Function` when it builds an object schema, which the page CSP (no 'unsafe-eval')
// reports as a violation even though the probe is caught. Every schema comes from here, so the switch is set
// before the first one is built and only the pages that load zod pay for it.
config({ jitless: true });

export { z } from "zod";
