import { getDatabase } from '../database/database';

export interface AiLocalStatistics {
  threadCount: number;
  messageCount: number;
  indexedDocumentCount: number;
  sourceCount: number;
}

export async function getAiLocalStatistics(): Promise<AiLocalStatistics> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{
    thread_count: number;
    message_count: number;
    indexed_document_count: number;
    source_count: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM ai_threads) AS thread_count,
       (SELECT COUNT(*) FROM ai_messages) AS message_count,
       (SELECT COUNT(*) FROM ai_sources WHERE extraction_status = 'ready') AS indexed_document_count,
       (SELECT COUNT(*) FROM ai_sources) AS source_count`,
  );
  return {
    threadCount: row?.thread_count ?? 0,
    messageCount: row?.message_count ?? 0,
    indexedDocumentCount: row?.indexed_document_count ?? 0,
    sourceCount: row?.source_count ?? 0,
  };
}

export async function deleteAllAiChats(): Promise<number> {
  const database = await getDatabase();
  const result = await database.runAsync('DELETE FROM ai_threads');
  return result.changes;
}
