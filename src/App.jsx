import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, Send, Download, Printer, Loader2, RotateCcw, Plus, Clock, Trash2, History, FileDown, X, Sparkles } from "lucide-react";
import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import { Document, Packer, Paragraph } from "docx";

const INK = "#15171E";
const PAPER = "#F2F3F6";
const SURFACE = "#FFFFFF";
const ACCENT = "#3654E0";
const ACCENT_SOFT = "#EEF0FE";
const MUTED = "#6B7080";
const RULE = "#E4E5EA";

const TEMPLATES = [
  {
    title: "No-Show & Cancellation Policy",
    text: `NO-SHOW AND CANCELLATION POLICY

We ask patients to give at least 24 hours notice if they need to cancel or reschedule an appointment.

- Missed appointments without notice may result in a $25 fee, charged to the card on file.
- Two or more missed appointments in a row may require a deposit to book future visits.
- Fees may be waived for documented emergencies.
- Patients will be notified of this policy at the time of scheduling.`,
  },
  {
    title: "Patient Privacy Basics",
    text: `PATIENT PRIVACY POLICY (INTERNAL)

Our practice is committed to protecting patient information.

- Staff should only access patient records needed for their current task.
- Patient information should never be discussed in public areas of the office.
- Screens displaying patient information should be locked when unattended.
- Any suspected privacy incident should be reported to the office manager immediately.
- Patients may request a copy of their records through the front desk.`,
  },
  {
    title: "Staff Dress Code",
    text: `STAFF DRESS CODE

To maintain a professional and clean environment for patients:

- Scrubs or provided uniforms should be worn during all shifts.
- Closed-toe shoes are required at all times.
- Name badges should be visible during patient interactions.
- Personal hygiene and grooming should meet professional standards.
- Exceptions for religious or medical accommodations should be discussed with the office manager.`,
  },
  {
    title: "Late Arrival Policy",
    text: `LATE ARRIVAL POLICY

- Patients arriving more than 15 minutes late may need to be rescheduled to ensure other patients are seen on time.
- Front desk staff will use judgment based on the day's schedule before rebooking a late arrival.
- Repeated late arrivals may be discussed with the patient at their next visit.`,
  },
];

