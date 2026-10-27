# Search-Clean

[日本語](README.md) | **English**

**Search Clean Lite** hides Google's **AI Overviews** in your browser. Use the popup switch to turn hiding ON or OFF.

> **1.0.0 is a prerelease.** This distribution has not been reviewed through the Chrome Web Store or Microsoft Edge Add-ons.

## Download

- **[Download Search-Clean-Lite-1.0.0.zip](https://github.com/crevice0308/Search-Clean/releases/download/v1.0.0-preview.1/Search-Clean-Lite-1.0.0.zip)**
- [Prerelease details and validation notes](https://github.com/crevice0308/Search-Clean/releases/tag/v1.0.0-preview.1)

Use the ZIP linked above for installation, **not** GitHub's automatically generated “Source code (zip)” archive.

## Scope

The instructions below cover loading an unpacked extension in Google Chrome or Microsoft Edge on Windows. Compatibility with every operating system and browser version is not guaranteed.

The extension targets HTTPS search pages at `/search` (including query parameters) on these hosts:

- `www.google.com` / `google.com`
- `www.google.co.jp` / `google.co.jp`

It uses Manifest V3 and declares Chrome 105 as the minimum version. This is a manifest requirement, **not** a claim that every version from 105 onward has been tested.

## Install on Windows

1. Download the ZIP, right-click it, and choose **Extract All**.
2. Put the extracted folder somewhere you will keep it while using the extension.
3. Open your browser's extension manager:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the **`extension` folder** below—not the ZIP or its parent folder.

```text
Search-Clean-Lite-1.0.0/
└── extension/       ← Select this folder
    ├── manifest.json
    ├── content.js
    └── …
```

7. Reload your Google search page. Optionally pin the extension to the toolbar.

**Do not move or delete the loaded `extension` folder while using it.** To uninstall, remove the extension in the extension manager first, then delete the saved folder.

## Usage

Open **Search Clean Lite** from the toolbar and use the switch:

- **ON (default):** hide matching AI Overviews.
- **OFF:** disable this extension's hiding.

Google does not show an AI Overview for every search. If none appears with the switch OFF, that alone cannot establish whether the extension works.

## How it works, permissions, and privacy

- The extension **hides page elements using CSS**. It does not prevent AI Overview generation, block its network requests, or stop Google's data collection.
- It requests the `storage` permission and saves the ON/OFF setting in `chrome.storage.local`.
- Content scripts are limited to the Google search pages listed above.
- Static inspection of the distributed code found no search-data upload or analytics-request logic. This is **not** a comprehensive security audit or verification of all browser network traffic.

## Validation and limitations

- **41 mock/static tests passed**, alongside static inspection.
- A user reported that AI Overviews were hidden in their environment.
- Independent ON/OFF comparison on live Google Search, long-term behavior, and cross-browser compatibility checks remain incomplete. Passing mock tests does not establish complete real-site compatibility.
- Changes to Google's markup or display variants may prevent hiding or affect unintended content. If something looks wrong, turn the switch OFF or disable the extension.

Report problems through [Issues](https://github.com/crevice0308/Search-Clean/issues), including your browser/version, reproduction steps, and the difference between ON and OFF. Remove personal information from search terms and screenshots before sharing.

## File integrity

The published ZIP preserves the inspected original unchanged.

```text
File:    Search-Clean-Lite-1.0.0.zip
Size:    61,047 bytes
SHA-256: a3a5c3ce2663b32ff56ce3c222eec5c1b209a00c530dfbb2fb36a9414ce9381a
```

This is not an official Google or Microsoft project. No license has been specified at this time.
