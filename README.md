# MUSICLAB DAW v3.1

A browser-first mobile DAW foundation for MUSICLAB.

## Included and functional
- Beat import
- Vocal import
- Browser microphone recording with MediaRecorder
- Headphone vocal monitoring ON/OFF
- Beat monitoring while singing
- Play / pause / stop / loop
- BPM control
- Track mute / solo
- Gain
- 3-band EQ
- Noise gate
- Compressor
- Saturation
- Echo / delay
- Reverb
- Master level
- Presets
- Parameter automation for several effects
- Natural-language AI command box that maps commands into actual controls
- Average-pitch correction preview using detected vocal pitch
- Humanize control that reduces pitch-correction strength toward the original
- WAV rendering/export
- Responsive mobile layout

## Important pitch-engine note
This version deliberately does NOT pretend to be a commercial note-by-note Auto-Tune clone. The pitch section detects an average vocal pitch, finds a target note from the selected key/scale, and applies a real pitch-shift preview by changing playback rate. Humanize reduces the correction amount. A future specialist pitch engine can replace this module for frame-by-frame correction and formant preservation.

## Noise note
The current browser noise stage uses a dynamics gate rather than ML denoising. It is intentionally conservative so it does not destroy the vocal. A dedicated ML/noise-profile processor should be added later for studio-grade denoise.

## Run
Open through HTTPS or localhost. Microphone permissions generally require a secure origin.

For GitHub Pages:
1. Upload the files.
2. Enable Pages for the branch/folder.
3. Open the HTTPS Pages URL.
4. Use headphones when monitoring your microphone.

## No Python required
This build is a static browser app. A Python backend can be added later for heavier AI/ML processing, transcription, source separation, advanced pitch correction and mastering.
