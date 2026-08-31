# -*- coding: utf-8 -*-
"""Ende-zu-Ende-Test: Google-Login auf der Render-Version von IronCoach.
Edge wird mit Junction-Profil (Martins Google-Session) ueber CDP gesteuert.
Macht nach jedem Schritt einen Screenshot zur Diagnose."""
import os, subprocess, time
from playwright.sync_api import sync_playwright

SHOTS = r"C:\Users\maxgi\OneDrive\000_CODEX_WORK\03_ironcoach\screenshots\render_google_test"
os.makedirs(SHOTS, exist_ok=True)

# Edge mit Junction-Profil + Debug-Port starten (umgeht Default-Profil-Sperre)
edge_proc = subprocess.Popen([
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--user-data-dir=C:\\Users\\maxgi\\AppData\\Local\\EdgeDebug",
    "--remote-debugging-port=9333",
    "--no-first-run", "--no-default-browser-check",
    "--profile-directory=Default",
    "--window-size=1280,900",
    "about:blank",
])
time.sleep(8)

def shot(page, name):
    p = os.path.join(SHOTS, name)
    page.screenshot(path=p, full_page=False)
    print(f"[SHOT] {name}: {page.url}")

with sync_playwright() as p:
    try:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9333")
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": 1280, "height": 900})

        page.goto("https://iron-coach-90eu.onrender.com/login.html", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)
        shot(page, "01_login_page.png")

        with page.expect_navigation(timeout=60000):
            page.click("#google-login-btn")
        page.wait_for_timeout(6000)
        shot(page, "02_after_google_click.png")

        for attempt in range(8):
            url = page.url
            print(f"[LOOP {attempt}] url={url[:110]}")
            if "iron-coach-90eu.onrender.com" in url and "token=" in url:
                break
            if "accounts.google.com" in url:
                try:
                    acct = page.locator("div[data-identifier]").first
                    if acct.count() > 0 and acct.is_visible():
                        print("[INFO] Klicke Google-Konto...")
                        acct.click(timeout=5000)
                        page.wait_for_timeout(6000)
                        shot(page, f"03_after_account_click_{attempt}.png")
                        continue
                except Exception as e:
                    print("[INFO] kein Konto-Element:", str(e)[:100])
                for sel in ["button:has-text('Weiter')", "button:has-text('Continue')", "button:has-text('Zulassen')", "#submit_approve_access"]:
                    try:
                        btn = page.locator(sel).first
                        if btn.count() > 0 and btn.is_visible():
                            print(f"[INFO] Klicke Consent-Button {sel}")
                            btn.click(timeout=5000)
                            page.wait_for_timeout(6000)
                            shot(page, f"04_consent_click_{attempt}.png")
                            break
                    except Exception:
                        pass
                try:
                    cb = page.locator("input[type=checkbox]").first
                    if cb.count() > 0 and cb.is_visible() and not cb.is_checked():
                        cb.check(timeout=3000)
                except Exception:
                    pass
            page.wait_for_timeout(4000)
            shot(page, f"05_loop_{attempt}.png")

        page.wait_for_timeout(4000)
        shot(page, "06_final.png")
        print("[RESULT] Finale URL:", page.url[:200])
        if "token=" in page.url:
            print("[RESULT] LOGIN ERFOLGREICH - Token in URL!")
        else:
            try:
                print("[RESULT] Fehlermeldung:", page.inner_text("#login-error"))
            except Exception:
                pass
        browser.close()
    finally:
        edge_proc.terminate()
print("FERTIG")