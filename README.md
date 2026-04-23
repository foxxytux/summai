# Summai

Firefox extension that summarizes the current page with OpenRouter when you click the extension icon.

## Install the `.xpi`

1. Download the latest `.xpi` from the [GitHub release](https://github.com/foxxytux/summai/releases/tag/v0.1.0).
2. In Firefox, open `about:addons`.
3. Click the gear icon and choose `Install Add-on From File`.
4. Select `summai-0.1.0.xpi`.
5. Open the extension options and add your OpenRouter API key.

## Dev Install

If you want to run the source directly while developing:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select [`manifest.json`](./manifest.json).
4. Open the extension options and add your OpenRouter API key.

## Behavior

- Click the extension icon.
- The popup extracts readable text from the active tab.
- The page content is sent to OpenRouter for summarization.
- The result is shown in the popup.
