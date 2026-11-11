# Nibbler · Breachbyte

**Nibbler** is a standalone static-web packet field workbench. It supports visual selection of hex nibbles, binary bits, and text ranges; live pattern matching; reversible group editing; row reordering; packet conversion; and bit-comparison analysis. The site uses plain HTML, CSS, and JavaScript with no build step, remote fonts, frameworks, or telemetry.

## Run locally

On Windows, extract the ZIP and launch `run-local.bat`. Or start a server from this directory:

```bash
python -m http.server 8000
```

Open <http://127.0.0.1:8000/>. `file://` may block ES module imports, so opening `index.html` directly is not recommended.

## Editor controls

| Gesture | Result |
| --- | --- |
| Mouse-drag **within one packet row** | Draft a matching field in the custom overlay; does **not** save a group |
| Mouse-drag **across two or more rows** | Ordinary native text range, usable with copy, cut, delete, and typing to replace |
| **Shift+drag**, double-click or **Ctrl+A** | Native text selection (including one-line text) |
| **Shift+arrow** | Keyboard text selection; a single-row span may also preview a field |
| Drag the **centre of a coloured field** | Move the matching field horizontally or vertically to another packet |
| Drag either **edge grip** | Resize; dragging through the opposite edge reverses the field |
| **Right-click a field** | Save as group, edit, delete, or convert the selected field |
| **Right-click blank editor space** | Global Tools: convert all packet rows or manage selected text |
| **Escape** | Cancel temporary field or unsaved group edit |
| Drag **⋮⋮** beside a packet | Reorder with an immediate floating row and sliding displacement |
| **Alt+Up / Alt+Down** | Reorder the current line using the keyboard |

Native textarea selections are visually distinct from Nibbler's coloured field overlays. Groups are saved **only** via the right-click menu. When editing a saved group, **Save changes** must be selected to commit; Escape discards the edit.


## Delimiters and conversion

**Packet format** specifies how values should be interpreted. A blank **Packet delimiter** or literal `\n` means one packet per new line; entering `,`, `, `, `;` or another literal separator splits imported data into individual editable rows. Existing line breaks also delimit packets.

Right-click outside a field to access **Global Tools → Convert all packets to Hex / Binary / Decimal**. This rewrites the textbox, updates its format, and remaps exact Hex↔Binary field positions. Fields that cannot be represented exactly in the target encoding remain stored but inactive. Conversions fail atomically on malformed packets.

## Packet comparison

The comparison overview uses **hex bytes**, **binary bits**, **decimal digits**, or **text characters** according to the current format. Adjacent cells with the same state are visually grouped into labelled **SAME** or **DIFFERENT** runs; individual cells still have hover details. The lower **Bit-level field runs** list combines consecutive detected fields of the same type without joining across undetected gaps. The existing **Ignore short runs** and **Group changing bits** controls continue to affect the underlying bit-level analysis.

## Projects

**Ctrl+S** downloads a `.nibbler.json` project; **Ctrl+O** imports one. Project data includes packet text, saved field groups, match mode, delimiter, and analysis settings. Saving does not silently overwrite the original file.


© 2026 Breachbyte. All rights reserved.
