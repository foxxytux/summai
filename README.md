# Summai

Firefox extension that summarizes the current page with OpenRouter when you click the extension icon.

## Setup

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select [`manifest.json`](./manifest.json).
4. Open the extension options and add your OpenRouter API key.

## Behavior

- Click the extension icon.
- The popup extracts readable text from the active tab.
- The page content is sent to OpenRouter for summarization.
- The result is shown in the popup.
