/** Longest side kept for a plan: sharp enough to trace, small enough to store in the project. */
const MAX_SIDE = 2400;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type PlanFileError = 'unsupported' | 'tooLarge' | 'unreadable';
export class PlanFileFailure extends Error {
  constructor(readonly code: PlanFileError) { super(code); }
}

export interface LoadedPlan { canvas: HTMLCanvasElement; pages: number }

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isImage = (file: File) => /^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type);

function whiteCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new PlanFileFailure('unreadable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function loadImage(file: File): Promise<LoadedPlan> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const { canvas, context } = whiteCanvas(image.naturalWidth * scale, image.naturalHeight * scale);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, pages: 1 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadPdf(file: File, pageNumber: number): Promise<LoadedPlan> {
  // Loaded on first use so the editor does not download the PDF engine up front.
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages));
    const unit = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(unit.width, unit.height) });
    const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return { canvas, pages: pdf.numPages };
  } finally {
    await task.destroy();
  }
}

/** Turns a PDF page, screenshot or photo into one canvas on white paper. */
export async function loadPlanFile(file: File, pageNumber = 1): Promise<LoadedPlan> {
  if (file.size > MAX_FILE_BYTES) throw new PlanFileFailure('tooLarge');
  if (!isPdf(file) && !isImage(file)) throw new PlanFileFailure('unsupported');
  try {
    return await (isPdf(file) ? loadPdf(file, pageNumber) : loadImage(file));
  } catch (error) {
    throw error instanceof PlanFileFailure ? error : new PlanFileFailure('unreadable');
  }
}

/** Line art stays a crisp PNG; large scans fall back to JPEG to keep projects small. */
export function planDataUrl(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL('image/png');
  return png.length > 6_000_000 ? canvas.toDataURL('image/jpeg', 0.85) : png;
}
