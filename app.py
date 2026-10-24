
import io
import math
import hashlib
from pathlib import Path

import numpy as np
import streamlit as st
import librosa
import librosa.display
import matplotlib.pyplot as plt
import soundfile as sf
from scipy.signal import butter, sosfiltfilt


# ============================================================
# MUSICLAB — Full MVP v2.1
# Stages 1 → Final
# Recording • Vocal Analysis • Cleaning • Pitch Assist
# Humanize • Edit Assistant • Beat Mix • Export
#
# This is a practical Streamlit MVP, not a replacement for
# professional DAW/source-separation software.
# ============================================================

st.set_page_config(
    page_title="MUSICLAB",
    page_icon="🎵",
    layout="wide",
    initial_sidebar_state="expanded",
)

SR_TARGET = 44100
HOP = 512
FRAME = 2048
EPS = 1e-9


# ----------------------------- UI ----------------------------

st.markdown("""
<style>
.main-title {font-size:44px;font-weight:800;line-height:1.05;margin-bottom:0}
.subtitle {font-size:17px;opacity:.72;margin-top:4px;margin-bottom:24px}
.section-title {font-size:25px;font-weight:750;margin-top:28px;margin-bottom:10px}
.small {font-size:13px;opacity:.72}
.badge {padding:4px 9px;border-radius:10px;background:rgba(120,120,120,.12)}
</style>
""", unsafe_allow_html=True)

st.markdown('<div class="main-title">🎵 MUSICLAB</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="subtitle">A complete vocal-studio MVP: record, analyze, clean, pitch-assist, humanize, mix and export.</div>',
    unsafe_allow_html=True,
)


# -------------------------- Session state --------------------

defaults = {
    "vocal": None,
    "vocal_sr": None,
    "vocal_name": None,
    "beat": None,
    "beat_sr": None,
    "beat_name": None,
    "processed": None,
    "processed_sr": None,
    "cleaned": None,
    "cleaned_sr": None,
    "pitch_corrected": None,
    "pitch_corrected_sr": None,
    "mixed": None,
    "mixed_sr": None,
    "analysis": None,
    "last_vocal_hash": None,
}
for k, v in defaults.items():
    if k not in st.session_state:
        st.session_state[k] = v


# --------------------------- Helpers --------------------------

def audio_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_audio(data: bytes, target_sr=SR_TARGET):
    y, sr = librosa.load(io.BytesIO(data), sr=target_sr, mono=True)
    if y.size == 0:
        raise ValueError("The audio file is empty.")
    return y.astype(np.float32), target_sr


def wav_bytes(y, sr):
    buf = io.BytesIO()
    sf.write(buf, np.asarray(y, dtype=np.float32), sr, format="WAV")
    buf.seek(0)
    return buf.getvalue()


def normalize_peak(y, peak=0.95):
    y = np.asarray(y, dtype=np.float32)
    m = float(np.max(np.abs(y))) if len(y) else 0.0
    if m <= EPS:
        return y.copy()
    return (y * min(1.0, peak / m)).astype(np.float32)


def dbfs(y):
    rms = float(np.sqrt(np.mean(np.square(y)))) if len(y) else 0.0
    return 20 * np.log10(max(rms, EPS))


def peak_dbfs(y):
    p = float(np.max(np.abs(y))) if len(y) else 0.0
    return 20 * np.log10(max(p, EPS))


def frame_rms(y):
    return librosa.feature.rms(
        y=y, frame_length=FRAME, hop_length=HOP
    )[0]


def smooth_bool(mask, width=5):
    if len(mask) < 2 or width <= 1:
        return mask
    kernel = np.ones(width, dtype=float)
    x = np.convolve(mask.astype(float), kernel, mode="same")
    return x >= (width * 0.5)


def detect_pitch(y, sr):
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=librosa.note_to_hz("C2"),
        fmax=librosa.note_to_hz("C6"),
        sr=sr,
        frame_length=FRAME,
        hop_length=HOP,
        fill_na=np.nan,
    )
    return f0, voiced_flag, voiced_prob