function PolicyApp() {
  const { getToken } = useAuth();
  const [phase, setPhase] = useState("library"); // library | paste | chat
  const [policyId, setPolicyId] = useState(null);
  const [policyTitle, setPolicyTitle] = useState("");
  const [policyDoc, setPolicyDoc] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justEdited, setJustEdited] = useState(false);
  const [savedPolicies, setSavedPolicies] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "saved" | "error"
  const [libraryError, setLibraryError] = useState("");
  const [versions, setVersions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const pendingVersionRef = useRef(null);
  const chatEndRef = useRef(null);
  const editFlashTimer = useRef(null);
  const abortRef = useRef(null);
  const cancelTokenRef = useRef(0);
  const saveDebounce = useRef(null);

  async function authFetch(url, options = {}) {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: token ? `Bearer ${token}` : "",
      },
    });
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary() {
    setLibraryLoading(true);
    setLibraryError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await authFetch("/api/policies", { signal: controller.signal });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const data = await res.json();
      setSavedPolicies(data.policies || []);
    } catch (e) {
      setSavedPolicies([]);
      setLibraryError(
        e.name === "AbortError"
          ? "This is taking too long to load — the storage database may not be connecting. Check your REDIS_URL setup."
          : "Couldn't load saved policies. The storage database may not be set up correctly yet."
      );
    } finally {
      clearTimeout(timeout);
      setLibraryLoading(false);
    }
  }

  async function openPolicy(id) {
    try {
      const res = await authFetch(`/api/policy?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("not found");
      const record = await res.json();
      setPolicyId(record.id);
      setPolicyTitle(record.title);
      setPolicyDoc(record.document);
      setVersions(record.versions || []);
      setMessages(record.messages && record.messages.length ? record.messages : [
        { role: "assistant", text: `Reopened "${record.title}". Tell me what you'd like to change next.` },
      ]);
      setPhase("chat");
    } catch (e) {
      setError("Couldn't open that policy. It may have been deleted.");
    }
  }

  async function deletePolicy(id, e) {
    e.stopPropagation();
    setSavedPolicies((list) => list.filter((p) => p.id !== id));
    try {
      await authFetch(`/api/policy?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      // Non-critical if this fails silently; library will resync next load.
    }
  }

  function startNew() {
    setPasteText("");
    setPasteTitle("");
    setPhase("paste");
  }

  async function startChat() {
    if (pasteText.trim().length < 20) return;
    const title = pasteTitle.trim() || pasteText.trim().split("\n")[0].slice(0, 60) || "Untitled policy";
    const doc = pasteText.trim();
    const initialMessages = [
      {
        role: "assistant",
        text: "Got it — your policy is loaded on the right. Tell me what you'd like to change. For example: \"make the cancellation window 48 hours instead of 24\" or \"make the whole thing sound friendlier.\"",
      },
    ];
    setPolicyTitle(title);
    setPolicyDoc(doc);
    setVersions([]);
    setMessages(initialMessages);
    setPhase("chat");

    try {
      const res = await authFetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, document: doc, messages: initialMessages }),
      });
      const data = await res.json();
      setPolicyId(data.id);
    } catch (e) {
      setError("Couldn't save this policy to your library, but you can keep working — it just won't persist after you close the tab.");
    }
  }

  const saveNow = useCallback((doc, msgs, title, id) => {
    if (!id) return;
    setSaveStatus("saving");
    clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const versionSnapshot = pendingVersionRef.current;
      pendingVersionRef.current = null;
      try {
        const res = await authFetch(`/api/policy?id=${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ document: doc, messages: msgs, title, versionSnapshot }),
        });
        if (!res.ok) throw new Error("save failed");
        const updated = await res.json();
        if (updated.versions) setVersions(updated.versions);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      } catch (e) {
        setSaveStatus("error");
      } finally {
        clearTimeout(timeout);
      }
    }, 600);
  }, []);

  useEffect(() => {
    if (policyId && phase === "chat") {
      saveNow(policyDoc, messages, policyTitle, policyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyDoc, messages]);

  async function send() {
    const ask = input.trim();
    if (!ask || busy) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", text: ask }]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const myToken = ++cancelTokenRef.current;
    try {
      const response = await authFetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ policyDoc, ask }),
      });

      if (myToken !== cancelTokenRef.current) return;

      if (!response.ok) throw new Error("request failed");
      const data = await response.json();

      if (myToken !== cancelTokenRef.current) return;

      if (!data.document) throw new Error("empty document");
      pendingVersionRef.current = { document: policyDoc, label: ask };
      setPolicyDoc(data.document);
      setMessages((m) => [...m, { role: "assistant", text: data.reply || "Updated." }]);
    } catch (e) {
      if (myToken !== cancelTokenRef.current) return;
      if (e.name === "AbortError") {
        setMessages((m) => [...m, { role: "assistant", text: "Cancelled — the document wasn't changed." }]);
      } else {
        setError("That change didn't go through. Try rephrasing it.");
        setMessages((m) => [...m, { role: "assistant", text: "Hmm, I hit a snag applying that one. Mind rephrasing the change you want?" }]);
      }
    } finally {
      if (myToken === cancelTokenRef.current) setBusy(false);
      abortRef.current = null;
    }
  }

  function restoreVersion(version) {
    pendingVersionRef.current = { document: policyDoc, label: `Before restoring "${version.label}"` };
    setPolicyDoc(version.document);
    setMessages((m) => [...m, { role: "assistant", text: `Restored an earlier version from ${new Date(version.savedAt).toLocaleString()}.` }]);
    setHistoryOpen(false);
  }

  async function downloadWord() {
    setExportingWord(true);
    try {
      const doc = new Document({
        sections: [
          {
            children: policyDoc
              .split("\n")
              .map((line) => new Paragraph({ text: line })),
          },
        ],
      });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(policyTitle || "policy").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("Couldn't create the Word file. Try downloading as text instead.");
    } finally {
      setExportingWord(false);
    }
  }

  function cancelRewrite() {
    cancelTokenRef.current++;
    abortRef.current?.abort();
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", text: "Cancelled — the document wasn't changed." }]);
  }

  function download() {
    const blob = new Blob([policyDoc], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(policyTitle || "policy").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printDoc() {
    const w = window.open("", "_blank");
    w.document.write(
      `<pre style="font-family: 'Inter', -apple-system, sans-serif; font-size:14px; line-height:1.7; white-space:pre-wrap; padding:48px; max-width:680px; margin:auto;">${policyDoc.replace(/</g, "&lt;")}</pre>`
    );
    w.document.close();
    w.print();
  }

  function backToLibrary() {
    setPhase("library");
    setPolicyId(null);
    setPolicyDoc("");
    setMessages([]);
    setError("");
    loadLibrary();
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <div style={{ background: PAPER, height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif", color: INK, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@200;300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; margin: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        .pc-msg { animation: rise 0.25s ease; }
        .pc-input:focus, .pc-paste:focus { outline: none; border-color: ${ACCENT} !important; box-shadow: 0 0 0 3px ${ACCENT_SOFT}; }
        .pc-docedit:focus { outline: none; }
        .pc-btn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 2px; }
        .pc-btn:hover { opacity: 0.85; }
        .pc-card:hover { border-color: ${ACCENT} !important; box-shadow: 0 1px 2px rgba(21,23,30,0.04), 0 8px 20px rgba(21,23,30,0.07); }
      `}</style>

      {/* Header */}
      <div style={{ padding: "16px 24px", borderBottom: `1px solid ${RULE}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: SURFACE }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileText size={14} color="#fff" strokeWidth={2} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 300, letterSpacing: "0.01em" }}>Policy Editor</span>
          <UserButton afterSignOutUrl="/" />
          {phase === "chat" && saveStatus && (
            <span style={{ fontSize: 11.5, color: saveStatus === "saved" ? "#2E9B5F" : saveStatus === "error" ? "#C0392B" : MUTED, marginLeft: 4 }}>
              {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Couldn't save — check storage setup" : "Saved"}
            </span>
          )}
        </div>
        {phase === "chat" && (
          <button className="pc-btn" onClick={backToLibrary} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 300, color: MUTED, cursor: "pointer" }}>
            <RotateCcw size={12} /> My policies
          </button>
        )}
        {phase === "paste" && (
          <button className="pc-btn" onClick={backToLibrary} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 300, color: MUTED, cursor: "pointer" }}>
            Cancel
          </button>
        )}
      </div>

      {phase === "library" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 24px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 24, fontWeight: 200, letterSpacing: "-0.01em", margin: 0 }}>Your policies</h2>
                <p style={{ fontSize: 13.5, fontWeight: 300, color: MUTED, margin: "4px 0 0" }}>
                  Pick one up where you left off, or start something new.
                </p>
              </div>
              <button
                className="pc-btn"
                onClick={startNew}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "11px 18px", background: ACCENT, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(54,84,224,0.25), 0 4px 12px rgba(54,84,224,0.18)", flexShrink: 0 }}
              >
                <Plus size={15} /> New policy
              </button>
            </div>

            {libraryLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: MUTED, fontSize: 13.5, padding: "20px 0" }}>
                <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading your policies…
              </div>
            ) : libraryError ? (
              <div style={{ border: `1.5px solid #F1B0A8`, background: "#FDF1EF", borderRadius: 14, padding: "20px 22px" }}>
                <p style={{ fontSize: 13.5, color: "#A13B2E", margin: 0, lineHeight: 1.5 }}>{libraryError}</p>
                <button
                  className="pc-btn"
                  onClick={loadLibrary}
                  style={{ marginTop: 12, padding: "8px 16px", background: "#fff", border: "1px solid #F1B0A8", borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: "#A13B2E", cursor: "pointer" }}
                >
                  Try again
                </button>
              </div>
            ) : savedPolicies.length === 0 ? (
              <div style={{ border: `1.5px dashed ${RULE}`, borderRadius: 14, padding: "40px 24px", textAlign: "center" }}>
                <FileText size={26} color="#C7C9D1" strokeWidth={1.25} style={{ marginBottom: 10 }} />
                <p style={{ fontSize: 13.5, color: MUTED, margin: 0 }}>
                  Nothing saved yet. Start your first policy to see it here.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {savedPolicies.map((p) => (
                  <div
                    key={p.id}
                    className="pc-card"
                    onClick={() => openPolicy(p.id)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: SURFACE, border: `1px solid ${RULE}`, borderRadius: 12, padding: "16px 18px", cursor: "pointer", transition: "border-color 0.15s, box-shadow 0.15s" }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, background: ACCENT_SOFT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <FileText size={16} color={ACCENT} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</div>
                        <div style={{ fontSize: 11.5, color: MUTED, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <Clock size={10.5} /> Updated {fmtDate(p.updatedAt)}
                        </div>
                      </div>
                    </div>
                    <button
                      className="pc-btn"
                      onClick={(e) => deletePolicy(p.id, e)}
                      title="Delete"
                      style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                    >
                      <Trash2 size={14} color="#B0B4BF" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {phase === "paste" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ width: "100%", maxWidth: 640 }}>
            <h2 style={{ fontSize: 26, fontWeight: 200, letterSpacing: "-0.01em", margin: "0 0 8px" }}>Paste the policy you want to rewrite</h2>
            <p style={{ fontSize: 14, fontWeight: 300, color: MUTED, margin: "0 0 20px", lineHeight: 1.6 }}>
              Drop in the current version — even if it's rough or outdated. Then just tell it what to change, like you'd tell a colleague.
            </p>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11.5, fontWeight: 500, color: MUTED, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Or start from a template
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {TEMPLATES.map((t) => (
                  <button
                    key={t.title}
                    className="pc-btn"
                    onClick={() => {
                      setPasteTitle(t.title);
                      setPasteText(t.text);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      border: `1px solid ${RULE}`,
                      borderRadius: 999,
                      background: SURFACE,
                      fontSize: 12.5,
                      fontWeight: 500,
                      color: INK,
                      cursor: "pointer",
                    }}
                  >
                    <Sparkles size={12} color={ACCENT} />
                    {t.title}
                  </button>
                ))}
              </div>
            </div>

            <input
              className="pc-paste"
              value={pasteTitle}
              onChange={(e) => setPasteTitle(e.target.value)}
              placeholder="Name this policy (e.g. Cancellation Policy)"
              style={{ width: "100%", boxSizing: "border-box", padding: "12px 16px", border: `1.5px solid ${RULE}`, borderRadius: 10, background: SURFACE, fontSize: 13.5, color: INK, marginBottom: 12 }}
            />
            <textarea
              className="pc-paste"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"e.g.\n\nCANCELLATION POLICY\nPatients must give 24 hours notice to cancel. Two missed appointments may result in a fee..."}
              rows={11}
              style={{ width: "100%", boxSizing: "border-box", padding: 16, border: `1.5px solid ${RULE}`, borderRadius: 12, background: SURFACE, fontSize: 13.5, lineHeight: 1.6, color: INK, resize: "vertical", transition: "box-shadow 0.15s, border-color 0.15s" }}
            />
            <button
              className="pc-btn"
              onClick={startChat}
              disabled={pasteText.trim().length < 20}
              style={{ marginTop: 16, padding: "13px 28px", background: pasteText.trim().length < 20 ? "#D4D6DD" : ACCENT, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: pasteText.trim().length < 20 ? "not-allowed" : "pointer", boxShadow: pasteText.trim().length < 20 ? "none" : "0 1px 2px rgba(54,84,224,0.25), 0 4px 12px rgba(54,84,224,0.18)" }}
            >
              Load policy & start
            </button>
          </div>
        </div>
      )}

      {phase === "chat" && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(320px, 44%) 1fr", minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${RULE}`, minHeight: 0, background: SURFACE }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
              {messages.map((m, i) => (
                <div key={i} className="pc-msg" style={{ marginBottom: 14, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "85%",
                      padding: "11px 15px",
                      borderRadius: m.role === "user" ? "14px 14px 3px 14px" : "14px 14px 14px 3px",
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      background: m.role === "user" ? ACCENT : ACCENT_SOFT,
                      color: m.role === "user" ? "#fff" : INK,
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: MUTED, padding: "4px 2px" }}>
                  <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Rewriting…
                  <button
                    className="pc-btn"
                    onClick={cancelRewrite}
                    style={{ border: `1px solid ${RULE}`, background: SURFACE, borderRadius: 7, padding: "3px 10px", fontSize: 11.5, fontWeight: 400, color: INK, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: 16, borderTop: `1px solid ${RULE}`, flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="pc-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder='Tell me what to change…'
                  style={{ flex: 1, padding: "12px 15px", border: `1.5px solid ${RULE}`, borderRadius: 10, background: PAPER, fontSize: 13.5, color: INK, transition: "box-shadow 0.15s, border-color 0.15s" }}
                />
                <button
                  className="pc-btn"
                  onClick={send}
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  style={{ width: 44, borderRadius: 10, border: "none", background: busy || !input.trim() ? "#D4D6DD" : ACCENT, color: "#fff", cursor: busy || !input.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <Send size={16} />
                </button>
              </div>
              {error && <p style={{ fontSize: 11.5, color: "#C0392B", margin: "8px 0 0" }}>{error}</p>}
            </div>
          </div>

          <div style={{ overflowY: "auto", padding: "24px 28px", minHeight: 0 }}>
            <div style={{ background: SURFACE, border: `1px solid ${RULE}`, boxShadow: "0 1px 2px rgba(21,23,30,0.04), 0 10px 30px rgba(21,23,30,0.06)", borderRadius: 16, padding: "32px 36px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${RULE}`, paddingBottom: 14, marginBottom: 22 }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT, display: "flex", alignItems: "center", gap: 8 }}>
                  {policyTitle || "Working draft"}
                  {justEdited && (
                    <span style={{ color: "#2E9B5F", textTransform: "none", letterSpacing: "normal", fontWeight: 500, fontSize: 11.5 }}>
                      · edit saved
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="pc-btn"
                    onClick={() => setHistoryOpen(true)}
                    title="Version history"
                    style={{ ...iconBtn, width: "auto", padding: "0 10px", position: "relative" }}
                  >
                    <History size={14} color={MUTED} />
                    {versions.length > 0 && (
                      <span style={{ fontSize: 10.5, color: MUTED, marginLeft: 5 }}>{versions.length}</span>
                    )}
                  </button>
                  <button className="pc-btn" onClick={printDoc} title="Print" style={iconBtn}>
                    <Printer size={14} color={MUTED} />
                  </button>
                  <button className="pc-btn" onClick={download} title="Download as text" style={iconBtn}>
                    <Download size={14} color={MUTED} />
                  </button>
                  <button className="pc-btn" onClick={downloadWord} title="Download as Word" style={iconBtn} disabled={exportingWord}>
                    {exportingWord ? <Loader2 size={14} color={MUTED} style={{ animation: "spin 1s linear infinite" }} /> : <FileDown size={14} color={MUTED} />}
                  </button>
                </div>
              </div>
              <textarea
                className="pc-docedit"
                value={policyDoc}
                onChange={(e) => {
                  setPolicyDoc(e.target.value);
                  setJustEdited(true);
                  clearTimeout(editFlashTimer.current);
                  editFlashTimer.current = setTimeout(() => setJustEdited(false), 1500);
                }}
                spellCheck={true}
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 14,
                  lineHeight: 1.8,
                  color: INK,
                  margin: 0,
                  width: "100%",
                  minHeight: 420,
                  border: "none",
                  background: "transparent",
                  resize: "vertical",
                  padding: 0,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: MUTED, marginTop: 12 }}>
              Click directly into the document to fix small things. Use chat on the left for bigger rewrites. Everything saves automatically.
            </p>
          </div>
        </div>
      )}

      {historyOpen && (
        <div
          onClick={() => setHistoryOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(21,23,30,0.4)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              maxWidth: "90vw",
              height: "100%",
              background: SURFACE,
              boxShadow: "-4px 0 24px rgba(21,23,30,0.12)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "18px 20px", borderBottom: `1px solid ${RULE}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Version history</span>
              <button className="pc-btn" onClick={() => setHistoryOpen(false)} style={iconBtn}>
                <X size={14} color={MUTED} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {versions.length === 0 ? (
                <p style={{ fontSize: 13, color: MUTED, padding: "8px 4px" }}>
                  No earlier versions yet — one will be saved here each time you make a change through chat.
                </p>
              ) : (
                [...versions].reverse().map((v) => (
                  <div key={v.id} style={{ border: `1px solid ${RULE}`, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
                    <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>
                      {new Date(v.savedAt).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 13, color: INK, marginBottom: 10, lineHeight: 1.4 }}>
                      "{v.label}"
                    </div>
                    <button
                      className="pc-btn"
                      onClick={() => restoreVersion(v)}
                      style={{ fontSize: 12, fontWeight: 500, color: ACCENT, background: ACCENT_SOFT, border: "none", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}
                    >
                      Restore this version
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: PAPER,
            fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif",
          }}
        >
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@200;300;400;500;600&display=swap');`}</style>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 28 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={16} color="#fff" strokeWidth={2} />
              </div>
              <span style={{ fontSize: 19, fontWeight: 300, color: INK }}>Policy Editor</span>
            </div>
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        <PolicyApp />
      </SignedIn>
    </>
  );
}

const iconBtn = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid ${RULE}`,
  background: "transparent",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};
