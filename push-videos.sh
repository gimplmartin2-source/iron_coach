#!/bin/bash
# Script zum Hochladen der Videos mit Git LFS

echo "🎬 Installiere Git LFS..."
git lfs install

echo "🎬 Tracke MP4 Dateien..."
git lfs track "*.mp4"

echo "🎬 Füge .gitattributes hinzu..."
git add .gitattributes

echo "🎬 Füge Videos hinzu..."
git add webapp/public/exercises/*.mp4

echo "🎬 Commit..."
git commit -m "Add: Trainingsvideos via Git LFS"

echo "🎬 Push..."
git push origin main

echo "✅ Videos hochgeladen!"
