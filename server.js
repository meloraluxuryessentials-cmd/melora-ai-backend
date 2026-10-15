/*
  MELORA AI BACKEND SERVER
  Gratis deployment op Render.com

  Gebruikt Hugging Face Inference API (gratis tier)
  met Pollinations AI als fallback.
*/

const express = require('express');
const multer  = require('multer');
const cors    = require('cors');
const fetch   = require('node-fetch');
const sharp   = require('sharp');
const FormData = require('form-data');

const app  = express();
const port = process.env.PORT || 3000;

const HF_TOKEN = process.env.HF_TOKEN || '';

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
  res.json({ status: 'ok', service: 'Melora AI Backend' });
});

app.post('/api/visualize', upload.single('room'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Geen foto ontvangen.' });
    }

    const points      = JSON.parse(req.body.points || '[]');
    const productName = req.body.productName || 'wood acoustic wall panel';

    const imageBuffer = await sharp(req.file.buffer)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const base64Image = imageBuffer.toString('base64');

    const colorDescription = getColorDescription(productName);
    const prompt = `A luxury interior room with ${colorDescription} acoustic wood wall panels installed on the wall, photorealistic, high-end interior design, professional photography, warm lighting, 8k quality, architectural visualization`;

    let resultBuffer;

    try {
      const hfResponse = await callHuggingFace(prompt, base64Image);
      const imageData = await hfResponse.arrayBuffer();
      resultBuffer = Buffer.from(imageData);
    } catch (hfErr) {
      console.log('HF mislukt, probeer Pollinations:', hfErr.message);
      const encodedPrompt = encodeURIComponent(prompt);
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=768&nologo=true`;
      
      const pollResponse = await fetch(pollinationsUrl, { timeout: 120000 });
      if (!pollResponse.ok) {
        throw new Error('AI-generatie mislukt via alle beschikbare services.');
      }
      const imageData = await pollResponse.arrayBuffer();
      resultBuffer = Buffer.from(imageData);
    }

    res.set('Content-Type', 'image/jpeg');
    res.set('Content-Length', resultBuffer.length);
    res.send(resultBuffer);

  } catch (err) {
    console.error('Server fout:', err);
    res.status(500).json({ error: err.message || 'Onbekende fout.' });
  }
});

async function callHuggingFace(prompt, base64Image, retries = 3) {
  const models = [
    'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
    'https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5',
    'https://api-inference.huggingface.co/models/CompVis/stable-diffusion-v1-4'
  ];

  for (const modelUrl of models) {
    for (let i = 0; i < retries; i++) {
      try {
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
              num_inference_steps: 25,
              guidance_scale: 7.5
            }
          }),
          timeout: 120000
        });

        if (response.status === 503) {
          if (i < retries - 1) {
            await sleep(15000);
            continue;
          }
        }

        if (response.ok) return response;
        break;

      } catch (err) {
        console.error(`Netwerkfout bij ${modelUrl}:`, err.message);
        break;
      }
    }
  }

  throw new Error('Alle AI modellen zijn momenteel niet bereikbaar.');
}

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
