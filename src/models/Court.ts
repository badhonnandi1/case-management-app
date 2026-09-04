export interface Court {
  id: string;
  fullName: string;
  shortCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCourtInput {
  fullName: string;
  shortCode: string;
}

export type UpdateCourtInput = CreateCourtInput;
