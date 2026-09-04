import { INITIAL_SCHEMA_STATEMENTS } from '../schema';

export const initialMigration = {
  version: 1,
  name: 'initial_schema',
  statements: INITIAL_SCHEMA_STATEMENTS,
} as const;
