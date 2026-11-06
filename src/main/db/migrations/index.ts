export interface Migration {
  version: number;
  name: string;
  notes?: Readonly<Record<string, string>>;
  statements: readonly string[];
}

/** Flattened head. New migrations append here until the next flatten. */
export const SCHEMA_VERSION = 1;

export const MIGRATIONS: readonly Migration[] = [];
