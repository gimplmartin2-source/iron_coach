'use strict';
// Sprach-Eintrag: wandelt einen (von Whisper transkribierten) deutschen Satz wie
// "Liegestütz mit 25 Wiederholungen, einen Satz, dann 3x10 Bankdrücken Langhantel
// mit 60 Kilo" in strukturierte Workout-Einträge um.
//
// Bewusst regelbasiert statt LLM: Die Domäne ist klein (feste Übungsliste, Zahlen,
// wenige Einheiten), das Ergebnis ist deterministisch, läuft in Millisekunden ohne
// GPU und kann keine Übung "erfinden". Es werden ausschließlich Übungen aus der
// übergebenen Liste (= DB des Users) zugeordnet; alles andere wird als Fehler
// gemeldet.

// ---------------------------------------------------------------------------
// Normalisierung
// ---------------------------------------------------------------------------

function fold(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Leichter deutscher Stemmer für Plural/Flexion ("Liegestütze" -> "liegestutz",
// "Kurzhanteln" -> "kurzhantel", "Kniebeugen" -> "kniebeug").
function stem(token) {
  let t = token;
  if (t.length > 5 && t.endsWith('en')) return t.slice(0, -2);
  if (t.length > 4 && /[ens]$/.test(t)) return t.slice(0, -1);
  return t;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Ab wann zwei Wörter als "gleich" gelten. Kurze Wörter müssen exakt passen,
// sonst matcht z.B. "dips" auf "hips".
function isFuzzyEqual(a, b) {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len < 5) return false;
  const sim = similarity(a, b);
  return len < 8 ? sim >= 0.8 : sim >= 0.85;
}

// ---------------------------------------------------------------------------
// Wortlisten
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'ich', 'habe', 'hab', 'hatte', 'hab', 'gemacht', 'mache', 'machen', 'gamacht', 'geschafft',
  'trainiert', 'absolviert', 'gestemmt', 'gedruckt',
  'mit', 'ohne', 'dem', 'der', 'die', 'das', 'den', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
  'und', 'oder', 'dann', 'danach', 'noch', 'am', 'an', 'auf', 'im', 'in', 'zu', 'zum', 'zur', 'je',
  'jeweils', 'a', 'von', 'fur', 'also', 'ah', 'ahm', 'ahh', 'hm', 'hmm', 'ok', 'okay', 'heute',
  'jetzt', 'gerade', 'insgesamt', 'bei', 'plus', 'so', 'um', 'war', 'waren', 'hat', 'es', 'wir',
  'total', 'davon', 'dazu', 'auch', 'nochmal', 'bitte', 'eintragen', 'trag', 'ein', 'uebung',
  'ubung', 'ubungen', 'training', 'workout', 'gewicht', 'zusatzgewicht', 'korpergewicht', 'eigengewicht',
  'je', 'pro', 'lang', 'lange', 'langsam', 'schnell', 'sauber', 'gut', 'super', 'locker',
  'beide', 'alle', 'jede', 'jeden', 'jedes', 'ca', 'circa', 'etwa', 'ungefahr', 'fast', 'knapp',
  'als', 'nachstes', 'anschliessend', 'ausserdem', 'zusatzlich', 'zuerst', 'erst', 'zuletzt', 'zum', 'schluss',
  'bisschen', 'mehr', 'weniger', 'hier', 'dabei'
]);

const UNIT = {
  sets: new Set(['satz', 'satze', 'saetze', 'satzen', 'runde', 'runden', 'durchgang', 'durchgange', 'serie', 'serien', 'sets', 'set']),
  reps: new Set(['wiederholung', 'wiederholungen', 'wdh', 'wh', 'reps', 'rep', 'repetitions', 'stuck', 'wiederholen']),
  weight: new Set(['kg', 'kilo', 'kilos', 'kilogramm', 'kilogram']),
  hours: new Set(['stunde', 'stunden', 'h', 'std']),
  minutes: new Set(['minute', 'minuten', 'min', 'mins']),
  seconds: new Set(['sekunde', 'sekunden', 'sek', 'sec', 's', 'secs']),
  times: new Set(['x', 'mal'])
};
const ALL_UNITS = new Set([].concat(...Object.values(UNIT).map(s => [...s])));
const REST_WORDS = new Set(['pause', 'pausen', 'satzpause', 'erholung', 'rest']);
const FEELING_WORDS = new Set(['gefuhl', 'gefuhlt', 'rpe', 'intensitat', 'anstrengung', 'befinden']);
const REPS_CONNECTORS = new Set(['je', 'a', 'zu', 'jeweils', 'pro', 'mit']);

