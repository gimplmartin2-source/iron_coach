import pyautogui
import time
import re
from PIL import Image

# Failsafe aktivieren
pyautogui.FAILSAFE = True

print("=== Google Login Automation Start ===")

# Schritt 1: Auth URL öffnen
print("1. Öffne Browser URL...")
pyautogui.hotkey('ctrl', 'l')
time.sleep(0.5)
pyautogui.typewrite('https://trainings-tracker-7kuw.onrender.com/auth/google')
time.sleep(0.5)
pyautogui.press('enter')
time.sleep(4)  # Warte auf Seite

# Schritt 2: Klicke auf James (Position 1110, 460)
print("2. Klicke auf James Account...")
pyautogui.click(1110, 460)
print(f"   Geklickt bei Position (1110, 460)")
time.sleep(3)

# Screenshot nach James-Selektion
screenshot1 = pyautogui.screenshot()
screenshot1.save('step1.png')
print("   ✓ Screenshot gespeichert: step1.png")

# Schritt 3: Klicke Weiter-Button (Consent-Seite)
print("3. Klicke Weiter-Button...")
pyautogui.click(1050, 750)
print(f"   Geklickt bei Position (1050, 750)")

# Warte auf Redirect (länger wegen Netzwerk)
print("   Warte auf Redirect...")
time.sleep(7)

# Screenshot nach Redirect
screenshot2 = pyautogui.screenshot()
screenshot2.save('step2.png')
print("   ✓ Screenshot gespeichert: step2.png")

# Schritt 4: URL auslesen
print("4. Prüfe URL auf Token...")
pyautogui.hotkey('ctrl', 'l')
time.sleep(0.3)
pyautogui.hotkey('ctrl', 'c')
time.sleep(0.3)

# Versuche aus Zwischenablage zu lesen
try:
    from PIL import ImageGrab
    import win32clipboard
    
    win32clipboard.OpenClipboard()
    url = win32clipboard.GetClipboardData()
    win32clipboard.CloseClipboard()
    
    print(f"   Aktuelle URL: {url}")
    
    # Prüfe auf Token in URL
    if 'token=' in url:
        token_match = re.search(r'token=([^&\s]+)', url)
        if token_match:
            token = token_match.group(1)
            print(f"\n✅ TOKEN GEFUNDEN: {token[:50]}...")
            
            # Speichere Token
            with open('token.txt', 'w') as f:
                f.write(token)
            print("✓ Token gespeichert in token.txt")
        else:
            print("⚠️ Token-Parameter gefunden, aber konnte nicht extrahiert werden")
    elif 'trainings-tracker-7kuw.onrender.com' in url:
        print(f"⚠️ Auf der richtigen Domain, aber kein Token in URL: {url}")
    else:
        print(f"⚠️ Anderer Redirect: {url}")
        
except Exception as e:
    print(f"   Konnte URL nicht auslesen: {e}")
    print("   Bitte manuell prüfen - Screenshots step1.png und step2.png liegen vor")

print("\n=== Automation Complete ===")
