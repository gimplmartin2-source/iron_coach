'use strict';
// Lokale Transkription über einen Whisper-Server auf Martins PC.
//
// Unterstützt zwei Server-Typen über dieselbe multipart-Schnittstelle:
//  - whisper.cpp "whisper-server"   -> WHISPER_URL=http://127.0.0.1:8178/inference   (Standard)
//  - OpenAI-kompatible Server       -> WHISPER_URL=http://127.0.0.1:8000/v1/audio/transcriptions
//    (z.B. speaches / faster-whisper-server, LocalAI)
// Beide verstehen die Felder file, language, prompt, response_format, temperature;
// überzählige Felder werden ignoriert.

const DEFAULT_URL = 'http://127.0.0.1:8178/inference';

function config() {
  return {
    url: process.env.WHISPER_URL || DEFAULT_URL,
    model: process.env.WHISPER_MODEL || 'whisper-1',
    language: process.env.WHISPER_LANGUAGE || 'de',
    timeoutMs: parseInt(process.env.WHISPER_TIMEOUT_MS, 10) || 120000
  };
}

function extensionFor(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'wav';
}

async function transcribe(buffer, mime, { prompt } = {}) {
  const cfg = config();
  const form = new FormData();
  const type = String(mime || 'audio/wav').split(';')[0];
  form.append('file', new Blob([buffer], { type }), `aufnahme.${extensionFor(mime)}`);
  form.append('model', cfg.model);
  form.append('language', cfg.language);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt);

  const started = Date.now();
  let res;
  try {
    res = await fetch(cfg.url, { method: 'POST', body: form, signal: AbortSignal.timeout(cfg.timeoutMs) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `Zeitüberschreitung nach ${cfg.timeoutMs} ms` : err.message;
    const e = new Error(`Whisper-Server nicht erreichbar (${cfg.url}): ${reason}`);
    e.code = 'WHISPER_UNREACHABLE';
    throw e;
  }
  const body = await res.text();
  if (!res.ok) {
    const e = new Error(`Whisper-Server Fehler ${res.status}: ${body.slice(0, 300)}`);
    e.code = 'WHISPER_ERROR';
    throw e;
  }
  let text;
  try {
    const json = JSON.parse(body);
    text = json.text != null ? json.text : (json.transcription || []).map(s => s.text).join(' ');
  } catch {
    text = body; // response_format=text
  }
  return { text: String(text || '').replace(/\s+/g, ' ').trim(), ms: Date.now() - started };
}

async function status() {
  const cfg = config();
  // Erreichbarkeit grob prüfen (whisper.cpp liefert auf GET / eine HTML-Seite,
  // OpenAI-kompatible Server meist 404/405 auf GET – beides heißt "läuft")
  try {
    const base = new URL(cfg.url);
    const res = await fetch(`${base.protocol}//${base.host}/`, { signal: AbortSignal.timeout(2000) });
    return { reachable: true, url: cfg.url, httpStatus: res.status };
  } catch (err) {
    return { reachable: false, url: cfg.url, error: err.message };
  }
}

module.exports = { transcribe, status, config };