// Satz-/Abschnitts-Trenner zwischen Übungen
const CLAUSE_SPLIT = /(?:(?<!\d)\.+|\.+(?!\d)|[;!?\n]+|\b(?:und dann|und danach|dann|danach|anschliessend|ausserdem|zusatzlich|als nachstes|zum schluss|zuletzt)\b)/g;

// ---------------------------------------------------------------------------
// Zahlwörter (deutsch, 0..999 inkl. "fünfundzwanzig", "zweieinhalb")
// ---------------------------------------------------------------------------

const UNITS_WORDS = {
  null: 0, eins: 1, ein: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4,
  funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9
};
const TEEN_WORDS = {
  zehn: 10, elf: 11, zwolf: 12, dreizehn: 13, vierzehn: 14, funfzehn: 15, sechzehn: 16,
  siebzehn: 17, achtzehn: 18, neunzehn: 19
};
const TENS_WORDS = {
  zwanzig: 20, dreissig: 30, dreisig: 30, vierzig: 40, funfzig: 50, sechzig: 60, siebzig: 70,
  achtzig: 80, neunzig: 90
};
const UNIT_PREFIX = { ein: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };

function parseBelow100(w) {
  if (w in TEEN_WORDS) return TEEN_WORDS[w];
  if (w in TENS_WORDS) return TENS_WORDS[w];
  if (w in UNITS_WORDS && w !== 'null') return UNITS_WORDS[w];
  const m = w.match(/^(ein|zwei|drei|vier|funf|sechs|sieben|acht|neun)und(.+)$/);
  if (m && m[2] in TENS_WORDS) return UNIT_PREFIX[m[1]] + TENS_WORDS[m[2]];
  return null;
}

function parseNumberWord(word) {
  let w = word;
  if (!w) return null;
  if (w === 'null') return 0;
  if (w === 'halb' || w === 'halbe' || w === 'halben') return 0.5;
  if (w === 'eineinhalb' || w === 'anderthalb') return 1.5;
  let half = 0;
  if (w.endsWith('einhalb') && w.length > 7) {
    half = 0.5;
    w = w.slice(0, -7);
  }
  let total = 0;
  const h = w.match(/^(ein|zwei|drei|vier|funf|sechs|sieben|acht|neun)?hundert(.*)$/);
  if (h) {
    total = 100 * (h[1] ? UNIT_PREFIX[h[1]] : 1);
    w = h[2].replace(/^und/, '');
    if (!w) return total + half;
  }
  const rest = parseBelow100(w);
  if (rest === null) return null;
  return total + rest + half;
}

// ---------------------------------------------------------------------------
// Tokenisierung
// ---------------------------------------------------------------------------