def hz_to_midi(f):
    return 69.0 + 12.0 * np.log2(np.maximum(f, EPS) / 440.0)


def midi_to_hz(m):
    return 440.0 * (2.0 ** ((m - 69.0) / 12.0))


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F",
              "F#", "G", "G#", "A", "A#", "B"]

SCALES = {
    "Chromatic": list(range(12)),
    "Major": [0, 2, 4, 5, 7, 9, 11],
    "Natural Minor": [0, 2, 3, 5, 7, 8, 10],
}


def nearest_scale_midi(midi_value, root_pc, scale_name):
    allowed = {(root_pc + x) % 12 for x in SCALES[scale_name]}
    base = int(round(midi_value))
    candidates = []
    for n in range(base - 12, base + 13):
        if n % 12 in allowed:
            candidates.append(n)
    return min(candidates, key=lambda n: abs(n - midi_value))


def estimate_key(y, sr):
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    profile = np.mean(chroma, axis=1)
    if np.max(profile) <= EPS:
        return "Unknown", 0.0
    idx = int(np.argmax(profile))
    confidence = float(profile[idx] / (np.mean(profile) + EPS))
    return NOTE_NAMES[idx], confidence


def vocal_activity_mask(y, sr, f0=None, voiced_prob=None):
    rms = frame_rms(y)
    rel_db = librosa.amplitude_to_db(rms + EPS, ref=np.max)
    energy = rel_db > -42.0

    if f0 is None or voiced_prob is None:
        return smooth_bool(energy, 5), rel_db

    voiced = np.isfinite(f0) & (voiced_prob >= 0.45)
    mask = energy & voiced
    mask = smooth_bool(mask, 5)
    return mask, rel_db


def apply_frame_gate(y, mask, sr, attenuation_db=-28.0):
    """Conservative gate. It does not claim to separate sources perfectly."""
    if len(y) == 0:
        return y.copy()

    gains = np.where(mask, 1.0, 10.0 ** (attenuation_db / 20.0))
    frame_centers = librosa.frames_to_samples(
        np.arange(len(gains)), hop_length=HOP
    )
    frame_centers = np.clip(frame_centers, 0, len(y) - 1)

    gain_audio = np.interp(
        np.arange(len(y)),
        frame_centers,
        gains,
    )
    # Fade boundaries slightly to reduce clicks.
    gain_audio = np.convolve(
        gain_audio,
        np.ones(max(1, int(sr * 0.008))) / max(1, int(sr * 0.008)),
        mode="same",
    )
    return (y * gain_audio).astype(np.float32)


def spectral_denoise(y, sr, reduction_db=8.0):
    """
    Conservative spectral subtraction using a low-energy noise estimate.
    This is intentionally mild to avoid destroying vocals.
    """
    if len(y) < FRAME:
        return y.copy()

    D = librosa.stft(y, n_fft=FRAME, hop_length=HOP)
    mag = np.abs(D)
    phase = np.angle(D)

    frame_energy = np.mean(mag, axis=0)
    n_noise = max(1, int(len(frame_energy) * 0.12))
    idx = np.argsort(frame_energy)[:n_noise]
    noise = np.median(mag[:, idx], axis=1, keepdims=True)

    # Keep this deliberately gentle. Aggressive spectral subtraction can create
    # phase/warbling artifacts that make a natural singing voice sound like its
    # pitch is moving. MUSICLAB therefore caps this stage at a mild setting.
    strength = np.clip(reduction_db / 30.0, 0.0, 0.35)
    clean_mag = np.maximum(mag - noise * strength, mag * 0.30)

    out = librosa.istft(
        clean_mag * np.exp(1j * phase),
        hop_length=HOP,
        length=len(y),
    )
    return out.astype(np.float32)


