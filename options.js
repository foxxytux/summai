const api = typeof browser !== "undefined" ? browser : chrome;

const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const saveButton = document.getElementById("save");
const statusEl = document.getElementById("status");

const DEFAULT_MODEL = "openai/gpt-4o-mini";

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadSettings() {
  const data = await api.storage.local.get({
    apiKey: "",
    model: DEFAULT_MODEL
  });

  apiKeyInput.value = data.apiKey || "";
  modelInput.value = data.model || DEFAULT_MODEL;
}

async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  await api.storage.local.set({ apiKey, model });
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