function preprocess(text) {
  return fold(text)
    .replace(/(\d),(\d)/g, '$1.$2')            // 62,5 -> 62.5
    .replace(/(\d+):(\d{2})/g, ' $1:$2 ')       // 1:30 bleibt als Dauer-Token
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1 x $2')  // 3x10 / 3 × 10
    .replace(/(\d)([a-z])/g, '$1 $2')           // 60kg -> 60 kg
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[à]/g, ' a ')
    .replace(/[‐‑–—\-_/]/g, ' ')
    .replace(/[,"'„“”()[\]{}]/g, ' ');
}

const WORD_ONE = new Set(['ein', 'eine', 'einen', 'einem', 'einer', 'eins', 'halb', 'halbe', 'halben']);

// Liefert Tokens: { t: 'word', w: <folded> } oder { t: 'num', v: <number> }
function tokenize(clause) {
  const raw = clause.split(/\s+/).filter(Boolean);
  const words = [];
  for (const r of raw) {
    // "dreimal" -> "drei" "mal", "zehnmal" -> "zehn" "mal"
    const m = r.match(/^([a-z]+)mal$/);
    if (m && m[1] !== 'ein' && parseNumberWord(m[1]) !== null) {
      words.push(m[1], 'mal');
    } else if (r === 'einmal') {
      words.push('1', 'mal');
    } else {
      words.push(r);
    }
  }

  const tokens = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.:]+$/, '');
    if (!w) continue;
    if (/^\d+:\d{2}$/.test(w)) {
      const [mm, ss] = w.split(':').map(Number);
      tokens.push({ t: 'dur', v: mm * 60 + ss });
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(w)) {
      tokens.push({ t: 'num', v: parseFloat(w) });
      continue;
    }
    if (WORD_ONE.has(w)) {
      // "ein/einen" ist nur dann die Zahl 1, wenn eine Einheit folgt ("einen Satz")
      const next = (words[i + 1] || '').replace(/[.:]+$/, '');
      if (ALL_UNITS.has(next) || (next.startsWith('halb') && !w.startsWith('halb'))) {
        tokens.push({ t: 'num', v: w.startsWith('halb') ? 0.5 : 1 });
      } else {
        tokens.push({ t: 'word', w });
      }
      continue;
    }
    const n = parseNumberWord(w);
    if (n !== null) {
      tokens.push({ t: 'num', v: n });
      continue;
    }
    tokens.push({ t: 'word', w });
  }

  // "zweiundsechzig komma fünf" / "62 komma 5" -> 62.5
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].t === 'num' && tokens[i + 1].t === 'word' && tokens[i + 1].w === 'komma' && tokens[i + 2].t === 'num') {
      const frac = tokens[i + 2].v;
      tokens[i] = { t: 'num', v: parseFloat(`${tokens[i].v}.${String(frac).replace('.', '')}`) };
      tokens.splice(i + 1, 2);
    }
  }
  // "eine halbe Stunde" -> 0.5, "eineinhalb" bereits oben
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (tokens[i].t === 'num' && tokens[i].v === 1 && tokens[i + 1].t === 'num' && tokens[i + 1].v === 0.5) {
      tokens.splice(i, 2, { t: 'num', v: 0.5 });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Übungs-Index & Matching
// ---------------------------------------------------------------------------

function nameTokens(name) {
  const cleaned = preprocess(String(name).replace(/\([^)]*\)/g, ' '));
  return cleaned.split(/\s+/).filter(Boolean)
    .map(w => w.replace(/[.:]+$/, ''))
    .filter(w => w && !/^\d/.test(w) && !STOPWORDS.has(w))
    .map(stem);
}

function buildIndex(exercises, usage = {}) {
  return exercises
    .filter(e => e && e.id != null && e.name)
    .map(e => {
      const toks = nameTokens(e.name);
      return {
        ex: e,
        toks,
        concat: toks.join(''),
        group: [...toks].sort().join(' '), // Duplikate wie "Seitheben Kurzhanteln"/"Kurzhantel Seitheben"
        usage: usage[e.id] || 0
      };
    })
    .filter(x => x.toks.length > 0);
}

// Prüft, ob die Fenster-Tokens W die Übungs-Tokens E (ganz oder teilweise) treffen.
// Rückgabe: { full: bool, covered: Anzahl getroffener Übungs-Tokens, sim } oder null
function matchWindow(W, item) {
  const E = item.toks;
  const wConcat = W.join('');
  // a) Zusammengeschrieben (Bankdrücken vs. Bank drücken, Push-ups vs Pushups)
  if (isFuzzyEqual(wConcat, item.concat)) {
    return { full: true, covered: E.length, sim: similarity(wConcat, item.concat) };
  }
  // b) Wort-Mengen-Abgleich (Reihenfolge egal): jedes W-Token muss genau ein E-Token treffen
  const used = new Array(E.length).fill(false);
  let simSum = 0;
  for (const w of W) {
    let best = -1;
    let bestSim = 0;
    for (let k = 0; k < E.length; k++) {
      if (used[k]) continue;
      if (isFuzzyEqual(w, E[k])) {
        const s = similarity(w, E[k]);
        if (s > bestSim) { bestSim = s; best = k; }
      }
    }
    if (best === -1) {
      // c) Ein Wort deckt zwei aufeinanderfolgende Übungs-Wörter ab ("hammercurl" vs "hammer curl")
      let found = false;
      for (let k = 0; k + 1 < E.length; k++) {
        if (used[k] || used[k + 1]) continue;
        if (isFuzzyEqual(w, E[k] + E[k + 1])) {
          used[k] = used[k + 1] = true;
          simSum += similarity(w, E[k] + E[k + 1]);
          found = true;
          break;
        }
      }
      if (!found) return null;
    } else {
      used[best] = true;
      simSum += bestSim;
    }
  }
  const covered = used.filter(Boolean).length;
  return { full: covered === E.length, covered, sim: simSum / W.length };
}

