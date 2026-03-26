import sys
import os
import tempfile
import traceback
from datetime import datetime, timedelta

# ── Dependency check ──────────────────────────────────────────────
try:
    import cv2
except ImportError:
    print("ERROR: opencv-python not installed. Run: pip install opencv-python")
    sys.exit(1)

try:
    from PyQt6.QtWidgets import (
        QApplication, QWidget, QFileDialog,
        QVBoxLayout, QLabel, QSlider, QHBoxLayout,
        QPushButton, QStyle, QMenuBar, QComboBox, QMessageBox
    )
    from PyQt6.QtCore import QTimer, Qt
    from PyQt6.QtGui import QImage, QPixmap
except ImportError:
    print("ERROR: PyQt6 not installed. Run: pip install PyQt6")
    sys.exit(1)

try:
    from decrypt_segment import decrypt_to_bytes
except ImportError as e:
    print(f"ERROR: Could not import decrypt_segment.py — {e}")
    print("Make sure decrypt_segment.py is in the same folder as player.py")
    sys.exit(1)


# ── Player ────────────────────────────────────────────────────────
class VMSPlayer(QWidget):

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Mirador VMS Player")
        self.setGeometry(100, 100, 1200, 750)

        layout = QVBoxLayout()

        # Menu bar
        menubar = QMenuBar()
        fileMenu = menubar.addMenu("File")
        openFile = fileMenu.addAction("Open File")
        openFile.triggered.connect(self.open_file)
        openFolder = fileMenu.addAction("Open Folder")
        openFolder.triggered.connect(self.open_folder)
        fileMenu.addSeparator()
        exitAction = fileMenu.addAction("Exit")
        exitAction.triggered.connect(self.close)
        menubar.addMenu("View")
        menubar.addMenu("Tools")
        menubar.addMenu("Help")
        layout.setMenuBar(menubar)

        # Video area
        self.videoLabel = QLabel("No file loaded — use File > Open File or Open Folder")
        self.videoLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.videoLabel.setStyleSheet("background: black; color: #888; font-size: 14px;")
        self.videoLabel.setMinimumHeight(550)

        # Timeline slider
        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.sliderMoved.connect(self.seek_global)

        # Controls
        controls = QHBoxLayout()
        style = self.style()

        self.prevBtn = QPushButton()
        self.prevBtn.setIcon(style.standardIcon(QStyle.StandardPixmap.SP_MediaSeekBackward))
        self.prevBtn.clicked.connect(self.prev_frame)

        self.playBtn = QPushButton()
        self.playBtn.setIcon(style.standardIcon(QStyle.StandardPixmap.SP_MediaPlay))
        self.playBtn.clicked.connect(self.play_video)

        self.pauseBtn = QPushButton()
        self.pauseBtn.setIcon(style.standardIcon(QStyle.StandardPixmap.SP_MediaPause))
        self.pauseBtn.clicked.connect(self.pause_video)

        self.nextBtn = QPushButton()
        self.nextBtn.setIcon(style.standardIcon(QStyle.StandardPixmap.SP_MediaSeekForward))
        self.nextBtn.clicked.connect(self.next_frame)

        self.timeLabel = QLabel("00:00:00")

        self.speedBox = QComboBox()
        self.speedBox.addItems(["0.5x", "1x", "2x"])
        self.speedBox.setCurrentText("1x")
        self.speedBox.currentTextChanged.connect(self.change_speed)

        self.fullscreenBtn = QPushButton()
        self.fullscreenBtn.setIcon(style.standardIcon(QStyle.StandardPixmap.SP_TitleBarMaxButton))
        self.fullscreenBtn.clicked.connect(self.toggle_fullscreen)

        controls.addWidget(self.prevBtn)
        controls.addWidget(self.playBtn)
        controls.addWidget(self.pauseBtn)
        controls.addWidget(self.nextBtn)

        timelineLayout = QVBoxLayout()
        self.timelineLabel = QLabel("Recording Timeline")
        self.timelineLabel.setAlignment(Qt.AlignmentFlag.AlignCenter)
        timelineLayout.addWidget(self.timelineLabel)
        timelineLayout.addWidget(self.slider)
        controls.addLayout(timelineLayout)

        controls.addWidget(self.timeLabel)
        controls.addWidget(self.speedBox)
        controls.addWidget(self.fullscreenBtn)

        layout.addWidget(self.videoLabel)
        layout.addLayout(controls)
        self.setLayout(layout)

        # State
        self.timer = QTimer()
        self.timer.timeout.connect(self.play_frame)
        self.cap = None
        self.total_frames = 0
        self.playback_speed = 33  # ~30fps
        self.file_queue = []
        self.frame_offsets = []
        self.segment_times = []
        self.current_index = 0
        self._temp_files = []  # track temp files for cleanup

    # ── Open single file ──────────────────────────────────────────
    def open_file(self):
        file, _ = QFileDialog.getOpenFileName(
            self, "Open Recording", "", "Encrypted Video (*.enc)"
        )
        if not file:
            return
        self.file_queue = [file]
        self.frame_offsets = [0]
        self.segment_times = [self._extract_timestamp(file)]
        self.current_index = 0
        self._load_video(file)

    # ── Open folder ───────────────────────────────────────────────
    def open_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Open Folder")
        if not folder:
            return

        files = sorted([
            os.path.join(folder, f)
            for f in os.listdir(folder)
            if f.lower().endswith(".enc") and os.path.getsize(os.path.join(folder, f)) > 32
        ])

        if not files:
            QMessageBox.warning(self, "No files", "No valid .enc files found in that folder.")
            return

        self.file_queue = files
        self.frame_offsets = []
        self.segment_times = []
        total = 0

        for file in files:
            try:
                decrypted = decrypt_to_bytes(file)
                if decrypted is None:
                    continue
                tmp = self._write_temp(decrypted)
                cap = cv2.VideoCapture(tmp)
                frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                cap.release()
            except Exception as e:
                print(f"[PLAYER] Could not read {file}: {e}")
                frames = 0

            self.frame_offsets.append(total)
            total += frames
            self.segment_times.append(self._extract_timestamp(file))

        self.slider.setMaximum(max(total, 1))
        self.current_index = 0
        if files:
            self._load_video(files[0])

    # ── Helpers ───────────────────────────────────────────────────
    def _extract_timestamp(self, path):
        name = os.path.basename(path).replace(".enc", "")
        for fmt in ("%Y-%m-%d_%H-%M-%S", "%Y%m%d_%H%M%S", "%Y-%m-%d %H-%M-%S"):
            try:
                return datetime.strptime(name, fmt)
            except ValueError:
                continue
        return None

    def _write_temp(self, data: bytes) -> str:
        """Write decrypted bytes to a temp file and track it."""
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tmp.write(data)
        tmp.close()
        self._temp_files.append(tmp.name)
        return tmp.name

    def _load_video(self, enc_file: str):
        self.timer.stop()
        try:
            decrypted = decrypt_to_bytes(enc_file)
            if decrypted is None:
                QMessageBox.critical(self, "Error", f"Could not decrypt:\n{enc_file}")
                return
        except Exception as e:
            QMessageBox.critical(self, "Decryption Error", str(e))
            traceback.print_exc()
            return

        tmp_path = self._write_temp(decrypted)

        if self.cap:
            self.cap.release()

        self.cap = cv2.VideoCapture(tmp_path)
        if not self.cap.isOpened():
            QMessageBox.critical(self, "Error", "Could not open video — may be corrupt.")
            return

        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Only update slider max for single-file mode
        if len(self.file_queue) == 1:
            self.slider.setMaximum(max(self.total_frames, 1))

        fps = self.cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0 or fps > 120:
            fps = 25
        self.playback_speed = int(1000 / fps)
        self.timer.start(self.playback_speed)
        print(f"[PLAYER] Loaded: {enc_file}  frames={self.total_frames}  fps={fps:.1f}")

    # ── Playback controls ─────────────────────────────────────────
    def play_video(self):
        if self.cap:
            self.timer.start(self.playback_speed)

    def pause_video(self):
        self.timer.stop()

    def next_frame(self):
        if self.cap:
            pos = int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, pos + 1)
            self.play_frame()

    def prev_frame(self):
        if self.cap:
            pos = int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, pos - 2))
            self.play_frame()

    def seek_global(self, position):
        for i in range(len(self.frame_offsets)):
            start = self.frame_offsets[i]
            end   = self.frame_offsets[i + 1] if i + 1 < len(self.frame_offsets) else self.slider.maximum()
            if start <= position < end:
                if i != self.current_index:
                    self.current_index = i
                    self._load_video(self.file_queue[i])
                local_frame = position - start
                if self.cap:
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, local_frame)
                break

    def change_speed(self, text):
        speeds = {"0.5x": 66, "1x": 33, "2x": 16}
        self.playback_speed = speeds.get(text, 33)
        if self.timer.isActive():
            self.timer.start(self.playback_speed)

    def toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    # ── Frame render loop ─────────────────────────────────────────
    def play_frame(self):
        if not self.cap:
            return

        ret, frame = self.cap.read()

        if not ret:
            # Try next segment
            self.current_index += 1
            if self.current_index < len(self.file_queue):
                self._load_video(self.file_queue[self.current_index])
            else:
                self.timer.stop()
            return

        frame_pos   = int(self.cap.get(cv2.CAP_PROP_POS_FRAMES))
        global_pos  = self.frame_offsets[self.current_index] + frame_pos if self.frame_offsets else frame_pos
        self.slider.setValue(global_pos)

        fps     = self.cap.get(cv2.CAP_PROP_FPS) or 25
        seconds = frame_pos / fps
        base    = self.segment_times[self.current_index] if self.segment_times else None

        if base:
            self.timeLabel.setText((base + timedelta(seconds=seconds)).strftime("%H:%M:%S"))
        else:
            h = int(seconds // 3600)
            m = int((seconds % 3600) // 60)
            s = int(seconds % 60)
            self.timeLabel.setText(f"{h:02d}:{m:02d}:{s:02d}")

        # Render frame
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = frame.shape
        img    = QImage(frame.data, w, h, ch * w, QImage.Format.Format_RGB888)
        pixmap = QPixmap.fromImage(img)
        scaled = pixmap.scaled(
            self.videoLabel.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation
        )
        self.videoLabel.setPixmap(scaled)

    # ── Cleanup ───────────────────────────────────────────────────
    def closeEvent(self, event):
        self.timer.stop()
        if self.cap:
            self.cap.release()
        for tmp in self._temp_files:
            try:
                os.remove(tmp)
            except Exception:
                pass
        event.accept()


# ── Entry point ───────────────────────────────────────────────────
if __name__ == "__main__":
    app = QApplication(sys.argv)
    player = VMSPlayer()
    player.show()
    sys.exit(app.exec())
