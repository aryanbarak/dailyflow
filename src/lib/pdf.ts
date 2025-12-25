import { pdfjs } from "react-pdf";

// Vite: resolve worker from pdfjs-dist package
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.js",
  import.meta.url
).toString();
