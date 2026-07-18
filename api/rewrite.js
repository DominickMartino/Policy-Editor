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
===DOCUMENT===
<the FULL updated policy document text, complete, not truncated or summarized>

Rules: Always reproduce the ENTIRE document in the DOCUMENT section, not just the changed part. Keep the document's original structure and any details the user didn't ask to change. Make only the requested changes plus anything grammatically necessary. Plain professional language. Never add patient-identifiable information.`;

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

    const splitIdx = raw.indexOf("===DOCUMENT===");
    if (splitIdx === -1) {
      return res.status(502).json({ error: "Unexpected response shape" });
    }
    const reply = raw.slice(0, splitIdx).replace(/^REPLY:\s*/i, "").trim();
    const document = raw.slice(splitIdx + "===DOCUMENT===".length).trim();

    if (!document) {
      return res.status(502).json({ error: "Empty document returned" });
    }

    return res.status(200).json({ reply, document });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
