import os
import sys
from pathlib import Path

# Add project root to path so we can import app modules
sys.path.append(str(Path(__file__).parent.parent))

from app.api.routers.recording_api import convert_video_format, _windows_path_to_container

def test_path_conversions():
    print("=== Testing Windows Path Conversions ===")
    test_cases = [
        ("D:\\Exports", "/mnt/dest_d/Exports"),
        ("C:\\my_usb_folder\\sub", "/mnt/dest_c/my_usb_folder/sub"),
        ("Z:\\network_folder", "/network_backup/network_folder"),
        ("/custom/linux/path", "/custom/linux/path")
    ]
    
    success = True
    for win_path, expected_linux in test_cases:
        resolved = _windows_path_to_container(win_path)
        resolved_str = str(resolved).replace("\\", "/") # Normalize backslashes for comparison
        if resolved_str == expected_linux:
            print(f"✓ '{win_path}' -> '{resolved_str}' (Match)")
        else:
            print(f"✗ '{win_path}' -> '{resolved_str}' (Expected: '{expected_linux}')")
            success = False
    return success

def generate_dummy_mp4() -> bytes:
    """Generate a minimal valid MP4 file using ffmpeg for testing."""
    import subprocess
    cmd = [
        "ffmpeg", "-y", "-loglevel", "quiet",
        "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
        "-c:v", "libx264", "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1"
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, _ = proc.communicate(timeout=10)
        if proc.returncode == 0 and len(stdout) > 0:
            return stdout
    except Exception as e:
        print(f"Error generating dummy video: {e}")
    return b""

def test_format_conversions():
    print("\n=== Testing Video Format Transcoding ===")
    dummy_data = generate_dummy_mp4()
    if not dummy_data:
        print("⚠ Could not generate dummy MP4 data using ffmpeg (is ffmpeg installed in this environment?). Skipping video tests.")
        return True
        
    print(f"Dummy MP4 generated successfully: {len(dummy_data)} bytes")
    
    formats = ["mp4", "avi", "asf"]
    success = True
    
    for fmt in formats:
        try:
            converted = convert_video_format(dummy_data, fmt)
            if len(converted) > 100:
                print(f"✓ Converted to {fmt.upper()}: output is {len(converted)} bytes")
            else:
                print(f"✗ Converted to {fmt.upper()}: output too small ({len(converted)} bytes)")
                success = False
        except Exception as e:
            print(f"✗ Failed to convert to {fmt.upper()}: {e}")
            success = False
            
    return success

if __name__ == "__main__":
    p_success = test_path_conversions()
    v_success = test_format_conversions()
    
    if p_success and v_success:
        print("\nAll export tests PASSED! 🎉")
        sys.exit(0)
    else:
        print("\nSome export tests FAILED! ❌")
        sys.exit(1)