def pitch_assist(
    y,
    sr,
    f0,
    voiced_prob,
    root_pc,
    scale_name,
    correction_amount,
    humanize,
    max_correction_semitones=4.0,
):
    """
    Practical MVP pitch preview:
    - estimates a representative correction from voiced frames
    - applies a bounded global pitch shift
    - blends corrected/original according to correction + humanize.

    It is not a phase-vocoder Auto-Tune clone. True note-by-note
    correction needs a dedicated high-quality pitch-shifting engine.
    """
    valid = (
        np.isfinite(f0)
        & (voiced_prob >= 0.45)
    )
    if not np.any(valid):
        return y.copy(), 0.0, 0.0

    midi = hz_to_midi(f0[valid])
    targets = np.array([
        nearest_scale_midi(v, root_pc, scale_name)
        for v in midi
    ], dtype=float)

    cents = (targets - midi) * 100.0

    # Robust representative correction.
    median_cents = float(np.median(cents))
    median_cents = float(
        np.clip(
            median_cents,
            -max_correction_semitones * 100.0,
            max_correction_semitones * 100.0,
        )
    )

    correction = float(np.clip(correction_amount, 0.0, 1.0))
    human = float(np.clip(humanize, 0.0, 1.0))

    # Humanize reduces the applied correction, preserving movement.
    applied_cents = median_cents * correction * (1.0 - 0.70 * human)
    applied_semitones = applied_cents / 100.0

    if abs(applied_semitones) < 0.01:
        return y.copy(), median_cents, applied_cents

    shifted = librosa.effects.pitch_shift(
        y,
        sr=sr,
        n_steps=applied_semitones,
        bins_per_octave=12,
    )

    blend = 0.15 + 0.85 * correction
    blend *= 1.0 - 0.35 * human
    blend = float(np.clip(blend, 0.05, 1.0))

    out = (y * (1.0 - blend) + shifted * blend).astype(np.float32)
    return out, median_cents, applied_cents


def simple_master(y):
    """Gentle final level stage; intentionally not a full mastering chain."""
    y = normalize_peak(y, 0.93)
    return y.astype(np.float32)


def mix_audio(vocal, vocal_sr, beat, beat_sr, vocal_gain_db=0.0, beat_gain_db=-6.0):
    if beat is None:
        return vocal.copy(), vocal_sr

    if beat_sr != vocal_sr:
        beat = librosa.resample(
            beat,
            orig_sr=beat_sr,
            target_sr=vocal_sr,
        )

    n = max(len(vocal), len(beat))

    v = np.zeros(n, dtype=np.float32)
    b = np.zeros(n, dtype=np.float32)
    v[:len(vocal)] = vocal
    b[:len(beat)] = beat

    vg = 10 ** (vocal_gain_db / 20.0)
    bg = 10 ** (beat_gain_db / 20.0)

    mixed = v * vg + b * bg
    mixed = normalize_peak(mixed, 0.92)

    return mixed.astype(np.float32), vocal_sr


def make_analysis(y, sr):
    f0, voiced_flag, voiced_prob = detect_pitch(y, sr)
    mask, rel_db = vocal_activity_mask(y, sr, f0, voiced_prob)

    valid = np.isfinite(f0) & (voiced_prob >= 0.45)
    voiced_seconds = float(np.sum(mask) * HOP / sr)

    pitch_conf = float(np.mean(voiced_prob[valid])) if np.any(valid) else 0.0

    if np.any(valid):
        midi = hz_to_midi(f0[valid])
        median_midi = float(np.median(midi))
        median_note = NOTE_NAMES[int(round(median_midi)) % 12]
        median_hz = float(midi_to_hz(median_midi))
    else:
        median_note = "Unknown"
        median_hz = 0.0

    key, key_conf = estimate_key(y, sr)

    rms = frame_rms(y)
    rel = librosa.amplitude_to_db(rms + EPS, ref=np.max)
    silence = float(np.mean(rel < -40.0) * 100.0)

    return {
        "f0": f0,
        "voiced_prob": voiced_prob,
        "voiced_flag": voiced_flag,
        "mask": mask,
        "rel_db": rel_db,
        "pitch_conf": pitch_conf,
        "voiced_seconds": voiced_seconds,
        "median_note": median_note,
        "median_hz": median_hz,
        "key": key,
        "key_conf": key_conf,
        "silence_pct": silence,
    }


