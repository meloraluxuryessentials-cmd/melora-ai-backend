/*
  MELORA AI BACKEND SERVER
  Gratis deployment op Render.com

  Gebruikt Hugging Face Inference API (gratis tier)
  voor AI room visualisatie.
*/

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fetch   = require('node-fetch');
const sharp   = require('sharp');
const FormData = require('form-data');

const app  = express();
const port = process.env.PORT || 3000;

/* ── Jouw Hugging Face token (stel in als environment variable op Render) ── */
const HF_TOKEN = process.env.HF_TOKEN || '';

/* ── CORS: sta verzoeken toe van jouw Shopify domein ── */
app.use(cors({
  origin: [
    'https://meloraluxury.com',
    'https://www.meloraluxury.com',
    /\.myshopify\.com$/
  ]
}));

/* ── Multer: afbeeldingen in geheugen opslaan (max 10 MB) ── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

/* ── Health check ── */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Melora AI Backend' });
});

/* ── Hoofd-endpoint: POST /api/visualize ── */
app.post('/api/visualize', upload.single('room'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Geen foto ontvangen.' });
    }

    if (!HF_TOKEN) {
      return res.status(500).json({ error: 'HF_TOKEN niet ingesteld op de server.' });
    }

    const points      = JSON.parse(req.body.points || '[]');
    const productName = req.body.productName || 'wood acoustic wall panel';

    /* ── Stap 1: Afbeelding verwerken met Sharp ── */
    /* Maximaal 1024px breed voor snelle verwerking */
    const imageBuffer = await sharp(req.file.buffer)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const base64Image = imageBuffer.toString('base64');

    /* ── Stap 2: Prompt samenstellen op basis van productnaam ── */
    const colorDescription = getColorDescription(productName);
    const prompt = `A luxury interior room with ${colorDescription} acoustic wood wall panels installed on the wall, ` +
      `photorealistic, high-end interior design, professional photography, ` +
      `warm lighting, 8k quality, architectural visualization`;

    /* ── Stap 3: Hugging Face API aanroepen ── */
    /* We gebruiken FLUX.1-schnell voor snelle gratis generatie */
    const hfResponse = await callHuggingFace(prompt, base64Image);

    if (!hfResponse.ok) {
      const errText = await hfResponse.text();
      console.error('HF API fout:', errText);
      return res.status(502).json({ error: 'AI-generatie mislukt. Probeer het opnieuw.' });
    }

    /* ── Stap 4: Resultaat als afbeelding terugsturen ── */
    const imageData = await hfResponse.arrayBuffer();
    const resultBuffer = Buffer.from(imageData);

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Length', resultBuffer.length);
    res.send(resultBuffer);

  } catch (err) {
    console.error('Server fout:', err);
    res.status(500).json({ error: err.message || 'Onbekende fout.' });
  }
});

/* ── Hugging Face API aanroepen met retry bij 503 ── */
async function callHuggingFace(prompt, base64Image, retries = 3) {
  const modelUrl = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';

  for (let i = 0; i < retries; i++) {
    const response = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Wait-For-Model': 'true'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          num_inference_steps: 30,
          guidance_scale: 7.5,
          width: 1024,
          height: 768
        }
      })
    });

    /* Model laadt nog op — wacht 15 seconden en probeer opnieuw */
    if (response.status === 503) {
      if (i < retries - 1) {
        await sleep(15000);
        continue;
      }
    }

    return response;
  }
}

/* ── Kleurvertaling op basis van productnaam ── */
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
  console.log(`Melora AI Backend draait op poort ${port}`);
});
