const api = typeof browser !== "undefined" ? browser : chrome;

const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const summaryLevelInput = document.getElementById("summaryLevel");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_SUMMARY_LEVEL = "medium";

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const data = await api.storage.local.get({
    apiKey: "",
    model: DEFAULT_MODEL,
    summaryLevel: DEFAULT_SUMMARY_LEVEL
  });

  apiKeyInput.value = data.apiKey || "";
  modelInput.value = data.model || DEFAULT_MODEL;
  summaryLevelInput.value = data.summaryLevel || DEFAULT_SUMMARY_LEVEL;
}

async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;
  const summaryLevel = summaryLevelInput.value || DEFAULT_SUMMARY_LEVEL;

  await api.storage.local.set({ apiKey, model, summaryLevel });
  setStatus("Saved.");
}

saveButton.addEventListener("click", () => {
  saveSettings().catch((error) => {
    setStatus(error && error.message ? error.message : "Could not save settings.");
  });
});

loadSettings().catch((error) => {
  setStatus(error && error.message ? error.message : "Could not load settings.");
});
