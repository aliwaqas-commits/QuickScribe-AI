// Import the Google AI SDK and a simple in-memory cache for rate-limiting
const { GoogleGenerativeAI } = require("@google/generative-ai");
const LRUCache = require("lru-cache");

// --- CONFIGURATION ---

// 1. Get your API key from Vercel Environment Variables
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. Rate Limiting: 5 requests per IP per 10 minutes. This is CRITICAL.
// This cache will hold 500 IPs for 10 minutes.
const ipCache = new LRUCache({
  max: 500,
  ttl: 10 * 60 * 1000, // 10 minutes
});
const RATE_LIMIT_COUNT = 5;

// 3. The AI Prompt
const PROMPT = "You are an expert summarizer. Analyze the following text and provide a concise, accurate summary. Use clear language and focus on the main points. Format the output as clean text.\n\nHere is the text:\n";

// --- THE SERVERLESS FUNCTION ---

export default async function handler(request, response) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  // --- 1. Abuse & Rate-Limit Check ---
  // Get the user's IP address from Vercel headers
  const ip = request.headers['x-forwarded-for'] || '127.0.0.1';
  const ipCount = (ipCache.get(ip) || 0) + 1;
  
  ipCache.set(ip, ipCount);

  if (ipCount > RATE_LIMIT_COUNT) {
    return response.status(429).json({ error: 'Too many requests. Please try again in 10 minutes.' });
  }

  // --- 2. Get Text & Validate ---
  const { text } = request.body;
  if (!text || typeof text !== 'string' || text.length < 50) {
    return response.status(400).json({ error: 'Invalid text. Min 50 characters required.' });
  }
  if (text.length > 30000) { // Protect your costs
    return response.status(413).json({ error: 'Text too large. Max 30,000 characters.' });
  }

  // --- 3. Call the AI API (Securely) ---
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest"});
    const fullPrompt = PROMPT + text;

    const result = await model.generateContent(fullPrompt);
    const aiResponse = await result.response;
    const summary = aiResponse.text();

    return response.status(200).json({ summary: summary });

  } catch (error) {
    console.error("AI API Error:", error);
    // Handle specific Google API errors (e.g., safety blocks)
    if (error.response && error.response.candidates === 0) {
      return response.status(400).json({ error: 'Content was blocked by safety filters.' });
    }
    return response.status(500).json({ error: 'Failed to generate summary.' });
  }
}
