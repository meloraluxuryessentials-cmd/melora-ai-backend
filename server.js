/*
  MELORA AI BACKEND SERVER
  Gebruikt Replicate.com voor echte img2img transformatie
*/

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fetch   = require('node-fetch');
const sharp   = require('sharp');

const app  = express();
const port = process.env.PORT || 3000;

const REPLICATE_TOKEN = process.env.REPLICATE_TOKEN || '';

app.use(cors({
  origin: [
    'https://meloraluxury.com',
    'https://www.meloraluxury.com',
    /\.myshopify\.com$/
  ]
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Melora AI Backend v2 (Replicate)' });
});

app.post('/api/visualize', upload.single('room'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Geen foto ontvangen.' });
    }

    if (!REPLICATE_TOKEN) {
      return res.status(500).json({ error: 'REPLICATE_TOKEN niet ingesteld op de server.' });
    }

    const productName = req.body.productName || 'wood acoustic wall panel';

    /* Afbeelding verkleinen voor snelle verwerking */
    const imageBuffer = await sharp(req.file.buffer)
      .resize({ width: 768, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;

    const colorDescription = getColorDescription(productName);
    const prompt = `luxury interior with ${colorDescription} acoustic wood wall panels on the wall, high-end interior design, photorealistic, professional photography, warm lighting`;
    const negativePrompt = 'ugly, blurry, low quality, distorted, cartoon, painting';

    /* Stap 1: Start Replicate prediction */
    const startResponse = await fetch('https://api.replicate.com/v1/models/stability-ai/stable-diffusion/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_TOKEN}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait'
      },
      body: JSON.stringify({
        input: {
          image: base64Image,
          prompt: prompt,
          negative_prompt: negativePrompt,
          prompt_strength: 0.6,
          num_inference_steps: 30,
          guidance_scale: 7.5,
          scheduler: 'DPMSolverMultistep'
        }
      })
    });

    if (!startResponse.ok) {
      const err = await startResponse.text();
      console.error('Replicate fout:', err);
      return res.status(502).json({ error: 'AI-generatie mislukt. Probeer het opnieuw.' });
    }

    let prediction = await startResponse.json();
    console.log('Prediction gestart:', prediction.id, 'status:', prediction.status);

    /* Stap 2: Wacht op resultaat (polling) */
    let attempts = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 60) {
      await sleep(2000);
      const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` }
      });
      prediction = await pollResponse.json();
      console.log('Status:', prediction.status);
      attempts++;
    }

    if (prediction.status !== 'succeeded' || !prediction.output) {
      return res.status(502).json({ error: 'AI-generatie mislukt of time-out.' });
    }

    /* Stap 3: Download gegenereerde afbeelding */
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    const imgResponse = await fetch(outputUrl);
    const imageData = await imgResponse.arrayBuffer();
    const resultBuffer = Buffer.from(imageData);

    res.set('Content-Type', 'image/png');
    res.set('Content-Length', resultBuffer.length);
    res.send(resultBuffer);

  } catch (err) {
    console.error('Server fout:', err);
    res.status(500).json({ error: err.message || 'Onbekende fout.' });
  }
});

function getColorDescription(productName) {
  const name = productName.toLowerCase();
  if (name.includes('zwart essen') || name.includes('black ash')) return 'black ash wood veneer';
  if (name.includes('donker zwart') || name.includes('dark black')) return 'dark matte black';
  if (name.includes('walnoot') || name.includes('walnut')) return 'rich walnut wood';
  if (name.includes('naturel eiken') || name.includes('natural oak')) return 'natural light oak wood';
  if (name.includes('licht eiken') || name.includes('light oak')) return 'pale light oak wood';
  if (name.includes('gerookt') || name.includes('smoked')) return 'smoked grey oak wood';
  return 'premium wood veneer';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`Melora AI Backend v2 draait op poort ${port}`);
});
