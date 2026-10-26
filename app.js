/* Read Aloud — the browser's speechSynthesis with the device's own voices. */
(function () {
  "use strict";
  var $ = S3.$;
  var synth = window.speechSynthesis;
  var input = $("#input"), reader = $("#reader"), playBtn = $("#play"), stopBtn = $("#stop"), status = $("#status");
  var langSel = $("#lang"), voiceSel = $("#voice"), online = $("#online"), bar = $("#bar");

  // ---------- pure helpers (self-tested) ----------
  var TERM = /[.!?؟…\n]/;
  // Split text into pieces of at most `max` chars at sentence ends (or spaces), keeping each piece's offset.
  function chunks(text, max) {
    var out = [], re = /[^.!?؟…\n]+[.!?؟…]*["'”’)\]»]*\s*|\n+/g, m, cur = null;
    function push(start, t) { if (/\S/.test(t)) out.push({ start: start, text: t }); }
    while ((m = re.exec(text))) {
      var piece = m[0], at = m.index;
      if (cur && cur.text.length + piece.length <= max && piece[0] !== "\n") { cur.text += piece; continue; }
      if (cur) push(cur.start, cur.text);
      cur = null;
      while (piece.length > max) { // one very long sentence: cut at the last space before the limit
        var cut = piece.lastIndexOf(" ", max);
        if (cut < max / 2) cut = max;
        push(at, piece.slice(0, cut)); piece = piece.slice(cut); at += cut;
      }
      cur = { start: at, text: piece };
    }
    if (cur) push(cur.start, cur.text);
    return out;
  }
  function sentenceAt(text, i) {
    var s = i; while (s > 0 && !TERM.test(text[s - 1])) s--;
    while (s < text.length && /\s/.test(text[s])) s++;
    var e = i; while (e < text.length && !TERM.test(text[e])) e++;
    while (e < text.length && /[.!?؟…"'”’)\]»]/.test(text[e])) e++;
    return [s, Math.max(s, e)];
  }
  function wordAt(text, i, len) {
    if (len > 0) return [i, i + len];
    var m = /[\p{L}\p{N}\p{M}'’\-]+/uy; m.lastIndex = i;
    var r = m.exec(text);
    return [i, i + (r ? r[0].length : 0)];
  }
  function detectLang(text) {
    var ar = (text.match(/[؀-ۿ]/g) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
    return ar > latin ? "ar" : null;
  }
  function primary(lang) { return String(lang || "").replace("_", "-").toLowerCase().split("-")[0]; }
  function filterVoices(voices, lang, withOnline) {
    return voices.filter(function (v) { return (withOnline || v.localService) && (!lang || primary(v.lang) === lang); });
  }

  // ---------- settings ----------
  var saved = S3.store("ra.settings") || {};
  var set = { lang: saved.lang || "auto", voice: saved.voice || "", rate: saved.rate || 1, pitch: saved.pitch != null ? saved.pitch : 1, volume: saved.volume != null ? saved.volume : 1, online: !!saved.online };
  function persist() { S3.store("ra.settings", set); }
  [["rate", function (v) { return (+v).toFixed(1) + "×"; }], ["pitch", function (v) { return (+v).toFixed(1); }], ["volume", function (v) { return Math.round(v * 100) + "%"; }]].forEach(function (p) {
    var el = $("#" + p[0]), lbl = $("#" + p[0] + "V");
    el.value = set[p[0]]; lbl.textContent = p[1](el.value);
    el.addEventListener("input", function () { set[p[0]] = +el.value; lbl.textContent = p[1](el.value); persist(); });
    el.addEventListener("change", function () { if (state === "playing") startAt(pos); });
  });
  online.checked = set.online;

  // ---------- voices ----------
  var voices = [];
  var names = typeof Intl !== "undefined" && Intl.DisplayNames ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
  function langName(code) { try { return names ? names.of(code) : code; } catch (e) { return code; } }
  function effectiveLang() { return set.lang === "auto" ? detectLang(input.value) || primary(navigator.language) || "en" : set.lang; }
  function fillVoices() {
    voices = synth ? synth.getVoices() : [];
    var pool = filterVoices(voices, null, set.online), langs = {};
    pool.forEach(function (v) { var p = primary(v.lang); langs[p] = (langs[p] || 0) + 1; });
    langSel.innerHTML = "";
    langSel.appendChild(S3.h("option", { value: "auto", text: "Auto (match the text)" }));
    Object.keys(langs).sort(function (a, b) { return langName(a).localeCompare(langName(b)); }).forEach(function (l) {
      langSel.appendChild(S3.h("option", { value: l, text: langName(l) + " (" + langs[l] + ")" }));
    });
    if (set.lang !== "auto" && !langs[set.lang]) set.lang = "auto";
    langSel.value = set.lang;
    fillVoiceList();
  }
  function fillVoiceList() {
    var lang = effectiveLang(), list = filterVoices(voices, lang, set.online);
    voiceSel.innerHTML = "";
    list.forEach(function (v) {
      voiceSel.appendChild(S3.h("option", { value: v.voiceURI, text: v.name + " · " + v.lang + (v.localService ? "" : " · online") }));
    });
    var pick = list.filter(function (v) { return v.voiceURI === set.voice; })[0] || list.filter(function (v) { return v.default; })[0] || list[0];
    if (pick) voiceSel.value = pick.voiceURI;
    voiceSel.disabled = !list.length;
    var note = $("#voiceNote");
    if (!synth) note.textContent = "This browser has no speech support. Try a recent Chrome, Edge, Safari or Firefox.";
    else if (!voices.length) note.textContent = "No voices found yet. Your browser may still be loading them, or your system has none installed.";
    else if (!list.length) note.textContent = "No " + (set.online ? "" : "offline ") + langName(lang) + " voice on this device. Install one in your system's speech or language settings" + (set.online ? "" : ", or include online voices") + ".";
    else note.textContent = list.length + " voice" + (list.length === 1 ? "" : "s") + " for " + langName(lang) + ". Voices are provided by your device and browser.";
  }
  function currentVoice() { return voices.filter(function (v) { return v.voiceURI === voiceSel.value; })[0] || null; }
  if (synth) {
    fillVoices();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", fillVoices); else synth.onvoiceschanged = fillVoices;
  } else { fillVoices(); playBtn.disabled = true; }
  langSel.addEventListener("change", function () { set.lang = langSel.value; persist(); fillVoiceList(); });
  voiceSel.addEventListener("change", function () { set.voice = voiceSel.value; persist(); if (state === "playing") startAt(pos); });
  online.addEventListener("change", function () { set.online = online.checked; persist(); fillVoices(); });
  input.addEventListener("input", S3.debounce(function () { if (set.lang === "auto") fillVoiceList(); }, 300));

  // ---------- reader view ----------
  var text = "", pos = 0, state = "idle", run = 0, queue = [], qi = 0;
  function paint(ws, we) {
    var se = sentenceAt(text, ws);
    reader.textContent = "";
    reader.appendChild(document.createTextNode(text.slice(0, se[0])));
    var sent = S3.h("span", { "class": "sent" }, [text.slice(se[0], ws), S3.h("mark", { text: text.slice(ws, we) }), text.slice(we, Math.max(we, se[1]))]);
    reader.appendChild(sent);
    reader.appendChild(document.createTextNode(text.slice(Math.max(we, se[1]))));
    var mr = sent.querySelector("mark").getBoundingClientRect(), rr = reader.getBoundingClientRect();
    if (mr.top < rr.top || mr.bottom > rr.bottom) reader.scrollTop += mr.top - rr.top - reader.clientHeight / 3;
    bar.style.width = (text.length ? Math.min(100, ws / text.length * 100) : 0).toFixed(1) + "%";
  }
  function setState(s) {
    state = s;
    var reading = s !== "idle";
    input.hidden = reading; reader.hidden = !reading; stopBtn.disabled = !reading;
    playBtn.querySelector("span").textContent = s === "playing" ? "Pause" : s === "paused" ? "Resume" : "Play";
    playBtn.querySelector("use").setAttribute("href", s === "playing" ? "#i-pause" : "#i-play");
    status.textContent = { idle: "Ready", playing: "Reading…", paused: "Paused" }[s];
    status.className = "chip" + (s === "playing" ? " accent" : "");
    $("#hint").textContent = reading ? "Click a word to jump there. Stop to edit the text." : "Reading starts at the cursor, or from the top.";
  }
  function speakNext(token) {
    if (token !== run) return;
    if (qi >= queue.length) { stop(true); return; }
    var c = queue[qi++], u = new SpeechSynthesisUtterance(c.text), v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = effectiveLang();
    u.rate = set.rate; u.pitch = set.pitch; u.volume = set.volume;
    u.onstart = function () { if (token === run) { pos = c.start; var w = wordAt(text, c.start + (c.text.length - c.text.replace(/^\s+/, "").length), 0); paint(w[0], w[1]); } };
    u.onboundary = function (e) {
      if (token !== run || (e.name && e.name !== "word")) return;
      var w = wordAt(text, c.start + e.charIndex, e.charLength || 0);
      pos = w[0]; paint(w[0], w[1]);
    };
    u.onend = function () { speakNext(token); };
    u.onerror = function (e) {
      if (token !== run || e.error === "interrupted" || e.error === "canceled") return;
      S3.toast("Speech failed: " + (e.error || "unknown error"), "error"); stop();
    };
    synth.speak(u);
  }
  function startAt(from) {
    text = input.value;
    if (!text.trim()) { S3.toast("Type or paste some text first", "error"); return; }
    if (from >= text.length || !/\S/.test(text.slice(from))) from = 0;
    from = wordStart(from);
    run++; synth.cancel();
    queue = chunks(text.slice(from), 220).map(function (c) { return { start: c.start + from, text: c.text }; });
    qi = 0; pos = from;
    setState("playing"); paint(from, from);
    var token = run;
    setTimeout(function () { speakNext(token); }, 60); // Chrome drops a speak() issued in the same tick as cancel()
  }
  function wordStart(i) { while (i > 0 && /[\p{L}\p{N}\p{M}]/u.test(text[i - 1])) i--; return i; }
  function stop(finished) {
    run++; if (synth) synth.cancel();
    setState("idle"); bar.style.width = finished ? "100%" : "0%";
    if (finished) { S3.done(); setTimeout(function () { if (state === "idle") bar.style.width = "0%"; }, 1200); }
  }

  playBtn.addEventListener("click", function () {
    if (!synth) return;
    if (state === "playing") { synth.pause(); setState("paused"); return; }
    if (state === "paused") { synth.resume(); setState("playing"); return; }
    startAt(input.selectionStart < input.value.length ? input.selectionStart : 0);
  });
  stopBtn.addEventListener("click", function () { stop(); input.focus(); });
  reader.addEventListener("click", function () {
    var sel = window.getSelection(); if (!sel || !sel.anchorNode || !reader.contains(sel.anchorNode)) return;
    // Turn the click position into an offset in the full text.
    var r = document.createRange(); r.setStart(reader, 0); r.setEnd(sel.anchorNode, sel.anchorOffset);
    startAt(r.toString().length);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state !== "idle") stop(); });
  window.addEventListener("beforeunload", function () { if (synth) synth.cancel(); });

  $("#clear").addEventListener("click", function () { stop(); input.value = ""; fillVoiceList(); input.focus(); });
  var SAMPLE = "Reading aloud helps you catch mistakes your eyes skip over. Paste an email, an article or your own draft, press Play, and follow the highlighted words.\n\n" +
    "You can change the speed and the voice at any time. Voices come from your device, so a phone, a laptop and a different browser may each sound a little different.";
  $("#sample").addEventListener("click", function () { stop(); input.value = SAMPLE; fillVoiceList(); });

  setState("idle");

  window.S3_DEMO = function () {
    input.value = SAMPLE; text = SAMPLE; setState("playing");
    var i = SAMPLE.indexOf("highlighted"); paint(i, i + "highlighted".length);
    status.textContent = "Reading…"; synth && synth.cancel();
  };

  window.S3_SELFTEST = function () {
    var t = "First sentence here. Second one is a bit longer! Third? ok\n\nNew para.";
    var c = chunks(t, 25), joined = c.map(function (x) { return x.text; }).join("");
    var cover = c.every(function (x) { return t.substr(x.start, x.text.length) === x.text && x.text.length <= 25; }) && joined.replace(/\s/g, "") === t.replace(/\s/g, "");
    var long = chunks("word ".repeat(100), 50);
    var longOk = long.length >= 10 && long.every(function (x) { return x.text.length <= 50; });
    var s = sentenceAt(t, t.indexOf("bit")), sOk = t.slice(s[0], s[1]) === "Second one is a bit longer!";
    var w = wordAt(t, t.indexOf("longer"), 0), wOk = t.slice(w[0], w[1]) === "longer" && wordAt(t, 0, 5)[1] === 5;
    var ar = "مرحبا بكم. كيف حالكم؟ بخير";
    var sa = sentenceAt(ar, ar.indexOf("حالكم")), arOk = ar.slice(sa[0], sa[1]) === "كيف حالكم؟" && detectLang(ar) === "ar" && detectLang("hello") === null;
    var fake = [{ lang: "ar-SA", localService: true }, { lang: "en_US", localService: true }, { lang: "en-GB", localService: false }];
    var vOk = filterVoices(fake, "en", false).length === 1 && filterVoices(fake, "en", true).length === 2 && filterVoices(fake, "ar", false).length === 1 && filterVoices(fake, null, false).length === 2;
    return cover && longOk && sOk && wOk && arOk && vOk;
  };
})();
