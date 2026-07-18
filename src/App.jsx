import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, Send, Download, Printer, Loader2, RotateCcw, Plus, Clock, Trash2, History, FileDown, X, Sparkles, Sun, Moon, Search, Share2, Copy, Check, ShieldAlert, Bold, Italic } from "lucide-react";
import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import { Document, Packer, Paragraph, TextRun } from "docx";

const LIGHT = {
  INK: "#15171E",
  PAPER: "#F2F3F6",
  SURFACE: "#FFFFFF",
  ACCENT: "#3654E0",
  ACCENT_SOFT: "#EEF0FE",
  MUTED: "#6B7080",
  RULE: "#E4E5EA",
};

const DARK = {
  INK: "#ECEDF2",
  PAPER: "#16181E",
  SURFACE: "#1F222A",
  ACCENT: "#6C87FF",
  ACCENT_SOFT: "#252C48",
  MUTED: "#9195A6",
  RULE: "#2C303A",
};

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

function PolicyApp({ onOpenBilling, billingLoading }) {
  const { getToken } = useAuth();
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("policyEditorDark") === "1";
    } catch {
      return false;
    }
  });
  const { INK, PAPER, SURFACE, ACCENT, ACCENT_SOFT, MUTED, RULE } = dark ? DARK : LIGHT;

  useEffect(() => {
    try {
      localStorage.setItem("policyEditorDark", dark ? "1" : "0");
    } catch {
      // ignore if storage is unavailable
    }
  }, [dark]);

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
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState(""); // "" | "saving" | "saved" | "error"
  const [libraryError, setLibraryError] = useState("");
  const [versions, setVersions] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [shareToken, setShareToken] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [printTheme, setPrintTheme] = useState("classic");
  const [docFont, setDocFont] = useState("georgia");
  const currentTheme = PRINT_THEMES.find((t) => t.id === printTheme) || PRINT_THEMES[0];
  const currentFont = FONTS.find((f) => f.id === docFont) || FONTS[0];
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 820);
  const [mobileTab, setMobileTab] = useState("document"); // "chat" | "document" — only used on narrow screens
  const pendingVersionRef = useRef(null);
  const chatEndRef = useRef(null);
  const docEditableRef = useRef(null);
  const isInternalDocUpdateRef = useRef(false);
  const editFlashTimer = useRef(null);
  const abortRef = useRef(null);
  const cancelTokenRef = useRef(0);
  const preRewriteDocRef = useRef(null);
  const saveDebounce = useRef(null);

  const filteredPolicies = librarySearch.trim()
    ? savedPolicies.filter((p) => p.title.toLowerCase().includes(librarySearch.trim().toLowerCase()))
    : savedPolicies;

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
    function handleResize() {
      setIsMobile(window.innerWidth < 820);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Keep the editable document box showing whatever is in policyDoc — except when
  // the change just came from the user's own typing in that same box, since in
  // that case the DOM already reflects it and re-setting innerHTML would jump
  // the cursor around.
  useEffect(() => {
    if (isInternalDocUpdateRef.current) {
      isInternalDocUpdateRef.current = false;
      return;
    }
    if (docEditableRef.current) {
      docEditableRef.current.innerHTML = markdownLiteToHtml(policyDoc).replace(/\n/g, "<br>");
    }
  }, [policyDoc]);

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
      setShareToken(record.shareToken || null);
      setPrintTheme(record.printTheme || "classic");
      setDocFont(record.docFont || "georgia");
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
    setShareToken(null);
    setPrintTheme("classic");
    setDocFont("georgia");
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

  const saveNow = useCallback((doc, msgs, title, id, theme, font) => {
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
          body: JSON.stringify({ document: doc, messages: msgs, title, versionSnapshot, printTheme: theme, docFont: font }),
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
    if (policyId && phase === "chat" && !busy) {
      saveNow(policyDoc, messages, policyTitle, policyId, printTheme, docFont);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyDoc, messages, printTheme, docFont]);

  async function send() {
    const ask = input.trim();
    if (!ask || busy) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", text: ask }]);
    setBusy(true);
    if (isMobile) setMobileTab("document");
    const controller = new AbortController();
    abortRef.current = controller;
    const myToken = ++cancelTokenRef.current;
    const originalDoc = policyDoc;
    preRewriteDocRef.current = originalDoc;

    try {
      const response = await authFetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ policyDoc, ask }),
      });

      if (myToken !== cancelTokenRef.current) return;
      if (!response.ok || !response.body) throw new Error("request failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      let docStartIdx = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (myToken !== cancelTokenRef.current) {
          try {
            reader.cancel();
          } catch (e) {
            // ignore
          }
          return;
        }
        if (done) break;
        raw += decoder.decode(value, { stream: true });

        if (docStartIdx === -1) {
          const idx = raw.indexOf("===DOCUMENT===");
          if (idx !== -1) docStartIdx = idx;
        }
        if (docStartIdx !== -1) {
          // Show the document rewriting itself live, chunk by chunk, as it streams in.
          const liveDoc = raw.slice(docStartIdx + "===DOCUMENT===".length).replace(/^\n/, "");
          setPolicyDoc(liveDoc);
        }
      }

      if (myToken !== cancelTokenRef.current) return;

      // Now do a clean final parse of the complete response.
      const flagsIdx = raw.indexOf("===FLAGS===");
      const docIdx = raw.indexOf("===DOCUMENT===");
      if (docIdx === -1) throw new Error("bad shape");

      const reply = raw.slice(0, flagsIdx === -1 ? docIdx : flagsIdx).replace(/^REPLY:\s*/i, "").trim();
      const flagsRaw = flagsIdx === -1 ? "" : raw.slice(flagsIdx + "===FLAGS===".length, docIdx).trim();
      const document = raw.slice(docIdx + "===DOCUMENT===".length).trim();
      const flags =
        !flagsRaw || /^none$/i.test(flagsRaw)
          ? []
          : flagsRaw.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);

      if (!document) throw new Error("empty document");

      pendingVersionRef.current = { document: originalDoc, label: ask };
      setPolicyDoc(document);
      setMessages((m) => [...m, { role: "assistant", text: reply || "Updated.", flags }]);
    } catch (e) {
      if (myToken !== cancelTokenRef.current) return; // cancelRewrite already handled cleanup
      setPolicyDoc(originalDoc);
      setError("That change didn't go through. Try rephrasing it.");
      setMessages((m) => [...m, { role: "assistant", text: "Hmm, I hit a snag applying that one. Mind rephrasing the change you want?" }]);
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
      const theme = PRINT_THEMES.find((t) => t.id === printTheme) || PRINT_THEMES[0];
      const font = FONTS.find((f) => f.id === docFont) || FONTS[0];
      const wordFontName = font.label; // e.g. "Times New Roman", "Arial" — matches real installed font names
      const doc = new Document({
        sections: [
          {
            children: policyDoc.split("\n").map(
              (line) =>
                new Paragraph({
                  children: markdownLiteToRuns(line).map(
                    (r) => new TextRun({ text: r.text, bold: !!r.bold, italics: !!r.italics, font: wordFontName, size: theme.fontSize * 2 })
                  ),
                })
            ),
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

  async function generateShareLink() {
    if (!policyId) return;
    setShareBusy(true);
    try {
      const res = await authFetch(`/api/policy?id=${encodeURIComponent(policyId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generateShare: true }),
      });
      const updated = await res.json();
      setShareToken(updated.shareToken || null);
    } catch (e) {
      setError("Couldn't create a share link. Try again.");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShareLink() {
    if (!policyId) return;
    setShareBusy(true);
    try {
      const res = await authFetch(`/api/policy?id=${encodeURIComponent(policyId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeShare: true }),
      });
      const updated = await res.json();
      setShareToken(updated.shareToken || null);
    } catch (e) {
      setError("Couldn't revoke the share link. Try again.");
    } finally {
      setShareBusy(false);
    }
  }

  function copyShareLink() {
    const url = `${window.location.origin}/shared/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }

  function cancelRewrite() {
    cancelTokenRef.current++;
    abortRef.current?.abort();
    if (preRewriteDocRef.current !== null) setPolicyDoc(preRewriteDocRef.current);
    setBusy(false);
    setMessages((m) => [...m, { role: "assistant", text: "Cancelled — the document wasn't changed." }]);
  }

  function applyFormat(command) {
    const el = docEditableRef.current;
    if (!el) return;
    document.execCommand(command);
    handleEditableInput(); // sync the change back into policyDoc right away
  }

  function htmlToMarkdownLite(root) {
    let result = "";
    let firstBlock = true;

    function walk(node, bold, italic) {
      if (node.nodeType === Node.TEXT_NODE) {
        let text = node.textContent;
        if (bold) text = `**${text}**`;
        if (italic) text = `*${text}*`;
        result += text;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName;
      if (tag === "BR") {
        result += "\n";
        return;
      }
      const isBlock = tag === "DIV" || tag === "P";
      if (isBlock) {
        if (!firstBlock) result += "\n";
        firstBlock = false;
      }

      const nextBold = bold || tag === "B" || tag === "STRONG";
      const nextItalic = italic || tag === "I" || tag === "EM";

      for (const child of node.childNodes) {
        walk(child, nextBold, nextItalic);
      }
    }

    for (const child of root.childNodes) {
      walk(child, false, false);
    }
    return result;
  }

  function handleEditableInput() {
    const el = docEditableRef.current;
    if (!el) return;
    const text = htmlToMarkdownLite(el);
    isInternalDocUpdateRef.current = true;
    setPolicyDoc(text);
    setJustEdited(true);
    clearTimeout(editFlashTimer.current);
    editFlashTimer.current = setTimeout(() => setJustEdited(false), 1500);
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
    const theme = PRINT_THEMES.find((t) => t.id === printTheme) || PRINT_THEMES[0];
    const font = FONTS.find((f) => f.id === docFont) || FONTS[0];
    const formattedHtml = markdownLiteToHtml(policyDoc);
    const w = window.open("", "_blank");
    w.document.write(`
      <div style="font-family: ${font.family}; font-size: ${theme.fontSize}pt; line-height: ${theme.compact ? 1.4 : 1.7}; white-space: pre-wrap; padding: 48px; max-width: 680px; margin: auto;">
        <div style="text-align: ${theme.headerAlign}; font-weight: bold; font-size: ${theme.fontSize + 3}pt; margin-bottom: 20px;">${escapeHtml(policyTitle || "")}</div>
        ${formattedHtml}
      </div>
    `);
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
      <div style={{ padding: isMobile ? "12px 14px" : "16px 24px", borderBottom: `1px solid ${RULE}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: SURFACE, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, minWidth: 0 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <FileText size={14} color="#fff" strokeWidth={2} />
          </div>
          {!isMobile && <span style={{ fontSize: 16, fontWeight: 300, letterSpacing: "0.01em", whiteSpace: "nowrap" }}>Policy Editor</span>}
          <button
            className="pc-btn"
            onClick={() => setDark((d) => !d)}
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
            style={{ ...iconBtn(RULE), marginLeft: 2, flexShrink: 0 }}
          >
            {dark ? <Sun size={14} color={MUTED} /> : <Moon size={14} color={MUTED} />}
          </button>
          <UserButton afterSignOutUrl="/" />
          {!isMobile && onOpenBilling && (
            <button
              className="pc-btn"
              onClick={onOpenBilling}
              disabled={billingLoading}
              title="Manage billing"
              style={{ background: "none", border: "none", fontSize: 11.5, color: MUTED, cursor: billingLoading ? "not-allowed" : "pointer", padding: 0, marginLeft: 4, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              {billingLoading ? "Opening…" : "Billing"}
            </button>
          )}
          {phase === "chat" && saveStatus && !isMobile && (
            <span style={{ fontSize: 11.5, color: saveStatus === "saved" ? "#2E9B5F" : saveStatus === "error" ? "#C0392B" : MUTED, marginLeft: 4, whiteSpace: "nowrap" }}>
              {saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Couldn't save — check storage setup" : "Saved"}
            </span>
          )}
        </div>
        {phase === "chat" && (
          <button className="pc-btn" onClick={backToLibrary} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, borderRadius: 8, padding: isMobile ? "7px 10px" : "7px 13px", fontSize: 12.5, fontWeight: 300, color: MUTED, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}>
            <RotateCcw size={12} /> {isMobile ? "" : "My policies"}
          </button>
        )}
        {phase === "paste" && (
          <button className="pc-btn" onClick={backToLibrary} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid ${RULE}`, borderRadius: 8, padding: "7px 13px", fontSize: 12.5, fontWeight: 300, color: MUTED, cursor: "pointer", flexShrink: 0 }}>
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

            {!libraryLoading && !libraryError && savedPolicies.length > 0 && (
              <div style={{ position: "relative", marginBottom: 16 }}>
                <Search size={14} color={MUTED} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
                <input
                  className="pc-paste"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search your policies…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px 10px 38px", border: `1.5px solid ${RULE}`, borderRadius: 10, background: SURFACE, fontSize: 13, color: INK }}
                />
              </div>
            )}

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
            ) : filteredPolicies.length === 0 ? (
              <p style={{ fontSize: 13.5, color: MUTED, padding: "12px 4px" }}>
                No policies match "{librarySearch}".
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredPolicies.map((p) => (
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
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {isMobile && (
            <div style={{ display: "flex", gap: 6, padding: "10px 16px", borderBottom: `1px solid ${RULE}`, background: SURFACE, flexShrink: 0 }}>
              <button
                className="pc-btn"
                onClick={() => setMobileTab("document")}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "none",
                  background: mobileTab === "document" ? ACCENT : "transparent",
                  color: mobileTab === "document" ? "#fff" : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Document
              </button>
              <button
                className="pc-btn"
                onClick={() => setMobileTab("chat")}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  borderRadius: 8,
                  border: "none",
                  background: mobileTab === "chat" ? ACCENT : "transparent",
                  color: mobileTab === "chat" ? "#fff" : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  position: "relative",
                }}
              >
                Chat
                {busy && mobileTab !== "chat" && (
                  <span style={{ position: "absolute", top: 6, right: "28%", width: 6, height: 6, borderRadius: "50%", background: mobileTab === "chat" ? "#fff" : ACCENT }} />
                )}
              </button>
            </div>
          )}
          <div style={{ flex: 1, display: isMobile ? "block" : "grid", gridTemplateColumns: isMobile ? undefined : "minmax(320px, 44%) 1fr", minHeight: 0 }}>
          <div style={{ display: isMobile && mobileTab !== "chat" ? "none" : "flex", flexDirection: "column", borderRight: isMobile ? "none" : `1px solid ${RULE}`, minHeight: 0, background: SURFACE, height: isMobile ? "100%" : "auto" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px" }}>
              {messages.map((m, i) => (
                <div key={i} className="pc-msg" style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
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
                  {m.flags && m.flags.length > 0 && (
                    <div
                      style={{
                        maxWidth: "85%",
                        marginTop: 6,
                        padding: "10px 13px",
                        borderRadius: "14px 14px 14px 3px",
                        background: dark ? "#3A2E14" : "#FFF6E5",
                        border: `1px solid ${dark ? "#5C4A20" : "#F0DBA6"}`,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <ShieldAlert size={12.5} color={dark ? "#E0B84A" : "#9A7A1E"} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: dark ? "#E0B84A" : "#9A7A1E", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Worth double-checking
                        </span>
                      </div>
                      {m.flags.map((f, fi) => (
                        <div key={fi} style={{ fontSize: 12.5, color: dark ? "#E8D9AE" : "#7A5F17", lineHeight: 1.5, marginBottom: fi === m.flags.length - 1 ? 0 : 4 }}>
                          • {f}
                        </div>
                      ))}
                    </div>
                  )}
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

          <div style={{ display: isMobile && mobileTab !== "document" ? "none" : "block", overflowY: "auto", padding: isMobile ? "16px" : "24px 28px", minHeight: 0, height: isMobile ? "100%" : "auto" }}>
            <div style={{ background: SURFACE, border: `1px solid ${RULE}`, boxShadow: "0 1px 2px rgba(21,23,30,0.04), 0 10px 30px rgba(21,23,30,0.06)", borderRadius: 16, padding: isMobile ? "22px 20px" : "32px 36px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${RULE}`, paddingBottom: 14, marginBottom: 22 }}>
                <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: ACCENT, display: "flex", alignItems: "center", gap: 8 }}>
                  {policyTitle || "Working draft"}
                  {busy && (
                    <span style={{ color: ACCENT, textTransform: "none", letterSpacing: "normal", fontWeight: 500, fontSize: 11.5, display: "flex", alignItems: "center", gap: 4 }}>
                      <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> writing…
                    </span>
                  )}
                  {!busy && justEdited && (
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
                    style={{ ...iconBtn(RULE), width: "auto", padding: "0 10px", position: "relative" }}
                  >
                    <History size={14} color={MUTED} />
                    {versions.length > 0 && (
                      <span style={{ fontSize: 10.5, color: MUTED, marginLeft: 5 }}>{versions.length}</span>
                    )}
                  </button>
                  <button className="pc-btn" onClick={printDoc} title="Print" style={iconBtn(RULE)}>
                    <Printer size={14} color={MUTED} />
                  </button>
                  <button className="pc-btn" onClick={download} title="Download as text" style={iconBtn(RULE)}>
                    <Download size={14} color={MUTED} />
                  </button>
                  <button className="pc-btn" onClick={downloadWord} title="Download as Word" style={iconBtn(RULE)} disabled={exportingWord}>
                    {exportingWord ? <Loader2 size={14} color={MUTED} style={{ animation: "spin 1s linear infinite" }} /> : <FileDown size={14} color={MUTED} />}
                  </button>
                  <button className="pc-btn" onClick={() => setShareOpen(true)} title="Share read-only link" style={iconBtn(RULE)}>
                    <Share2 size={14} color={MUTED} />
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    className="pc-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyFormat("bold")}
                    title="Bold selected text"
                    style={{ ...iconBtn(RULE), width: 30 }}
                  >
                    <Bold size={13} color={MUTED} />
                  </button>
                  <button
                    className="pc-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyFormat("italic")}
                    title="Italicize selected text"
                    style={{ ...iconBtn(RULE), width: 30 }}
                  >
                    <Italic size={13} color={MUTED} />
                  </button>
                </div>
                <select
                  value={printTheme}
                  onChange={(e) => setPrintTheme(e.target.value)}
                  title="Print & export style"
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${RULE}`, background: SURFACE, color: INK, fontSize: 12, cursor: "pointer" }}
                >
                  {PRINT_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label} style
                    </option>
                  ))}
                </select>
                <select
                  value={docFont}
                  onChange={(e) => setDocFont(e.target.value)}
                  title="Font"
                  style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${RULE}`, background: SURFACE, color: INK, fontSize: 12, cursor: "pointer", fontFamily: currentFont.family }}
                >
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                ref={docEditableRef}
                className="pc-docedit"
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditableInput}
                spellCheck={true}
                style={{
                  whiteSpace: "pre-wrap",
                  fontFamily: currentFont.family,
                  fontSize: currentTheme.compact ? 13 : 14,
                  lineHeight: currentTheme.compact ? 1.5 : 1.8,
                  color: INK,
                  margin: 0,
                  width: "100%",
                  minHeight: 420,
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  padding: 0,
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: MUTED, marginTop: 12 }}>
              {isMobile
                ? "Tap into the document to fix small things. Use the Chat tab for bigger rewrites. Everything saves automatically."
                : "Click directly into the document to fix small things. Use chat on the left for bigger rewrites. Everything saves automatically."}
              {" "}Select text and use Bold/Italic above to format it — changes appear immediately and carry through to print and export.
            </p>
          </div>
          </div>
        </div>
      )}

      {shareOpen && (
        <div
          onClick={() => setShareOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(21,23,30,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 420, maxWidth: "100%", background: SURFACE, borderRadius: 16, padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 500 }}>Share read-only link</span>
              <button className="pc-btn" onClick={() => setShareOpen(false)} style={iconBtn(RULE)}>
                <X size={14} color={MUTED} />
              </button>
            </div>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 16 }}>
              Anyone with this link can view "{policyTitle}" — they can't edit it or sign in to your account.
            </p>
            {!shareToken ? (
              <button
                className="pc-btn"
                onClick={generateShareLink}
                disabled={shareBusy}
                style={{ padding: "11px 18px", background: ACCENT, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: shareBusy ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}
              >
                {shareBusy ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Share2 size={14} />}
                Create link
              </button>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/shared/${shareToken}`}
                    style={{ flex: 1, padding: "10px 12px", border: `1.5px solid ${RULE}`, borderRadius: 8, background: PAPER, fontSize: 12.5, color: INK }}
                  />
                  <button
                    className="pc-btn"
                    onClick={copyShareLink}
                    style={{ padding: "0 14px", background: shareCopied ? "#2E9B5F" : ACCENT, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500 }}
                  >
                    {shareCopied ? <Check size={13} /> : <Copy size={13} />}
                    {shareCopied ? "Copied" : "Copy"}
                  </button>
                </div>
                <button
                  className="pc-btn"
                  onClick={revokeShareLink}
                  disabled={shareBusy}
                  style={{ fontSize: 12.5, color: "#C0392B", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  Revoke this link
                </button>
              </>
            )}
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
              <button className="pc-btn" onClick={() => setHistoryOpen(false)} style={iconBtn(RULE)}>
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
  const [sharedToken, setSharedToken] = useState(null);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/shared\/(.+)$/);
    if (match) setSharedToken(match[1]);
  }, []);

  if (sharedToken) {
    return <SharedPolicyView token={sharedToken} />;
  }

  return (
    <>
      <SignedOut>
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: LIGHT.PAPER,
            fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif",
          }}
        >
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@200;300;400;500;600&display=swap');`}</style>
          <div style={{ textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 28 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: LIGHT.ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={16} color="#fff" strokeWidth={2} />
              </div>
              <span style={{ fontSize: 19, fontWeight: 300, color: LIGHT.INK }}>Policy Editor</span>
            </div>
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>
      <SignedIn>
        {/* Subscription paywall temporarily disabled for testing.
            Swap the line below back to <SubscriptionGate /> once Stripe is fully set up. */}
        <PolicyApp />
      </SignedIn>
    </>
  );
}

function SubscriptionGate() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState("checking"); // checking | active | inactive | error
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  async function authedFetch(url, options = {}) {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: token ? `Bearer ${token}` : "" },
    });
  }

  const checkStatus = useCallback(async () => {
    try {
      const res = await authedFetch("/api/subscription-status");
      const data = await res.json();
      setStatus(data.active ? "active" : "inactive");
    } catch (e) {
      setStatus("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // If we just came back from a successful Stripe checkout, the webhook may take
  // a few seconds to arrive — recheck a handful of times rather than showing
  // "not subscribed" prematurely.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      checkStatus();
      if (attempts >= 6) clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCheckout() {
    setCheckoutLoading(true);
    try {
      const res = await authedFetch("/api/create-checkout-session", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setCheckoutLoading(false);
      }
    } catch (e) {
      setCheckoutLoading(false);
    }
  }

  async function openBillingPortal() {
    setPortalLoading(true);
    try {
      const res = await authedFetch("/api/create-portal-session", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setPortalLoading(false);
      }
    } catch (e) {
      setPortalLoading(false);
    }
  }

  if (status === "checking") {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: LIGHT.PAPER }}>
        <Loader2 size={20} color={LIGHT.MUTED} style={{ animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (status === "active") {
    return <PolicyApp onOpenBilling={openBillingPortal} billingLoading={portalLoading} />;
  }

  const justCancelled = new URLSearchParams(window.location.search).get("checkout") === "cancelled";

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: LIGHT.PAPER,
        fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif",
        padding: 20,
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@200;300;400;500;600&display=swap'); @keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: LIGHT.ACCENT, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <FileText size={22} color="#fff" strokeWidth={2} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 300, color: LIGHT.INK, margin: "0 0 8px" }}>Subscribe to Policy Editor</h1>
        <p style={{ fontSize: 13.5, color: LIGHT.MUTED, lineHeight: 1.6, margin: "0 0 24px" }}>
          {justCancelled
            ? "No charge was made. Subscribe below whenever you're ready."
            : "Unlimited policy rewrites, version history, and secure storage for your practice."}
        </p>
        <button
          onClick={startCheckout}
          disabled={checkoutLoading}
          style={{
            width: "100%",
            padding: "13px 20px",
            background: LIGHT.ACCENT,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: checkoutLoading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {checkoutLoading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {checkoutLoading ? "Redirecting…" : "Subscribe"}
        </button>
        {status === "error" && (
          <p style={{ fontSize: 12, color: "#C0392B", marginTop: 14 }}>
            Couldn't check your subscription status. Try refreshing the page.
          </p>
        )}
      </div>
    </div>
  );
}

function SharedPolicyView({ token }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [policy, setPolicy] = useState(null);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    fetch(`/api/shared?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "This link isn't valid.");
        }
        return res.json();
      })
      .then((data) => {
        setPolicy(data);
        setStatus("ready");
      })
      .catch((e) => {
        setErrMsg(e.message);
        setStatus("error");
      });
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: LIGHT.PAPER, fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif", padding: "40px 20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Lexend:wght@200;300;400;500;600&display=swap');`}</style>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: LIGHT.ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileText size={13} color="#fff" strokeWidth={2} />
          </div>
          <span style={{ fontSize: 13, color: LIGHT.MUTED }}>Shared via Policy Editor</span>
        </div>

        {status === "loading" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: LIGHT.MUTED, fontSize: 13.5 }}>
            <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Loading…
          </div>
        )}

        {status === "error" && (
          <div style={{ border: "1.5px solid #F1B0A8", background: "#FDF1EF", borderRadius: 14, padding: "20px 22px" }}>
            <p style={{ fontSize: 13.5, color: "#A13B2E", margin: 0 }}>{errMsg}</p>
          </div>
        )}

        {status === "ready" && (
          <div style={{ background: LIGHT.SURFACE, border: `1px solid ${LIGHT.RULE}`, borderRadius: 16, padding: "32px 36px", boxShadow: "0 1px 2px rgba(21,23,30,0.04), 0 10px 30px rgba(21,23,30,0.06)" }}>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: LIGHT.ACCENT, marginBottom: 20, paddingBottom: 14, borderBottom: `1px solid ${LIGHT.RULE}` }}>
              {policy.title}
            </div>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.8, color: LIGHT.INK, margin: 0, fontFamily: "'Lexend', 'Inter', -apple-system, sans-serif" }}>
              {policy.document}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const PRINT_THEMES = [
  { id: "classic", label: "Classic", fontSize: 12, headerAlign: "center" },
  { id: "modern", label: "Modern", fontSize: 11, headerAlign: "left" },
  { id: "compact", label: "Compact", fontSize: 10, headerAlign: "left", compact: true },
];

const FONTS = [
  { id: "georgia", label: "Georgia", family: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", family: "'Times New Roman', Times, serif" },
  { id: "cambria", label: "Cambria", family: "Cambria, Georgia, serif" },
  { id: "arial", label: "Arial", family: "Arial, Helvetica, sans-serif" },
  { id: "helvetica", label: "Helvetica", family: "Helvetica, Arial, sans-serif" },
  { id: "calibri", label: "Calibri", family: "Calibri, Candara, Arial, sans-serif" },
  { id: "verdana", label: "Verdana", family: "Verdana, Geneva, sans-serif" },
  { id: "courier", label: "Courier New", family: "'Courier New', Courier, monospace" },
];

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Converts our simple **bold** / *italic* markers into real <strong>/<em> tags.
// Input is escaped first so this never introduces any injected HTML beyond
// the strong/em tags we add ourselves.
function markdownLiteToHtml(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return html;
}

// Splits a line of text into an array of { text, bold, italic } runs based on
// the same **bold** / *italic* markers, for building a Word document.
function markdownLiteToRuns(line) {
  const runs = [];
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: line.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      runs.push({ text: match[2], bold: true });
    } else if (match[3]) {
      runs.push({ text: match[4], italics: true });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    runs.push({ text: line.slice(lastIndex) });
  }
  return runs.length ? runs : [{ text: line }];
}

function iconBtn(ruleColor) {
  return {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: `1px solid ${ruleColor}`,
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
}
