/**
 * PDF to PNG Conversion Module
 * 
 * Uses PDF.js to render PDF pages to canvas, then exports as PNG base64.
 * This enables vision-based OCR on scanned PDFs that require image processing.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PageImage {
  pageNumber: number;
  base64: string; // PNG base64 without data URL prefix
  width: number;
  height: number;
}

export interface PDFConversionResult {
  totalPages: number;
  pages: PageImage[];
  conversionTimeMs: number;
  errors: string[];
}

export interface PDFConversionProgress {
  currentPage: number;
  totalPages: number;
  status: 'loading' | 'rendering' | 'done' | 'error';
}

/**
 * Convert a PDF file to an array of PNG images
 * 
 * @param file - The PDF file to convert
 * @param options - Conversion options
 * @returns Promise with conversion result containing base64 images
 */
export async function convertPDFToImages(
  file: File,
  options: {
    maxPages?: number;
    scale?: number; // DPI scale, default 2.0 for high quality OCR
    onProgress?: (progress: PDFConversionProgress) => void;
  } = {}
): Promise<PDFConversionResult> {
  const startTime = Date.now();
  const { maxPages = 50, scale = 2.0, onProgress } = options;
  const errors: string[] = [];
  const pages: PageImage[] = [];

  try {
    onProgress?.({ currentPage: 0, totalPages: 0, status: 'loading' });

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const totalPages = Math.min(pdf.numPages, maxPages);
    console.log(`[pdf-to-images] Loading PDF: ${totalPages} pages (max: ${maxPages})`);
    
    onProgress?.({ currentPage: 0, totalPages, status: 'rendering' });

    // Process pages sequentially to avoid memory issues
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const pageImage = await renderPageToImage(pdf, pageNum, scale);
        pages.push(pageImage);
        
        onProgress?.({ currentPage: pageNum, totalPages, status: 'rendering' });
        
        // Small delay to prevent UI blocking
        if (pageNum % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (pageError) {
        const errorMsg = `Page ${pageNum}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`;
        console.error(`[pdf-to-images] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    onProgress?.({ currentPage: totalPages, totalPages, status: 'done' });

    return {
      totalPages,
      pages,
      conversionTimeMs: Date.now() - startTime,
      errors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to load PDF';
    console.error('[pdf-to-images] PDF loading failed:', errorMsg);
    
    onProgress?.({ currentPage: 0, totalPages: 0, status: 'error' });
    
    return {
      totalPages: 0,
      pages: [],
      conversionTimeMs: Date.now() - startTime,
      errors: [errorMsg],
    };
  }
}

/**
 * Render a single PDF page to a PNG image
 */
async function renderPageToImage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<PageImage> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // Create canvas
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) {
    throw new Error('Failed to get canvas context');
  }

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Render page to canvas
  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  // Convert to PNG base64
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.replace('data:image/png;base64,', '');

  // Cleanup
  canvas.width = 0;
  canvas.height = 0;

  return {
    pageNumber,
    base64,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Convert a base64 PDF string to images
 * Useful when you already have the PDF as base64
 */
export async function convertBase64PDFToImages(
  base64PDF: string,
  options: {
    maxPages?: number;
    scale?: number;
    onProgress?: (progress: PDFConversionProgress) => void;
  } = {}
): Promise<PDFConversionResult> {
  const startTime = Date.now();
  const { maxPages = 50, scale = 2.0, onProgress } = options;
  const errors: string[] = [];
  const pages: PageImage[] = [];

  try {
    onProgress?.({ currentPage: 0, totalPages: 0, status: 'loading' });

    // Decode base64 to bytes
    const binaryString = atob(base64PDF);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    
    const totalPages = Math.min(pdf.numPages, maxPages);
    console.log(`[pdf-to-images] Loading base64 PDF: ${totalPages} pages`);
    
    onProgress?.({ currentPage: 0, totalPages, status: 'rendering' });

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const pageImage = await renderPageToImage(pdf, pageNum, scale);
        pages.push(pageImage);
        
        onProgress?.({ currentPage: pageNum, totalPages, status: 'rendering' });
        
        if (pageNum % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } catch (pageError) {
        const errorMsg = `Page ${pageNum}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`;
        errors.push(errorMsg);
      }
    }

    onProgress?.({ currentPage: totalPages, totalPages, status: 'done' });

    return {
      totalPages,
      pages,
      conversionTimeMs: Date.now() - startTime,
      errors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to convert PDF';
    
    onProgress?.({ currentPage: 0, totalPages: 0, status: 'error' });
    
    return {
      totalPages: 0,
      pages: [],
      conversionTimeMs: Date.now() - startTime,
      errors: [errorMsg],
    };
  }
}

/**
 * Check if a file is a PDF
 */
export function isPDF(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}
