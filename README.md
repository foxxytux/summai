# Summai

Firefox extension that summarizes the current page or an uploaded PDF with OpenRouter.

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
5. Install the latest `summai-*.xpi` from the GitHub release or drag it into `about:addons`.
6. Pick a summary level in the extension options if you want longer or shorter summaries.

## Dev Install

If you want to run the source directly while developing:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select [`manifest.json`](./manifest.json).
4. Open the extension options and add your OpenRouter API key.

## Behavior

- The first time you open the popup on a site, it auto-generates a summary.
- After that, reopening the popup shows the cached summary for that site.
- Use `Upload PDF` to summarize a local PDF file.
- Use the popup `Level` control to switch summary length without opening Options.
- Click `Re-summarize` when you want a fresh summary for the current site.
