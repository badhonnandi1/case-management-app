export interface CaseTask {
  id: string;
  caseId: string;
  title: string;
  note: string | null;
  dueDate: string | null;
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface CreateCaseTaskInput {
  caseId: string;
  title: string;
  note?: string | null;
  dueDate?: string | null;
}

export interface UpdateCaseTaskInput {
  title?: string;
  note?: string | null;
  dueDate?: string | null;
}