def build_edit_assistant(y, sr, analysis):
    messages = []

    rel_db = analysis["rel_db"]
    f0 = analysis["f0"]
    vp = analysis["voiced_prob"]
    mask = analysis["mask"]

    if len(rel_db):
        low = np.where(rel_db < -22)[0]
        if len(low):
            idx = int(low[0])
            t = idx * HOP / sr
            messages.append(
                f"{t:06.2f}s — possible quiet section. Consider local gain before compression."
            )

    if analysis["pitch_conf"] < 0.45:
        messages.append(
            "Pitch confidence is low. Check microphone quality, room noise and whether the input is spoken rather than sung."
        )

    uncertain = np.where(
        np.isfinite(f0) & (vp >= 0.20) & (vp < 0.45)
    )[0]
    if len(uncertain):
        idx = int(uncertain[0])
        t = idx * HOP / sr
        messages.append(
            f"{t:06.2f}s — uncertain pitch region. Listen before applying correction."
        )

    if analysis["silence_pct"] > 35:
        messages.append(
            "A large portion of the recording is low-level/silent. Trim empty space or inspect the room noise."
        )

    if not np.any(mask):
        messages.append(
            "No strong singing-like frames were detected. Do not apply aggressive vocal gating."
        )

    if not messages:
        messages.append(
            "No major automatic edit warning was found. Listen through the take before processing."
        )

    return messages


# ----------------------------- Sidebar ------------------------

with st.sidebar:
    st.header("🎛️ MUSICLAB")
    st.write("Full MVP")

    st.divider()
    st.write("### Pipeline")
    st.write("1. 🎙️ Record / Upload")
    st.write("2. 📊 Analyze")
    st.write("3. 🧹 Clean")
    st.write("4. 🎯 Pitch Assist")
    st.write("5. 🧑‍🎤 Humanize")
    st.write("6. 🗣️ Word Review")
    st.write("7. 🎚️ Mix")
    st.write("8. 💾 Export")

    st.divider()
    st.caption(
        "MUSICLAB uses conservative signal-processing methods. "
        "It does not claim perfect source separation or studio-grade Auto-Tune."
    )


# ------------------------- Input section ----------------------

st.markdown('<div class="section-title">🎙️ 1. Get Audio Into MUSICLAB</div>', unsafe_allow_html=True)

upload_tab, record_tab = st.tabs(["📁 Upload Vocal", "🎙️ Record Vocal"])

with upload_tab:
    vocal_file = st.file_uploader(
        "Upload your vocal",
        type=["wav", "mp3", "m4a", "flac", "ogg"],
        key="vocal_upload",
    )

    if vocal_file is not None:
        try:
            raw = vocal_file.getvalue()
            h = audio_hash(raw)

            if st.session_state.last_vocal_hash != h:
                y, sr = load_audio(raw)
                st.session_state.vocal = y
                st.session_state.vocal_sr = sr
                st.session_state.vocal_name = vocal_file.name
                st.session_state.last_vocal_hash = h
                st.session_state.processed = None
                st.session_state.cleaned = None
                st.session_state.pitch_corrected = None
                st.session_state.mixed = None

            st.success(f"Loaded vocal: {vocal_file.name}")
        except Exception as e:
            st.error("Could not load the vocal.")
            st.code(str(e))

with record_tab:
    st.caption(
        "Your browser will request microphone permission the first time."
    )
    recording = st.audio_input(
        "🎙️ Record your vocal",
        key="mic_recording",
    )

    if recording is not None:
        try:
            raw = recording.getvalue()
            h = audio_hash(raw)

            if st.session_state.last_vocal_hash != h:
                y, sr = load_audio(raw)
                st.session_state.vocal = y
                st.session_state.vocal_sr = sr
                st.session_state.vocal_name = "MUSICLAB microphone recording.wav"
                st.session_state.last_vocal_hash = h
                st.session_state.processed = None
                st.session_state.cleaned = None
                st.session_state.pitch_corrected = None
                st.session_state.mixed = None

            st.success("Microphone recording loaded.")
        except Exception as e:
            st.error("Could not process the recording.")
            st.code(str(e))


