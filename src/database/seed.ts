import type { SQLiteDatabase } from 'expo-sqlite';

import type { CaseStatus } from '../models/Case';
import { addDays, toLocalDateString } from '../utils/date';
import { createId } from '../utils/id';

interface SeedCase {
  caseNumber: string;
  caseTitle: string;
  partyName: string;
  oppositePartyName: string;
  courtName: string;
  judgeName: string | null;
  previousDate: string | null;
  nextDate: string | null;
  previousOrder: string | null;
  nextStep: string | null;
  status: CaseStatus;
  notes: string | null;
  updatedOffset: number;
}

export async function seedDevelopmentData(database: SQLiteDatabase): Promise<void> {
  if (!__DEV__) {
    return;
  }

  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM cases',
  );

  if ((result?.count ?? 0) > 0) {
    return;
  }

  const today = new Date();
  const year = today.getFullYear();
  const dateAtOffset = (offset: number) => toLocalDateString(addDays(today, offset));
  const samples: SeedCase[] = [
    {
      caseNumber: `Civil Suit 124/${year}`,
      caseTitle: 'Rahman vs Karim',
      partyName: 'Md. Rahman',
      oppositePartyName: 'Md. Karim',
      courtName: 'Dhaka District Court',
      judgeName: 'Hon. Farhana Islam',
      previousDate: dateAtOffset(-21),
      nextDate: dateAtOffset(11),
      previousOrder: "Plaintiff's witness examination completed.",
      nextStep: 'Prepare documents for cross-examination.',
      status: 'ACTIVE',
      notes: 'Original deed is held in the client file.',
      updatedOffset: -1,
    },
    {
      caseNumber: `Criminal Revision 48/${year}`,
      caseTitle: 'State vs Hasan',
      partyName: 'The State',
      oppositePartyName: 'Hasan Ahmed',
      courtName: 'Metropolitan Sessions Court, Dhaka',
      judgeName: 'Hon. Kamal Uddin',
      previousDate: dateAtOffset(-14),
      nextDate: dateAtOffset(0),
      previousOrder: 'Bail extended until the next hearing.',
      nextStep: 'Present written submissions on maintainability.',
      status: 'ACTIVE',
      notes: null,
      updatedOffset: 0,
    },
    {
      caseNumber: `Family Suit 73/${year}`,
      caseTitle: 'Sultana vs Chowdhury',
      partyName: 'Nusrat Sultana',
      oppositePartyName: 'Arif Chowdhury',
      courtName: 'Family Court, Dhaka',
      judgeName: null,
      previousDate: dateAtOffset(-28),
      nextDate: dateAtOffset(3),
      previousOrder: 'Parties directed to attend mediation.',
      nextStep: 'Confirm client attendance and settlement position.',
      status: 'PENDING',
      notes: 'Awaiting updated income statement.',
      updatedOffset: -3,
    },
    {
      caseNumber: `Writ Petition 310/${year}`,
      caseTitle: 'Eastern Traders Ltd. vs Government',
      partyName: 'Eastern Traders Ltd.',
      oppositePartyName: "Government of Bangladesh",
      courtName: 'High Court Division',
      judgeName: 'Hon. Justice A. M. Kabir',
      previousDate: dateAtOffset(-9),
      nextDate: dateAtOffset(26),
      previousOrder: 'Rule issued; respondents directed to reply.',
      nextStep: 'Review affidavit-in-opposition when served.',
      status: 'ACTIVE',
      notes: null,
      updatedOffset: -5,
    },
    {
      caseNumber: `Money Suit 89/${year}`,
      caseTitle: 'Noor Bank Ltd. vs Alam Enterprises',
      partyName: 'Noor Bank Ltd.',
      oppositePartyName: 'Alam Enterprises',
      courtName: 'Joint District Judge Court, Gazipur',
      judgeName: null,
      previousDate: dateAtOffset(-45),
      nextDate: null,
      previousOrder: 'Suit disposed after satisfaction of decree.',
      nextStep: null,
      status: 'CLOSED',
      notes: 'Certified copy collected.',
      updatedOffset: -12,
    },
  ];

  await database.execAsync('BEGIN IMMEDIATE TRANSACTION');

  try {
    for (const sample of samples) {
      const createdAt = addDays(today, sample.updatedOffset - 20).toISOString();
      const updatedAt = addDays(today, sample.updatedOffset).toISOString();

      await database.runAsync(
        `INSERT INTO cases (
          id, case_number, case_title, party_name, opposite_party_name,
          court_name, judge_name, previous_date, next_date, previous_order,
          next_step, status, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        createId(),
        sample.caseNumber,
        sample.caseTitle,
        sample.partyName,
        sample.oppositePartyName,
        sample.courtName,
        sample.judgeName,
        sample.previousDate,
        sample.nextDate,
        sample.previousOrder,
        sample.nextStep,
        sample.status,
        sample.notes,
        createdAt,
        updatedAt,
      );
    }

    await database.execAsync('COMMIT');
  } catch (error) {
    await database.execAsync('ROLLBACK');
    throw error;
  }
}
