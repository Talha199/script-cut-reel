# `edit/project.json` reference

All times are **raw seconds in the original recording** (what `lines.mjs` prints), regardless of
speed-up or silence removal — `build.mjs` maps them onto the final timeline. Exceptions: `t` and `dur`
are timeline seconds.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `lang` | string | from `transcribe.mjs --language` | **Required** (one or the other). `<html lang>`: Turkish uppercase (`i → İ`) only works with `"tr"`. Warns if it differs from the transcription language. |
| `segments` | `[{in, out, note?}]` | — | Kept ranges of the main video, in play order (may reorder). `note` is for humans. |
| `hook` | string \| `{text, t?, src?, dur?, srcEnd?}` | — | Headline (3–6 words) naming the topic, centred in the upper third. Default: from frame 0 until the end of segment 0 (2.5–6 s), drawn on the first frame without an entrance, so it is also the feed thumbnail / cover. `*word*` = accent colour. |
| `title` | object \| omitted | — | `{kicker, title, subtitle, dur}` placed by `{after: "hook", offset}`, `{after: "intro", offset}`, `{src: <raw s>}` or `{t: <timeline s>}` (default `t: 0`). `after: "hook"` skips an intro that directly follows the hook. At `t: 0` it is drawn on the first frame. `dur` default 4.5. |
| `refs` | `[{src, srcEnd?, dur?, kicker, text}]` | `[]` | Small chips (e.g. a quoted source) shown from `src` to `srcEnd` (raw) or for `dur` seconds. Hook, title and refs share the top band — build warns when they overlap in time. |
| `introAfter` | number \| null | `null` | Index of the segment after which the intro clip plays. Default and recommendation: no intro (see SKILL.md "Intro"). Needs `--intro` in prep. |
| `introMuted` | bool | `false` | Drop the intro clip's own audio. |
| `protect` | `[{in, out, note?}]` | `[]` | Raw ranges whose pauses belong to the delivery (Qur'an recitation, du'a, a quoted verse): no silence is cut inside them. Speed is still global — keep `--speed 1` when recitation is present. |
| `silence` | object \| `false` | `{minGap: 0.3, keepAfter: 0.15, keepBefore: 0.1}` | Remove silences ≥ `minGap` inside segments, keeping `keepAfter` s after speech and `keepBefore` s before the next word. `false` = keep all pauses. Needs `edit/silences.json`. |
| `music` | object | `{bed: 0.10, intro: 0, fadeIn: 0.4, fadeOut: 1.2, start: 0}` | Linear gains (both tracks are −16 LUFS after prep): `bed` 0.10 ≈ −20 dB under the voice (0.06–0.08 for dense speech), `intro` during the intro clip, `start` = offset into the music file. |
| `captionFixes` | `{ "<word index>": string }` | `{}` | Replace a transcript word's text; `""` hides it. Index = position in `edit/transcript.json` (shown by `lines.mjs`). Multi-word replacements are fine (`"ist es"`). Wins over the glossary. |
| `captionInserts` | `[{text, start, end, emph?}]` | `[]` | Caption words the ASR missed (raw times). |
| `captionEmphasis` | `[word index]` | `[]` | Keywords drawn bold + accent for their whole phrase. At most one per phrase, about one every 3–5 phrases. When used, the running word highlight switches to a softer tint so gold keeps one meaning. |
| `glossary` | `{ "word": "Spelling" }` | `{}` | Spellings applied to every caption word (case-insensitive, punctuation kept). Merged over `edit/glossary.json` — keep a reusable one per language (`templates/glossary.de.json`, `glossary.tr.json`). |
| `captions` | object | portrait: `{maxChars: 22, maxWords: 5, size: 64, bottom: 680, width: 860, offsetX: 0, minDur: 0.85, scrim: 0.52, startAfter: null}`, landscape: `{42, 7, 52, 110, 1500, …}` | `maxChars` per line; longer phrases (from merging) break into two lines, a single over-long word shrinks (≥ 70 %). `bottom` 680 puts the block's lower edge at y≈1240, above Meta's bottom-35 % zone (600 if the speaker is framed low). `minDur` = shortest time on screen. `scrim` = backing opacity. `startAfter: "hook"` hides captions while the hook headline shows. `enabled: false` hides captions. |
| `theme` | object | `{accent: "#e6bf63", text: "#fbf8f1", ink: "8,16,13", highlight?}` | Accent (hook emphasis, keywords, rule), text colour, scrim colour as `"r,g,b"`, `highlight` = colour of the word being spoken (default accent, or a softer tint with `captionEmphasis`). |
| `progress` | bool | `false` | Thin accent line that fills over the talk (at y=262, under Instagram's header). Off by default: no evidence it helps, and it is cut from every grid crop. |
| `endFade` | number | `0` | Seconds of fade to black at the end. A visible outro invites the swipe and kills replays; end with a hard cut on the last word. |

## Caption grouping

Phrases break at: a different segment, a gap > 0.45 s, sentence punctuation (`. ? ! :`, also before
a closing quote), a comma after ≥ 2 words, `maxWords`, or `maxChars`. A phrase that would be on screen
for less than `minDur` merges into the next phrase of the same sentence — or into the previous one —
when the result fits on two lines (`2 × maxChars`). Build prints the reading speed: warn above
17 characters/s, too fast above 20.

## Example

See [`templates/project.example.json`](../templates/project.example.json).
