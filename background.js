const DEFAULT_MODEL = "openai/gpt-4o-mini";
const SUMMARY_CHAR_LIMIT = 20000;
const SUMMARY_STORAGE_KEY = "lastSummary";
const DEFAULT_SUMMARY_LEVEL = "medium";

const SUMMARY_LEVELS = {
  low: {
    maxTokens: 700,
    label: "Low",
    overview: "Provide a fuller, more detailed summary.",
    structure:
      "Use more prose in the overview and include 5-8 bullet points with supporting detail."
  },
  medium: {
    maxTokens: 450,
    label: "Medium",
    overview: "Balance detail and brevity.",
    structure:
      "Use a concise overview and include 4-6 bullet points covering the main takeaways."
  },
  high: {
    maxTokens: 280,
    label: "High",
    overview: "Keep it concise.",
    structure: "Use a short overview and 3-5 bullet points with only the key facts."
  },
  xhigh: {
    maxTokens: 180,
    label: "XHigh",
    overview: "Be very concise.",
    structure: "Use a very short overview and 2-4 ultra-condensed bullet points."
  }
};

function getBrowser() {
  return typeof browser !== "undefined" ? browser : chrome;
}

function trimText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function getActiveTab() {
  const api = getBrowser();
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function extractPageText(tabId) {
  const api = getBrowser();
  const results = await api.tabs.executeScript(tabId, {
    code: `(() => {
      const bodyText = document.body ? document.body.innerText : "";
      const fallbackText = document.documentElement ? document.documentElement.innerText : "";
      const title = document.title || "";
      const url = location.href;

      return {
        title,
        url,
        text: bodyText || fallbackText || ""
      };
    })();`
  });

  const payload = results && results[0] ? results[0] : {};
  return {
    title: trimText(payload.title),
    url: trimText(payload.url),
    text: trimText(payload.text)
  };
}

function getSummaryLevelConfig(level) {
  return SUMMARY_LEVELS[level] || SUMMARY_LEVELS[DEFAULT_SUMMARY_LEVEL];
}

function buildPrompt({ title, url, text, level }) {
  const config = getSummaryLevelConfig(level);

  return [
    `Summarize the following web page in markdown. The requested summary level is ${config.label}.`,
    config.overview,
    "Return:",
    "1. A short `## Overview` section with 1-2 sentences.",
    `2. A \`## Key Takeaways\` section. ${config.structure}`,
    "3. A short `## Caveats` section if the page looks truncated or low-signal.",
    "4. Keep the total length aligned with the requested summary level.",
    "",
    `Title: ${title || "(untitled)"}`,
    `URL: ${url || "(unknown)"}`,
    "",
    "Page text:",
    text
  ].join("\n");
}

async function getSettings() {
  const api = getBrowser();
  const result = await api.storage.local.get({
    apiKey: "",
    model: DEFAULT_MODEL,
    summaryLevel: DEFAULT_SUMMARY_LEVEL
  });
  return {
    apiKey: String(result.apiKey || "").trim(),
    model: String(result.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    summaryLevel: String(result.summaryLevel || DEFAULT_SUMMARY_LEVEL).trim() || DEFAULT_SUMMARY_LEVEL
  };
}

async function summarizeWithOpenRouter({ apiKey, model, title, url, text, level }) {
  const config = getSummaryLevelConfig(level);
  const api = getBrowser();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": api.runtime.getURL(""),
      "X-Title": "Summai"
    },
    body: JSON.stringify({
      model,
      max_tokens: config.maxTokens,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "You summarize web pages in markdown.",
            "Be concise, accurate, and avoid inventing details.",
            `The requested summary level is ${config.label}.`,
            config.structure
          ].join(" ")
        },
        {
          role: "user",
          content: buildPrompt({
            title,
            url,
            text: text.slice(0, SUMMARY_CHAR_LIMIT),
            level
          })
        }
      ]
    })
  });

  const raw = await response.text();
  let data;

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`OpenRouter returned invalid JSON: ${raw.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : response.statusText;
    throw new Error(`OpenRouter request failed (${response.status}): ${message}`);
  }

  const summary = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : "";

  if (!summary) {
    throw new Error("OpenRouter returned an empty summary.");
  }

  return trimText(summary);
}

async function saveSummary(result) {
  const api = getBrowser();
  await api.storage.local.set({
    [SUMMARY_STORAGE_KEY]: {
      ...result,
      savedAt: new Date().toISOString()
    }
  });
}

async function getSavedSummary() {
  const api = getBrowser();
  const result = await api.storage.local.get({
    [SUMMARY_STORAGE_KEY]: null
  });

  return result[SUMMARY_STORAGE_KEY] || null;
}

async function summarizeActiveTab() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab found.");
  }

  const page = await extractPageText(tab.id);
  const cleanText = trimText(page.text);

  if (!cleanText) {
    throw new Error("Could not extract readable text from this page.");
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("Missing OpenRouter API key. Open the extension options to add one.");
  }

  const summary = await summarizeWithOpenRouter({
    apiKey: settings.apiKey,
    model: settings.model,
    title: page.title || tab.title || "",
    url: page.url || tab.url || "",
    text: cleanText,
    level: settings.summaryLevel
  });

  const result = {
    title: page.title || tab.title || "",
    url: page.url || tab.url || "",
    summary
  };

  await saveSummary(result);
  return result;
}

getBrowser().runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "SUMMARIZE_ACTIVE_TAB") {
    summarizeActiveTab()
      .then((result) => {
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Unexpected error"
        });
      });

    return true;
  }

  if (message.type === "GET_LAST_SUMMARY") {
    getSavedSummary()
      .then((result) => {
        sendResponse({ ok: true, summary: result });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Unexpected error"
        });
      });

    return true;
  }

  if (message.type === "OPEN_SUMMARY_PAGE") {
    const api = getBrowser();

    api.tabs.create({ url: api.runtime.getURL("summary.html") })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : "Unexpected error"
        });
      });

    return true;
  }

  summarizeActiveTab()
    .then((result) => {
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : "Unexpected error"
      });
    });

  return true;
});
