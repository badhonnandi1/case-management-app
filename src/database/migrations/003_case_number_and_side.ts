export const caseNumberAndSideMigration = {
  version: 3,
  name: 'case_number_parts_and_represented_side',
  statements: [
    'ALTER TABLE cases ADD COLUMN case_type TEXT',
    'ALTER TABLE cases ADD COLUMN case_serial TEXT',
    'ALTER TABLE cases ADD COLUMN case_year TEXT',
    "ALTER TABLE cases ADD COLUMN represented_side TEXT CHECK (represented_side IS NULL OR represented_side IN ('PLAINTIFF', 'DEFENDANT'))",
  ],
} as const;
