const api = typeof browser !== "undefined" ? browser : chrome;

const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const refreshButton = document.getElementById("refreshButton");
const openSummaryButton = document.getElementById("openSummaryButton");
const optionsButton = document.getElementById("optionsButton");
const SUMMARY_STORAGE_KEY = "lastSummary";

function setStatus(text) {
  statusEl.textContent = text;
}

function setSummary(text) {
  summaryEl.textContent = text;
}

function renderSummary(data) {
  if (!data || !data.summary) {
    setSummary("No summary yet. Click the extension icon to generate one.");
    return;
  }

  const title = data.title ? `${data.title}\n\n` : "";
  const savedAt = data.savedAt ? `\n\nSaved ${new Date(data.savedAt).toLocaleString()}` : "";
  setSummary(`${title}${data.summary}${savedAt}`);
}

async function loadCachedSummary() {
  const result = await api.storage.local.get({
    [SUMMARY_STORAGE_KEY]: null
  });

  return result[SUMMARY_STORAGE_KEY];
}

async function restoreCachedSummary() {
  try {
    const cached = await loadCachedSummary();
    if (cached) {
      renderSummary(cached);
      setStatus("Last summary restored.");
    } else {
      setSummary("No summary yet. Click the extension icon to generate one.");
      setStatus("Ready.");
    }
  } catch (error) {
    setStatus("Ready.");
  }
}

async function summarize() {
  setStatus("Summarizing the current page...");

  try {
    const response = await api.runtime.sendMessage({ type: "SUMMARIZE_ACTIVE_TAB" });

    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "Summarization failed.");
    }

    setStatus("Summary ready.");
    renderSummary(response);
  } catch (error) {
    setStatus("Could not summarize this page.");
    if (!(await loadCachedSummary())) {
      setSummary(
        `${error && error.message ? error.message : "Unexpected error"}\n\n` +
          "If you have not added an OpenRouter API key yet, open Options first."
      );
    }
  }
}

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

document.addEventListener("DOMContentLoaded", async () => {
  await restoreCachedSummary();
  summarize();
});
