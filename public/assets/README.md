# Brand assets — drop-in manifest

The app looks for these exact filenames in this directory and falls back to
built-in placeholders until they exist. Drop the real files in and they take
over with **no code change**.

| Expected file | Used for | Notes |
|---|---|---|
| `heart-1.svg` | Sidebar brand lockup (20px) | Minimum size 14px height; clear space = ½ its height on all sides |
| `figure-mark.svg` | Empty states (140px height) | Reserved for empty states / human moments only |
| `pattern-5-clean.svg` | Empty-state background fill at opacity .14 | Must be the version with the baked-in frame stroke removed — not the original pattern-5 |
| `stamps-strokes.svg` | Section header decoration (≤1 per screen) | Not yet wired anywhere in Phase 1 |

Retired — never add: pencil motif, `paper-clip.svg`.
