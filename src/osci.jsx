import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Oscilloscopio Didattico – 2 pagine sincronizzate (Docente / Studenti)
 * - Apri due tab/finestre del browser:
 *   • #/docente  → pannello docente
 *   • #/studenti → interfaccia studenti
 * - La sincronizzazione avviene via BroadcastChannel + localStorage.
 * - Nessun backend necessario.
 *
 * Suggerimento: il docente imposta i canali e preme "Pubblica impostazioni".
 * Gli studenti vedono in tempo reale le forme d'onda e possono regolare scala/offset,
 * inserire i valori letti (Vmax, Vmin, Vpp, Periodo, Frequenza) per CH1/CH2/CH3
 * e compilare Nome, Cognome, Classe, Data.
 */

// --- Utilità di sincronizzazione (BroadcastChannel + localStorage) ---
const CHANNEL_KEY = "oscSimState:v1";
const VIEW_KEY = "oscSimView:v1"; // impostazioni UI studente

function useBroadcastState(defaultState) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(CHANNEL_KEY);
      return raw ? JSON.parse(raw) : defaultState;
    } catch (e) {
      return defaultState;
    }
  });

  // BroadcastChannel per sync in tempo reale
  const bcRef = useRef(null);
  useEffect(() => {
    const bc = new BroadcastChannel("osc-sim");
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      if (ev?.data?.type === "SET_STATE") {
        setState(ev.data.payload);
      }
    };
    return () => bc.close();
  }, []);

  const publish = (next) => {
    const nextState = typeof next === "function" ? next(state) : next;
    setState(nextState);
    try {
      localStorage.setItem(CHANNEL_KEY, JSON.stringify(nextState));
    } catch {}
    try {
      bcRef.current?.postMessage({ type: "SET_STATE", payload: nextState });
    } catch {}
  };

  return [state, publish];
}

// --- Modello di stato condiviso ---
const defaultSharedState = {
  locked: false, // quando true, blocca i controlli docente (utile per avviare la prova)
  difficulty: "base", // base | intermedio | avanzato
  showCorrect: false, // opzionale: consenti verifica per gli studenti
  timeBase: 0.001, // secondi per divisione (s/div) base consigliata
  sampleRate: 20000, // Hz per disegno
  durationDivs: 10, // numero di divisioni orizzontali visibili
  verticalDivs: 8, // numero di divisioni verticali
  channels: [
    // Tre canali minimi
    {
      id: 1,
      enabled: true,
      waveform: "sine", // sine | square | triangle | saw | rectified | am | fm | noise | sum2
      amplitude: 2, // V picco
      frequency: 1000, // Hz
      phase: 0, // rad
      dc: 0, // offset DC in V
      color: "#22c55e", // verde
      noise: 0, // std dev del rumore in V
    },
    {
      id: 2,
      enabled: false,
      waveform: "square",
      amplitude: 1,
      frequency: 500,
      phase: 0,
      dc: 0,
      color: "#3b82f6", // blu
      noise: 0,
    },
    {
      id: 3,
      enabled: false,
      waveform: "triangle",
      amplitude: 1.5,
      frequency: 200,
      phase: 0,
      dc: 0,
      color: "#ef4444", // rosso
      noise: 0,
    },
  ],
};

// --- Stato UI locale lato studente ---
function useStudentView() {
  const [view, setView] = useState(() => {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      vPerDiv: 1, // V/div
      sPerDiv: 0.001, // s/div
      vOffset: 0, // shift verticale in V
      tOffset: 0, // shift orizzontale in secondi
      name: "",
      surname: "",
      class: "",
      date: "",
      // misure inserite a mano per ogni canale
      measures: {
        1: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
        2: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
        3: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
      },
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {}
  }, [view]);

  return [view, setView];
}

