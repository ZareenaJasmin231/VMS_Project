import json
import os
import requests

class DatasheetParser:
    """
    An LLM-based parser for extracting camera specifications
    from PDF text using the Gemini API via direct REST calls.
    """
    
    def __init__(self, text: str):
        self.text = text
        self.api_key = os.environ.get("GEMINI_API_KEY")

    def parse(self) -> dict:
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set. Please add it to your .env file.")

        prompt = """You are an expert CCTV engineer and data extractor. Extract the camera specifications from the following datasheet text and return the result strictly as a valid JSON object matching the exact schema provided below. Do not include markdown formatting or backticks around the JSON.

Extract the following values based on the text. If a value is completely missing or cannot be reasonably inferred, use appropriate defaults (e.g., 2.8 for focal length, 90 for hfov, etc.).

SCHEMA:
{
  "id": "lowercase-brand-and-model-with-hyphens (e.g. axis-p3245-v)",
  "brand": "The manufacturer brand (e.g. Axis, Bosch, Hikvision, Dahua)",
  "series": "The series name (e.g. P32 Series)",
  "model": "The exact model number (e.g. P3245-V)",
  "type": "Camera physical type: must be one of [dome, bullet, ptz, fisheye, box, thermal]. Infer from text/images.",
  "sensor": "Sensor size as a string (e.g. 1/2.8 inch or 1/1.8 inch)",
  "sensorW": "Float representing sensor width in mm based on format (e.g. 5.27 for 1/2.8, 7.18 for 1/1.8)",
  "sensorH": "Float representing sensor height in mm based on format (e.g. 3.96 for 1/2.8, 5.32 for 1/1.8)",
  "megapixels": "Float representing megapixels (e.g. 2.0, 4.0, 8.0)",
  "focalLength": "Float representing minimum focal length in mm",
  "focalLengthMax": "Float representing maximum focal length in mm. If fixed lens, this equals focalLength.",
  "isVarifocal": "Boolean indicating if it is a varifocal/zoom lens",
  "hfov": "Integer representing the widest Horizontal Field of View (HFOV) in degrees",
  "hfovMin": "Integer representing the narrowest Horizontal Field of View in degrees. If fixed lens, this equals hfov.",
  "vfov": "Integer representing the widest Vertical Field of View (VFOV) in degrees",
  "dfov": "Integer representing the widest Diagonal Field of View (DFOV) in degrees",
  "rangeDay": "Integer representing typical daytime detection range in meters (default 30 if unknown)",
  "rangeNight": "Integer representing IR/night illumination range in meters (default 30 if unknown)",
  "ir": "Integer representing IR range in meters",
  "poe": "Boolean indicating if it supports Power over Ethernet (PoE)",
  "ip": "String indicating ingress protection rating (e.g. IP66 or IP67)",
  "notes": "Short string summarizing key features.",
  "coverageArea": 0,
  "icon": "Must match the type field exactly",
  "bitrateTypical": "Float representing typical bitrate in Mbps (default 3.0)",
  "fps": "Integer representing maximum frames per second (e.g. 30 or 60)",
  "codecSupport": "Array of strings (e.g. [H.264, H.265])",
  "onboardStorage": "Boolean indicating if it has a MicroSD/SD card slot",
  "onboardStorageMaxGB": "Integer representing max SD card capacity in GB (e.g. 256, 512. 0 if no storage)",
  "bitrateH264": "Float representing typical H.264 bitrate in Mbps (default 4.0)",
  "securityBadges": "Array of strings for security certifications (e.g. [FIPS, NDAA] or empty list)"
}

DATASHEET TEXT:
""" + self.text

        import time
        
        MODELS_TO_TRY = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-pro',
        ]
        API_VERSIONS = ['v1beta', 'v1']
        last_error = None
        
        for api_version in API_VERSIONS:
            for model_name in MODELS_TO_TRY:
                for attempt in range(3):
                    try:
                        url = f"https://generativelanguage.googleapis.com/{api_version}/models/{model_name}:generateContent?key={self.api_key}"
                        
                        payload = {
                            "contents": [{"parts": [{"text": prompt}]}],
                            "generationConfig": {"temperature": 0.1}
                        }
                        
                        print(f"[DatasheetParser] Trying {api_version}/{model_name} (attempt {attempt + 1})")
                        
                        resp = requests.post(url, json=payload, timeout=120)
                        
                        if resp.status_code == 429:
                            wait = 5 * (attempt + 1)
                            print(f"[DatasheetParser] Rate limited (429). Waiting {wait}s before retry...")
                            time.sleep(wait)
                            continue
                        elif resp.status_code == 503:
                            # Model overloaded — wait and retry once, then move to next model
                            if attempt == 0:
                                print(f"[DatasheetParser] Model {model_name} overloaded (503). Waiting 10s before retry...")
                                time.sleep(10)
                                continue
                            else:
                                error_body = resp.text[:500]
                                print(f"[DatasheetParser] ⚠️ {model_name} still overloaded (503), trying next model.")
                                last_error = Exception(f"{resp.status_code}: {error_body}")
                                break
                        elif resp.status_code == 404:
                            print(f"[DatasheetParser] ⚠️ Model {model_name} not found on {api_version}")
                            break
                        elif resp.status_code != 200:
                            error_body = resp.text[:500]
                            print(f"[DatasheetParser] ⚠️ {model_name} returned {resp.status_code}: {error_body}")
                            last_error = Exception(f"{resp.status_code}: {error_body}")
                            break
                        
                        result = resp.json()
                        
                        # Extract text from Gemini response
                        raw_text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
                        
                        # Clean up potential markdown formatting
                        if raw_text.startswith("```"):
                            lines = raw_text.split('\n')
                            if lines[0].startswith("```"):
                                lines = lines[1:]
                            if lines[-1].startswith("```"):
                                lines = lines[:-1]
                            raw_text = "\n".join(lines)
                        
                        data = json.loads(raw_text)
                        
                        # Ensure doc_id format
                        data["id"] = f"{data.get('brand', 'unknown').lower()}-{data.get('model', 'unknown').lower()}".replace(" ", "-")
                        
                        print(f"[DatasheetParser] ✅ Success with {api_version}/{model_name}")
                        return data
                        
                    except (KeyError, json.JSONDecodeError) as e:
                        last_error = e
                        print(f"[DatasheetParser] ⚠️ Parse error with {model_name}: {e}")
                        break
                    except Exception as e:
                        last_error = e
                        print(f"[DatasheetParser] ⚠️ {model_name} error: {e}")
                        if "429" in str(e) or "quota" in str(e).lower():
                            if attempt < 2:
                                time.sleep(5 * (attempt + 1))
                                continue
                        break
        
        raise ValueError(f"Failed to parse datasheet. All models exhausted. Last error: {str(last_error)}")