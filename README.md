# vercel_textToSpeech

Multi-language text-to-speech reader with cloud file storage.

## Features

- **Multi-language TTS**: Supports English, Cantonese, Mandarin, French, Spanish, Korean, and Hebrew
- **Sentence-based reading**: Automatically splits text into clickable sentences
- **File management**: Save and load documents with cloud storage via Vercel Blob
- **Adjustable speed**: Control speech rate (0.7x, 1x, 1.5x)
- **Sidebar navigation**: Organize and manage multiple text files

## Local Development

```bash
npm install
npm start
```

Visit `http://localhost:3000`

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete Vercel deployment instructions.

## Tech Stack

- React 18
- Vercel Blob Storage
- Web Speech API
- Vercel Serverless Functions