// --- Generatore di forme d'onda ---
function waveformSample(type, t, { amplitude, frequency, phase, dc, difficulty, noise = 0 }) {
  const w = 2 * Math.PI * frequency;
  const baseSine = Math.sin(w * t + phase);
  let y = 0;

  switch (type) {
    case "sine":
      y = amplitude * baseSine;
      break;
    case "square": {
      const s = Math.sin(w * t + phase);
      y = amplitude * (s >= 0 ? 1 : -1);
      break;
    }
    case "triangle": {
      // onda triangolare normalizzata
      const frac = ((t * frequency + phase / (2 * Math.PI)) % 1 + 1) % 1;
      y = amplitude * (4 * Math.abs(frac - 0.5) - 1);
      break;
    }
    case "saw": {
      const frac = ((t * frequency + phase / (2 * Math.PI)) % 1 + 1) % 1;
      y = amplitude * (2 * frac - 1);
      break;
    }
    case "rectified": {
      // semionda raddrizzata (non armonica)
      y = amplitude * Math.max(0, baseSine);
      break;
    }
    case "am": {
      // modulazione di ampiezza: portante freq, modulante freq/10
      const m = 0.5 * (1 + Math.sin(2 * Math.PI * (frequency / 10) * t));
      y = (amplitude * m) * Math.sin(w * t + phase);
      break;
    }
    case "fm": {
      // modulazione di frequenza: dev = 0.2 f
      const dev = 0.2 * frequency;
      const instPhase = 2 * Math.PI * (frequency * t + (dev / (2 * Math.PI)) * (1 - Math.cos(2 * Math.PI * (frequency / 8) * t))) + phase;
      y = amplitude * Math.sin(instPhase);
      break;
    }
    case "noise": {
      y = amplitude * (Math.random() * 2 - 1);
      break;
    }
    case "sum2": {
      // somma di due sinusoidi per difficoltà
      y = 0.6 * amplitude * Math.sin(w * t + phase) + 0.6 * amplitude * Math.sin(2 * w * t + phase / 3);
      break;
    }
    default:
      y = amplitude * baseSine;
  }

  // Aggiungi offset DC
  y += dc;

  // Rumore in base alla difficoltà
  let noiseStd = noise;
  if (difficulty === "intermedio") noiseStd += 0.02 * amplitude;
  if (difficulty === "avanzato") noiseStd += 0.05 * amplitude;
  if (noiseStd > 0) y += randn() * noiseStd;

  return y;
}

function randn() {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// --- Canvas Oscilloscopio ---
function ScopeCanvas({ shared, view, canvasId = "scope-canvas" }) {
  const canvasRef = useRef(null);

  // Parametri derivati
  const width = 980;
  const height = 520;
  const divX = shared.durationDivs;
  const divY = shared.verticalDivs;
  const sDiv = view.sPerDiv; // s/div scelto dagli studenti
  const vDiv = view.vPerDiv; // V/div scelto dagli studenti
  const totalTime = sDiv * divX;

  // Disegno
  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    // Sfondo
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, width, height);

    // Griglia
    ctx.strokeStyle = "#1f2a44";
    ctx.lineWidth = 1;

    const dx = width / divX;
    const dy = height / divY;
    for (let i = 0; i <= divX; i++) {
      ctx.beginPath();
      ctx.moveTo(i * dx, 0);
      ctx.lineTo(i * dx, height);
      ctx.stroke();
    }
    for (let j = 0; j <= divY; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * dy);
      ctx.lineTo(width, j * dy);
      ctx.stroke();
    }

    // Assi centrali
    ctx.strokeStyle = "#334155";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2 - (view.vOffset / vDiv) * dy);
    ctx.lineTo(width, height / 2 - (view.vOffset / vDiv) * dy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Disegno dei canali
    shared.channels.forEach((ch) => {
      if (!ch.enabled) return;
      ctx.lineWidth = 2;
      ctx.strokeStyle = ch.color;
      ctx.beginPath();
      const N = Math.max(1000, Math.floor(shared.sampleRate * totalTime));
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * totalTime + view.tOffset; // tempo assoluto
        const yV = waveformSample(ch.waveform, t, {
          amplitude: ch.amplitude,
          frequency: ch.frequency,
          phase: ch.phase,
          dc: ch.dc,
          difficulty: shared.difficulty,
          noise: ch.noise,
        });
        const x = (i / (N - 1)) * width;
        const y = height / 2 - ((yV - view.vOffset) / vDiv) * dy;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }, [shared, view]);

  return (
    <div className="w-full flex flex-col items-center">
      <canvas
        id={canvasId}
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded-2xl shadow-xl border border-slate-700"
      />
      <div className="mt-2 text-xs text-slate-300">
        {vDiv} V/div • {sDiv} s/div • Offset V: {view.vOffset} V • Offset t: {view.tOffset} s
      </div>
    </div>
  );
}