if st.session_state.vocal is None:
    st.info("Upload or record a vocal to begin.")
    st.stop()

vocal = st.session_state.vocal
vocal_sr = st.session_state.vocal_sr


# -------------------------- Beat input -------------------------

st.markdown('<div class="section-title">🎵 2. Optional Instrumental / Beat</div>', unsafe_allow_html=True)

beat_file = st.file_uploader(
    "Upload a beat if you want to mix it with the vocal",
    type=["wav", "mp3", "m4a", "flac", "ogg"],
    key="beat_upload",
)

if beat_file is not None:
    try:
        beat_y, beat_sr = load_audio(beat_file.getvalue())
        st.session_state.beat = beat_y
        st.session_state.beat_sr = beat_sr
        st.session_state.beat_name = beat_file.name
        st.success(f"Loaded beat: {beat_file.name}")
    except Exception as e:
        st.error("Could not load the beat.")
        st.code(str(e))


# ---------------------- Monitoring / layers -------------------

st.markdown('<div class="section-title">🎧 1A. Monitoring Layers</div>', unsafe_allow_html=True)

mon1, mon2 = st.columns(2)
with mon1:
    hear_beat = st.checkbox(
        "🎵 Beat monitor ON",
        value=True,
        help="When ON, MUSICLAB keeps the beat player available while you record. Use headphones to avoid the beat leaking into the microphone.",
    )
with mon2:
    hear_vocal = st.checkbox(
        "🎙️ Hear my vocal ON",
        value=True,
        help="Turn this OFF whenever you do not want to hear the vocal playback. It does not alter the recording.",
    )

if st.session_state.beat is not None and hear_beat:
    st.caption("Beat monitor: press play, then start recording. Headphones are strongly recommended.")
    st.audio(st.session_state.beat, sample_rate=st.session_state.beat_sr)
elif st.session_state.beat is not None:
    st.caption("Beat monitor is OFF. Turn it ON when you want the beat player available.")

st.info(
    "Important: the Streamlit microphone recorder cannot inject app audio directly into the microphone stream. "
    "For true zero-latency in-ear monitoring, use headphones/audio hardware or a future browser Web-Audio recorder. "
    "The beat layer here lets you play the beat while recording without changing your vocal file."
)

# ----------------------- Original playback ---------------------

st.markdown('<div class="section-title">▶️ 3. Original Vocal</div>', unsafe_allow_html=True)

st.write(f"**{st.session_state.vocal_name}**")
if hear_vocal:
    st.audio(vocal, sample_rate=vocal_sr)
else:
    st.caption("Vocal playback is OFF. Turn **Hear my vocal ON** when you want to listen.")

c1, c2, c3, c4 = st.columns(4)
c1.metric("Duration", f"{len(vocal)/vocal_sr:.2f}s")
c2.metric("Sample rate", f"{vocal_sr:,} Hz")
c3.metric("Peak", f"{peak_dbfs(vocal):.1f} dBFS")
c4.metric("Average", f"{dbfs(vocal):.1f} dBFS")


# ---------------------------- Analyze --------------------------

st.markdown('<div class="section-title">📊 4. Vocal Analyzer</div>', unsafe_allow_html=True)

if st.button("🔎 Analyze Vocal", type="primary", use_container_width=True):
    with st.spinner("Analyzing pitch, energy and vocal activity..."):
        st.session_state.analysis = make_analysis(vocal, vocal_sr)

analysis = st.session_state.analysis

if analysis is None:
    st.info("Press **Analyze Vocal** to calculate the vocal diagnostics.")
