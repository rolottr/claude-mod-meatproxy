# meatproxy

**Claude writes the email. You are the meat proxy that sends it. This mod makes that part one key.**

Ask Claude Code to draft an email, a reply, or a Slack message. The draft opens in a pane on the right side of the terminal, from top to bottom. Copy it as rich text, markdown, or plain text with one click or one key, then paste it into Gmail, Outlook, Mail, Slack, or Teams.

No more "put the email in an md file in /tmp", then `cat`, then select, then copy.

```text
 ❯ Draft a reply to Begoña: nothing is missing,         │                                                    ✕
   the payments are in the transfers of 13 and 14 Oct.  │ Copy  r: Rich text  m: Markdown  p: Plain  s: Subject
                                                        │ k: ‹ Older  j: Newer ›  Draft 2 of 2  ✓ Copied rich text.
 ⏺ meatproxy - draft (MCP)(to: "Begoña",                │ ─────────────────────────────────────────────────────
     subject: "RE: Facturación de octubre",             │
     body: "12 lines, shown in the Draft pane")         │ To: Begoña
                                                        │ Subject: RE: Facturación de octubre
 ⏺ The draft is in the Draft pane.                      │
                                                        │ Hola Begoña:
                                                        │
                                                        │ No falta nada. Los pagos de Lucía están en las
                                                        │ transferencias del 13 y del 14 de octubre.
                                                        │
                                                        │ ┌───────────────┬───────┬─────────┐
                                                        │ │ Transferencia │ Fecha │ Importe │
                                                        │ ├───────────────┼───────┼─────────┤
                                                        │ │ T-101         │ 13/10 │ 120 EUR │
                                                        │ │ T-102         │ 14/10 │ 80 EUR  │
                                                        │ └───────────────┴───────┴─────────┘
                                                        │
                                                        │ Un saludo,
                                                        │ Andrés
```

## Install

At the prompt of a Claude Code session in a terminal:

```text
/plugin install meatproxy --marketplace rolottr/claude-mod-meatproxy
```

Or from a shell:

```bash
claude plugin install meatproxy --marketplace rolottr/claude-mod-meatproxy
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). The mod is active at once, with no restart.

In the Claude Desktop app, click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `rolottr/claude-mod-meatproxy`, then **Add plugin**.

### Requirements

- Claude Code v2.1.287 or later (`claude --version`). Mods do not run in older versions.
- For the pane on the right side, use the fullscreen layout. Add this to `~/.claude/settings.json`:

  ```json
  { "tui": "fullscreen" }
  ```

  In the default layout, the pane opens above the prompt, at full width.

## Use

Ask for a draft as you always do. You do not need a command or a keyword:

- "Draft a reply to Ana: thanks, I will check it tomorrow."
- "Write an email in Spanish to Marta with the payment link. Put it in an md file in /tmp."
- "Redacta una respuesta para Raúl sobre las transferencias."

Claude puts the draft in the pane and does not repeat it in the chat. When you ask for a change ("make it shorter", "add a total row"), the new version opens as the next draft, and the older versions stay in the history.

| In the pane | What it does |
| --- | --- |
| `r` Rich text | Copies the draft with its format: bold, links, lists, and tables. |
| `m` Markdown | Copies the markdown source. |
| `p` Plain | Copies plain text, with no markdown signs. |
| `s` Subject | Copies the subject line (emails only). |
| `k` ‹ Older / `j` Newer › | Steps through the drafts. |
| ✕ or `Esc` | Closes the pane. |

Click an item with the mouse, or run `/draft` to give the pane the keyboard and press the keys.

| Command | What it does |
| --- | --- |
| `/draft` | Opens the pane with the last draft. |
| `/draft rich` | Copies the last draft as rich text, with no pane. |
| `/draft md` | Copies the last draft as markdown. |
| `/draft plain` | Copies the last draft as plain text. |
| `/draft subject` | Copies the subject of the last draft. |
| `/draft close` | Closes the pane. |

The mod keeps your last 30 drafts on your computer, so `/draft` also finds a draft from an earlier session.

## Rich text on each system

Rich text goes on the clipboard in the formats that mail and chat apps read:

| System | Tool | Formats |
| --- | --- | --- |
| macOS | `osascript` (built in) | HTML, RTF, and plain text |
| Linux, Wayland | `wl-copy` (package `wl-clipboard`) | HTML |
| Linux, X11 | `xclip` | HTML |
| Windows | PowerShell `Set-Clipboard -AsHtml` | HTML |

Markdown and plain text use Claude Code's own clipboard, so they work everywhere.

## How it works

The mod gives Claude a `draft` tool and tells Claude to use it for every text that you will send to another person. This rule applies also when you ask for an md file or `/tmp`. Plans, notes, and documents for yourself still go to files as usual.

Where nothing can show a pane (the VS Code extension's chat panel, or `claude -p`), the tool tells Claude to show the draft in the chat.

If your organization manages Claude Code, it can stop the mod's rule in the system prompt and its reminder on each request. The tool's own description still tells Claude to use the pane.

## Uninstall

```bash
claude plugin uninstall meatproxy
```

Or run `/plugin`, open the **Installed** tab, and remove **meatproxy**.

## Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

[MIT](LICENSE)
