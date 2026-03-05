# Concatenate Subdocuments to Main Document with Live Editing

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/yourname/concat-subdocs)](https://github.com/yourname/concat-subdocs/releases)
[![GitHub license](https://img.shields.io/github/license/yourname/concat-subdocs)](LICENSE)

A SiYuan note plugin that automatically concatenates the content of subdocuments to the bottom of the main document, maintaining perfect rendering. Supports real-time editing synchronization, hover preview, and one-click reset of all concatenation states.

## Features

- 🔗 **One‑Click Toggle** – Click the toolbar/status bar icon to concatenate all subdocuments of the current document in file‑tree order at the bottom.
- 🎨 **Perfect Rendering** – Uses the SiYuan core engine to render Markdown; subdocument content appears exactly as when opened individually.
- ✏️ **Real‑Time Edit Sync** – After editing a subdocument in a hover float or a new tab, the concatenated area automatically refreshes.
- 🖱️ **Hover Preview** – Hover over the pencil icon on a subdocument to see a native SiYuan block‑reference float, allowing preview and opening of the subdocument.
- 🧹 **One‑Click Reset** – In the plugin settings, you can reset the concatenation state of all documents (set the `custom-concat` attribute to `false`).
- 💾 **State Memory** – The concatenation state of each document is automatically remembered and restored when the document is reopened.

## Installation

### Manual Installation
1. In your [SiYuan workspace](https://github.com/siyuan-note/siyuan), create a folder named `concat-subdocs` under `data/plugins/`.
2. Place the following three files from this repository into that folder:
   - `index.js`
   - `index.css`
   - `plugin.json`
3. Restart SiYuan, or enable the plugin in `Settings – Marketplace – Downloaded`.

### Via Community Marketplace (Coming Soon)
The plugin is planned to be submitted to the official SiYuan marketplace, where it can be installed with one click in the future.

## Usage

### Toggling Concatenation Mode
- Click the **concatenate icon** (a chain‑like icon) in the top toolbar (or bottom‑left status bar) to toggle the concatenation state of the current document.
- When enabled, all subdocuments are displayed in file‑tree order below the main document, separated by dashed lines.
- Click the icon again to close concatenation and restore the original view.

### Subdocument Operations
- **Hover Preview** – Hover over the **pencil icon** on a subdocument to open a native SiYuan block‑reference float, which shows a preview and provides an **Open** button.
- **Edit Subdocuments**:
  - Click the pencil icon to open the subdocument in a new tab for direct editing.
  - You can also edit subdocuments directly in the concatenated area.
  - Clicking the **Open** button in the hover float also opens the subdocument in a new tab.
- **Sync Updates** – After editing and saving changes in a subdocument editor, returning to the main document will automatically refresh the concatenated area.

### Clearing All Concatenation States
The plugin settings provide a one‑click reset that sets the `custom-concat` attribute to `false` for all documents and closes any currently open concatenation containers.
- Go to `Settings – Plugins – Concatenate Subdocuments to Main Document`.
- Click the **Clear Now** button and confirm the action.

## Configuration

The plugin has no complex configuration options; only the clearing function mentioned above. All concatenation states are stored via the document attribute `custom-concat` with values `true` or `false`.

## Compatibility

- SiYuan version: **v3.5.8 and above** (tested on v3.5.8, v3.5.9)
- Supports Windows / macOS / Linux

## Development & Contributions

Issues and pull requests are welcome. For local development, please ensure Node.js is installed and you are familiar with the SiYuan plugin development process.

### Project Structure
```
concat-subdocs/
├── index.js          # Main plugin code
├── index.css         # Stylesheet
├── plugin.json       # Plugin configuration
└── README.md         # This document
```

## License

[MIT](LICENSE)

## Acknowledgements

- Thanks to [SiYuan](https://github.com/siyuan-note/siyuan) for providing an excellent platform.
- Thanks to all users for their feedback and support.

---

If you find this plugin useful, please consider giving it a ⭐!