else:
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Pitch confidence", f"{analysis['pitch_conf']*100:.0f}%")
    c2.metric("Detected note", analysis["median_note"])
    c3.metric("Estimated key", analysis["key"])
    c4.metric("Low-level/silence", f"{analysis['silence_pct']:.0f}%")

    f0 = analysis["f0"]
    vp = analysis["voiced_prob"]
    valid = np.isfinite(f0)

    fig, ax = plt.subplots(figsize=(12, 4))
    times = librosa.frames_to_time(np.arange(len(f0)), sr=vocal_sr, hop_length=HOP)

    if np.any(valid):
        ax.plot(
            times[valid],
            f0[valid],
            linewidth=1.2,
        )

    ax.set_title("Estimated Vocal Pitch")
    ax.set_xlabel("Time (seconds)")
    ax.set_ylabel("Frequency (Hz)")
    ax.set_ylim(50, 1200)
    fig.tight_layout()
    st.pyplot(fig, use_container_width=True)
    plt.close(fig)

    fig2, ax2 = plt.subplots(figsize=(12, 3.5))
    ax2.plot(times, vp)
    ax2.set_title("Pitch / Voicing Confidence")
    ax2.set_xlabel("Time (seconds)")
    ax2.set_ylabel("Confidence")
    ax2.set_ylim(0, 1.05)
    fig2.tight_layout()
    st.pyplot(fig2, use_container_width=True)
    plt.close(fig2)


# ------------------------- Cleaning ----------------------------

st.markdown('<div class="section-title">🧹 5. Vocal Cleaning</div>', unsafe_allow_html=True)

clean_col1, clean_col2 = st.columns(2)

with clean_col1:
    noise_reduction = st.slider(
        "Spectral noise reduction",
        0,
        8,
        0,
        1,
        help="Pitch-safe noise reduction. 0 keeps the original vocal tone untouched. Higher values can introduce artifacts.",
    )

with clean_col2:
    gate_attenuation = st.slider(
        "Non-vocal attenuation",
        -36,
        -6,
        -18,
        1,
        help="How much to turn down non-vocal frames. This does not pitch-shift the vocal.",
    )

keep_breaths = st.checkbox(
    "Keep breaths / uncertain vocal regions",
    value=True,
)

if st.button("🧹 Clean Vocal", use_container_width=True):
    with st.spinner("Cleaning vocal conservatively..."):
        if analysis is None:
            analysis = make_analysis(vocal, vocal_sr)
            st.session_state.analysis = analysis

        cleaned = spectral_denoise(
            vocal,
            vocal_sr,
            reduction_db=float(noise_reduction),
        )

        mask = analysis["mask"].copy()

        if keep_breaths:
            # Relax gating around uncertain regions.
            mask = smooth_bool(mask, 3)

        cleaned = apply_frame_gate(
            cleaned,
            mask,
            vocal_sr,
            attenuation_db=float(gate_attenuation),
        )

        # Do NOT pitch-shift or globally retune the cleaned vocal.
        # Peak normalization is intentionally omitted so the cleanup stage
        # cannot make the singer sound unnaturally different.
        st.session_state.cleaned = cleaned.astype(np.float32)
        st.session_state.cleaned_sr = vocal_sr
        st.session_state.processed = st.session_state.cleaned
        st.session_state.processed_sr = vocal_sr
        st.session_state.pitch_corrected = None

    st.success("Vocal cleaning preview created — pitch is preserved.")


if st.session_state.cleaned is not None:
    st.write("**Cleaned vocal preview (pitch-safe)**")
    if hear_vocal:
        st.audio(
            st.session_state.cleaned,
            sample_rate=st.session_state.cleaned_sr,
        )
    else:
        st.caption("Vocal playback is OFF.")

if st.button("↩️ Reset to Original Vocal", use_container_width=True):
    st.session_state.cleaned = None
    st.session_state.pitch_corrected = None
    st.session_state.processed = None
    st.session_state.mixed = None
    st.rerun()


# ----------------------- Pitch + Humanize ----------------------

st.markdown('<div class="section-title">🎯 6. Pitch Assist + Humanize</div>', unsafe_allow_html=True)

if analysis is None:
    st.info("Analyze the vocal first. MUSICLAB needs a pitch contour before pitch assist.")
