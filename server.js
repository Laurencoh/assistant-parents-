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
let conversationsCol = null;
if (process.env.MONGODB_URI) {
  const mongoClient = new MongoClient(process.env.MONGODB_URI);
  mongoClient.connect()
    .then(() => {
      const db = mongoClient.db('lovea');
      analyticsCol = db.collection('analytics_questions');
      conversationsCol = db.collection('conversations');
      conversationsCol.createIndex({ sessionId: 1 }, { unique: true }).catch(() => {});
      console.log('[Lovéa] MongoDB connecté — analytics + conversations actifs');
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

  const ageLine = age ? `The child is ${age} ${unite ?? 'years'} old — adapt all advice to this age throughout the conversation.` : '';
  const allergiesLine = allergies
    ? `## ABSOLUTE ALLERGY RULE — NON-NEGOTIABLE\nThe child is allergic or has dietary restrictions: ${allergies}.\nNEVER suggest any food, ingredient, or recipe containing these. This is a safety rule, not a preference. If the parent asks for recipes or meal ideas, automatically replace any forbidden ingredient with a safe alternative and mention the substitution naturally (e.g. replace cow's milk with an age-appropriate plant-based milk).`
    : '';
  const profileLine = profile ? `## Child profile (always use this throughout the conversation)\n${profile}` : '';

  const filmFormatLine = shortcut === 'film' ? `
FORMAT RULE FOR THIS MESSAGE — FILM/SERIES MODE (overrides the general format rule):
Recommend one film or series adapted to the child's age. Reply in the exact same language the parent used. Use the child's first name if known from their profile, otherwise use a generic term. Use this exact structure, translated into that language:

🎬 **[Film/series title]**
⭐ [Translated "Rating:"] [X/5] | ⏱️ [Translated "Duration:"] [X min] | 👶 [Translated "From age"] [age]

**[Translated "What it's about:"]**
[2-3 sentences of simple summary]

**[Translated "Why it's great for"] [child's name or "your child"]:**
[One sentence on the values or what it brings]

⚠️ **[Translated "Points to note:"]** [What might need a discussion with the child]
🍿 **[Translated "Best watched:"]** [Alone / As a family / With parents]

Rules: adapt age rating and content warnings to the child's actual age. No offer to elaborate at the end.` : '';

  const conseilFormatLine = shortcut === 'conseil' ? `
FORMAT RULE FOR THIS MESSAGE — ACTIVITY MODE (overrides the general format rule):
Generate one activity idea adapted to the child's age. Reply in the exact same language the parent used. Use this exact structure, translated into that language:

🎨 **[Activity name]**
⏱️ [Translated "Duration:"] [X minutes] | 👶 [Translated "Suitable from"] [age] | 📍 [Translated "Indoor" or "Outdoor"]

**[Translated "What you need:"]**
- [material 1]
- [material 2]
...

**[Translated "How to:"]**
1. [Step 1]
2. [Step 2]
3. [Step 3]
...

🧠 **[Translated "What it develops:"]** [skill or benefit]
💡 **[Translated "Variation:"]** [One way to vary the activity]

Rules: adapt age, duration, and materials to the child's actual age. No offer to elaborate at the end.` : '';

  const sommeilFormatLine = shortcut === 'sommeil' ? `
FORMAT RULE FOR THIS MESSAGE — BEDTIME ROUTINE MODE (overrides the general format rule):
Generate a calming bedtime routine adapted to the child's age. Reply in the exact same language the parent used. Use this exact structure, translated into that language. Use the child's first name if known from their profile, otherwise use a generic term like "your child":

🌙 **[Translated "Bedtime routine for"] [child's name or "your child"]**
⏰ [Translated "Start at:"] [recommended time]

**[Translated "The routine:"]**
🛁 [Time] — [Activity 1 e.g. bath]
🍼 [Time] — [Activity 2 e.g. light snack]
📖 [Time] — [Activity 3 e.g. story]
💡 [Time] — [Activity 4 e.g. dim lights]
😴 [Time] — [Recommended bedtime]

💡 **[Translated "Tip:"]** [One practical tip to help the child fall asleep]
💛 **[Translated "Avoid:"]** [One thing to avoid before bedtime]

Rules: adapt all times and activities to the child's age. Be specific with clock times. No offer to elaborate at the end.` : '';

  const repasFormatLine = shortcut === 'repas' ? `
FORMAT RULE FOR THIS MESSAGE — RECIPE MODE (overrides the general format rule):
Generate a simple recipe adapted to the child's age. Reply in the exact same language the parent used. Use this exact structure, translated into that language:

🍽️ **[Recipe name]**
⏱️ [Translated "Time:"] [X minutes] | 👶 [Translated "Suitable from"] [age]

**[Translated "Ingredients:"]**
- [ingredient 1]
- [ingredient 2]
- [ingredient 3]
...

**[Translated "Preparation:"]**
1. [Step 1]
2. [Step 2]
3. [Step 3]
...

💡 **[Translated "Tip:"]** [One practical tip for parents]
🌱 **[Translated "Nutritional value:"]** [One simple sentence on health benefits]

Rules: strictly respect all allergies and dietary restrictions from the child's profile. Adapt ingredients and textures to the child's age. No offer to elaborate at the end.` : '';

  const criseFormatLine = shortcut === 'crise' ? `
FORMAT RULE FOR THIS MESSAGE — CRISIS MODE (overrides the general format rule):
A parent is living a crisis with their child right now. Reply in the exact same language the parent used. Use this exact structure, translated into that language:

🫁 **[Translated "Breathe."]** [One short reassuring sentence]

**[Step 1 label] :** [Simple immediate action]
**[Step 2 label] :** [Next action]
**[Step 3 label] :** [Next action]
**[Step 4 label] :** [Next action]

💛 **[Translated "Remember:"]** [One warm, kind sentence for the parent]

Rules: adapt steps to the child's age. Be short, clear, and calming. No long paragraphs. No offer to elaborate at the end.` : '';

  const system = [
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
    filmFormatLine,
    conseilFormatLine,
    sommeilFormatLine,
    repasFormatLine,
    criseFormatLine,
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
    if (shortcut === 'histoire' && fullText.length > 300 && !TTS_UNSUPPORTED.has(lang)) {
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


// Languages with no ElevenLabs TTS support
const TTS_UNSUPPORTED = new Set(['he']);

// Voice IDs per language — add native voices for more languages as needed
const VOICE_BY_LANG = {
  en: '21m00Tcm4TlvDq8ikWAM', // Rachel — English native
  // All others: Charlotte — warm multilingual voice
};
const DEFAULT_VOICE = 'XB0fDUnXU5powFXDhCwa'; // Charlotte (multilingual)

// Languages supported by eleven_turbo_v2_5
const TURBO_LANGS = new Set([
  'en','de','pl','es','it','fr','pt','hi','ar','zh','ja','hu',
  'ko','nl','tr','sv','id','fi','da','no','ru','cs','el','ro',
  'ta','uk','bg','ms','sk','hr','sl','et','lv','lt',
]);

const ELEVEN_LANG = {
  fr:'fr', en:'en', es:'es', de:'de', it:'it', pt:'pt', ru:'ru',
  zh:'zh', ja:'ja', ko:'ko', tr:'tr', nl:'nl', pl:'pl', ar:'ar',
  ro:'ro', he:'he',
};

app.post('/api/speech', async (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  if (TTS_UNSUPPORTED.has(lang)) return res.status(422).json({ error: 'tts_lang_unsupported' });
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS not configured' });
  const language_code = ELEVEN_LANG[lang] || 'fr';
  const voice_id = VOICE_BY_LANG[lang] || DEFAULT_VOICE;
  const model_id = TURBO_LANGS.has(lang) ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2';
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
          model_id,
          ...(TURBO_LANGS.has(lang) ? { language_code } : {}),
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

// ── Conversations ──────────────────────────────────────────────
app.post('/api/conversation', async (req, res) => {
  if (!conversationsCol) return res.json({ ok: false });
  const { sessionId, parentName, childName, childAge, theme, messages } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  try {
    const now = new Date();
    const update = {
      $set: {
        parentName: parentName || null,
        childName:  childName  || null,
        childAge:   childAge   || null,
        lastConversation: now,
        messages: (messages || []).slice(-10),
      },
      $setOnInsert: { createdAt: now },
    };
    // Log theme with timestamp (capped at 100 entries) for "this week" filtering
    if (theme) {
      update.$push = { themesLog: { $each: [{ theme, ts: now }], $slice: -100 } };
    }
    await conversationsCol.updateOne({ sessionId }, update, { upsert: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Lovéa] conversation save error:', err.message);
    res.json({ ok: false });
  }
});

app.get('/api/conversation/:sessionId', async (req, res) => {
  if (!conversationsCol) return res.json(null);
  const sessionId = req.params.sessionId.replace(/[^a-z0-9-]/gi, '');
  try {
    const doc = await conversationsCol.findOne({ sessionId }, { projection: { _id: 0 } });
    res.json(doc || null);
  } catch {
    res.json(null);
  }
});

// ── Carte du jour ─────────────────────────────────────────────
app.post('/api/daily', async (req, res) => {
  const { sessionId, childName, childAge, lang, memoire } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Cache hit : retourner la carte du jour si déjà générée aujourd'hui ET mémoire inchangée
  const forceRegen = req.body.forceRegen === true;
  if (!forceRegen && conversationsCol) {
    try {
      const doc = await conversationsCol.findOne({ sessionId }, { projection: { dailyCard: 1, memoireUpdatedAt: 1 } });
      if (doc?.dailyCard?.date === today) {
        const cardGenAt   = doc.dailyCard.generatedAt ? new Date(doc.dailyCard.generatedAt) : null;
        const memoUpdated = doc.memoireUpdatedAt    ? new Date(doc.memoireUpdatedAt)       : null;
        // Invalider le cache si la mémoire a été mise à jour après la génération de la carte
        if (!memoUpdated || !cardGenAt || memoUpdated < cardGenAt) {
          return res.json({ card: doc.dailyCard.card, cached: true });
        }
      }
    } catch {}
  }

  // Construire le contexte personnalisé à partir de la mémoire structurée
  const name   = childName || 'l\'enfant';
  const ageCtx = childAge  ? `${name} a ${childAge}` : `un jeune enfant`;

  const CAT_LABELS = {
    gouts:'Goûts & loisirs', sommeil:'Sommeil', repas:'Alimentation',
    emotions:'Émotions & comportement', progres:'Progrès', difficultes:'Défis', habitudes:'Habitudes',
  };

  const memNorm = (memoire || []).map(m => typeof m === 'string' ? { cat:'habitudes', fait:m } : m).filter(m => m?.fait);

  let memoCtx;
  if (memNorm.length) {
    // Grouper par catégorie pour un contexte structuré
    const grouped = {};
    for (const { cat, fait } of memNorm) {
      const label = CAT_LABELS[cat] || cat;
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(fait);
    }
    memoCtx = `Ce que Lovéa sait déjà de ${name} :\n` +
      Object.entries(grouped).map(([label, faits]) =>
        `• ${label} : ${faits.join(' / ')}`
      ).join('\n');
  } else {
    memoCtx = `Pas encore d'historique pour ${name}. Génère des recommandations adaptées à son âge uniquement.`;
  }

  const langNames = { fr:'français', en:'English', he:'hébreu', ar:'arabe', es:'espagnol', de:'allemand', it:'italien', pt:'portugais', ru:'russe', zh:'chinois', ja:'japonais', ko:'coréen', tr:'turc', nl:'néerlandais', pl:'polonais', ro:'roumain' };
  const langLabel = langNames[lang] || 'français';

  const prompt = `Tu es Lovéa, assistant parental bienveillant.
Génère la carte du jour ENTIÈREMENT PERSONNALISÉE pour ${ageCtx}.

${memoCtx}

RÈGLES DE PERSONNALISATION (obligatoires si la mémoire existe) :
- L'activité doit s'appuyer sur un goût, une habitude ou un trait connu de ${name} — jamais une activité générique
- Le conseil doit répondre à un défi, une émotion ou une difficulté réelle de ${name}
- L'histoire doit correspondre aux centres d'intérêt connus (personnages aimés, thèmes préférés)
- Le focus doit cibler un domaine où ${name} peut progresser selon ce qu'on sait de lui/elle
- "raison" : explique EN DÉTAIL quels souvenirs spécifiques t'ont guidé — nomme les faits exacts utilisés (ex: "Parce que ${name} adore les dinosaures et que les crises arrivent surtout avant le coucher..."). Cette phrase doit être unique à ${name} et incompréhensible pour un autre enfant.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après :
{
  "activite": {
    "emoji": "🎨",
    "titre": "...",
    "duree": "...",
    "lieu": "intérieur" ou "extérieur" ou "partout",
    "description": "2-3 phrases concrètes — adaptées aux goûts et au caractère de ${name}"
  },
  "conseil": "1-2 phrases — répond à une situation réelle de ${name}, pas un conseil générique",
  "histoire": {
    "titre": "Titre d'un livre ou histoire réelle et adaptée",
    "description": "1 phrase expliquant pourquoi CE livre correspond à ${name} spécifiquement"
  },
  "focus": "Un objectif ciblé pour aujourd'hui, basé sur ce qu'on sait de ${name}",
  "raison": "1 phrase courte et directe (max 20 mots). Cite 1 ou 2 souvenirs précis de ${name} qui ont guidé ce choix. Exemple : 'Parce que ${name} adore les dinosaures et préfère les activités calmes le soir.'"
}

Langue de réponse : ${langLabel}.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0]?.text?.trim() || '{}';
    const match = raw.match(/\{[\s\S]*\}/);
    const card = match ? JSON.parse(match[0]) : null;
    if (!card?.activite) return res.status(500).json({ error: 'invalid card' });

    // Sauvegarder dans MongoDB
    if (conversationsCol) {
      await conversationsCol.updateOne(
        { sessionId },
        { $set: { dailyCard: { date: today, card, generatedAt: new Date() } }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      ).catch(() => {});
    }

    res.json({ card, cached: false });
  } catch (err) {
    console.error('[Lovéa] daily error:', err.message);
    res.status(500).json({ error: 'generation_failed' });
  }
});

// ── Mémoire enfant ────────────────────────────────────────────
app.post('/api/memoire', async (req, res) => {
  const { sessionId, messages, existingMemoire, childName, lang } = req.body;
  if (!sessionId || !messages?.length) return res.status(400).json({ error: 'missing data' });

  const name = childName || 'l\'enfant';

  const todayDate = new Date().toISOString().slice(0, 10);

  // Normalise existing memoire : accepte string[] (ancien format) ou {cat,fait,date}[]
  const existingNorm = (existingMemoire || []).map(m =>
    typeof m === 'string'
      ? { cat: 'habitudes', fait: m, date: todayDate }
      : { ...m, date: m.date || todayDate }
  ).slice(0, 12);

  const existingJson = JSON.stringify(existingNorm, null, 2);
  const convo = messages
    .slice(-14)
    .map(m => `${m.role === 'user' ? 'Parent' : 'Lovéa'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const CATS = 'gouts | sommeil | repas | emotions | progres | difficultes | habitudes';

  const systemPrompt = `Tu es un assistant mémoire pour Lovéa, une app parentale. Tu analyses des conversations et extrais des faits précis sur l'enfant.

Catégories disponibles (utilise exactement ces codes) :
- gouts        : goûts, intérêts, loisirs, activités préférées, personnages aimés
- sommeil      : habitudes de sommeil, difficultés, rituels du soir, heures
- repas        : alimentation, aliments aimés/refusés, comportement à table
- emotions     : émotions, peurs, comportement, humeur, réactions
- progres      : acquisitions, apprentissages, développement, étapes franchies
- difficultes  : problèmes récurrents, défis, points de vigilance
- habitudes    : routines quotidiennes, rituels, organisation de la vie

Règles strictes :
1. Chaque fait = phrase courte (max 10 mots), en minuscules, sans point final, personnelle et concrète
2. Maximum 12 faits au total dans le tableau fusionné
3. Fusionne intelligemment avec les faits existants : si un fait change, remplace l'ancien (ne garde pas les deux)
4. Supprime les doublons et les faits trop génériques
5. Ne garde que les faits sur l'ENFANT (pas sur les parents ni les conseils)
6. Réponds UNIQUEMENT avec un tableau JSON valide, rien d'autre
7. Format : [{"cat":"gouts","fait":"adore les dinosaures","date":"2026-07-09"},...]
8. IMPORTANT : conserve la "date" d'origine des faits inchangés. Ne mets aujourd'hui (${todayDate}) que pour les faits nouveaux ou modifiés.
8. Langue des faits : ${lang === 'en' ? 'English' : lang === 'he' ? 'Hebrew' : lang === 'ar' ? 'Arabic' : 'français'}`;

  const userPrompt = `Faits actuellement mémorisés sur ${name} :
${existingNorm.length ? existingJson : '(aucun encore)'}

Nouvelle conversation à analyser :
${convo}

Retourne le tableau JSON fusionné et mis à jour (max 12 faits, catégories : ${CATS}).`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = response.content[0]?.text?.trim() || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    let memoire = match ? JSON.parse(match[0]) : [];

    // Validation : garde uniquement les objets bien formés avec cat valide
    const VALID_CATS = new Set(['gouts','sommeil','repas','emotions','progres','difficultes','habitudes']);
    memoire = memoire
      .filter(m => m && typeof m.fait === 'string' && VALID_CATS.has(m.cat))
      .map(m => ({ cat: m.cat, fait: m.fait, date: m.date || todayDate }))
      .slice(0, 12);

    if (conversationsCol && memoire.length) {
      await conversationsCol.updateOne(
        { sessionId },
        { $set: { memoire, memoireUpdatedAt: new Date() } },
        { upsert: true }
      );
    }
    res.json({ memoire });
  } catch (err) {
    console.error('[Lovéa] memoire error:', err.message);
    res.json({ memoire: existingMemoire || [] });
  }
});

app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'blog.html')));
app.get('/blog/:slug', (req, res) => {
  const slug = req.params.slug.replace(/[^a-z0-9-]/gi, '');
  const filePath = path.join(__dirname, 'blog', `${slug}.html`);
  if (require('fs').existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).sendFile(path.join(__dirname, 'index.html'));
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
