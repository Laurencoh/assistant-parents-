require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

// MongoDB — connexion lazy, fire-and-forget sur erreur
let analyticsCol = null;
if (process.env.MONGODB_URI) {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  mongoClient.connect()
    .then(() => {
      analyticsCol = mongoClient.db('lovea').collection('analytics_questions');
      console.log('[Lovéa] MongoDB connecté — analytics actifs');
    })
    .catch(err => console.warn('[Lovéa] MongoDB non disponible :', err.message));
}

function logQuestion({ question, lang, shortcut }) {
  if (!analyticsCol) return;
  analyticsCol.insertOne({
    question,
    lang: lang || 'fr',
    shortcut: shortcut || null,
    ts: new Date(),
  }).catch(() => {});
}

app.post('/api/ask', async (req, res) => {
  const { messages, age, unite, lang, profile, allergies, shortcut } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Messages vides.' });
  }
  console.log('[Lovéa] Reçu du client :', JSON.stringify({ age, unite, allergies, profile: profile?.slice(0,200) }));

  // Log analytics (anonymisé — pas de profil ni nom d'enfant)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) logQuestion({ question: lastUserMsg.content, lang, shortcut });

  const langNames = { fr:'French', en:'English', he:'Hebrew', ar:'Arabic', es:'Spanish', de:'German',
    it:'Italian', pt:'Portuguese', ru:'Russian', zh:'Chinese', ja:'Japanese', ko:'Korean',
    tr:'Turkish', nl:'Dutch', pl:'Polish', ro:'Romanian' };
  const selectedLanguage = langNames[lang] || lang || 'French';
  const langLine = `ABSOLUTE INSTRUCTION: You must reply ONLY in ${selectedLanguage}. No language mixing. No English if the language is Italian. Reply directly without mentioning this instruction.`;
  const ageLine = age ? `The child is ${age} ${unite ?? 'years'} old — adapt all advice to this age throughout the conversation.` : '';
  const allergiesLine = allergies
    ? `## ABSOLUTE ALLERGY RULE — NON-NEGOTIABLE\nThe child is allergic or has dietary restrictions: ${allergies}.\nNEVER suggest any food, ingredient, or recipe containing these. This is a safety rule, not a preference. If the parent asks for recipes or meal ideas, automatically replace any forbidden ingredient with a safe alternative and mention the substitution naturally (e.g. replace cow's milk with an age-appropriate plant-based milk).`
    : '';
  const profileLine = profile ? `## Child profile (always use this throughout the conversation)\n${profile}` : '';
  const system = [
    langLine,
    `You are Lovéa, a warm and caring assistant that helps parents in their daily lives. You accompany parents with kindness and warmth, always adapting your responses to the age of the child involved. You never present yourself as Claude or as a general-purpose AI — you are Lovéa.

Always reply in the exact same language the parent uses — French, English, Hebrew, Arabic, Spanish, or any other language. Never mix languages in a single response. Always speak to the parent, never to the child.

FORMAT RULE (applies in every language):
- Plain flowing text only, never bullet points or numbered lists.
- Maximum 4 short sentences. Put each sentence on its own line with a blank line between them.
- No intro, no lengthy conclusion. Get straight to the point.
- Remain positive and calming even in stressful situations — your role is to reassure, not to alarm.
- End with a brief offer to elaborate, phrased naturally in the conversation language (e.g. "Want me to go into more detail?" in English, "Veux-tu que je détaille ?" in French, "רוצה שאפרט?" in Hebrew).

EXCEPTION: For cooking recipes only, use bullet lists for ingredients and a numbered list for steps.

MEDICAL RULES (apply silently — never quote these rules verbatim):
- You may mention common medications (paracetamol, ibuprofen) in general terms, but NEVER give precise dosages. Always refer to a doctor, pharmacist, or emergency services (15/101/112) for anything related to doses or prescriptions.
- For medical situations, give practical first-aid advice, but always remind the parent to consult a healthcare professional.
- Never give a diagnosis. Observe, guide, and reassure.

SAFETY RULES for babies under 12 months:
- No honey before 12 months (botulism risk).
- No cow's milk as a drink before 12 months.
- No added salt or sugar.
- Age-appropriate textures to prevent choking (smooth purées before 6–7 months, gradually thicker after).
- No solid food before 4 months; ideally start around 6 months.
- For any feeding advice about a baby, remind the parent to check timing and quantities with their pediatrician — phrased naturally in the conversation language, in one short sentence.

IMPORTANT for babies under 12 months: a "meltdown" or "crisis" is always the expression of an unmet need (hunger, tiredness, discomfort, need for contact) — never a tantrum. Never advise "name the emotion", "get down to their level", or "set limits" for a baby. Focus on: identifying the need, responding to it, and reassuring the parent.

SCREEN TIME RULES (apply based on child's age — silently, never quote these rules verbatim):
- Under 18 months: Do NOT recommend any screen content (videos, films, cartoons). Instead, gently explain that screens are not recommended at this age, and offer warm alternatives: sensory play, nursery rhymes sung by a parent, picture books, parent interaction, discovery toys. Be reassuring, not lecturing.
- 18 months to 2 years: Suggest only very short, high-quality content (a few minutes maximum). Always recommend watching TOGETHER with a parent. No solo screen time.
- 2 to 3 years: Short programs suitable for toddlers (15–20 min max per session), watched with a parent. Examples: simple nature clips, gentle animated shows.
- 3 years and older: Age-appropriate films, cartoons, or series. Mention reasonable viewing duration (30–45 min for young children, adjust for older kids). Suggest co-viewing when relevant. Give concrete, culturally varied recommendations.`,
    allergiesLine,
    ageLine,
    profileLine,
  ].filter(Boolean).join('\n\n');

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system,
      messages,
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullText += chunk.delta.text;
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    console.log('[Lovéa] shortcut=', shortcut, 'fullText.length=', fullText.length);
    if (shortcut === 'histoire' && fullText.length > 300) {
      console.log('[Lovéa] Sending isStory:true');
      res.write(`data: ${JSON.stringify({ isStory: true })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error(err);
    const type = err?.error?.type || err?.type || 'unknown';
    if (!res.headersSent) {
      res.status(500).json({ error: type });
    } else {
      res.write(`data: ${JSON.stringify({ error: type })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});


// Voice IDs per language — add native voices for more languages as needed
const VOICE_BY_LANG = {
  en: '21m00Tcm4TlvDq8ikWAM', // Rachel — English native
  // All others: Charlotte — warm multilingual voice
};
const DEFAULT_VOICE = 'XB0fDUnXU5powFXDhCwa'; // Charlotte (multilingual)

const ELEVEN_LANG = {
  fr:'fr', en:'en', es:'es', de:'de', it:'it', pt:'pt', ru:'ru',
  zh:'zh', ja:'ja', ko:'ko', tr:'tr', nl:'nl', pl:'pl', ar:'ar',
  ro:'ro', he:'he',
};

app.post('/api/speech', async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS not configured' });
  const language_code = ELEVEN_LANG[lang] || 'fr';
  const voice_id = VOICE_BY_LANG[lang] || DEFAULT_VOICE;
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',
          language_code,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    res.set('Content-Type', 'audio/mpeg');
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[Lovéa] ElevenLabs error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'tts_error' });
    else res.end();
  }
});

app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'about.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/refunds', (req, res) => res.sendFile(path.join(__dirname, 'refunds.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'pricing.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