else:
    pc1, pc2, pc3 = st.columns(3)

    with pc1:
        root_name = st.selectbox(
            "Key root",
            NOTE_NAMES,
            index=0,
        )

    with pc2:
        scale_name = st.selectbox(
            "Scale",
            list(SCALES.keys()),
            index=1,
        )

    with pc3:
        correction_amount = st.slider(
            "Pitch correction",
            0.0,
            1.0,
            0.65,
            0.05,
        )

    humanize = st.slider(
        "Humanize",
        0.0,
        1.0,
        0.55,
        0.05,
        help="Higher values preserve more of the original pitch movement.",
    )

    st.caption(
        "This preview uses a bounded pitch-shift correction based on the detected pitch contour. "
        "It is an Auto-Tune-style assistant, not a professional note-by-note retuning engine."
    )

    st.warning(
        "Pitch correction is OFF until you press the button. The cleaning stage above never changes pitch. "
        "If your voice previously sounded high/low after cleaning, use the pitch-safe cleaning first and leave this preview untouched."
    )

    if st.button("🎯 Create Pitch-Corrected Preview", use_container_width=True):
        with st.spinner("Creating pitch-corrected preview..."):
            root_pc = NOTE_NAMES.index(root_name)
            source = (
                st.session_state.processed
                if st.session_state.processed is not None
                else vocal
            )

            # Re-detect on the current source so the preview matches the audio.
            f0, vf, vp = detect_pitch(source, vocal_sr)

            corrected, median_cents, applied_cents = pitch_assist(
                source,
                vocal_sr,
                f0,
                vp,
                root_pc,
                scale_name,
                correction_amount,
                humanize,
            )

            st.session_state.pitch_corrected = corrected.astype(np.float32)
            st.session_state.pitch_corrected_sr = vocal_sr
            st.session_state.processed = st.session_state.pitch_corrected
            st.session_state.processed_sr = vocal_sr

            st.session_state.pitch_report = (
                median_cents,
                applied_cents,
            )

        st.success("Pitch-corrected preview created.")

    if st.session_state.get("pitch_report"):
        median_cents, applied_cents = st.session_state.pitch_report
        c1, c2 = st.columns(2)
        c1.metric("Typical detected correction", f"{median_cents:+.0f} cents")
        c2.metric("Applied preview correction", f"{applied_cents:+.0f} cents")

    if st.session_state.pitch_corrected is not None:
        st.write("**Pitch-corrected preview**")
        if hear_vocal:
            st.audio(
                st.session_state.pitch_corrected,
                sample_rate=st.session_state.pitch_corrected_sr,
            )
        else:
            st.caption("Vocal playback is OFF.")


# ---------------------- Edit Assistant ------------------------

st.markdown('<div class="section-title">🧠 7. Edit Assistant</div>', unsafe_allow_html=True)

if analysis is None:
    st.info("Analyze the vocal to generate edit recommendations.")
else:
    edits = build_edit_assistant(vocal, vocal_sr, analysis)

    for i, message in enumerate(edits, 1):
        st.write(f"**{i}.** {message}")

    st.caption(
        "Recommendations are suggestions, not automatic claims that a take is bad."
    )


# ---------------------- Word / lyric review --------------------

st.markdown('<div class="section-title">🗣️ 8. Word & Lyric Review</div>', unsafe_allow_html=True)

st.caption(
    "Paste the words/lyrics you sang. MUSICLAB can organize them for review. "
    "True word-level timestamps require a dedicated transcription/alignment model."
)

lyrics = st.text_area(
    "Lyrics / transcript",
    placeholder="Paste the words you sang here...",
    height=140,
)

if lyrics.strip():
    words = re.findall(r"[A-Za-zÀ-ÿ0-9']+", lyrics)
    unique = len(set(w.lower() for w in words))
    st.write(f"**Words:** {len(words)}  •  **Unique words:** {unique}")

    if analysis is not None:
        if analysis["pitch_conf"] < 0.45:
            st.warning(
                "The recording has low pitch confidence. Check pronunciation and recording quality manually."
            )
        else:
            st.success(
                "The recording has enough pitch information for the current vocal analysis."
            )

    st.info(
        "Word-by-word timing and pronunciation scoring are reserved for the "
        "optional transcription/alignment upgrade."
    )


# ------------------------- Beat mixing -------------------------

