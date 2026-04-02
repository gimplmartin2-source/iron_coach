import pyautogui
import time

print('=== Google Login Automation ===')
print('Starte...')

# Failsafe aktivieren
pyautogui.FAILSAFE = True

# Schritt 1: Alle Fenster anzeigen
print('\n1. Suche nach Browser-Fenstern...')
all_titles = pyautogui.getAllTitles()
print(f'   Gefundene Fenster: {len(all_titles)}')

# Zeige nur relevante Fenster
for title in all_titles:
    if any(keyword in title.lower() for keyword in ['google', 'chrome', 'trainings', 'tracker', 'browser']):
        print(f'   -> Relevant: "{title}"')

# Schritt 2 & 3: Chrome-Fenster finden und aktivieren
print('\n2. Aktiviere Chrome-Fenster...')

# Versuche verschiedene Suchbegriffe
chrome_window = None
for search_term in ['Google', 'Chrome', 'trainings-tracker', 'Anmelden']:
    windows = pyautogui.getWindowsWithTitle(search_term)
    if windows:
        chrome_window = windows[0]
        print(f'   Gefunden mit "{search_term}": {chrome_window.title}')
        break

if chrome_window:
    try:
        chrome_window.activate()
        time.sleep(0.5)
        chrome_window.maximize()
        time.sleep(2)
        print('   Chrome aktiviert und maximiert')
    except Exception as e:
        print(f'   Warnung bei Aktivierung: {e}')
        time.sleep(2)
else:
    print('   Kein Chrome-Fenster gefunden - verwende aktives Fenster')
    time.sleep(2)

# Schritt 5: Screenshot VOR dem Klick
print('\n3. Mache Screenshot vor dem Klick...')
pyautogui.screenshot().save('before_click.png')
print('   -> before_click.png gespeichert')

# Schritt 6: Klick auf James (Position 960, 520)
print('\n4. Klicke auf James (960, 520)...')
pyautogui.click(960, 520)
print('   -> Geklickt!')

# Schritt 7: 3 Sekunden warten
print('   Warte 3 Sekunden...')
time.sleep(3)

# Schritt 8: Screenshot NACH dem Klick
print('\n5. Mache Screenshot nach dem Klick...')
pyautogui.screenshot().save('after_james_click.png')
print('   -> after_james_click.png gespeichert')

# Schritt 9: Klicke auf "Weiter" (Position 1100, 750)
print('\n6. Klicke auf Weiter (1100, 750)...')
pyautogui.click(1100, 750)
print('   -> Geklickt!')

# Warte 2 Sekunden
print('   Warte 2 Sekunden...')
time.sleep(2)

# Schritt 10: Finale Screenshot
print('\n7. Mache finale Screenshot...')
pyautogui.screenshot().save('final.png')
print('   -> final.png gespeichert')

print('\n=== FERTIG ===')
print('Alle Screenshots gespeichert:')
print('  - before_click.png')
print('  - after_james_click.png')
print('  - final.png')