// --- Controlli Docente per ogni canale ---
function ChannelControls({ ch, onChange }) {
  const set = (k, v) => onChange({ ...ch, [k]: v });
  return (
    <div className="p-3 rounded-2xl border border-slate-700 bg-slate-900/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">CH{ch.id}</div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ch.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          Attivo
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <label className="block text-slate-300 mb-1">Forma d'onda</label>
          <select
            className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2"
            value={ch.waveform}
            onChange={(e) => set("waveform", e.target.value)}
          >
            <option value="sine">Armonica: Seno</option>
            <option value="sum2">Armonica: Somma di sinusoidi</option>
            <option value="square">Non armonica: Quadra</option>
            <option value="triangle">Non armonica: Triangolare</option>
            <option value="saw">Non armonica: Dente di sega</option>
            <option value="rectified">Non armonica: Seno raddrizzato</option>
            <option value="am">Non armonica: AM</option>
            <option value="fm">Non armonica: FM</option>
            <option value="noise">Rumore</option>
          </select>
        </div>
        <NumberField label="Ampiezza (V picco)" value={ch.amplitude} step={0.1} min={0} onChange={(v)=>set("amplitude", v)} />
        <NumberField label="Frequenza (Hz)" value={ch.frequency} step={1} min={0} onChange={(v)=>set("frequency", v)} />
        <NumberField label="Fase (rad)" value={ch.phase} step={0.1} onChange={(v)=>set("phase", v)} />
        <NumberField label="Offset DC (V)" value={ch.dc} step={0.1} onChange={(v)=>set("dc", v)} />
        <NumberField label="Rumore (V rms)" value={ch.noise} step={0.01} min={0} onChange={(v)=>set("noise", v)} />
        <div className="col-span-2">
          <label className="block text-slate-300 mb-1">Colore traccia</label>
          <input type="color" value={ch.color} onChange={(e)=>set("color", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, step=1, min }) {
  return (
    <label className="flex flex-col gap-1 text-slate-300">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="bg-slate-800 border border-slate-700 rounded-xl p-2"
      />
    </label>
  );
}

// --- Pagina Docente ---
function TeacherPage({ shared, setShared }) {
  const setChannel = (idx, next) => {
    const channels = [...shared.channels];
    channels[idx] = next;
    setShared({ ...shared, channels });
  };

  const publishNow = () => setShared((s) => ({ ...s }));

  const randomize = (level) => {
    const baseFreqs = [50, 100, 200, 500, 1000, 2000, 5000];
    const forms = ["sine", "square", "triangle", "saw", "rectified", "am", "fm", "sum2"];
    const channels = shared.channels.map((ch) => ({
      ...ch,
      enabled: Math.random() > 0.2,
      waveform: forms[Math.floor(Math.random() * forms.length)],
      amplitude: +(0.5 + Math.random() * 4).toFixed(2),
      frequency: baseFreqs[Math.floor(Math.random() * baseFreqs.length)],
      phase: +(Math.random() * Math.PI).toFixed(2),
      dc: +((-1 + Math.random() * 2)).toFixed(2),
      noise: level === "avanzato" ? +(Math.random() * 0.2).toFixed(2) : level === "intermedio" ? +(Math.random() * 0.1).toFixed(2) : +(Math.random() * 0.03).toFixed(2),
    }));
    setShared({ ...shared, difficulty: level, channels });
  };

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold mb-2">Pannello Docente</h1>
      <p className="text-slate-300 mb-4">Imposta i canali, scegli la difficoltà e pubblica la simulazione. Apri la pagina Studenti su un altro schermo/browser (URL con #/studenti).</p>

      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <label className="flex items-center gap-2">
          <span>Difficoltà:</span>
          <select
            className="bg-slate-800 border border-slate-700 rounded-xl p-2"
            value={shared.difficulty}
            onChange={(e) => setShared({ ...shared, difficulty: e.target.value })}
          >
            <option value="base">Base</option>
            <option value="intermedio">Intermedio</option>
            <option value="avanzato">Avanzato</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span>Mostra tasto verifica agli studenti</span>
          <input
            type="checkbox"
            checked={shared.showCorrect}
            onChange={(e) => setShared({ ...shared, showCorrect: e.target.checked })}
          />
        </label>
        <label className="flex items-center gap-2">
          <span>Blocca controlli docente</span>
          <input
            type="checkbox"
            checked={shared.locked}
            onChange={(e) => setShared({ ...shared, locked: e.target.checked })}
          />
        </label>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {shared.channels.map((ch, i) => (
          <ChannelControls key={ch.id} ch={ch} onChange={(next) => setChannel(i, next)} />
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-6">
        <button
          onClick={() => randomize(shared.difficulty)}
          className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700"
        >Casuale (mantieni difficoltà)</button>
        <button
          onClick={() => randomize("base")}
          className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600"
        >Casuale Base</button>
        <button
          onClick={() => randomize("intermedio")}
          className="px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-600"
        >Casuale Intermedio</button>
        <button
          onClick={() => randomize("avanzato")}
          className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-600"
        >Casuale Avanzato</button>
        <button
          onClick={publishNow}
          className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600"
        >Pubblica impostazioni</button>
      </div>

      <div className="mb-6">
        <ScopeCanvas canvasId="teacher-scope" shared={shared} view={{ vPerDiv: 1, sPerDiv: shared.timeBase, vOffset: 0, tOffset: 0 }} />
      </div>

      <p className="text-sm text-slate-400">Suggerimento: condividi il link di questa pagina con {window.location.origin + window.location.pathname + "#/studenti"} per gli studenti.</p>
    </div>
  );
}

// --- Pagina Studenti ---
function StudentPage({ shared }) {
  const [view, setView] = useStudentView();

  const set = (k, v) => setView((s) => ({ ...s, [k]: v }));
  const setMeasure = (chId, k, v) => setView((s) => ({
    ...s,
    measures: { ...s.measures, [chId]: { ...s.measures[chId], [k]: v } },
  }));

  // Verifica opzionale rispetto ai valori teorici
  const [checkResult, setCheckResult] = useState(null);

  const correctValues = useMemo(() => computeCorrect(shared), [shared]);

  const doCheck = () => {
    const tolV = 0.05; // 5%
    const tolF = 0.02; // 2%
    const res = { ok: true, perChannel: {} };
    for (const ch of shared.channels) {
      if (!ch.enabled) continue;
      const user = view.measures[ch.id];
      const corr = correctValues[ch.id];
      const comp = {};
      const fields = [
        ["vmax", tolV],
        ["vmin", tolV],
        ["vpp", tolV],
        ["period", tolF],
        ["freq", tolF],
      ];
      let ok = true;
      for (const [k, tol] of fields) {
        const u = parseFloat(user[k]);
        const c = corr[k];
        if (!isFinite(u) || !isFinite(c)) { ok = false; comp[k] = false; continue; }
        const rel = Math.abs(u - c) / (Math.abs(c) + 1e-9);
        const pass = rel <= tol;
        comp[k] = pass;
        if (!pass) ok = false;
      }
      res.perChannel[ch.id] = { ok, comp };
      if (!ok) res.ok = false;
    }
    setCheckResult(res);
  };

  const printPage = () => window.print();
  const downloadCanvasPNG = () => {
    const canvas = document.getElementById("student-scope");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "oscilloscopio_display.png";
    a.click();
  };

  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold mb-2">Pagina Studenti</h1>
      <div className="flex gap-2 justify-end mb-3">
        <button onClick={printPage} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm">Stampa / Salva PDF</button>
        <button onClick={downloadCanvasPNG} className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm">Scarica display (PNG)</button>
      </div>
      <p className="text-slate-300 mb-4">Regola le scale (V/div e s/div), imposta gli offset e leggi i valori sullo schermo. Inserisci poi le misure per CH1, CH2 e CH3, il tuo nome, classe e data.</p>

      {/* Riga principale: Oscilloscopio a sinistra, pannelli a destra */}
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* Oscilloscopio */}
        <div className="lg:col-span-2">
          <ScopeCanvas canvasId="student-scope" shared={shared} view={view} />
        </div>

        {/* Pannelli a destra: Controlli scala + Dati Studente */}
        <div className="space-y-4">
          <div className="p-4 rounded-2xl border border-slate-700 bg-slate-900/40 space-y-3">
            <h3 className="font-semibold">Controlli scala</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="V/div" value={view.vPerDiv} step={0.1} min={0.1} onChange={(v)=>set("vPerDiv", v)} />
              <NumberField label="s/div" value={view.sPerDiv} step={0.0001} min={0.00001} onChange={(v)=>set("sPerDiv", v)} />
              <NumberField label="Offset V (V)" value={view.vOffset} step={0.1} onChange={(v)=>set("vOffset", v)} />
              <NumberField label="Offset t (s)" value={view.tOffset} step={0.0001} onChange={(v)=>set("tOffset", v)} />
            </div>
            <div className="text-xs text-slate-400">Suggerimento: regola s/div per far stare interi periodi sullo schermo, poi stima Delta t tra creste o zero-crossing.</div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-700 bg-slate-900/40 space-y-3">
            <h3 className="font-semibold">Dati Studente</h3>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Nome" value={view.name} onChange={(v)=>set("name", v)} />
              <TextField label="Cognome" value={view.surname} onChange={(v)=>set("surname", v)} />
              <TextField label="Classe" value={view.class} onChange={(v)=>set("class", v)} />
              <TextField label="Data" value={view.date} onChange={(v)=>set("date", v)} placeholder="YYYY-MM-DD" />
            </div>
          </div>
        </div>
      </div>

      {/* Sezione canali in basso */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        {[1,2,3].map((id) => (
          <MeasureCard key={id} chId={id} enabled={shared.channels.find(c=>c.id===id)?.enabled} values={view.measures[id]} onChange={(k,v)=>setMeasure(id,k,v)} />
        ))}
      </div>

      {shared.showCorrect && (
        <div className="mt-4 p-4 rounded-2xl border border-slate-700 bg-slate-900/40 space-y-3">
          <button onClick={doCheck} className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 w-full">Verifica con tolleranza</button>
          {checkResult && (
            <div className="text-sm">
              <div className={checkResult.ok?"text-emerald-400":"text-rose-400"}>
                {checkResult.ok?"Tutte le misure nei limiti.":"Alcune misure non rientrano nella tolleranza."}
              </div>
              <ul className="mt-2 space-y-1">
                {Object.entries(checkResult.perChannel).map(([chId, r]) => (
                  <li key={chId}>
                    <span className="font-semibold">CH{chId}:</span> {r.ok?"OK":"Rivedi"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MeasureCard({ chId, enabled, values, onChange }) {
  return (
    <div className={`p-4 rounded-2xl border ${enabled?"border-slate-700 bg-slate-900/40":"border-slate-800 bg-slate-900/20 opacity-60"}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Misure CH{chId}</h3>
        <span className={`text-xs ${enabled?"text-emerald-400":"text-slate-500"}`}>{enabled?"attivo":"spento"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <TextField label="Vmax (V)" value={values.vmax} onChange={(v)=>onChange("vmax", v)} />
        <TextField label="Vmin (V)" value={values.vmin} onChange={(v)=>onChange("vmin", v)} />
        <TextField label="Vpp (V)" value={values.vpp} onChange={(v)=>onChange("vpp", v)} />
        <TextField label="Periodo (s)" value={values.period} onChange={(v)=>onChange("period", v)} />
        <TextField label="Frequenza (Hz)" value={values.freq} onChange={(v)=>onChange("freq", v)} />
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="flex flex-col gap-1 text-slate-300 text-sm">
      <span>{label}</span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded-xl p-2"
      />
    </label>
  );
}

// --- Calcolo dei valori corretti (ideali) per confronto ---
function computeCorrect(shared) {
  const map = {};
  for (const ch of shared.channels) {
    const { amplitude, dc, frequency, waveform } = ch;
    // Stime ideali per le forme principali. NB: il rumore e forme complesse rendono il confronto solo indicativo.
    let vmax, vmin, vpp, period, freq;

    switch (waveform) {
      case "sine":
        vmax = dc + amplitude;
        vmin = dc - amplitude;
        vpp = 2 * amplitude;
        freq = frequency;
        period = freq > 0 ? 1 / freq : Infinity;
        break;
      case "square":
        vmax = dc + amplitude;
        vmin = dc - amplitude;
        vpp = 2 * amplitude;
        freq = frequency;
        period = freq > 0 ? 1 / freq : Infinity;
        break;
      case "triangle":
      case "saw":
      case "rectified":
      case "am":
      case "fm":
      case "sum2":
      case "noise":
      default:
        // fallback: usa range di ±amplitude come stima e freq base
        vmax = dc + amplitude;
        vmin = dc - amplitude;
        vpp = 2 * amplitude;
        freq = waveform === "noise" ? 0 : frequency;
        period = freq > 0 ? 1 / freq : Infinity;
        break;
    }

    map[ch.id] = { vmax, vmin, vpp, period, freq };
  }
  return map;
}

// --- Router minimale su hash ---
function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash || "#/docente");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/docente");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

// --- App principale ---
export default function App() {
  const [shared, setSharedRaw] = useBroadcastState(defaultSharedState);
  const route = useHashRoute();

  // Se locked, alcune azioni docente disabilitate visivamente (ma pubblichiamo sempre lo stato)
  const setShared = (next) => {
    if (typeof next === "function") setSharedRaw((s) => next(s));
    else setSharedRaw(next);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur px-6 py-3 flex items-center gap-3">
        <a href="#/docente" className={`px-3 py-1.5 rounded-xl ${route.includes("docente")?"bg-slate-800 text-white":"text-slate-300 hover:bg-slate-900"}`}>Docente</a>
        <a href="#/studenti" className={`px-3 py-1.5 rounded-xl ${route.includes("studenti")?"bg-slate-800 text-white":"text-slate-300 hover:bg-slate-900"}`}>Studenti</a>
        <div className="ml-auto text-slate-400 text-sm">Oscilloscopio Didattico • 3 Canali • Sincronizzato</div>
      </nav>

      {route.includes("studenti") ? (
        <StudentPage shared={shared} />
      ) : (
        <TeacherPage shared={shared} setShared={setShared} />
      )}

      <footer className="px-6 py-8 text-center text-xs text-slate-500">
        Suggerimento: apri questa app in due schede (#/docente e #/studenti) per una lezione live. Nessun dato lasciará il tuo browser.
      </footer>
    </div>
  );
}
