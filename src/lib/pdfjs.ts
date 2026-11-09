// pdf.js einmal zentral laden. Der Legacy-Build und die Ergänzungen sorgen dafür, dass PDFs auch im Mac-Fenster gelesen werden.
import './streamPolyfill';

let laden: Promise<typeof import('pdfjs-dist')> | null = null;

export function pdfjsLaden() {
  laden ??= (async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' });
    return pdfjs;
  })();
  return laden;
}