function hasValueTokenBetween(tokens, a, b) {
  for (let p = a + 1; p < b; p++) {
    const t = tokens[p];
    if (t.t !== 'word' || ALL_UNITS.has(t.w) || REST_WORDS.has(t.w) || FEELING_WORDS.has(t.w)) return true;
  }
  return b - a > 4;
}

// Findet alle Übungs-Erwähnungen in einer Token-Liste (nicht überlappend).
function findMentions(tokens, index) {
  // Nur Wörter, die keine Zahl/Einheit/Füllwort sind, kommen für Übungsnamen infrage
  const cand = [];
  tokens.forEach((tok, pos) => {
    if (tok.t !== 'word') return;
    if (ALL_UNITS.has(tok.w) || STOPWORDS.has(tok.w) || REST_WORDS.has(tok.w) || FEELING_WORDS.has(tok.w)) return;
    if (tok.w === 'komma') return;
    cand.push({ w: stem(tok.w), raw: tok.w, pos });
  });

  const mentions = [];
  const taken = new Array(cand.length).fill(false);

  while (true) {
    let best = null;
    for (let i = 0; i < cand.length; i++) {
      if (taken[i]) continue;
      for (let len = 1; len <= 6 && i + len <= cand.length; len++) {
        // Fenster muss zusammenhängend sein (keine Zahlen/Einheiten mit > 2 Tokens Abstand)
        let ok = true;
        for (let k = i; k < i + len; k++) {
          if (taken[k]) { ok = false; break; }
          // Zwischen den Wörtern dürfen nur Füllwörter stehen ("Bankdrücken mit der Langhantel")
          if (k > i && hasValueTokenBetween(tokens, cand[k - 1].pos, cand[k].pos)) { ok = false; break; }
        }
        if (!ok) break;
        const W = cand.slice(i, i + len).map(c => c.w);
        const hits = [];
        for (const item of index) {
          const m = matchWindow(W, item);
          if (m) hits.push({ item, ...m });
        }
        if (!hits.length) continue;
        // Bewertung: Mehr getroffene Wörter > vollständiger Name > Ähnlichkeit
        for (const h of hits) {
          const score = len * 10 + (h.full ? 5 : 0) + h.sim;
          if (!best || score > best.score) {
            best = { score, i, len, hits };
          } else if (best.i === i && best.len === len) {
            // gleiches Fenster: hits sammeln wir unten
          }
        }
        if (best && best.i === i && best.len === len) best.hits = hits;
      }
    }
    if (!best) break;
    for (let k = best.i; k < best.i + best.len; k++) taken[k] = true;

    // Kandidaten für dieses Fenster bestimmen: vollständige Treffer schlagen Teil-Treffer
    const fulls = best.hits.filter(h => h.full);
    let pool = fulls.length ? fulls : best.hits;
    // Bei Teil-Treffern: nur die mit höchster Abdeckungsquote (weniger fehlende Wörter = spezifischer)
    if (!fulls.length) {
      const ratio = h => h.covered / h.item.toks.length;
      const maxRatio = Math.max(...pool.map(ratio));
      pool = pool.filter(h => ratio(h) === maxRatio);
    }
    const maxSim = Math.max(...pool.map(h => h.sim));
    pool = pool.filter(h => h.sim >= maxSim - 0.05);

    // Gleiche Wortgruppe = Duplikat in der DB -> meistgenutzte gewinnt
    // (gleiche Wörter in anderer Reihenfolge oder nur anders zusammengeschrieben)
    const groups = [];
    for (const h of pool) {
      const idx = groups.findIndex(g => g.item.group === h.item.group || g.item.concat === h.item.concat);
      if (idx === -1) groups.push(h);
      else {
        const g = groups[idx];
        if (h.item.usage > g.item.usage || (h.item.usage === g.item.usage && h.sim > g.sim)) groups[idx] = h;
      }
    }
    const options = groups.sort((a, b) => b.item.usage - a.item.usage || b.sim - a.sim);

    mentions.push({
      start: cand[best.i].pos,
      end: cand[best.i + best.len - 1].pos,
      spoken: cand.slice(best.i, best.i + best.len).map(c => c.raw).join(' '),
      options: options.map(o => o.item.ex),
      full: fulls.length > 0
    });
  }

  mentions.sort((a, b) => a.start - b.start);
  return { mentions, leftoverWords: cand.filter((c, i) => !taken[i]) };
}

