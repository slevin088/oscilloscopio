import React, { useEffect, useRef, useState } from "react";

/**
 * Oscilloscopio Didattico – Docente & Studenti (2 Pagine Sincronizzate)
 * File unico React (TS-friendly). Nessun backend: sync via BroadcastChannel + localStorage.
 *
 * Pagine:
 *   - #/docente
 *   - #/studenti
 */

// ==============================
// SYNC STATE (BroadcastChannel)
// ==============================
const CHANNEL_KEY = "oscSimState:v1";
const VIEW_KEY = "oscSimView:v1";

function useBroadcastState(defaultState: any) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(CHANNEL_KEY);
      return raw ? JSON.parse(raw) : defaultState;
    } catch {
      return defaultState;
    }
  });

  const bcRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const bc = new BroadcastChannel("osc-sim");
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      if (ev?.data?.type === "SET_STATE") setState(ev.data.payload);
    };
    return () => bc.close();
  }, []);

  const publish = (next: any) => {
    const nextState = typeof next === "function" ? next(state) : next;
    setState(nextState);
    try { localStorage.setItem(CHANNEL_KEY, JSON.stringify(nextState)); } catch {}
    try { bcRef.current?.postMessage({ type: "SET_STATE", payload: nextState }); } catch {}
  };

  return [state, publish] as const;
}

// ======================
// MODELLO STATO CONDIVISO
// ======================
const defaultSharedState = {
  locked: false,
  difficulty: "base" as "base" | "intermedio" | "avanzato",
  timeBase: 0.001, // s/div predefinito docente
  sampleRate: 20000,
  durationDivs: 10,
  verticalDivs: 10,
  channels: [
    { id: 1, enabled: true, waveform: "sine", amplitude: 2, frequency: 1000, phase: 0, dc: 0, color: "#22c55e", noise: 0 },
    { id: 2, enabled: false, waveform: "square", amplitude: 1, frequency: 500, phase: 0, dc: 0, color: "#3b82f6", noise: 0 },
    { id: 3, enabled: false, waveform: "triangle", amplitude: 1.5, frequency: 200, phase: 0, dc: 0, color: "#ef4444", noise: 0 },
  ],
};

// ==================
// STATO LATO STUDENTE
// ==================
function useStudentView() {
  const [view, setView] = useState(() => {
    try { const raw = localStorage.getItem(VIEW_KEY); if (raw) return JSON.parse(raw); } catch {}
    return {
      vPerDiv: 1,
      sPerDiv: 0.001,
      vOffset: 0,
      tOffset: 0,
      name: "",
      surname: "",
      class: "",
      date: "",
      measures: {
        1: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
        2: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
        3: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
      },
    };
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} }, [view]);
  return [view, setView] as const;
}

