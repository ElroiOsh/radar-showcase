import "dotenv/config";

const key = (process.env.GEMINI_API_KEY || "").trim();
console.log("key present:", Boolean(key));
console.log("key length:", key.length);
console.log("starts AIza:", key.startsWith("AIza"));
console.log("model env:", process.env.GEMINI_MODEL || "(none)");

if (!key) process.exit(1);

const models = ["gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-flash-latest"];

for (const model of models) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: 'Return JSON only: {"ok":true}' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 32 },
    }),
  });
  const body = await res.text();
  console.log(model, "→", res.status, body.slice(0, 180).replace(/\s+/g, " "));
}
