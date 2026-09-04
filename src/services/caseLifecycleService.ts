import { deleteCase } from '../repositories/caseRepository';
import { cancelCaseReminder } from './notificationService';
import { deleteCaseStorage } from './fileService';

export async function deleteCaseWithLocalData(
  caseId: string,
): Promise<{ deleted: boolean; fileCleanupFailed: boolean }> {
  await cancelCaseReminder(caseId);
  const deleted = await deleteCase(caseId);
  if (!deleted) return { deleted: false, fileCleanupFailed: false };

  try {
    deleteCaseStorage(caseId);
    return { deleted: true, fileCleanupFailed: false };
  } catch (error) {
    console.error('Case metadata was deleted, but its local file directory could not be cleaned up.', error);
    return { deleted: true, fileCleanupFailed: true };
  }
}
