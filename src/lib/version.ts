/** The version in package.json, which next.config.ts hands to the client; importing package.json itself would ship its scripts and dependency lists. */
export const version: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
