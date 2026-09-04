export const aiAssistantMigration = {
  version: 4,
  name: 'ai_assistant_foundation',
  statements: [
    // Composite parent keys ensure duplicated case/document IDs cannot drift apart.
    'CREATE UNIQUE INDEX idx_documents_id_case_id ON documents(id, case_id)',
    `CREATE TABLE ai_sources (
      id TEXT PRIMARY KEY NOT NULL,
      case_id TEXT NOT NULL,
      document_id TEXT NOT NULL UNIQUE,
      file_hash TEXT,
      file_size INTEGER,
      extraction_status TEXT NOT NULL CHECK (extraction_status IN (
        'pending', 'indexing', 'ready', 'requires_ocr', 'unsupported', 'missing', 'failed'
      )),
      page_count INTEGER,
      extracted_at TEXT,
      parser_version TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id, case_id) REFERENCES documents(id, case_id) ON DELETE CASCADE,
      UNIQUE (id, case_id, document_id),
      CHECK (file_size IS NULL OR file_size >= 0),
      CHECK (page_count IS NULL OR page_count >= 0)
    )`,
    'CREATE INDEX idx_ai_sources_case_id ON ai_sources(case_id)',
    'CREATE INDEX idx_ai_sources_status ON ai_sources(extraction_status)',
    `CREATE TABLE ai_chunks (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id, case_id, document_id)
        REFERENCES ai_sources(id, case_id, document_id) ON DELETE CASCADE,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      UNIQUE (source_id, chunk_index),
      UNIQUE (id, document_id),
      CHECK (chunk_index >= 0),
      CHECK (page_start >= 1),
      CHECK (page_end >= page_start),
      CHECK (length(trim(content)) > 0)
    )`,
    'CREATE INDEX idx_ai_chunks_source_id ON ai_chunks(source_id)',
    'CREATE INDEX idx_ai_chunks_case_document ON ai_chunks(case_id, document_id)',
    `CREATE VIRTUAL TABLE ai_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      case_id UNINDEXED,
      document_id UNINDEXED,
      content,
      tokenize = 'unicode61 remove_diacritics 0'
    )`,
    `CREATE TRIGGER ai_chunks_fts_insert AFTER INSERT ON ai_chunks BEGIN
      INSERT INTO ai_chunks_fts(rowid, chunk_id, case_id, document_id, content)
      VALUES (new.rowid, new.id, new.case_id, new.document_id, new.content);
    END`,
    `CREATE TRIGGER ai_chunks_fts_update AFTER UPDATE ON ai_chunks BEGIN
      DELETE FROM ai_chunks_fts WHERE rowid = old.rowid;
      INSERT INTO ai_chunks_fts(rowid, chunk_id, case_id, document_id, content)
      VALUES (new.rowid, new.id, new.case_id, new.document_id, new.content);
    END`,
    `CREATE TRIGGER ai_chunks_fts_delete AFTER DELETE ON ai_chunks BEGIN
      DELETE FROM ai_chunks_fts WHERE rowid = old.rowid;
    END`,
    `CREATE TABLE ai_threads (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX idx_ai_threads_updated_at ON ai_threads(updated_at DESC)',
    `CREATE TABLE ai_thread_cases (
      thread_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, case_id),
      FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
    )`,
    'CREATE INDEX idx_ai_thread_cases_case_id ON ai_thread_cases(case_id)',
    `CREATE TABLE ai_thread_documents (
      thread_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      PRIMARY KEY (thread_id, document_id),
      FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )`,
    'CREATE INDEX idx_ai_thread_documents_document_id ON ai_thread_documents(document_id)',
    `CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      model_name TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      estimated_cost REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE,
      CHECK (input_tokens IS NULL OR input_tokens >= 0),
      CHECK (output_tokens IS NULL OR output_tokens >= 0),
      CHECK (estimated_cost IS NULL OR estimated_cost >= 0)
    )`,
    'CREATE INDEX idx_ai_messages_thread_created ON ai_messages(thread_id, created_at)',
    `CREATE TABLE ai_citations (
      id TEXT PRIMARY KEY NOT NULL,
      message_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      page_start INTEGER NOT NULL,
      page_end INTEGER NOT NULL,
      citation_number INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (chunk_id, document_id) REFERENCES ai_chunks(id, document_id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      UNIQUE (message_id, citation_number),
      CHECK (page_start >= 1),
      CHECK (page_end >= page_start),
      CHECK (citation_number >= 1)
    )`,
    'CREATE INDEX idx_ai_citations_message_id ON ai_citations(message_id)',
    'CREATE INDEX idx_ai_citations_chunk_id ON ai_citations(chunk_id)',
  ],
} as const;
