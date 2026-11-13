// Eigener pdf.js-Worker: erst die Ergänzungen für Apples WebView, dann der Worker aus dem Legacy-Build.
import './streamPolyfill';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
