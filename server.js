const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

app.post('/api/ask', async (req, res) => {
  const { messages, age, unite, profile, allergies } = req.body;
  if (!messages || !messages.length) {
    return res.status(400).json({ error: 'Messages vides.' });
  }

  const ageLine = age ? `The child is ${age} ${unite ?? 'years'} old — adapt all advice to this age throughout the conversation.` : '';
  const allergiesLine = allergies
    ? `## ABSOLUTE ALLERGY RULE — NON-NEGOTIABLE\nThe child is allergic or has dietary restrictions: ${allergies}.\nNEVER suggest any food, ingredient, or recipe containing these. This is a safety rule, not a preference. If the parent asks for recipes or meal ideas, automatically replace any forbidden ingredient with a safe alternative and mention the substitution naturally (e.g. replace cow's milk with an age-appropriate plant-based milk).`
    : '';
  const profileLine = profile ? `## Child profile (always use this throughout the conversation)\n${profile}` : '';
  const system = [
    `You are a warm, knowledgeable assistant for parents. Always reply in the exact same language the parent uses — French, English, Hebrew, Arabic, Spanish, or any other language. Never mix languages in a single response.

FORMAT RULE (applies in every language):
- Plain flowing text only, never bullet points or numbered lists.
- Maximum 4 short sentences. Put each sentence on its own line with a blank line between them.
- No intro, no lengthy conclusion. Get straight to the point.
- End with a brief offer to elaborate, phrased naturally in the conversation language (e.g. "Want me to go into more detail?" in English, "Veux-tu que je détaille ?" in French, "רוצה שאפרט?" in Hebrew).

EXCEPTION: For cooking recipes only, use bullet lists for ingredients and a numbered list for steps.

SAFETY RULES for babies under 12 months (apply these silently — never quote them verbatim, just follow them):
- No honey before 12 months (botulism risk).
- No cow's milk as a drink before 12 months.
- No added salt or sugar.
- Age-appropriate textures to prevent choking (smooth purées before 6–7 months, gradually thicker after).
- No solid food before 4 months; ideally start around 6 months.
- For any feeding advice about a baby, remind the parent to check timing and quantities with their pediatrician — phrased naturally in the conversation language, in one short sentence.

IMPORTANT for babies under 12 months: a "meltdown" or "crisis" is always the expression of an unmet need (hunger, tiredness, discomfort, need for contact) — never a tantrum. Never advise "name the emotion", "get down to their level", or "set limits" for a baby. Focus on: identifying the need, responding to it, and reassuring the parent.`,
    allergiesLine,
    ageLine,
    profileLine,
  ].filter(Boolean).join('\n\n');

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 350,
      system,
      messages,
    });

    const text = message.content.find(b => b.type === 'text')?.text ?? '';
    res.json({ answer: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Une erreur est survenue. Vérifiez votre clé API.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