// ===============
// WAVEFORM ENGINE
// ===============
function randn() {
  let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function waveformSample(type: string, t: number, p: any) {
  const { amplitude, frequency, phase, dc, difficulty, noise = 0 } = p;
  const w = 2 * Math.PI * frequency;
  const baseSine = Math.sin(w * t + phase);
  let y = 0;
  switch (type) {
    case "sine": y = amplitude * baseSine; break;
    case "square": y = amplitude * (Math.sin(w * t + phase) >= 0 ? 1 : -1); break;
    case "triangle": { const frac = ((t * frequency + phase / (2 * Math.PI)) % 1 + 1) % 1; y = amplitude * (4 * Math.abs(frac - 0.5) - 1); break; }
    case "saw": { const frac = ((t * frequency + phase / (2 * Math.PI)) % 1 + 1) % 1; y = amplitude * (2 * frac - 1); break; }
    case "rectified": y = amplitude * Math.max(0, baseSine); break;
    case "am": { const m = 0.5 * (1 + Math.sin(2 * Math.PI * (frequency / 10) * t)); y = (amplitude * m) * Math.sin(w * t + phase); break; }
    case "fm": { const dev = 0.2 * frequency; const inst = 2 * Math.PI * (frequency * t + (dev / (2 * Math.PI)) * (1 - Math.cos(2 * Math.PI * (frequency / 8) * t))) + phase; y = amplitude * Math.sin(inst); break; }
    case "noise": y = amplitude * (Math.random() * 2 - 1); break;
    case "sum2": {
      // Somma armonica normalizzata (1° + 2° armonica) con fase coerente
      // y_raw = sin(ωt+φ) + 0.5·sin(2ωt+2φ)
      // picco teorico = 1.2990381057 (a x=π/3 quando φ=0) ⇒ normalizzo per avere ampiezza unitaria
      const raw = Math.sin(w * t + phase) + 0.5 * Math.sin(2 * w * t + 2 * phase);
      const NORM = 1.299038105676658; // 3*sqrt(3)/4 ≈ 1.2990381
      y = amplitude * (raw / NORM);
      break;
    }
    default: y = amplitude * baseSine;
  }
  let n = noise; if (difficulty === "intermedio") n += 0.02 * amplitude; if (difficulty === "avanzato") n += 0.05 * amplitude; if (n > 0) y += randn() * n;
  return y + dc;
}

// ============
// SCOPE CANVAS
// ============
function ScopeCanvas({ shared, view, canvasId = "scope-canvas" }: any) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const width = 980, height = 520;
  const divX = shared.durationDivs, divY = shared.verticalDivs;
  const sDiv = view.sPerDiv, vDiv = view.vPerDiv; const totalTime = sDiv * divX;

  useEffect(() => {
    const canvas = canvasRef.current!; const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    // sfondo
    ctx.fillStyle = "#0b1020"; ctx.fillRect(0, 0, width, height);
    // griglia principale semplice 10x10 (pixel-aligned per evitare sfasamenti visuali)
    const dx = width / divX, dy = height / divY;
    ctx.strokeStyle = "#1f2a44"; ctx.lineWidth = 1;
    for (let i = 0; i <= divX; i++) {
      const x = Math.round(i * dx) + 0.5; // pixel alignment
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let j = 0; j <= divY; j++) {
      const y = Math.round(j * dy) + 0.5; // pixel alignment
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // assi centrali più evidenti (verticale al centro, orizzontale centrata sull'offset V) (verticale al centro, orizzontale centrata sull'offset V)
    ctx.strokeStyle = "#475569"; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, height / 2 - (view.vOffset / vDiv) * dy); ctx.lineTo(width, height / 2 - (view.vOffset / vDiv) * dy); ctx.stroke();
    
    // canali
    shared.channels.forEach((ch: any) => {
      if (!ch.enabled) return;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = ch.color;
      ctx.beginPath();

      const N = Math.max(2000, Math.floor(shared.sampleRate * totalTime));
      const w = 2 * Math.PI * ch.frequency;

      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * totalTime + view.tOffset;
        const yV = waveformSample(ch.waveform, t, { ...ch, difficulty: shared.difficulty });
        const xR = (i / (N - 1)) * width;
        const yR = height / 2 - ((yV - view.vOffset) / vDiv) * dy;
        const x = Math.round(xR) + 0.5;
        const y = Math.round(yR) + 0.5;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }, [shared, view]);

  return (
    <div className="w-full flex flex-col items-center">
      <canvas id={canvasId} ref={canvasRef} width={width} height={height} className="rounded-2xl shadow-xl border border-slate-700" />
      <div className="mt-2 text-xs text-slate-300">{vDiv} V/div • {sDiv} s/div • Offset V: {view.vOffset} V • Offset t: {view.tOffset} s</div>
    </div>
  );
}

// =======================
// INPUT HELPERS COMPONENTS
// =======================
function NumberField({ label, value, onChange, step = 1, min }: any) {
  return (
    <label className="flex flex-col gap-1 text-slate-300 text-sm">
      <span>{label}</span>
      <input type="number" step={step} min={min} value={value} onChange={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} className="bg-slate-800 border border-slate-700 rounded-xl p-2" />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }: any) {
  return (
    <label className="flex flex-col gap-1 text-slate-300 text-sm">
      <span>{label}</span>
      <input type="text" placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange((e.target as HTMLInputElement).value)} className="bg-slate-800 border border-slate-700 rounded-xl p-2" />
    </label>
  );
}

function MeasureCard({ chId, enabled, values, onChange }: any) {
  const safe = values || { vmax: "", vmin: "", vpp: "", period: "", freq: "" };
  return (
    <div className={`p-4 rounded-2xl border ${enabled ? "border-slate-700 bg-slate-900/40" : "border-slate-800 bg-slate-900/20 opacity-60"}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Misure CH{chId}</h3>
        <span className={`text-xs ${enabled ? "text-emerald-400" : "text-slate-500"}`}>{enabled ? "attivo" : "spento"}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <TextField label="Vmax (V)" value={safe.vmax} onChange={(v: string) => onChange("vmax", v)} />
        <TextField label="Vmin (V)" value={safe.vmin} onChange={(v: string) => onChange("vmin", v)} />
        <TextField label="Vpp (V)" value={safe.vpp} onChange={(v: string) => onChange("vpp", v)} />
        <TextField label="Periodo (s)" value={safe.period} onChange={(v: string) => onChange("period", v)} />
        <TextField label="Frequenza (Hz)" value={safe.freq} onChange={(v: string) => onChange("freq", v)} />
      </div>
    </div>
  );
}

// ==================
// PAGINA: DOCENTE
// ==================
function ChannelControls({ ch, onChange }: any) {
  const set = (k: string, v: any) => onChange({ ...ch, [k]: v });
  return (
    <div className="p-3 rounded-2xl border border-slate-700 bg-slate-900/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">CH{ch.id}</div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ch.enabled} onChange={(e) => set("enabled", (e.target as HTMLInputElement).checked)} /> Attivo
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2">
          <label className="block text-slate-300 mb-1">Forma d'onda</label>
          <select className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2" value={ch.waveform} onChange={(e) => set("waveform", (e.target as HTMLSelectElement).value)}>
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
        <NumberField label="Ampiezza (V picco)" value={ch.amplitude} step={0.1} min={0} onChange={(v: number) => set("amplitude", v)} />
        <NumberField label="Frequenza (Hz)" value={ch.frequency} step={1} min={0} onChange={(v: number) => set("frequency", v)} />
        <NumberField label="Fase (rad)" value={ch.phase} step={0.1} onChange={(v: number) => set("phase", v)} />
        <NumberField label="Offset DC (V)" value={ch.dc} step={0.1} onChange={(v: number) => set("dc", v)} />
        <NumberField label="Rumore (V rms)" value={ch.noise} step={0.01} min={0} onChange={(v: number) => set("noise", v)} />
        <div className="col-span-2">
          <label className="block text-slate-300 mb-1">Colore traccia</label>
          <input type="color" value={ch.color} onChange={(e) => set("color", (e.target as HTMLInputElement).value)} />
        </div>
      </div>
    </div>
  );
}

function TeacherPage({ shared, setShared }: any) {
  const setChannel = (idx: number, next: any) => {
    const channels = [...shared.channels]; channels[idx] = next; setShared({ ...shared, channels });
  };
  const randomize = (level: "base" | "intermedio" | "avanzato") => {
    const baseFreqs = [50, 100, 200, 500, 1000, 2000, 5000];
    const forms = ["sine", "square", "triangle", "saw", "rectified", "am", "fm", "sum2"];
    const channels = shared.channels.map((ch: any) => ({
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
      <p className="text-slate-300 mb-4">Imposta i canali e pubblica la simulazione. Apri #/studenti in un'altra scheda.</p>

      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <label className="flex items-center gap-2">
          <span>Difficoltà:</span>
          <select className="bg-slate-800 border border-slate-700 rounded-xl p-2" value={shared.difficulty} onChange={(e) => setShared({ ...shared, difficulty: (e.target as HTMLSelectElement).value })}>
            <option value="base">Base</option>
            <option value="intermedio">Intermedio</option>
            <option value="avanzato">Avanzato</option>
          </select>
        </label>
        <button onClick={() => randomize(shared.difficulty)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:bg-slate-700">Casuale (mantieni)</button>
        <button onClick={() => randomize("base")} className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600">Base</button>
        <button onClick={() => randomize("intermedio")} className="px-3 py-2 rounded-xl bg-amber-700 hover:bg-amber-600">Intermedio</button>
        <button onClick={() => randomize("avanzato")} className="px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-600">Avanzato</button>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        {shared.channels.map((ch: any, i: number) => (
          <ChannelControls key={ch.id} ch={ch} onChange={(next: any) => setChannel(i, next)} />
        ))}
      </div>

      <ScopeCanvas canvasId="teacher-scope" shared={shared} view={{ vPerDiv: 1, sPerDiv: shared.timeBase, vOffset: 0, tOffset: 0 }} />
    </div>
  );
}

// ==================
// PAGINA: STUDENTI
// ==================
function StudentPage({ shared }: any) {
  const [view, setView] = useStudentView();

  // fallback misure sicure sempre presenti
  const defaultMeasures = {
    1: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
    2: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
    3: { vmax: "", vmin: "", vpp: "", period: "", freq: "" },
  } as const;
  const measures = (view.measures && typeof view.measures === "object") ? view.measures : { ...defaultMeasures };

  const set = (k: string, v: any) => setView((s: any) => ({ ...s, [k]: v }));
  const setMeasure = (chId: number, k: string, v: any) => setView((s: any) => {
    const safeMeasures: any = s.measures && typeof s.measures === "object" ? { ...s.measures } : { ...defaultMeasures };
    const safeChannel = safeMeasures[chId] ? { ...safeMeasures[chId] } : { vmax: "", vmin: "", vpp: "", period: "", freq: "" };
    safeMeasures[chId] = { ...safeChannel, [k]: v };
    return { ...s, measures: safeMeasures };
  });

  const [checkResult, setCheckResult] = useState<any>(null);

  const doCheck = () => {
    const tolV = 0.05, tolF = 0.02;
    let erroriCount = 0, datiMancanti = 0;
    if (!view.name) datiMancanti++; if (!view.surname) datiMancanti++; if (!view.class) datiMancanti++; if (!view.date) datiMancanti++;
    const res: any = { ok: true, perChannel: {} };
    for (const ch of shared.channels) {
      if (!ch.enabled) continue;
      const user: any = (measures && measures[ch.id]) || {};
      const corr: any = { vmax: ch.amplitude + ch.dc, vmin: -ch.amplitude + ch.dc, vpp: 2 * ch.amplitude, period: ch.frequency > 0 ? 1 / ch.frequency : Infinity, freq: ch.frequency };
      for (const [k, tol] of [["vmax", tolV], ["vmin", tolV], ["vpp", tolV], ["period", tolF], ["freq", tolF]] as any) {
        const u = parseFloat(user[k]); const c = corr[k];
        if (!isFinite(u) || !isFinite(c)) { res.ok = false; (res.perChannel[ch.id] = res.perChannel[ch.id] || { ok: true, errors: 0 }).errors++; continue; }
        const rel = Math.abs(u - c) / (Math.abs(c) + 1e-9);
        if (rel > tol) { res.ok = false; (res.perChannel[ch.id] = res.perChannel[ch.id] || { ok: true, errors: 0 }).errors++; }
      }
    }
    let totalErrors = 0; Object.values(res.perChannel).forEach((r: any) => { totalErrors += r.errors || 0; r.ok = (r.errors || 0) === 0; });
    let punteggio = 10 - Math.min(5, Math.ceil(totalErrors / 2)); if (datiMancanti) punteggio = Math.max(0, punteggio - 1);
    setCheckResult({ ...res, punteggio, erroriCount: totalErrors, datiMancanti });
  };

  // UI
  return (
    <div className="p-6 text-slate-100">
      <h1 className="text-2xl font-bold mb-6">Pagina Studenti</h1>

      {/* Dati Studente */}
      <div className="p-5 rounded-2xl border border-slate-700 bg-slate-900/40 mb-6">
        <h2 className="font-semibold mb-4">Dati Studente</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <TextField label="Nome" value={view.name} onChange={(v: string) => set("name", v)} />
          <TextField label="Cognome" value={view.surname} onChange={(v: string) => set("surname", v)} />
          <TextField label="Classe" value={view.class} onChange={(v: string) => set("class", v)} />
          <label className="flex flex-col gap-1 text-slate-300 text-sm">
            <span>Data</span>
            <input type="date" value={view.date || ""} onChange={(e) => set("date", (e.target as HTMLInputElement).value)} className="bg-slate-800 border border-slate-700 rounded-xl p-2" />
          </label>
        </div>
      </div>

      {/* Layout: Oscilloscopio SX + Controlli Scala DX */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1"><ScopeCanvas canvasId="student-scope" shared={shared} view={view} /></div>
        <aside className="w-full lg:w-80 p-5 rounded-2xl border border-slate-700 bg-slate-900/40">
          <h2 className="font-semibold mb-4">Controlli Scala</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <NumberField label="V/div" value={view.vPerDiv} step={0.1} min={0.1} onChange={(v: number) => set("vPerDiv", v)} />
            <NumberField label="s/div" value={view.sPerDiv} step={0.0001} min={0.000001} onChange={(v: number) => set("sPerDiv", v)} />
            <NumberField label="Offset V (V)" value={view.vOffset} step={0.1} onChange={(v: number) => set("vOffset", v)} />
            <NumberField label="Offset t (s)" value={view.tOffset} step={0.0001} onChange={(v: number) => set("tOffset", v)} />
          </div>
        </aside>
      </div>

      {/* Dati CH1-CH3 */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        {[1,2,3].map((id) => (
          <MeasureCard key={id} chId={id} enabled={shared.channels.find((c: any) => c.id === id)?.enabled} values={measures[id]} onChange={(k: string, v: string) => setMeasure(id, k, v)} />
        ))}
      </div>

      {/* Verifica */}
      <div className="mt-8">
        <button onClick={doCheck} className="w-full px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600">Verifica con tolleranza</button>
      </div>

      {checkResult && (
        <div className="text-sm mt-4">
          <div className={checkResult.ok ? "text-emerald-400" : "text-rose-400"}>{checkResult.ok ? "Tutte le misure nei limiti." : "Alcune misure non rientrano nella tolleranza."}</div>
          <div className="mt-2"><strong>Punteggio automatico: {checkResult.punteggio} / 10</strong></div>
          <ul className="mt-2 space-y-1">
            {Object.entries(checkResult.perChannel || {}).map(([chId, r]: any) => (
              <li key={chId}><span className="font-semibold">CH{chId}</span> – {r.ok ? "OK" : `Errori: ${r.errors}`}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// =============
// MINI ROUTER
// =============
function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash || "#/docente");
  useEffect(() => { const onH = () => setRoute(window.location.hash || "#/docente"); window.addEventListener("hashchange", onH); return () => window.removeEventListener("hashchange", onH); }, []);
  return route;
}

// =============
// APP ROOT
// =============
export default function App() {
  const [shared, setSharedRaw] = useBroadcastState(defaultSharedState);
  const route = useHashRoute();
  const setShared = (next: any) => { if (typeof next === "function") setSharedRaw((s: any) => next(s)); else setSharedRaw(next); };
  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 backdrop-blur px-6 py-3 flex items-center gap-3">
        <a href="#/docente" className={`px-3 py-1.5 rounded-xl ${route.includes("docente")?"bg-slate-800 text-white":"text-slate-300 hover:bg-slate-900"}`}>Docente</a>
        <a href="#/studenti" className={`px-3 py-1.5 rounded-xl ${route.includes("studenti")?"bg-slate-800 text-white":"text-slate-300 hover:bg-slate-900"}`}>Studenti</a>
        <div className="ml-auto text-slate-400 text-sm">Oscilloscopio Didattico • 3 Canali • Sincronizzato</div>
      </nav>
      {route.includes("studenti") ? <StudentPage shared={shared} /> : <TeacherPage shared={shared} setShared={setShared} />}
      <footer className="px-6 py-8 text-center text-xs text-slate-500">Suggerimento: apri questa app in due schede (#/docente e #/studenti) per una lezione live.</footer>
    </div>
  );
}

// =============
// DEV MINI TESTS
// =============
(function devTests(){
  try {
    const ch = { id:1, amplitude:2, dc:1, frequency:100, phase:0, waveform:"sine", color:"#fff", enabled:true } as any;
    const y0 = waveformSample("sine", 0, { ...ch, difficulty: "base" });
    console.assert(typeof y0 === "number", "waveformSample returns number");
    console.log("[OscSim] Dev tests OK");
  } catch (e) { console.warn("[OscSim] Dev tests FAILED", e); }
})();
