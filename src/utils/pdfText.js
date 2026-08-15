// Text extraction from PDFs in the browser via pdf.js. Returns the document as
// text lines in reading order, with cells (separate text runs on the same
// baseline) joined by two spaces — the separator utils/trumfInvoice.js splits on.
//
// pdf.js is loaded lazily so the ~400 kB library only ships to users who
// actually import an invoice.

let pdfjsPromise = null;

const loadPdfjs = async () => {
    if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
            const [pdfjs, { default: workerUrl }] = await Promise.all([
                import('pdfjs-dist'),
                import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
            ]);
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
            return pdfjs;
        })();
    }
    return pdfjsPromise;
};

/**
 * Group text items on each page into lines by their y-position (within a
 * 2pt tolerance — text in the same table row shares a baseline) and order
 * items left-to-right inside the line.
 */
export const groupTextItemsIntoLines = (items, tolerance = 2) => {
    const rows = [];
    for (const item of items) {
        if (typeof item.str !== 'string' || item.str.trim() === '') continue;
        const x = item.transform[4];
        const y = item.transform[5];
        let row = rows.find(r => Math.abs(r.y - y) <= tolerance);
        if (!row) {
            row = { y, items: [] };
            rows.push(row);
        }
        row.items.push({ x, str: item.str.trim() });
    }
    // PDF coordinates: y grows upwards, so top of page = largest y
    rows.sort((a, b) => b.y - a.y);
    return rows.map(row =>
        row.items.sort((a, b) => a.x - b.x).map(i => i.str).join('  ')
    );
};

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string[]>} lines across all pages, in order
 */
export const extractPdfLines = async (data) => {
    const pdfjs = await loadPdfjs();
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const doc = await loadingTask.promise;
    const lines = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            lines.push(...groupTextItemsIntoLines(content.items));
        }
    } finally {
        await loadingTask.destroy();
    }
    return lines;
};
