const api = typeof browser !== "undefined" ? browser : chrome;

const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const summaryLevelSelect = document.getElementById("summaryLevel");
const uploadPdfButton = document.getElementById("uploadPdfButton");
const pdfInput = document.getElementById("pdfInput");
const refreshButton = document.getElementById("refreshButton");
const openSummaryButton = document.getElementById("openSummaryButton");
const optionsButton = document.getElementById("optionsButton");
const SUMMARY_STORAGE_KEY = "lastSummary";
const SITE_SUMMARY_CACHE_KEY = "summariesBySite";
const DEFAULT_SUMMARY_LEVEL = "medium";
let currentSiteKey = "";
let currentSummaryLevel = DEFAULT_SUMMARY_LEVEL;

function setStatus(text) {
  statusEl.textContent = text;
}

function setSummary(text) {
  summaryEl.textContent = text;
}

function getSiteKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null"
      ? parsed.href.split("#")[0].split("?")[0]
      : parsed.origin;
  } catch {
    return (url || "").trim();
  }
}

function normalizeSummaryLevel(level) {
  return ["low", "medium", "high", "xhigh"].includes(level) ? level : DEFAULT_SUMMARY_LEVEL;
}

function getSummaryLevelLabel(level) {
  switch (normalizeSummaryLevel(level)) {
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

function renderSummary(data) {
  if (!data || !data.summary) {
    setSummary("No summary yet. Click the extension icon to generate one.");
    return;
  }

  const titleText = data.fileName || data.title || "";
  const title = titleText ? `${titleText}\n\n` : "";
  const savedAt = data.savedAt ? `\n\nSaved ${new Date(data.savedAt).toLocaleString()}` : "";
  setSummary(`${title}${data.summary}${savedAt}`);
}

async function getActiveTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadPopupSettings() {
  const result = await api.storage.local.get({
    summaryLevel: DEFAULT_SUMMARY_LEVEL
  });

  currentSummaryLevel = normalizeSummaryLevel(result.summaryLevel);
  summaryLevelSelect.value = currentSummaryLevel;
}

async function saveSummaryLevel(level) {
  currentSummaryLevel = normalizeSummaryLevel(level);
  await api.storage.local.set({
    summaryLevel: currentSummaryLevel
  });
  summaryLevelSelect.value = currentSummaryLevel;
}

async function loadCachedSummary(siteKey) {
  const result = await api.storage.local.get({
    [SITE_SUMMARY_CACHE_KEY]: {},
    [SUMMARY_STORAGE_KEY]: null
  });

  if (!siteKey) {
    return null;
  }

  const cache = result[SITE_SUMMARY_CACHE_KEY] || {};
  if (cache[siteKey]) {
    return cache[siteKey];
  }

  const fallback = result[SUMMARY_STORAGE_KEY];
  if (fallback) {
    const fallbackSiteKey = fallback.siteKey || getSiteKey(fallback.url || "");
    if (fallbackSiteKey === siteKey) {
      const migrated = {
        ...fallback,
        siteKey
      };
      cache[siteKey] = migrated;
      await api.storage.local.set({
        [SITE_SUMMARY_CACHE_KEY]: cache,
        [SUMMARY_STORAGE_KEY]: migrated
      });
      return migrated;
    }
  }

  return null;
}

async function persistLastSummary(summary) {
  if (!summary) {
    return;
  }

  await api.storage.local.set({
    [SUMMARY_STORAGE_KEY]: summary
  });
}

async function summarize() {
  setStatus("Summarizing the current page...");

  try {
    const response = await api.runtime.sendMessage({ type: "SUMMARIZE_ACTIVE_TAB" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Summarization failed.");
    }

    setStatus(`Summary ready. ${getSummaryLevelLabel(currentSummaryLevel)} level.`);
    renderSummary(response);
    await persistLastSummary(response);
  } catch (error) {
    setStatus("Could not summarize this page.");
    if (!(await loadCachedSummary(currentSiteKey))) {
      setSummary(
        `${error && error.message ? error.message : "Unexpected error"}\n\n` +
          "If you have not added an OpenRouter API key yet, open Options first."
      );
    }
  }
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
      default: {
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

async function readPdfAsText(file) {
  return new Promise((resolve, reject) => {
    extractPdfText(file).then(resolve, reject);
  });
}

async function summarizePdf(file) {
  if (!file) {
    return;
  }

  if (file.type && file.type !== "application/pdf") {
    setStatus("Choose a PDF file.");
    return;
  }

  setStatus(`Extracting text from ${file.name}...`);

  try {
    const extractedText = await readPdfAsText(file);

    if (!extractedText) {
      throw new Error("Could not extract readable text from that PDF. OCR is not bundled in this release.");
    }

    setStatus(`Summarizing ${file.name}...`);

    const response = await api.runtime.sendMessage({
      type: "SUMMARIZE_PDF_FILE",
      fileName: file.name,
      extractedText,
      level: currentSummaryLevel
    });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "PDF summarization failed.");
    }

    setStatus(`PDF summary ready. ${getSummaryLevelLabel(currentSummaryLevel)} level.`);
    renderSummary(response);
    await persistLastSummary(response);
  } catch (error) {
    setStatus("Could not summarize that PDF.");
    setSummary(error && error.message ? error.message : "Unexpected error");
  } finally {
    pdfInput.value = "";
  }
}

uploadPdfButton.addEventListener("click", () => {
  pdfInput.click();
});

pdfInput.addEventListener("change", () => {
  summarizePdf(pdfInput.files && pdfInput.files[0]).catch((error) => {
    setStatus(error && error.message ? error.message : "Could not summarize that PDF.");
  });
});

openSummaryButton.addEventListener("click", () => {
  api.runtime.sendMessage({ type: "OPEN_SUMMARY_PAGE" });
  window.close();
});

refreshButton.addEventListener("click", () => {
  summarize();
});

optionsButton.addEventListener("click", () => {
  api.runtime.openOptionsPage();
});

summaryLevelSelect.addEventListener("change", () => {
  const nextLevel = normalizeSummaryLevel(summaryLevelSelect.value);
  saveSummaryLevel(nextLevel)
    .then(() => {
      setStatus(`Level set to ${getSummaryLevelLabel(nextLevel)}. Re-summarizing...`);
      return summarize();
    })
    .catch((error) => {
      setStatus(error && error.message ? error.message : "Could not update summary level.");
    });
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadPopupSettings();
  const tab = await getActiveTab();
  currentSiteKey = tab && tab.url ? getSiteKey(tab.url) : "";

  const cached = await loadCachedSummary(currentSiteKey);
  if (cached) {
    renderSummary(cached);
    setStatus("Summary for this site restored. Click Re-summarize to update.");
    await persistLastSummary(cached);
  } else {
    setSummary("No summary yet. Click the extension icon to generate one.");
    setStatus("First visit to this site. Generating summary...");
    await summarize();
  }
});
