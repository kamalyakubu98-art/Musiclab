# MUSICLAB Complete MVP v2.1

This version fixes the main vocal-cleaning problem: **cleaning no longer intentionally changes the pitch of the singer**.

## What changed

- Pitch-safe vocal cleaning: the cleaning stage uses a gentle gate and optional very mild noise reduction.
- Noise reduction defaults to **0** so the original vocal tone is preserved until you choose otherwise.
- Pitch correction is a separate, manual step. It does **not** run automatically after cleaning.
- Added **🎵 Beat monitor ON/OFF**.
- Added **🎙️ Hear my vocal ON/OFF** so you can choose when you want to listen to your vocal.
- Added a clear **Vocal + Beat layer** in the mixer.
- Added **Reset to Original Vocal** so you can immediately compare against the untouched recording.
- The beat player is available before/during the recording workflow; headphones are strongly recommended.

## Important recording limitation

Streamlit's built-in microphone recorder cannot inject the app's beat directly into the microphone stream with true zero-latency in-ear monitoring. For now, use the beat player while recording, preferably with headphones. The recorded vocal remains a separate file.

A future browser Web Audio recorder can provide true live headphone monitoring, mute/solo controls, latency control, and a proper multi-track timeline.

## Files

- `app.py` — the complete MUSICLAB app
- `requirements.txt` — Python dependencies

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

## GitHub / Streamlit Cloud

Upload/replace `app.py` and `requirements.txt` in your MUSICLAB repository. Keep the repository separate from MATCHLAB.

## Honest limitation

This is a practical MVP, not professional Auto-Tune, source separation, or mastering software. The pitch-correction preview is still a bounded global pitch-shift assistant; it is intentionally kept separate from cleaning so cleaning cannot unexpectedly make the singer sound high or low.
