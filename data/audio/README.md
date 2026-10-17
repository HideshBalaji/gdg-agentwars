# Synthetic voice notes

Four mono PCM WAV fixtures, each accompanied by an exact `.txt` transcript and `.json` provenance/extraction annotation:

- `breakdown.wav`: INC-001 / TN-07 / SHP-001; reported engine and refrigeration stop near Hosur, 600 kg inert training cargo, probe 6.5 C.
- `fridge_warning.wav`: alternative fridge-failure input; moving truck, probe 8.5 C. Do not combine this reading with the baseline 6.5 C scenario.
- `unclear_report.wav`: deliberately missing identity, exact location, and temperature; the consumer must ask for clarification, not invent facts.
- `damaged_delivery.wav`: reported outer packaging damage; interior inspection and claim disposition remain unknown.

Generated offline with [eSpeak NG](https://github.com/espeak-ng/espeak-ng) 1.52.0, English voice `en`, 155 words/minute, via `espeakng-loader` 0.2.4. Format: 22,050 Hz, 16-bit, mono. These are machine-synthesized voices, not recordings of drivers, not voice clones, and not evidence of real incidents. Each starts with “Training simulation.”

Original scenario text and generated audio output are provided as CC0-1.0 fixtures. eSpeak NG software is GPL-3.0-or-later and the loader is MIT-licensed; no engine binaries or voice-data packages are redistributed in this repository. The synthesis tools are collection-time tools, not a Gemini runtime replacement or a project dependency requirement. Audio transcription/model extraction has not been verified against Gemini; the sidecars are authored expected facts, not actual model results.
