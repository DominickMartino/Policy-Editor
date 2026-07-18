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

Rules: Always reproduce the ENTIRE document in the DOCUMENT section, not just the changed part. Keep the document's original structure and any details the user didn't ask to change. Make only the requested changes plus anything grammatically necessary. Plain professional language. Never add patient-identifiable information. Only include a flag if it's genuinely relevant to what's in the document \u2014 don't invent generic filler flags. The document may contain simple formatting markers: **text** means bold, *text* means italic. Preserve these markers exactly as they appear unless the user's request would naturally change them. If the user asks to bold, italicize, or emphasize something, add the appropriate ** or * markers around that text.`;

  const userMsg = `CURRENT POLICY DOCUMENT:\n---\n${policyDoc}\n---\n\nREQUESTED CHANGE: ${ask}`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
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
        stream: true,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      console.error("Anthropic API error:", errText);
      return res.status(502).json({ error: "Upstream error" });
    }

    // Stream plain text chunks straight through to the browser as they arrive,
    // instead of waiting for the whole response to finish.
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep the last, possibly incomplete line for next time

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            res.write(evt.delta.text);
          }
        } catch (e) {
          // Ignore any line that isn't valid JSON (shouldn't normally happen)
        }
      }
    }

    res.end();
  } catch (e) {
    console.error("Server error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error" });
    } else {
      res.end();
    }
  }
}
