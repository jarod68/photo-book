#!/usr/bin/env python3
"""
Détecte les visages dans une image et retourne leurs boîtes englobantes en JSON.
Utilise les Haar cascades d'OpenCV (frontal + profil) — aucun modèle à télécharger.

Usage : python3 detect_faces.py <image_path>
Sortie : JSON array  [{"x":…,"y":…,"width":…,"height":…}, …]
"""
import sys
import json
import os
import cv2

# Chemins possibles selon la distribution Linux / Alpine / macOS
_CASCADE_CANDIDATES = [
    cv2.data.haarcascades,
    '/usr/share/opencv4/haarcascades/',
    '/usr/share/opencv/haarcascades/',
    '/usr/local/share/opencv4/haarcascades/',
]

def _find_cascade(filename):
    for base in _CASCADE_CANDIDATES:
        p = os.path.join(base, filename)
        if os.path.exists(p):
            return p
    return None

FRONTAL = _find_cascade('haarcascade_frontalface_default.xml')
PROFILE = _find_cascade('haarcascade_profileface.xml')

def detect(image_path):
    img = cv2.imread(image_path)
    if img is None:
        return []

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Égalisation : améliore la détection sous éclairage variable
    gray = cv2.equalizeHist(gray)

    boxes = []

    def run_cascade(xml_path, flags=0):
        if not xml_path:
            return
        cc = cv2.CascadeClassifier(xml_path)
        faces = cc.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30),
            flags=flags,
        )
        if len(faces):
            for (x, y, fw, fh) in faces:
                boxes.append((int(x), int(y), int(fw), int(fh)))

    run_cascade(FRONTAL)
    run_cascade(PROFILE)                          # visages de profil
    run_cascade(PROFILE, cv2.CASCADE_SCALE_IMAGE) # profil retourné

    # Dédoublonnage rapide : supprimer les boîtes très chevauchantes
    merged = []
    for box in boxes:
        bx, by, bw, bh = box
        dup = False
        for mx, my, mw, mh in merged:
            # Chevauchement > 50 % → doublon
            ix = max(0, min(bx + bw, mx + mw) - max(bx, mx))
            iy = max(0, min(by + bh, my + mh) - max(by, my))
            if ix * iy > 0.5 * bw * bh:
                dup = True
                break
        if not dup:
            merged.append(box)

    result = []
    for (x, y, fw, fh) in merged:
        # Légère marge pour inclure front / tempes
        px = int(fw * 0.12)
        py = int(fh * 0.12)
        result.append({
            'x':      max(0, x - px),
            'y':      max(0, y - py),
            'width':  min(w - max(0, x - px), fw + 2 * px),
            'height': min(h - max(0, y - py), fh + 2 * py),
        })

    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'missing argument'}), file=sys.stderr)
        sys.exit(1)
    try:
        print(json.dumps(detect(sys.argv[1])))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        sys.exit(1)
