# Summai

Firefox extension that summarizes the current page with OpenRouter when you click the extension icon.

## Install

Firefox release builds only install add-ons that are signed and verified by Mozilla.

That means:

- The `.xpi` in the GitHub release is not installable in normal Firefox until it is signed.
- For development, you can still load the source temporarily from `about:debugging#/runtime/this-firefox`.
- For a normal install, the extension needs to be submitted to Mozilla Add-ons and signed.

## Developer Edition Install

If you want to install the unsigned `.xpi` locally, use Firefox Developer Edition or Nightly:

1. Open `about:config`.
2. Search for `xpinstall.signatures.required`.
3. Set it to `false`.
4. Restart Firefox Developer Edition if needed.
5. Install `summai-0.1.0.xpi` from the GitHub release or drag it into `about:addons`.

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
