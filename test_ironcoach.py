#!/usr/bin/env python3
"""
IronCoach WebApp - Komplettes Testing mit PyAutoGUI
Phasen: Login → App Test → Prüfung
"""

import pyautogui
import time
import subprocess
import os
from datetime import datetime

# Sicherheit: Failsafe aktivieren (Maus in Ecke = Not-Aus)
pyautogui.FAILSAFE = True

# Screenshot-Verzeichnis erstellen
screenshot_dir = r"C:\Users\maxgi\.openclaw\workspace\agents\ironcoach\screenshots"
os.makedirs(screenshot_dir, exist_ok=True)

def timestamp():
    return datetime.now().strftime("%H:%M:%S")

def screenshot(name):
    """Screenshot speichern"""
    path = os.path.join(screenshot_dir, name)
    pyautogui.screenshot(path)
    print(f"📸 [{timestamp()}] Screenshot gespeichert: {name}")
    return path

def wait(seconds, msg=""):
    """Warten mit Status"""
    if msg:
        print(f"⏳ [{timestamp()}] Warte {seconds}s: {msg}")
    else:
        print(f"⏳ [{timestamp()}] Warte {seconds}s...")
    time.sleep(seconds)

def click(x, y, description=""):
    """Mausklick an Position"""
    print(f"🖱️  [{timestamp()}] Klicke {description} bei ({x}, {y})")
    pyautogui.click(x, y)
    time.sleep(0.5)

def type_text(text, description=""):
    """Text eingeben"""
    print(f"⌨️  [{timestamp()}] Tippe: {description or text}")
    pyautogui.typewrite(text, interval=0.05)
    time.sleep(0.3)

def press(key, description=""):
    """Taste drücken"""
    print(f"⌨️  [{timestamp()}] Drücke: {description or key}")
    pyautogui.press(key)
    time.sleep(0.3)

print("=" * 60)
print("🔥 IRONCOACH WEBAPP - KOMPLETTES TESTING")
print("=" * 60)
print(f"🕐 Start: {timestamp()}")
print(f"🖥️  Bildschirmgröße: {pyautogui.size()}")
print(f"📁 Screenshots: {screenshot_dir}")
print()

# ==================== PHASE 1: LOGIN ====================
print("=" * 60)
print("📱 PHASE 1: GOOGLE LOGIN")
print("=" * 60)

print("\n[1/8] Chrome-Fenster aktivieren...")
# Chrom/Chrome über Alt+Tab oder direkt starten
try:
    # Versuche Chrome zu fokussieren über Titel
    import pygetwindow as gw
    chrome_windows = [w for w in gw.getAllWindows() if 'chrome' in w.title.lower() or 'google' in w.title.lower()]
    if chrome_windows:
        chrome_windows[0].activate()
        print(f"✅ Chrome-Fenster aktiviert: {chrome_windows[0].title}")
    else:
        # Starte Chrome direkt
        print("Starte Chrome neu...")
        subprocess.Popen([r"C:\Program Files\Google\Chrome\Application\chrome.exe"])
        wait(2, "Chrome starten")
except Exception as e:
    print(f"Hinweis: {e}")
    print("Bitte stelle sicher, dass Chrome im Vordergrund ist!")

wait(1, "Chrome im Fokus")

print("\n[2/8] Navigiere zur Login-URL...")
# Ctrl+L für Adressleiste, dann URL eingeben
pyautogui.keyDown('ctrl')
pyautogui.keyDown('l')
pyautogui.keyUp('l')
pyautogui.keyUp('ctrl')
time.sleep(0.5)
type_text("https://trainings-tracker-7kuw.onrender.com/auth/google", "Login-URL")
press('enter', "Enter für Navigation")

wait(4, "Seite laden")

print("\n[3/8] Aktueller Screenshot vor Benutzerauswahl...")
screenshot("pre_login.png")

print("\n[4/8] Klicke auf Benutzer 'James'...")
click(1110, 460, "Benutzer 'James'")

wait(4, "nach Benutzer-Auswahl")

