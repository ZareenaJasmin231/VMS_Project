import base64
import cv2
import numpy as np

def detect_zones_from_base64(base64_str: str):
    """
    Decodes a base64 encoded floor plan image and extracts rooms/zones
    using OpenCV contour detection and polygon approximation.
    """
    # Remove metadata header if present (e.g. data:image/png;base64,)
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]
    
    img_bytes = base64.b64decode(base64_str)
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode floor plan image.")
    
    # 1. Convert to grayscale
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # 2. Invert thresholding (walls are white 255, rooms are black 0)
    # Using adaptive thresholding for better extraction of complex floor plans
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 8
    )
    
    # 3. Morphological dilation/closing to seal minor wall breaks
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    # 4. Find contours using RETR_CCOMP (two-level hierarchy: external and holes)
    contours, hierarchy = cv2.findContours(closed, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    
    detected_zones = []
    img_h, img_w = img.shape[:2]
    total_area = img_h * img_w
    
    if hierarchy is not None:
        hierarchy = hierarchy[0]
        for i, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            
            # Filter noise (rooms too small or covering almost entire floor plan)
            if area < (total_area * 0.002) or area > (total_area * 0.4):
                continue
            
            # Simplify polygon coordinates to get clean rectangular/polygonal shapes
            peri = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
            
            # Ensure it is a valid polygon
            if len(approx) < 3:
                continue
                
            polygon_points = []
            for pt in approx:
                px, py = float(pt[0][0]), float(pt[0][1])
                polygon_points.append({"x": px, "y": py})
                
            # Random/harmonic zone color selection
            colors = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#f97316", "#06b6d4"]
            color = colors[len(detected_zones) % len(colors)]
            
            # Unique identifier
            zone_id = f"auto_{i}_{int(area)}"
            
            detected_zones.append({
                "id": zone_id,
                "name": f"Auto Zone {chr(65 + len(detected_zones) % 26)}",
                "color": color,
                "polygon": polygon_points
            })
            
    return detected_zones
