import type { ExtractedPdfPage } from './pdfTextExtractionService';

export interface OcrResult {
  status: 'not_configured';
  pages: ExtractedPdfPage[];
  message: string;
}

export interface OcrService {
  extractPages(uri: string, signal?: AbortSignal): Promise<OcrResult>;
}

export const localOcrService: OcrService = {
  async extractPages(_uri: string, _signal?: AbortSignal): Promise<OcrResult> {
    return {
      status: 'not_configured',
      pages: [],
      message: 'OCR is not configured. Scanned PDFs remain local and are not uploaded.',
    };
  },
};
