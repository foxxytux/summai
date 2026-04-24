const api = typeof browser !== "undefined" ? browser : chrome;

const chooseButton = document.getElementById("chooseButton");
const pdfInput = document.getElementById("pdfInput");
const openSummaryButton = document.getElementById("openSummaryButton");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");

const SUMMARY_STORAGE_KEY = "lastSummary";
const DEFAULT_SUMMARY_LEVEL = "medium";

function setStatus(text) {
  statusEl.textContent = text;
}

function setSummary(text) {
  summaryEl.textContent = text;
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
      parts.push(inList.html + "</" + inList.tag + ">");
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

function bytesToLatin1(bytes) {
  return new TextDecoder("latin1").decode(bytes);
}

function decodePdfString(text) {
  let output = "";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "\\") {
      output += char;
      continue;
    }

    i += 1;
    if (i >= text.length) {
      break;
    }

    const next = text[i];
    switch (next) {
      case "n":
        output += "\n";
        break;
      case "r":
        output += "\r";
        break;
      case "t":
        output += "\t";
        break;
      case "b":
        output += "\b";
        break;
      case "f":
        output += "\f";
        break;
      case "(":
      case ")":
      case "\\":
        output += next;
        break;
      case "\n":
        break;
      case "\r":
        if (text[i + 1] === "\n") {
          i += 1;
        }
        break;
      default:
        if (/[0-7]/.test(next)) {
          let octal = next;
          let count = 0;
          while (count < 2 && i + 1 < text.length && /[0-7]/.test(text[i + 1])) {
            i += 1;
            octal += text[i];
            count += 1;
          }
          output += String.fromCharCode(parseInt(octal, 8));
        } else {
          output += next;
        }
    }
  }

  return output;
}

function decodePdfHexString(hex) {
  const cleaned = hex.replace(/\s+/g, "");
  const normalized = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  let output = "";

  for (let i = 0; i < normalized.length; i += 2) {
    const code = parseInt(normalized.slice(i, i + 2), 16);
    if (!Number.isNaN(code)) {
      output += String.fromCharCode(code);
    }
  }

  return output;
}

function collectTextFragments(block) {
  const fragments = [];
  const stringPattern = /\(((?:\\.|[^\\()])*)\)\s*T[jJ]/g;
  const arrayPattern = /\[((?:\\.|[^\\\]])*)\]\s*TJ/g;
  const hexPattern = /<([0-9A-Fa-f\s]+)>\s*T[jJ]/g;
  let match;

  while ((match = stringPattern.exec(block))) {
    fragments.push(decodePdfString(match[1]));
  }

  while ((match = arrayPattern.exec(block))) {
    const payload = match[1];
    let innerMatch;
    const innerStringPattern = /\(((?:\\.|[^\\()])*)\)/g;
    const innerHexPattern = /<([0-9A-Fa-f\s]+)>/g;

    while ((innerMatch = innerStringPattern.exec(payload))) {
      fragments.push(decodePdfString(innerMatch[1]));
    }

    while ((innerMatch = innerHexPattern.exec(payload))) {
      fragments.push(decodePdfHexString(innerMatch[1]));
    }
  }

  while ((match = hexPattern.exec(block))) {
    fragments.push(decodePdfHexString(match[1]));
  }

  return fragments;
}

async function inflatePdfStream(streamText) {
  if (typeof DecompressionStream === "undefined") {
    return null;
  }

  try {
    const streamBytes = Uint8Array.from(streamText, (char) => char.charCodeAt(0));
    const compressed = new Blob([streamBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    const decompressed = await new Response(compressed).arrayBuffer();
    return bytesToLatin1(new Uint8Array(decompressed));
  } catch {
    return null;
  }
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const rawText = bytesToLatin1(new Uint8Array(buffer));
  const streamPattern = /stream\r?\n([\s\S]*?)endstream/g;
  const fragments = [];
  let match;

  while ((match = streamPattern.exec(rawText))) {
    const streamText = match[1].replace(/^\r?\n/, "");
    const content = (await inflatePdfStream(streamText)) || streamText;
    const blocks = content.match(/BT[\s\S]*?ET/g) || [content];

    for (const block of blocks) {
      fragments.push(...collectTextFragments(block));
    }
  }

  if (!fragments.length) {
    const blocks = rawText.match(/BT[\s\S]*?ET/g) || [];
    for (const block of blocks) {
      fragments.push(...collectTextFragments(block));
    }
  }

  return fragments
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

async function summarizePdf(file) {
  if (!file) {
    return;
  }

  setStatus(`Extracting text from ${file.name}...`);

  const extractedText = await extractPdfText(file);
  if (!extractedText) {
    throw new Error("Could not extract readable text from that PDF. OCR is not bundled in this release.");
  }

  const settings = await loadSettings();
  setStatus(`Summarizing ${file.name}...`);

  const response = await api.runtime.sendMessage({
    type: "SUMMARIZE_PDF_FILE",
    fileName: file.name,
    extractedText,
    level: settings.summaryLevel
  });

  if (!response || !response.ok) {
    throw new Error(response && response.error ? response.error : "PDF summarization failed.");
  }

  setStatus(`PDF summary ready. ${getSummaryLevelLabel(settings.summaryLevel)} level.`);
  setSummary(
    `<h2>${escapeHtml(file.name)}</h2>` +
      renderMarkdown(response.summary) +
      `<p class="saved-at">Saved ${escapeHtml(new Date(response.savedAt).toLocaleString())}</p>`
  );
  await persistLastSummary(response);
}

async function openFilePicker() {
  pdfInput.click();
}

chooseButton.addEventListener("click", () => {
  openFilePicker().catch((error) => {
    setStatus(error && error.message ? error.message : "Could not open the file picker.");
  });
});

pdfInput.addEventListener("change", () => {
  const file = pdfInput.files && pdfInput.files[0];
  summarizePdf(file)
    .catch((error) => {
      setStatus("Could not summarize that PDF.");
      setSummary(error && error.message ? error.message : "Unexpected error");
    })
    .finally(() => {
      pdfInput.value = "";
    });
});

openSummaryButton.addEventListener("click", () => {
  api.runtime.sendMessage({ type: "OPEN_SUMMARY_PAGE" });
});

document.addEventListener("DOMContentLoaded", () => {
  setStatus("Choose a PDF to extract text and summarize it.");
});

window.addEventListener("load", () => {
  setTimeout(() => {
    pdfInput.click();
  }, 0);
});
