# `edit/project.json` reference

All times are **raw seconds in the original recording** (what `lines.mjs` prints), regardless of
speed-up or silence removal — `build.mjs` maps them onto the final timeline.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `lang` | string | `"en"` | `<html lang>`; set it to the spoken language (`"de"`, `"tr"`, …). |
| `segments` | `[{in, out, note?}]` | — | Kept ranges of the main video, in play order (may reorder). `note` is for humans. |
| `introAfter` | number \| null | `null` | Index of the segment after which the intro clip plays. Needs `--intro` in prep. |
| `introMuted` | bool | `false` | Drop the intro clip's own audio. |
| `silence` | object \| `false` | `{minGap: 0.25, keepAfter: 0.1, keepBefore: 0.08}` | Remove silences ≥ `minGap` inside segments, keeping `keepAfter` s after speech and `keepBefore` s before the next word. `false` = keep all pauses. Needs `edit/silences.json`. |
| `music` | object | `{bed: 0.12, intro: 0, fadeIn: 1, fadeOut: 2.5, start: 0}` | Linear gains (both tracks are −16 LUFS after prep). `bed` under speech, `intro` during the intro clip, `start` = offset into the music file. |
| `title` | object \| omitted | — | `{after: "intro", offset, dur, kicker, title, subtitle}` or `{src: <raw s>, dur, …}` or `{t: <timeline s>, …}`. |
| `refs` | `[{src, srcEnd?, dur?, kicker, text}]` | `[]` | Small chips (e.g. a quoted source) shown from `src` to `srcEnd` (raw) or for `dur` seconds. |
| `captionFixes` | `{ "<word index>": string }` | `{}` | Replace a transcript word's text; `""` hides it. Index = position in `edit/transcript.json` (shown by `lines.mjs`). Multi-word replacements are fine (`"ist es"`). |
| `captionInserts` | `[{text, start, end}]` | `[]` | Caption words the ASR missed (raw times). |
| `captions` | object | portrait: `{maxChars: 28, maxWords: 5, size: 64, bottom: 520}` landscape: `{42, 7, 52, 110}` | Phrase grouping and placement; `enabled: false` hides captions. |
| `theme` | object | `{accent: "#e6bf63", text: "#fbf8f1", ink: "8,16,13"}` | Accent (highlight, rule, progress), text colour, scrim colour as `"r,g,b"`. |
| `progress` | bool | `true` | Thin accent line across the top that fills over the talk. |
| `endFade` | number | `0.8` | Seconds of fade to black at the end; `0` disables. |

## Caption grouping

Phrases break at: a different segment, a gap > 0.45 s, sentence punctuation (`. ? ! :`, also before
a closing quote), a comma after ≥ 2 words, `maxWords`, or `maxChars`. Each phrase stays ≥ 0.5 s.

## Example

See [`templates/project.example.json`](../templates/project.example.json).
