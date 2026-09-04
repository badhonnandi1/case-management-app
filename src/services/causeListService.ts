import { File } from 'expo-file-system';
import * as Print from 'expo-print';

import type { Case } from '../models/Case';
import type { CauseListOptions, GeneratedCauseList } from '../models/CauseList';
import { buildCauseListHtml, getCauseListFileName } from '../utils/causeList';
import { getAvailableCauseListFile } from './fileService';

export async function generateCauseListPdf(
  selectedDate: string,
  cases: readonly Case[],
  options: CauseListOptions,
): Promise<GeneratedCauseList> {
  if (cases.length === 0) throw new Error('Cannot generate a cause list without cases.');
  const result = await Print.printToFileAsync({
    html: buildCauseListHtml(selectedDate, cases, options),
    width: 612,
    height: 792,
    textZoom: 100,
  });
  const destination = getAvailableCauseListFile(getCauseListFileName(selectedDate));
  const temporaryFile = new File(result.uri);
  try {
    await temporaryFile.move(destination);
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
  return {
    uri: destination.uri,
    fileName: destination.name,
    caseCount: cases.length,
    pageCount: result.numberOfPages,
  };
}
