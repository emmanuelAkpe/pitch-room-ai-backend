import OpenAI, { toFile } from 'openai';
import { PERSONAS, evalInstruction } from './personas.js';

let _openai = null;
const openai = () => {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
};

async function withRetry(fn, retries = 3, delayMs = 600) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
}

function mimeToExt(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

export async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  const ext = mimeToExt(mimeType);
  const cleanType = mimeType.split(';')[0];
  return withRetry(async () => {
    const file = await toFile(audioBuffer, `audio.${ext}`, { type: cleanType });
    const result = await openai().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });
    return result.text?.trim() || '';
  });
}

export async function generatePiaResponse(userText, history, mode, startupName) {
  const persona = PERSONAS[mode] || PERSONAS.vc;

  const messages = [
    {
      role: 'system',
      content: `${persona.systemPrompt}\n\nThe startup being pitched is called: "${startupName || 'an unnamed startup'}".\n${evalInstruction()}`,
    },
    ...history,
    { role: 'user', content: userText },
  ];

  return withRetry(async () => {
    const completion = await openai().chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.65,
      max_tokens: 130,
    });

    const raw = completion.choices[0].message.content || '';
    const evalMatch = raw.match(/\[EVAL:(\{[^}]+\})\]/);
    let scores = null;
    const spokenText = raw.replace(/\[EVAL:[^\]]+\]/g, '').trim();

    if (evalMatch) {
      try { scores = JSON.parse(evalMatch[1]); } catch {}
    }

    return { spokenText, scores };
  });
}

export async function synthesizeSpeech(text, voice = 'onyx') {
  return withRetry(async () => {
    const response = await openai().audio.speech.create({
      model: 'tts-1',
      voice,
      input: text,
      response_format: 'mp3',
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  });
}

export async function generateFinalReport(session) {
  const transcript = session.transcript
    .map(e => `${e.speaker === 'user' ? 'Founder' : 'Investor'}: ${e.text}`)
    .join('\n');

  return withRetry(async () => {
    const completion = await openai().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a senior VC partner conducting a rigorous post-pitch analysis. Be specific, honest, and grounded in evidence from the actual conversation. Do not be generous — founders need real feedback.',
        },
        {
          role: 'user',
          content: `Analyze this pitch transcript and return valid JSON with exactly these fields:

- summary: 2-3 sentence factual summary of what was pitched and how the session went
- reasoning: 2-3 sentences explaining your investment decision in first-person investor voice, citing 1-2 specific moments from the pitch (e.g. "I'm passing because when I pressed on TAM the founder couldn't provide a bottom-up number..." or "This is a strong pass — the founder cited specific enterprise pilot data...")
- strengths: array of exactly 3 specific strength strings, each starting with an action verb citing something from the actual pitch (e.g. "Demonstrated clear understanding of...", "Articulated a compelling...")
- improvements: array of exactly 3 specific improvement strings, each starting with an action verb (e.g. "Quantify the TAM with bottom-up numbers...", "Clarify how you defend against...")
- scores: object with keys problem_clarity, value_proposition, market_size, competitors, monetization, go_to_market, defensibility, founder_credibility — each 0-100

SCORING CALIBRATION — be realistic, not encouraging:
- 0–20: Completely unaddressed or deeply flawed
- 21–40: Mentioned but vague, no evidence
- 41–60: Adequate but generic
- 61–75: Good — specific and believable
- 76–90: Strong — backed by data
- 91–100: Exceptional — rare

- overall_score: weighted average 0-100

VERDICT CALIBRATION — choose strictly:
- "Strong Pass": overall ≥ 78 AND no single score below 55 — would write a check today
- "Soft Pass": overall ≥ 62 — interested but needs work before investing
- "Consider": overall ≥ 45 — interesting kernel but significant gaps remain
- "Pass": overall < 45 — not ready, come back in 6 months

- recommendation: one of "Strong Pass", "Soft Pass", "Consider", "Pass"

- action_plan: array of exactly 3 objects, each with:
    - dimension: exact score key (e.g. "market_size") — pick the 3 lowest-scoring dimensions
    - title: 4-7 word coaching headline (specific and actionable)
    - drill: 2-3 sentence concrete practice exercise the founder can do before their next pitch

Do NOT inflate scores to be encouraging. Real VCs pass 99% of pitches. Return ONLY valid JSON, no markdown fences.

Transcript:
${transcript}`,
        },
      ],
    });

    try {
      const text = completion.choices[0].message.content || '{}';
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);

      // Always compute verdict from the actual score — never trust AI's recommendation
      const overall = parsed.overall_score || 0;
      const dimScores = Object.values(parsed.scores || {});
      const minDim = dimScores.length ? Math.min(...dimScores) : 0;
      if (overall >= 78 && minDim >= 55) {
        parsed.recommendation = 'Strong Pass';
      } else if (overall >= 62) {
        parsed.recommendation = 'Soft Pass';
      } else if (overall >= 45) {
        parsed.recommendation = 'Consider';
      } else {
        parsed.recommendation = 'Pass';
      }

      return parsed;
    } catch {
      return null; // let caller handle fallback
    }
  }).catch(() => ({
    summary: 'Session completed. Full analysis could not be generated.',
    reasoning: 'There was not enough transcript data to produce a detailed investment thesis.',
    strengths: [
      'Completed the pitch session under pressure',
      'Engaged with investor questions directly',
      'Demonstrated initiative by practicing',
    ],
    improvements: [
      'Provide specific market size numbers with a bottom-up calculation',
      'Strengthen your competitive moat — explain why you cannot be replicated',
      'Clarify your monetization model with a specific price point',
    ],
    scores: session.scores,
    overall_score: 35,
    recommendation: 'Pass',
    action_plan: [
      {
        dimension: 'market_size',
        title: 'Build a bottom-up market case',
        drill: 'Research three comparable companies and calculate TAM from their disclosed metrics. Practice stating market size in two ways: total addressable market and serviceable obtainable market with specific numbers.',
      },
      {
        dimension: 'monetization',
        title: 'Define your revenue model precisely',
        drill: 'Write your pricing in one sentence with a specific dollar figure and justify why. Practice delivering it in under 30 seconds including the rationale.',
      },
      {
        dimension: 'defensibility',
        title: 'Articulate your competitive moat',
        drill: 'List three reasons a well-funded competitor cannot replicate you in 18 months. Practice the "why us, why now" answer in under 60 seconds with hard evidence.',
      },
    ],
  }));
}
