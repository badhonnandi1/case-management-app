import { randomUUID } from 'expo-crypto';

export function createId(): string {
  return randomUUID();
}
