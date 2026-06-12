import json
import pytest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "src"))
from recording.recording_assistant import LabelTracker

NOMINAL_FPS = 30


@pytest.fixture
def tracker():
    t = LabelTracker(fps=NOMINAL_FPS, subject_id="p12", camera_id=0)
    t.set_wall_start(1000.0)
    return t


class TestSegmentMath:
    def test_first_segment_starts_at_frame_zero(self, tracker):
        tracker.add("foot_hold", 1000.0, 1001.0)
        seg = tracker.segments[0]
        assert seg["start_frame"] == 0
        assert seg["start_sec"] == 0.0
        assert seg["end_sec"] == pytest.approx(1.0)
        assert seg["duration_sec"] == pytest.approx(1.0)

    def test_frames_derived_from_wall_clock_not_counter(self, tracker):
        tracker.add("foot_hold", 1000.0, 1007.0)
        tracker.add("heel_tap", 1007.0, 1008.5)
        seg = tracker.segments[1]
        assert seg["gesture"] == "heel_tap"
        assert seg["start_frame"] == 210
        assert seg["start_sec"] == pytest.approx(7.0)
        assert seg["duration_sec"] == pytest.approx(1.5)

    def test_segments_are_contiguous_no_gaps_no_overlaps(self, tracker):
        times = [1000.0, 1003.0, 1009.0, 1012.0]
        labels = ["foot_hold", "heel_tap", "foot_hold"]
        for label, (t0, t1) in zip(labels, zip(times, times[1:])):
            tracker.add(label, t0, t1)
        for a, b in zip(tracker.segments, tracker.segments[1:]):
            assert b["start_sec"] == pytest.approx(a["end_sec"])
            assert b["start_frame"] == a["end_frame"] + 1

    def test_zero_duration_segment_produces_single_frame(self, tracker):
        tracker.add("heel_tap", 1005.0, 1005.0)
        seg = tracker.segments[0]
        assert seg["duration_sec"] == 0.0
        assert seg["start_frame"] == seg["end_frame"]


class TestJsonOutput:
    def test_output_schema_matches_spec(self, tracker, tmp_path):
        tracker.add("foot_hold", 1000.0, 1001.0)
        out = tmp_path / "phone1_labels.json"
        tracker.save(str(out),
                     video_file="/recordings/phone1/test.mp4")
        data = json.loads(out.read_text())
        for key in ("video_file", "subject_id", "camera_id", "nominal_fps",
                    "segments", "sync_note", "generator"):
            assert key in data, f"Missing key: {key}"
        seg = data["segments"][0]
        for key in ("gesture", "start_frame", "end_frame",
                    "start_sec", "end_sec", "duration_sec"):
            assert key in seg, f"Missing segment key: {key}"

    def test_json_is_valid_after_checkpoint_roundtrip(self, tracker, tmp_path):
        tracker.add("foot_hold", 1000.0, 1003.0)
        ckpt = tmp_path / "ckpt.json"
        tracker.save_checkpoint(str(ckpt))
        restored = LabelTracker.load_checkpoint(str(ckpt))
        assert restored.segments == tracker.segments
        restored.add("heel_tap", 1003.0, 1004.5)
        assert restored.segments[1]["start_sec"] == pytest.approx(3.0)


class TestMultiCamera:
    def test_independent_trackers_share_wall_anchor(self):
        anchor = 2000.0
        trackers = {f"phone{i}": LabelTracker(fps=30, subject_id="p12", camera_id=i)
                    for i in range(3)}
        for t in trackers.values():
            t.set_wall_start(anchor)
            t.add("heel_tap", anchor + 7.0, anchor + 8.5)
        frames = {t.segments[0]["start_frame"] for t in trackers.values()}
        assert frames == {210}
