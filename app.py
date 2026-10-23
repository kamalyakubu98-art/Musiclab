import io
import numpy as np
import streamlit as st
import librosa
import librosa.display
import matplotlib.pyplot as plt
import soundfile as sf


# ============================================================
# MUSICLAB — Audio Studio v1
# Stage 1: Upload + Playback + Waveform + Audio Analysis
# ============================================================

st.set_page_config(
    page_title="MUSICLAB",
    page_icon="🎵",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ------------------------------------------------------------
# Styling
# ------------------------------------------------------------

st.markdown(
    """
    <style>
    .main-title {
        font-size: 42px;
        font-weight: 800;
        margin-bottom: 0;
    }

    .subtitle {
        font-size: 17px;
        opacity: 0.75;
        margin-top: 0;
        margin-bottom: 25px;
    }

    .metric-card {
        padding: 18px;
        border-radius: 14px;
        border: 1px solid rgba(128,128,128,0.25);
        margin-bottom: 10px;
    }

    .section-title {
        font-size: 25px;
        font-weight: 700;
        margin-top: 25px;
        margin-bottom: 10px;
    }
    </style>
    """,
    unsafe_allow_html=True,
)


# ------------------------------------------------------------
# Header
# ------------------------------------------------------------

st.markdown(
    '<div class="main-title">🎵 MUSICLAB</div>',
    unsafe_allow_html=True,
)

st.markdown(
    '<div class="subtitle">'
    "Your AI-powered vocal studio — upload, listen and analyze."
    "</div>",
    unsafe_allow_html=True,
)


# ------------------------------------------------------------
# Session state
# ------------------------------------------------------------

if "audio_data" not in st.session_state:
    st.session_state.audio_data = None

if "sample_rate" not in st.session_state:
    st.session_state.sample_rate = None

if "audio_name" not in st.session_state:
    st.session_state.audio_name = None


# ------------------------------------------------------------
# Sidebar
# ------------------------------------------------------------

with st.sidebar:
    st.header("🎛️ MUSICLAB")

    st.write("Stage 1")

    st.caption(
        "Audio upload, playback and basic analysis."
    )

    st.divider()

    st.write("Coming next:")
    st.write("🎙️ Vocal recording")
    st.write("🎯 Pitch detection")
    st.write("🧹 Noise reduction")
    st.write("🤖 Auto-Tune")
    st.write("🧑‍🎤 Humanize")
    st.write("🗣️ Word analysis")
    st.write("🎚️ Mixing")


# ------------------------------------------------------------
# Upload
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🎵 Load Your Audio</div>',
    unsafe_allow_html=True,
)

uploaded_file = st.file_uploader(
    "Upload a vocal recording or audio file",
    type=["wav", "mp3", "m4a", "flac", "ogg"],
    help="WAV is recommended for the best results.",
)


# ------------------------------------------------------------
# Audio loading
# ------------------------------------------------------------

if uploaded_file is not None:

    # Only reload when a different file is selected.
    if st.session_state.audio_name != uploaded_file.name:

        try:
            file_bytes = uploaded_file.read()

            audio_buffer = io.BytesIO(file_bytes)

            y, sr = librosa.load(
                audio_buffer,
                sr=None,
                mono=True,
            )

            st.session_state.audio_data = y
            st.session_state.sample_rate = sr
            st.session_state.audio_name = uploaded_file.name

        except Exception as error:

            st.error(
                "MUSICLAB could not read this audio file."
            )

            st.code(str(error))

            st.stop()


# ------------------------------------------------------------
# No audio yet
# ------------------------------------------------------------

if st.session_state.audio_data is None:

    st.info(
        "Upload a vocal recording above to begin."
    )

    st.markdown(
        """
        ### What MUSICLAB will do

        **1. Listen**  
        Load and play your recording.

        **2. See**  
        Display the waveform of your audio.

        **3. Analyze**  
        Measure volume, silence, peaks and other audio properties.

        **4. Improve**  
        Later we will add vocal detection, noise removal,
        pitch correction, Humanize and word-level analysis.
        """
    )

    st.stop()


# ------------------------------------------------------------
# Get audio
# ------------------------------------------------------------

y = st.session_state.audio_data
sr = st.session_state.sample_rate

duration = len(y) / sr

peak = float(np.max(np.abs(y))) if len(y) else 0.0

rms = float(np.sqrt(np.mean(np.square(y)))) if len(y) else 0.0

if rms > 0:
    rms_db = 20 * np.log10(rms)
else:
    rms_db = -120.0

peak_db = (
    20 * np.log10(peak)
    if peak > 0
    else -120.0
)


# ------------------------------------------------------------
# Audio information
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🎧 Audio</div>',
    unsafe_allow_html=True,
)

st.write(
    f"**File:** `{st.session_state.audio_name}`"
)

st.audio(
    y,
    sample_rate=sr,
)


# ------------------------------------------------------------
# Convert to WAV for downloading
# ------------------------------------------------------------

