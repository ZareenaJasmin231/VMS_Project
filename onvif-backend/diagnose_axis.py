import sys
import os
from onvif import ONVIFCamera

def diagnose_axis(ip, port, user, pwd):
    print(f"\n--- DIAGNOSING {ip} ---")
    try:
        cam = ONVIFCamera(ip, port, user, pwd)
        media = cam.create_media_service()
        imaging = cam.create_imaging_service()
        
        sources = media.GetVideoSources()
        print(f"Found {len(sources)} VideoSources")
        
        configs = media.GetVideoSourceConfigurations()
        source_to_config = {c.SourceToken: c for c in configs}
        
        for i, src in enumerate(sources):
            token = src.token
            print(f"\n[SOURCE {i+1}] Token: {token}")
            print(f"  Resolution: {getattr(src.Resolution, 'Width', 0)}x{getattr(src.Resolution, 'Height', 0)}")
            
            # Check Config
            cfg = source_to_config.get(token)
            if cfg:
                print(f"  Config Token: {cfg.token}")
                try:
                    opts = media.GetVideoSourceConfigurationOptions({'ConfigurationToken': cfg.token})
                    print(f"  Options Bounds: {getattr(opts, 'BoundsRange', 'NONE')}")
                except Exception as e:
                    print(f"  Options Error: {e}")
            else:
                print(f"  Config: NONE")
            
            # Check Imaging
            try:
                img = imaging.GetImagingSettings({'VideoSourceToken': token})
                # Look for 'None' values in Focus or Exposure - common in empty Axis ports
                focus = getattr(img, 'Focus', None)
                exposure = getattr(img, 'Exposure', None)
                print(f"  Imaging: SUCCESS")
                print(f"  Focus Object: {focus}")
                print(f"  Exposure Object: {exposure}")
            except Exception as e:
                print(f"  Imaging Error: {e}")

            # Check Profiles
            all_profiles = media.GetProfiles()
            src_profiles = [p for p in all_profiles if p.VideoSourceConfiguration and p.VideoSourceConfiguration.SourceToken == token]
            print(f"  Profiles found: {len(src_profiles)}")
            for p in src_profiles:
                print(f"    - Name: {p.Name}")

    except Exception as e:
        print(f"FATAL ERROR: {e}")

if __name__ == "__main__":
    # Using the credentials from your search
    diagnose_axis("192.168.126.240", 80, "admin", "admin123!")
