import pyautogui
import time

# Failsafe aktivieren
pyautogui.FAILSAFE = True

# Finde Chrome-Fenster mit "Google" im Titel
try:
    chrome = pyautogui.getWindowsWithTitle('Google')[0]
    chrome.activate()
    time.sleep(1)
    print("Chrome-Fenster aktiviert")
except Exception as e:
    print(f"Konnte Chrome-Fenster nicht aktivieren: {e}")
    # Versuche es mit dem aktiven Fenster
    pass

# Klicke auf "James Claw" bei Position (960, 550)
print("Klicke auf James Claw...")
pyautogui.click(960, 550)
time.sleep(2)

# Klicke auf "Weiter"-Button bei Position (1100, 700)
print("Klicke auf Weiter-Button...")
pyautogui.click(1100, 700)
time.sleep(2)

# Mache Screenshot und speichere als final.png
print("Mache Screenshot...")
screenshot_path = 'C:\\Users\\maxgi\\.openclaw\\workspace\\agents\\ironcoach\\final.png'
pyautogui.screenshot().save(screenshot_path)
print(f"Screenshot gespeichert: {screenshot_path}")
print("Done")
