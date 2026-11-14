export interface Io {
  out(line: string): void;
  err(line: string): void;
  cwd: string;
  now(): number;
  env: Readonly<Record<string, string | undefined>>;
}

/** What a command asked for on the command line. */
export interface Flags {
  json: boolean;
  junit?: string;
  strict: boolean;
  for?: string;
  test?: string;
  format?: string;
  out?: string;
  assignment?: string;
}
