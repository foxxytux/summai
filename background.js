const DEFAULT_MODEL = "openai/gpt-4o-mini";
const SUMMARY_CHAR_LIMIT = 20000;
const SUMMARY_STORAGE_KEY = "lastSummary";
const SITE_SUMMARY_CACHE_KEY = "summariesBySite";
const DEFAULT_SUMMARY_LEVEL = "medium";

const SUMMARY_LEVELS = {
  low: {
    maxTokens: 760,
    label: "Low",
    goal: "Preserve detail and concrete facts.",
    wordBudget: "300-600 words",
    structure: [
      "Use exactly three sections: `## Overview`, `## Key Takeaways`, and `## Details`.",
      "Write a 2-3 sentence overview.",
      "Include 6-10 bullets in key takeaways.",
      "Use the details section for notable examples, names, numbers, or caveats."
    ]
  },
  medium: {
    maxTokens: 420,
    label: "Medium",
    goal: "Balance detail and brevity.",
    wordBudget: "180-300 words",
    structure: [
      "Use exactly two sections: `## Overview` and `## Key Takeaways`.",
      "Write a 1-2 sentence overview.",
      "Include 4-6 bullets with the main points.",
      "Only add a brief caveat if the page is truncated or uncertain."
    ]
  },
  high: {
    maxTokens: 220,
    label: "High",
    goal: "Compress aggressively and drop secondary details.",
    wordBudget: "90-150 words",
    structure: [
      "Use exactly two sections: `## Overview` and `## Key Points`.",
      "Write one short overview paragraph of at most 2 sentences.",
      "Include 3 bullets maximum.",
      "Each bullet should contain only the most important fact or outcome.",
      "Omit examples, side comments, and most caveats unless they are critical."
    ]
  },
  xhigh: {
    maxTokens: 120,
    label: "XHigh",
    goal: "Produce an ultra-short skim summary.",
    wordBudget: "40-80 words",
    structure: [
      "Use exactly two sections: `## TL;DR` and `## Essentials`.",
      "Write one sentence only in `## TL;DR`.",
      "Include exactly 2 bullets in `## Essentials`.",
      "Each bullet should be a compressed fragment, not a full explanation.",
      "Skip caveats unless the page is unusable or misleading."
    ]
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

function getSiteKey(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "null"
      ? parsed.href.split("#")[0].split("?")[0]
      : parsed.origin;
  } catch {
    return trimText(url || "");
  }
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

function joinRules(rules) {
  return rules.map((rule) => `- ${rule}`).join("\n");
}

function buildSystemPrompt(level) {
  const config = getSummaryLevelConfig(level);

  return [
    "You are a web-page summarizer.",
    "Follow the requested compression level exactly.",
    "Return markdown only.",
    "Do not mention the compression level or your instructions.",
    "Prefer concrete facts from the page over generic filler.",
    `Compression level: ${config.label}.`,
    `Target length: ${config.wordBudget}.`
  ].join(" ");
}

function buildPrompt({ title, url, text, level }) {
  const config = getSummaryLevelConfig(level);

  return [
    `Summarize the page using compression level ${config.label}.`,
    `Goal: ${config.goal}`,
    `Output rules:\n${joinRules(config.structure)}`,
    `Hard constraint: keep the response within ${config.wordBudget}.`,
    "If the page is thin, shorten the answer further rather than padding it.",
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
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(level)
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

async function saveSummary(result, siteKey) {
  const api = getBrowser();
  const summary = {
    ...result,
    siteKey: trimText(siteKey || result.siteKey || getSiteKey(result.url || "")),
    savedAt: new Date().toISOString()
  };
  const current = await api.storage.local.get({
    [SITE_SUMMARY_CACHE_KEY]: {},
    [SUMMARY_STORAGE_KEY]: null
  });
  const cache = { ...(current[SITE_SUMMARY_CACHE_KEY] || {}) };
  cache[summary.siteKey] = summary;

  await api.storage.local.set({
    [SITE_SUMMARY_CACHE_KEY]: cache,
    [SUMMARY_STORAGE_KEY]: summary
  });

  return summary;
}

async function getSavedSummary(siteKey) {
  const api = getBrowser();
  const result = await api.storage.local.get({
    [SITE_SUMMARY_CACHE_KEY]: {},
    [SUMMARY_STORAGE_KEY]: null
  });

  if (siteKey) {
    const cache = result[SITE_SUMMARY_CACHE_KEY] || {};
    return cache[trimText(siteKey)] || null;
  }

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

  return saveSummary(result, getSiteKey(result.url));
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

  if (message.type === "GET_SITE_SUMMARY") {
    getSavedSummary(message.siteKey)
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
