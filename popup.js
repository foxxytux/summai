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

async function readPdfAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
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

  setStatus(`Uploading ${file.name}...`);

  try {
    const fileData = await readPdfAsDataUrl(file);
    setStatus(`Summarizing ${file.name}...`);

    const response = await api.runtime.sendMessage({
      type: "SUMMARIZE_PDF_FILE",
      fileName: file.name,
      fileData,
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
