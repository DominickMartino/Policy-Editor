export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { policyDoc, ask } = req.body || {};
  if (!policyDoc || !ask) {
    return res.status(400).json({ error: "Missing policyDoc or ask" });
  }

  const system = `You help office managers at small healthcare practices rewrite internal policy documents. You are given the CURRENT policy document and a requested change. Respond in EXACTLY this format, with no markdown fences and nothing before or after it:

REPLY: <one or two sentences confirming what you changed, plain friendly language>
===FLAGS===
<Either the single word "None", or a short bullet list (one per line, starting with "- ") of things in the RESULTING document that commonly vary by state/local law or are worth a practice double-checking with a professional \u2014 e.g. fee caps, required disclosures, minor-consent rules, notice periods. Keep each bullet under 20 words. This is informational only, not legal advice, and should never claim certainty about what the law requires.>
===DOCUMENT===
<the FULL updated policy document text, complete, not truncated or summarized>

Rules: Always reproduce the ENTIRE document in the DOCUMENT section, not just the changed part. Keep the document's original structure and any details the user didn't ask to change. Make only the requested changes plus anything grammatically necessary. Plain professional language. Never add patient-identifiable information. Only include a flag if it's genuinely relevant to what's in the document \u2014 don't invent generic filler flags.`;

  const userMsg = `CURRENT POLICY DOCUMENT:\n---\n${policyDoc}\n---\n\nREQUESTED CHANGE: ${ask}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "Upstream error" });
    }

    const data = await response.json();
    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const flagsIdx = raw.indexOf("===FLAGS===");
    const docIdx = raw.indexOf("===DOCUMENT===");
    if (flagsIdx === -1 || docIdx === -1) {
      return res.status(502).json({ error: "Unexpected response shape" });
    }
    const reply = raw.slice(0, flagsIdx).replace(/^REPLY:\s*/i, "").trim();
    const flagsRaw = raw.slice(flagsIdx + "===FLAGS===".length, docIdx).trim();
    const document = raw.slice(docIdx + "===DOCUMENT===".length).trim();

    const flags =
      !flagsRaw || /^none$/i.test(flagsRaw)
        ? []
        : flagsRaw
            .split("\n")
            .map((l) => l.replace(/^-\s*/, "").trim())
            .filter(Boolean);

    if (!document) {
      return res.status(502).json({ error: "Empty document returned" });
    }

    return res.status(200).json({ reply, document, flags });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
