# MUSICLAB — Full MVP

This package starts at Stage 2 and contains the complete practical MVP in one Streamlit app.

## Included

- Microphone recording
- Audio upload
- Audio playback
- Waveform
- Volume and silence analysis
- Pitch detection with pYIN
- Estimated key
- Conservative spectral noise reduction
- Vocal-activity gating
- Pitch-assist correction
- Humanize control
- Edit Assistant recommendations
- Lyric/transcript review
- Beat upload
- Vocal + beat mixing
- WAV export

## Run

```bash
pip install -r requirements.txt
streamlit run app.py
```

## Streamlit Community Cloud

Upload/commit `app.py` and `requirements.txt` to your MUSICLAB repository. Streamlit Cloud will install the listed packages and run `app.py`.

## Important technical limitation

This is a complete MVP, but some features are intentionally conservative:

1. The noise cleaner is a spectral gate/denoiser. It is NOT perfect neural source separation.
2. The pitch correction preview uses pYIN analysis and a bounded pitch-shift blend. It is NOT a professional note-by-note Auto-Tune engine.
3. Humanize controls how strongly the correction is blended back toward the original.
4. Word review currently accepts pasted lyrics/transcript. True word timestamps, pronunciation scoring and automatic word-level gain require a dedicated speech transcription/alignment model.
5. Mixing and final level are basic. Professional mastering requires a much larger DSP chain.

These limitations are deliberate so the app remains deployable and understandable on a normal Streamlit setup.
