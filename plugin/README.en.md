# Context Glance

[简体中文](README.md) | **English**

A read-only Antigravity Sidecar dashboard for context compaction budget, token usage, and the latest request's model. Includes six themes, three font sizes, and Chinese / English interfaces.

Tested on Windows with Antigravity App 2.31.2. Uses the host's bundled Node runtime and Sidecar SDK; no npm dependencies are required. Other host versions and desktop platforms have not been fully verified.

## Installation and use

From the full source directory, run `Install.ps1`. With the Antigravity CLI installed, use `agy plugin install ./plugin`, or install the repository's `tree/main/plugin` URL after it has been published. Open **Context Glance / 上下文仪表盘** from the conversation header's **+ / Extensions** menu.

Use the language control to switch between Chinese and English. The initial language follows the browser locale; a manual choice is saved locally.

## Reading the dashboard

- The default percentage uses the host's current compaction budget. A 256k budget does not mean the model's advertised context window is only 256k.
- A custom reference value changes the display only; it does not expand the context window or disable compaction.
- The model card shows the current conversation's latest recorded request. It updates after a request using the newly selected model is recorded.
- Native-state failures fall back to local transcript usage. Unknown values remain unknown rather than being inferred from a model name or a global default.

## Read-only behavior

Only local state and the current conversation's transcript are read. The plugin does not invoke a model, inject chat content, change model selection or host settings, or register Skills, Rules, MCP servers, Agents, or Hooks. The host allocates its loopback-only port.

Internal read-only interfaces can change after a host update. Extra fields returned by metadata interfaces are discarded; only the required metrics and model identity are retained. Hidden panels stop polling, and idle backend subscriptions close after about 12 seconds.

Author: houleelen. Licensed under the [MIT License](LICENSE). Source and full documentation: `https://github.com/Houleelen/Context-glance-For-Antigravity`.
