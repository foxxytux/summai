const api = typeof browser !== "undefined" ? browser : chrome;

const chooseButton = document.getElementById("chooseButton");
const pdfInput = document.getElementById("pdfInput");
const openSummaryButton = document.getElementById("openSummaryButton");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");

const SUMMARY_STORAGE_KEY = "lastSummary";
const DEFAULT_SUMMARY_LEVEL = "medium";
const SUMMARY_CHAR_LIMIT = 20000;
const OCR_PAGE_SCALE = 2;
let pdfjsPromise = null;
let tesseractWorkerPromise = null;
let tesseractWorker = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function setSummary(text) {
  summaryEl.innerHTML = text;
}

function getSummaryLevelLabel(level) {
  switch (level) {
    case "low":
      return "Low";
    case "high":
      return "High";
    case "xhigh":
      return "XHigh";
    case "medium":
    default:
      return "Medium";
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  let inList = null;
  let inParagraph = [];

  function closeParagraph() {
    if (inParagraph.length) {
      parts.push(`<p>${inlineMarkdown(inParagraph.join(" "))}</p>`);
      inParagraph = [];
    }
  }

  function closeList() {
    if (inList) {
      parts.push(`${inList.html}</${inList.tag}>`);
      inList = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      parts.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      closeParagraph();
      if (!inList || inList.tag !== "ul") {
        closeList();
        inList = { tag: "ul", html: "<ul>" };
      }
      inList.html += `<li>${inlineMarkdown(bullet[1])}</li>`;
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      closeParagraph();
      if (!inList || inList.tag !== "ol") {
        closeList();
        inList = { tag: "ol", html: "<ol>" };
      }
      inList.html += `<li>${inlineMarkdown(numbered[1])}</li>`;
      continue;
    }

    closeList();
    inParagraph.push(line);
  }

  closeParagraph();
  closeList();

  return parts.join("");
}

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(api.runtime.getURL("vendor/pdfjs/pdf.min.mjs")).then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = api.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");
      return pdfjsLib;
    });
  }

  return pdfjsPromise;
}

async function loadSettings() {
  const result = await api.storage.local.get({
    summaryLevel: DEFAULT_SUMMARY_LEVEL
  });

  return {
    summaryLevel: String(result.summaryLevel || DEFAULT_SUMMARY_LEVEL).trim() || DEFAULT_SUMMARY_LEVEL
  };
}

async function persistLastSummary(summary) {
  if (!summary) {
    return;
  }

  await api.storage.local.set({
    [SUMMARY_STORAGE_KEY]: summary
  });
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
}

function trimText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractNativePdfText(pdf, limit) {
  const chunks = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });

    const pageText = trimText(
      textContent.items
        .map((item) => item.str || "")
        .join(" ")
    );

    if (pageText) {
      chunks.push(pageText);
    }

    if (chunks.join("\n\n").length >= limit) {
      break;
    }
  }

  return trimText(chunks.join("\n\n")).slice(0, limit);
}

async function loadTesseractWorker() {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      const worker = await Tesseract.createWorker([TESSDATA_ENG], 1, {
        workerPath: api.runtime.getURL("vendor/tesseract/worker.min.js"),
        corePath: api.runtime.getURL("vendor/tesseract-core"),
        workerBlobURL: false,
        gzip: false
      });
      tesseractWorker = worker;
      return worker;
    })();
  }

  return tesseractWorkerPromise;
}

async function ocrPdfText(pdf, limit) {
  const worker = await loadTesseractWorker();
  const chunks = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    setStatus(`OCR page ${pageNum} of ${pdf.numPages}...`);
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: OCR_PAGE_SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d", { alpha: false });

    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    const result = await worker.recognize(canvas);
    const pageText = trimText(result && result.data && result.data.text ? result.data.text : "");

    if (pageText) {
      chunks.push(pageText);
    }

    if (chunks.join("\n\n").length >= limit) {
      break;
    }
  }

  return trimText(chunks.join("\n\n")).slice(0, limit);
}

async function extractPdfText(file) {
  const pdfjsLib = await loadPdfjs();
  const data = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: api.runtime.getURL("vendor/pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: api.runtime.getURL("vendor/pdfjs/standard_fonts/")
  });

  const pdf = await loadingTask.promise;
  const nativeText = await extractNativePdfText(pdf, SUMMARY_CHAR_LIMIT);

  if (nativeText.length >= 300) {
    return {
      method: "text",
      text: nativeText
    };
  }

  setStatus("Text layer is thin. Running OCR...");
  const ocrText = await ocrPdfText(pdf, SUMMARY_CHAR_LIMIT);

  return {
    method: "ocr",
    text: ocrText
  };
}

async function summarizePdf(file) {
  if (!file) {
    return;
  }

  setStatus(`Reading ${file.name}...`);

  const { text, method } = await extractPdfText(file);
  if (!text) {
    throw new Error("Could not extract readable text from that PDF.");
  }

  const settings = await loadSettings();
  setStatus(`Summarizing ${file.name}...`);

  const response = await api.runtime.sendMessage({
    type: "SUMMARIZE_PDF_FILE",
    fileName: file.name,
    extractedText: text,
    level: settings.summaryLevel
  });

  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "PDF summarization failed.");
  }

  const methodLabel = method === "ocr" ? "OCR" : "text extraction";
  setStatus(`PDF summary ready. ${getSummaryLevelLabel(settings.summaryLevel)} level via ${methodLabel}.`);
  setSummary(
    `<h2>${escapeHtml(file.name)}</h2>` +
      renderMarkdown(response.summary) +
      `<p class="saved-at">Saved ${escapeHtml(new Date(response.savedAt).toLocaleString())}</p>`
  );
  await persistLastSummary(response);
}

chooseButton.addEventListener("click", () => {
  pdfInput.click();
});

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files && pdfInput.files[0];
  summarizePdf(file)
    .catch((error) => {
      setStatus("Could not summarize that PDF.");
      setSummary(`<p class="empty">${escapeHtml(error && error.message ? error.message : "Unexpected error")}</p>`);
    })
    .finally(() => {
      pdfInput.value = "";
    });
});

openSummaryButton.addEventListener("click", () => {
  api.runtime.sendMessage({ type: "OPEN_SUMMARY_PAGE" });
});

window.addEventListener("beforeunload", () => {
  if (tesseractWorker) {
    tesseractWorker.terminate().catch(() => {});
  }
});

document.addEventListener("DOMContentLoaded", () => {
  setStatus("Choose a PDF to extract text and summarize it.");
});
