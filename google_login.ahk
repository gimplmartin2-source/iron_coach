; AutoHotkey v2 Script
; Automatisiert Google OAuth Login für IronCoach

#Requires AutoHotkey v2.0

; Warte bis der Browser geöffnet ist
WinWait("Google - Google Chrome",, 30)

; Aktiviere das Fenster
WinActivate("Google - Google Chrome")

; Warte kurz
Sleep(2000)

; Klicke auf "James Claw" Account (Position anpassen nach Screen)
Click(960, 450)  ; Mittig auf Bildschirm

Sleep(2000)

; Klicke auf "Weiter" oder "Zustimmen"
Click(960, 600)

Sleep(3000)

; Klicke nochmal auf "Weiter" falls nötig
Click(960, 600)

; Fertig
MsgBox("Login-Versuch durchgeführt")
