// Apples WebView (Tauri auf macOS) kann ReadableStream nicht mit „for await“ durchlaufen. pdf.js braucht das.
const RS = (globalThis as any).ReadableStream;
if (RS && !RS.prototype[Symbol.asyncIterator]) {
  RS.prototype.values = function (opt?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    return {
      async next() { const r = await reader.read(); if (r.done) reader.releaseLock(); return r; },
      async return(value?: unknown) { if (!opt?.preventCancel) await reader.cancel(value); reader.releaseLock(); return { done: true, value }; },
      [Symbol.asyncIterator]() { return this; },
    };
  };
  RS.prototype[Symbol.asyncIterator] = RS.prototype.values;
}
export {};
