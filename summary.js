const api = typeof browser !== "undefined" ? browser : chrome;
const SUMMARY_STORAGE_KEY = "lastSummary";

const contentEl = document.getElementById("content");
const metaEl = document.getElementById("meta");

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

async function loadSummary() {
  const result = await api.storage.local.get({
    [SUMMARY_STORAGE_KEY]: null
  });

  return result[SUMMARY_STORAGE_KEY];
}

async function renderPage() {
  const data = await loadSummary();

  if (!data || !data.summary) {
    metaEl.textContent = "No saved summary yet.";
    contentEl.innerHTML = '<p class="empty">Click the extension icon and generate a summary first.</p>';
    return;
  }

  metaEl.textContent = data.title ? data.title : "Saved summary";
  contentEl.innerHTML = renderMarkdown(data.summary);
}

document.addEventListener("DOMContentLoaded", () => {
  renderPage().catch((error) => {
    metaEl.textContent = "Could not load summary.";
    contentEl.innerHTML = `<p class="empty">${escapeHtml(error && error.message ? error.message : "Unexpected error")}</p>`;
  });
});