st.markdown('<div class="section-title">🎚️ 9. Vocal + Beat Mixer</div>', unsafe_allow_html=True)

if st.session_state.beat is None:
    st.info("Upload a beat above to activate the mixer.")
else:
    beat_gain = st.slider(
        "Beat level",
        -18.0,
        3.0,
        -6.0,
        0.5,
        format="%.1f dB",
    )

    vocal_gain = st.slider(
        "Vocal level",
        -6.0,
        6.0,
        0.0,
        0.5,
        format="%.1f dB",
    )

    source = (
        st.session_state.processed
        if st.session_state.processed is not None
        else vocal
    )

    if st.button("🎚️ Create Mix", use_container_width=True):
        with st.spinner("Mixing vocal and beat..."):
            mixed, mix_sr = mix_audio(
                source,
                vocal_sr,
                st.session_state.beat,
                st.session_state.beat_sr,
                vocal_gain_db=float(vocal_gain),
                beat_gain_db=float(beat_gain),
            )
            st.session_state.mixed = mixed
            st.session_state.mixed_sr = mix_sr

        st.success("Mix created.")

    if st.session_state.mixed is not None:
        st.write("**Vocal + Beat layer**")
        if hear_vocal or hear_beat:
            st.audio(
                st.session_state.mixed,
                sample_rate=st.session_state.mixed_sr,
            )
        else:
            st.caption("Both monitoring switches are OFF.")


# ---------------------------- Export ---------------------------

st.markdown('<div class="section-title">💾 10. Export</div>', unsafe_allow_html=True)

export_source = None
export_sr = None
export_label = ""

if st.session_state.mixed is not None:
    export_source = st.session_state.mixed
    export_sr = st.session_state.mixed_sr
    export_label = "Full mix"
elif st.session_state.pitch_corrected is not None:
    export_source = st.session_state.pitch_corrected
    export_sr = st.session_state.pitch_corrected_sr
    export_label = "Pitch-corrected vocal"
elif st.session_state.cleaned is not None:
    export_source = st.session_state.cleaned
    export_sr = st.session_state.cleaned_sr
    export_label = "Pitch-safe cleaned vocal"
else:
    export_source = vocal
    export_sr = vocal_sr
    export_label = "Original vocal"

st.write(f"**Export source:** {export_label}")

if st.button("✨ Prepare Final Export", type="primary", use_container_width=True):
    with st.spinner("Preparing final level..."):
        final_audio = simple_master(export_source)
        st.session_state.final_export = final_audio
        st.session_state.final_export_sr = export_sr
    st.success("Final export is ready.")

if st.session_state.get("final_export") is not None:
    final_bytes = wav_bytes(
        st.session_state.final_export,
        st.session_state.final_export_sr,
    )

    st.audio(
        final_bytes,
        format="audio/wav",
    )

    st.download_button(
        "⬇️ Download MUSICLAB WAV",
        data=final_bytes,
        file_name="musiclab_final.wav",
        mime="audio/wav",
        use_container_width=True,
    )


# ------------------------- Final status ------------------------

st.markdown('<div class="section-title">🚀 MUSICLAB Status</div>', unsafe_allow_html=True)

status = [
    ("Microphone recording", True),
    ("Audio upload", True),
    ("Playback", True),
    ("Waveform", True),
    ("Pitch analysis", analysis is not None),
    ("Vocal activity analysis", analysis is not None),
    ("Pitch-safe vocal cleaning", st.session_state.cleaned is not None),
    ("Pitch correction preview", bool(st.session_state.get("pitch_report"))),
    ("Humanize control", True),
    ("Edit assistant", analysis is not None),
    ("Lyric/word review", bool(lyrics.strip())),
    ("Beat mixing", st.session_state.mixed is not None),
    ("Final WAV export", st.session_state.get("final_export") is not None),
]

for name, done in status:
    st.write(("✅ " if done else "⬜ ") + name)

st.divider()
st.caption(
    "MUSICLAB Full MVP — stages 2 through final. "
    "Professional-grade source separation, note-by-note Auto-Tune, "
    "word timestamps and mastering require specialized models/engines."
)
