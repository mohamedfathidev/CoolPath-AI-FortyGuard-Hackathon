import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.7-flash";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: "Reply with exactly: CoolPath Gemini connection OK",
  });

  console.log(`Model: ${MODEL}`);
  console.log("Response:", response.text);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Gemini test failed:", err);
    process.exit(1);
  });