// Schlägt die ähnlichsten Übungen für einen unbekannten Begriff vor (für die UI-Auswahl)
function suggest(spoken, index, limit = 5) {
  const s = nameTokens(spoken).join('');
  if (!s) return [];
  return index
    .map(item => ({ ex: item.ex, sim: Math.max(similarity(s, item.concat), ...item.toks.map(t => similarity(s, t)) ) }))
    .filter(x => x.sim >= 0.45)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
    .map(x => x.ex);
}

// ---------------------------------------------------------------------------
// Werte-Extraktion
// ---------------------------------------------------------------------------

function extractValues(tokens) {
  const out = { sets: null, reps: null, weight: null, duration: null, rest: null, feeling: null, leftovers: [] };
  const used = new Array(tokens.length).fill(false);
  const isNum = i => tokens[i] && tokens[i].t === 'num' && !used[i];
  const word = i => (tokens[i] && tokens[i].t === 'word' ? tokens[i].w : null);
  const inSet = (i, set) => word(i) !== null && set.has(word(i));

  const timeAt = (i) => {
    // Liest "1 minute 30 (sekunden)" / "90 sekunden" / "1:30" / "eineinhalb stunden" ab Position i
    if (tokens[i] && tokens[i].t === 'dur' && !used[i]) return { secs: tokens[i].v, next: i + 1 };
    if (!isNum(i)) return null;
    const v = tokens[i].v;
    if (inSet(i + 1, UNIT.hours)) {
      let secs = v * 3600;
      let next = i + 2;
      if (isNum(next) && inSet(next + 1, UNIT.minutes)) { secs += tokens[next].v * 60; next += 2; }
      return { secs, next };
    }
    if (inSet(i + 1, UNIT.minutes)) {
      let secs = v * 60;
      let next = i + 2;
      if (word(next) === 'und') next++;
      if (isNum(next) && (inSet(next + 1, UNIT.seconds) || (tokens[next].v < 60 && !inSet(next + 1, ALL_UNITS)))) {
        secs += tokens[next].v;
        next += inSet(next + 1, UNIT.seconds) ? 2 : 1;
      }
      return { secs, next };
    }
    if (inSet(i + 1, UNIT.seconds)) return { secs: v, next: i + 2 };
    return null;
  };
  const markUsed = (from, to) => { for (let k = from; k < to; k++) used[k] = true; };

  // 1) Pause: "Pause 90 Sekunden" / "90 Sekunden Pause" / "Pause 2 Minuten"
  for (let i = 0; i < tokens.length; i++) {
    if (!inSet(i, REST_WORDS)) continue;
    let j = i + 1;
    if (word(j) === 'von' || word(j) === 'war' || word(j) === 'jeweils' || word(j) === 'je') j++;
    let t = timeAt(j);
    if (t) { out.rest = Math.round(t.secs); markUsed(i, t.next); continue; }
    if (isNum(j)) { out.rest = Math.round(tokens[j].v); markUsed(i, j + 1); continue; }
    // rückwärts: "90 Sekunden Pause"
    for (let k = Math.max(0, i - 3); k < i; k++) {
      t = timeAt(k);
      if (t && t.next === i) { out.rest = Math.round(t.secs); markUsed(k, i + 1); break; }
    }
  }

  // 2) Gefühl: "Gefühl 7" / "Gefühl war 8 von 10"
  for (let i = 0; i < tokens.length; i++) {
    if (!inSet(i, FEELING_WORDS)) continue;
    for (let j = i + 1; j <= i + 3 && j < tokens.length; j++) {
      if (isNum(j)) {
        out.feeling = tokens[j].v;
        let end = j + 1;
        if (word(end) === 'von' && isNum(end + 1)) end += 2;
        markUsed(i, end);
        break;
      }
    }
  }

  // 3) "3 x 10" / "3 mal 10" / "drei mal zehn"
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (isNum(i) && inSet(i + 1, UNIT.times) && isNum(i + 2)) {
      out.sets = tokens[i].v;
      const t = timeAt(i + 2);
      if (t) { out.duration = t.secs; markUsed(i, t.next); }
      else { out.reps = tokens[i + 2].v; markUsed(i, i + 3); if (inSet(i + 3, UNIT.reps)) used[i + 3] = true; }
    }
  }

  // 4) Einheiten hinter Zahlen
  for (let i = 0; i < tokens.length; i++) {
    if (!isNum(i) && !(tokens[i].t === 'dur' && !used[i])) continue;
    const t = timeAt(i);
    if (t) {
      out.duration = (out.duration || 0) + t.secs;
      markUsed(i, t.next);
      continue;
    }
    if (tokens[i].t !== 'num') continue;
    const v = tokens[i].v;
    if (inSet(i + 1, UNIT.weight)) { out.weight = v; markUsed(i, i + 2); continue; }
    if (inSet(i + 1, UNIT.sets)) { out.sets = v; markUsed(i, i + 2); continue; }
    if (inSet(i + 1, UNIT.reps) || (inSet(i + 1, UNIT.times) && !isNum(i + 2))) { out.reps = v; markUsed(i, i + 2); continue; }
  }

  // 5) Einheit vor der Zahl: "Sätze: 3", "Wiederholungen 12", "Gewicht 40"
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (!isNum(i + 1) || inSet(i + 2, ALL_UNITS)) continue;
    if (inSet(i, UNIT.sets) && out.sets === null && !used[i]) { out.sets = tokens[i + 1].v; markUsed(i, i + 2); }
    else if (inSet(i, UNIT.reps) && out.reps === null && !used[i]) { out.reps = tokens[i + 1].v; markUsed(i, i + 2); }
    else if ((word(i) === 'gewicht' || word(i) === 'zusatzgewicht') && out.weight === null) { out.weight = tokens[i + 1].v; markUsed(i, i + 2); }
  }

  // 6) "à 10" / "je 12" / "zu je 8" -> Wiederholungen; übrige nackte Zahlen merken
  for (let i = 0; i < tokens.length; i++) {
    if (!isNum(i)) continue;
    const prev = word(i - 1);
    const prev2 = word(i - 2);
    out.leftovers.push({ v: tokens[i].v, connector: REPS_CONNECTORS.has(prev) ? prev : (REPS_CONNECTORS.has(prev2) ? prev2 : null) });
    used[i] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Haupt-Funktion
// ---------------------------------------------------------------------------

function exerciseRef(ex) {
  return { id: ex.id, name: ex.name, exercise_type: ex.exercise_type || 'strength' };
}

function hasValues(v) {
  return v.sets !== null || v.reps !== null || v.weight !== null || v.duration !== null || v.leftovers.length > 0;
}

function finalizeEntry(seg, warnings) {
  const v = seg.values;
  const entry = {
    source: seg.source.trim(),
    spoken: seg.mention ? seg.mention.spoken : null,
    exercise: null,
    candidates: [],
    sets: null, reps: null, weight: null, duration_seconds: null, rest_seconds: v.rest, feeling: v.feeling,
    status: 'ok',
    error: null,
    warnings: [...warnings]
  };

  if (!seg.mention) {
    entry.status = 'unknown';
    entry.error = `Keine bekannte Übung erkannt in: "${entry.source}"`;
    entry.candidates = seg.suggestions || [];
  } else if (seg.mention.options.length === 1) {
    entry.exercise = exerciseRef(seg.mention.options[0]);
    if (!seg.mention.full) entry.warnings.push(`"${seg.mention.spoken}" als "${entry.exercise.name}" interpretiert`);
  } else {
    entry.status = 'ambiguous';
    entry.candidates = seg.mention.options.map(exerciseRef);
    entry.error = `"${seg.mention.spoken}" ist mehrdeutig: ${entry.candidates.map(c => c.name).join(', ')}`;
  }

  const isTime = entry.exercise
    ? entry.exercise.exercise_type === 'time'
    : (v.duration !== null && v.reps === null);

  const leftovers = [...v.leftovers];
  let sets = v.sets;
  let reps = v.reps;
  let weight = v.weight;
  let duration = v.duration;

  if (isTime) {
    // Zeit-Übung: nackte Zahl = Sekunden ("Plank 60")
    if (duration === null && leftovers.length) duration = leftovers.shift().v;
    if (duration === null && reps !== null) { duration = reps; reps = null; }
  } else {
    const conn = leftovers.findIndex(l => l.connector && l.connector !== 'mit');
    if (reps === null && conn !== -1) reps = leftovers.splice(conn, 1)[0].v;
    if (reps === null && leftovers.length) {
      // "mit 60" nach Übung ohne Einheit ist eher Gewicht, wenn danach noch eine Zahl kommt
      const first = leftovers[0];
      if (first.connector === 'mit' && leftovers.length > 1) { weight = weight ?? leftovers.shift().v; }
      reps = leftovers.shift().v;
    }
    if (weight === null && leftovers.length && leftovers[0].connector === 'mit') weight = leftovers.shift().v;
    if (sets === null && leftovers.length === 1 && reps !== null) sets = leftovers.shift().v;
  }
  for (const l of leftovers) entry.warnings.push(`Zahl ${l.v} konnte nicht zugeordnet werden und wurde ignoriert`);

  if (sets === null) {
    sets = 1;
    if (!isTime || duration !== null) entry.warnings.push('Keine Satzanzahl genannt – 1 Satz angenommen');
  }
  entry.sets = sets;
  entry.weight = weight ?? 0;

  if (isTime) {
    entry.duration_seconds = duration !== null ? Math.round(duration) : null;
    entry.reps = 0;
    entry.weight = 0;
    if (entry.status === 'ok' && !entry.duration_seconds) {
      entry.status = 'incomplete';
      entry.error = `Dauer für "${entry.exercise.name}" fehlt (z.B. "60 Sekunden")`;
    }
  } else {
    entry.reps = reps;
    if (duration !== null) entry.warnings.push('Zeitangabe bei Kraftübung ignoriert');
    if (entry.status === 'ok' && !entry.reps) {
      entry.status = 'incomplete';
      entry.error = `Wiederholungen für "${entry.exercise.name}" fehlen (z.B. "12 Wiederholungen")`;
    }
  }

  // Plausibilitätsgrenzen
  const bad = [];
  if (!Number.isInteger(entry.sets) || entry.sets < 1 || entry.sets > 50) bad.push(`Sätze=${entry.sets}`);
  if (entry.reps !== null && (!Number.isInteger(entry.reps) || entry.reps < 0 || entry.reps > 1000)) bad.push(`Wiederholungen=${entry.reps}`);
  if (entry.weight < 0 || entry.weight > 500) bad.push(`Gewicht=${entry.weight}`);
  if (entry.duration_seconds !== null && (entry.duration_seconds < 1 || entry.duration_seconds > 6 * 3600)) bad.push(`Dauer=${entry.duration_seconds}s`);
  if (entry.feeling !== null && (entry.feeling < 1 || entry.feeling > 10)) { entry.warnings.push(`Gefühl ${entry.feeling} außerhalb 1–10 ignoriert`); entry.feeling = null; }
  if (bad.length && entry.status === 'ok') {
    entry.status = 'incomplete';
    entry.error = `Unplausible Werte: ${bad.join(', ')}`;
  }
  return entry;
}

/**
 * @param {string} text  Transkript
 * @param {Array<{id,name,exercise_type}>} exercises  Übungen des Users (nur diese sind erlaubt)
 * @param {{usage?: Object<number, number>}} opts  usage = Anzahl Workouts pro Übungs-ID (Tie-Break bei Duplikaten)
 */
function parseWorkoutText(text, exercises, opts = {}) {
  const index = buildIndex(exercises || [], opts.usage || {});
  const normalized = preprocess(text || '');
  const clauses = normalized.split(CLAUSE_SPLIT).map(s => (s || '').trim()).filter(Boolean);

  const segments = [];
  for (const clause of clauses) {
    const tokens = tokenize(clause);
    if (!tokens.length) continue;
    const { mentions, leftoverWords } = findMentions(tokens, index);

    if (!mentions.length) {
      const values = extractValues(tokens);
      // Nur Zahlen ohne Übung ("Einen Satz.") -> gehört zur vorherigen Übung
      const meaningful = leftoverWords.filter(w => w.raw.length > 2);
      if (!meaningful.length && segments.length) {
        segments[segments.length - 1].extraTokens.push(...tokens);
        segments[segments.length - 1].source += ' ' + clause;
        continue;
      }
      if (!meaningful.length && !hasValues(values)) continue;
      segments.push({
        mention: null,
        tokens,
        extraTokens: [],
        source: clause,
        suggestions: suggest(meaningful.map(w => w.raw).join(' '), index).map(exerciseRef)
      });
      continue;
    }

    // Mehrere Übungen in einem Abschnitt: Zahlen vor der ersten Übung -> "Zahl-zuerst"-Stil
    const numberFirst = tokens.slice(0, mentions[0].start).some(t => t.t === 'num' || t.t === 'dur');
    for (let m = 0; m < mentions.length; m++) {
      let from;
      let to;
      if (numberFirst) {
        from = m === 0 ? 0 : mentions[m - 1].end + 1;
        to = m === mentions.length - 1 ? tokens.length : mentions[m].end + 1;
      } else {
        from = m === 0 ? 0 : mentions[m].start;
        to = m === mentions.length - 1 ? tokens.length : mentions[m + 1].start;
      }
      const segTokens = tokens.slice(from, to);
      segments.push({ mention: mentions[m], tokens: segTokens, extraTokens: [], source: clause });
    }
  }

  // Werte extrahieren; Abschnitte ohne eigene Zahlen erben vom nächsten
  // ("Liegestütz und Kniebeugen je 3 Sätze à 20")
  for (const seg of segments) seg.values = extractValues(seg.tokens.concat(seg.extraTokens));
  for (let i = segments.length - 2; i >= 0; i--) {
    const s = segments[i];
    const n = segments[i + 1];
    if (s.mention && n.mention && s.source === n.source && !hasValues(s.values) && hasValues(n.values)) {
      s.values = { ...n.values, leftovers: [...n.values.leftovers] };
    }
  }

  const entries = segments.map(seg => finalizeEntry(seg, []));
  const okCount = entries.filter(e => e.status === 'ok').length;
  return {
    text: text || '',
    entries,
    ok: entries.length > 0 && okCount === entries.length,
    error: entries.length === 0 ? 'Keine Übung im Text erkannt' : null
  };
}

// Whisper-"initial prompt": Übungsnamen als Vokabular-Hinweis verbessert die
// Erkennung von Fachbegriffen ("Face Pulls", "Uchi-Komi") deutlich.
function buildWhisperPrompt(exercises, maxChars = 700) {
  let prompt = 'Training: 3 Sätze, 12 Wiederholungen, 60 Kilo, 90 Sekunden. Übungen: ';
  const names = [...new Set((exercises || []).map(e => String(e.name).replace(/\([^)]*\)/g, '').trim()))];
  for (const n of names) {
    if (prompt.length + n.length + 2 > maxChars) break;
    prompt += n + ', ';
  }
  return prompt.replace(/, $/, '.');
}

module.exports = {
  parseWorkoutText,
  buildWhisperPrompt,
  // für Tests / LLM-Validierung
  _internal: { fold, stem, tokenize, parseNumberWord, buildIndex, findMentions, extractValues, similarity, suggest, nameTokens }
};