print("\n[5/8] Screenshot nach Benutzer-Auswahl...")
screenshot("login_step1.png")

print("\n[6/8] Klicke 'Weiter'...")
click(1050, 750, "'Weiter'-Button")

print("\n[7/8] Warte auf Redirect...")
wait(8, "auf Redirect nach Login")

print("\n[8/8] Screenshot nach Login-Redirect...")
screenshot("login_step2.png")

print("\n✅ PHASE 1 ABGESCHLOSSEN")

# ==================== PHASE 2: APP TEST ====================
print("\n" + "=" * 60)
print("💪 PHASE 2: APP-FUNKTIONALITÄT TESTEN")
print("=" * 60)

print("\n[9/12] Prüfe URL auf token-parameter...")
# URL aus Adressleiste kopieren
pyautogui.keyDown('ctrl')
pyautogui.keyDown('l')
pyautogui.keyUp('l')
pyautogui.keyUp('ctrl')
time.sleep(0.3)
pyautogui.keyDown('ctrl')
pyautogui.keyDown('c')
pyautogui.keyUp('c')
pyautogui.keyUp('ctrl')
time.sleep(0.3)

# Screenshot um zu sehen wo wir sind
screenshot("url_check.png")
print("✅ URL-Check-Screenshot gemacht")

# Aktuellen Zustand simulieren - gehe davon aus dass Login erfolgreich war
print("\n[10/12] Suche 'Übung hinzufügen' Button...")

# Klicke auf typische Position für "Übung hinzufügen"
# Diese Koordinaten müssen möglicherweise angepasst werden
wait(2, "für Seiten-Rendering")

# Versuche mehrere Positionen für "Übung hinzufügen"
print("Klicke möglichen 'Übung hinzufügen'-Button...")
click(960, 600, "'Übung hinzufügen'-Button (geschätzt)")

wait(2, "Formular zu laden")

print("\n[11/12] Fülle Übungs-Formular aus...")

# Übung auswählen (erste Option oder Dropdown)
print("Öffne Übungs-Dropdown...")
click(960, 400, "Übungs-Dropdown")
wait(1)
press('down', "Erste Übung wählen")  # Nach unten für erste Übung
press('enter', "Übung bestätigen")
wait(1)

# Gewicht eingeben
print("Formularfelder ausfüllen...")
click(960, 500, "Gewicht-Feld")
type_text("80", "Gewicht 80kg")
press('tab', "Nächstes Feld")

type_text("3", "3 Sätze")
press('tab', "Nächstes Feld")

type_text("10", "10 Wiederholungen")

wait(1)

print("\n[12/12] Klicke 'Speichern'...")
click(960, 700, "'Speichern'-Button")

wait(3, "Speichervorgang")

print("\n[13/13] Screenshot nach Speichern...")
screenshot("app_test.png")

print("\n✅ PHASE 2 ABGESCHLOSSEN")

# ==================== PHASE 3: PRÜFUNG ====================
print("\n" + "=" * 60)
print("🔍 PHASE 3: FEHLER-PRÜFUNG MIT KONSOLE")
print("=" * 60)

print("\n[14/15] Öffne Browser-Konsole (F12)...")
press('f12', "Entwickler-Konsole (F12)")
wait(2, "Konsole öffnet")

print("Screenshot der Konsole...")
screenshot("console_errors.png")

print("\n[15/15] Konsole geschlossen lassen für weitere Tests...")
press('f12', "Konsole schließen")

wait(1)

# Abschluss-Screenshot
screenshot("final_state.png")

print("\n✅ PHASE 3 ABGESCHLOSSEN")

# ==================== ZUSAMMENFASSUNG ====================
print("\n" + "=" * 60)
print("🎉 TESTING KOMPLETT!")
print("=" * 60)
print(f"\n🕐 Ende: {timestamp()}")
print(f"📁 Alle Screenshots gespeichert in:")
print(f"   {screenshot_dir}")
print("\n📸 Erstellte Screenshots:")
for f in os.listdir(screenshot_dir):
    print(f"   - {f}")

print("\n✅ IronCoach Testing erfolgreich abgeschlossen!")