wav_buffer = io.BytesIO()

sf.write(
    wav_buffer,
    y,
    sr,
    format="WAV",
)

wav_buffer.seek(0)

st.download_button(
    label="⬇️ Download WAV Copy",
    data=wav_buffer,
    file_name="musiclab_audio.wav",
    mime="audio/wav",
)


# ------------------------------------------------------------
# Metrics
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">📊 Audio Information</div>',
    unsafe_allow_html=True,
)

col1, col2, col3, col4 = st.columns(4)

with col1:
    st.metric(
        "Duration",
        f"{duration:.2f} sec",
    )

with col2:
    st.metric(
        "Sample Rate",
        f"{sr:,} Hz",
    )

with col3:
    st.metric(
        "Peak",
        f"{peak_db:.1f} dB",
    )

with col4:
    st.metric(
        "Average Level",
        f"{rms_db:.1f} dB",
    )


# ------------------------------------------------------------
# Waveform
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">〰️ Waveform</div>',
    unsafe_allow_html=True,
)

fig, ax = plt.subplots(figsize=(12, 4))

librosa.display.waveshow(
    y,
    sr=sr,
    ax=ax,
)

ax.set_title("Audio Waveform")
ax.set_xlabel("Time (seconds)")
ax.set_ylabel("Amplitude")

fig.tight_layout()

st.pyplot(
    fig,
    use_container_width=True,
)

plt.close(fig)


# ------------------------------------------------------------
# Volume analysis
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🔊 Volume Analysis</div>',
    unsafe_allow_html=True,
)

frame_length = 2048
hop_length = 512

rms_frames = librosa.feature.rms(
    y=y,
    frame_length=frame_length,
    hop_length=hop_length,
)[0]

rms_db_frames = librosa.amplitude_to_db(
    rms_frames,
    ref=np.max,
)

time_axis = librosa.frames_to_time(
    np.arange(len(rms_db_frames)),
    sr=sr,
    hop_length=hop_length,
)

fig2, ax2 = plt.subplots(figsize=(12, 4))

ax2.plot(
    time_axis,
    rms_db_frames,
)

ax2.set_title("Volume Over Time")
ax2.set_xlabel("Time (seconds)")
ax2.set_ylabel("Relative dB")

ax2.axhline(
    -20,
    linestyle="--",
    alpha=0.6,
)

fig2.tight_layout()

st.pyplot(
    fig2,
    use_container_width=True,
)

plt.close(fig2)


# ------------------------------------------------------------
# Silence estimate
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🤫 Silence Detection</div>',
    unsafe_allow_html=True,
)

# This is deliberately conservative.
# It is NOT yet our intelligent vocal/noise detector.

silence_threshold = st.slider(
    "Silence threshold",
    min_value=-60,
    max_value=-10,
    value=-40,
    step=1,
)

silent_frames = rms_db_frames < silence_threshold

if len(silent_frames) > 0:
    silence_percentage = (
        float(np.mean(silent_frames)) * 100
    )
else:
    silence_percentage = 0.0

active_percentage = 100.0 - silence_percentage

col1, col2 = st.columns(2)

with col1:
    st.metric(
        "Estimated audio",
        f"{active_percentage:.1f}%",
    )

with col2:
    st.metric(
        "Estimated silence",
        f"{silence_percentage:.1f}%",
    )

st.caption(
    "This is a basic level-based estimate. "
    "Later MUSICLAB will distinguish singing from "
    "background noise and silence more intelligently."
)


# ------------------------------------------------------------
# Basic audio quality checks
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🩺 Basic Audio Check</div>',
    unsafe_allow_html=True,
)

warnings = []

if peak_db > -1:
    warnings.append(
        "⚠️ The recording is very close to 0 dBFS and may be clipping."
    )

if rms_db < -35:
    warnings.append(
        "⚠️ The recording is very quiet."
    )

if duration < 1:
    warnings.append(
        "⚠️ The recording is extremely short."
    )

if not warnings:

    st.success(
        "✅ No obvious basic level problems detected."
    )

else:

    for warning in warnings:
        st.warning(warning)


# ------------------------------------------------------------
# Current status
# ------------------------------------------------------------

st.markdown(
    '<div class="section-title">🚀 MUSICLAB Build Status</div>',
    unsafe_allow_html=True,
)

status_data = {
    "Audio upload": True,
    "Audio playback": True,
    "Waveform": True,
    "Volume analysis": True,
    "Silence estimate": True,
    "Vocal detection": False,
    "Noise removal": False,
    "Pitch detection": False,
    "Auto-Tune": False,
    "Humanize": False,
    "Word analysis": False,
    "Mixing": False,
}

for feature, completed in status_data.items():

    if completed:
        st.write(f"✅ {feature}")
    else:
        st.write(f"⬜ {feature}")


st.divider()

st.caption(
    "MUSICLAB Stage 1 — Audio Foundation"
            )
