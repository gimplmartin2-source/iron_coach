@echo off
rem Taegliches lokales IronCoach-DB-Backup (OneDrive-synced)
cd /d "C:\Users\maxgi\OneDrive\000_CODEX_WORK\03_ironcoach"
node backup_local_db.js >> backup_local.log 2>&1