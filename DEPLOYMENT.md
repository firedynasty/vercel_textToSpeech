# Deployment Instructions for Vercel

## Setup Steps

### 1. Install Vercel CLI (if not already installed)
```bash
npm install -g vercel
```

### 2. Login to Vercel
```bash
vercel login
```

### 3. Deploy to Vercel
```bash
vercel
```

Follow the prompts:
- Set up and deploy? **Y**
- Which scope? Choose your account
- Link to existing project? **N**
- Project name? (use default or enter custom name)
- In which directory is your code? **./`** (current directory)
- Override settings? **N**

### 4. Set Up Vercel Blob Storage

After first deployment:

1. Go to your project dashboard on Vercel
2. Navigate to **Storage** tab
3. Click **Create Database**
4. Select **Blob** storage
5. Create the blob store (this will automatically add `BLOB_READ_WRITE_TOKEN` to your environment variables)

### 5. Set Environment Variables

In your Vercel project dashboard:

1. Go to **Settings** → **Environment Variables**
2. Add the following variable:
   - **Variable Name:** `ACCESS_CODE`
   - **Value:** Your secure password (e.g., "mySecurePassword123")
   - **Environment:** Production, Preview, Development

The `BLOB_READ_WRITE_TOKEN` should already be set automatically when you created the Blob storage.

### 6. Redeploy

After setting environment variables:
```bash
vercel --prod
```

## Testing Locally

To test the API routes locally:

```bash
npm start
```

The app will run on `http://localhost:3000` and automatically authenticate you (no password needed for localhost).

## Features

### Sidebar File Management
- **Create New File** - Click "+ New File" to create a new document
- **Save File** - Click "💾 Save File" to save your current text
- **Load File** - Click any file in the sidebar to load it
- **Edit Name** - Click the ✏️ button to rename a file
- **Delete** - Click the 🗑️ button to delete a file
- **Refresh** - Click "Refresh" to reload files from cloud storage

### Text-to-Speech Features
- Paste text into the textarea
- Text is automatically split into sentences
- Click any sentence to hear it spoken
- Select language from dropdown (Cantonese, Mandarin, English, French, Spanish, Korean, Hebrew)
- Adjust speech rate (0.7x, 1x, 1.5x)

## File Storage

- **Localhost**: Files are stored in browser localStorage
- **Production**: Files are stored in Vercel Blob storage
- All files are saved with the prefix `tts-docs/` in Blob storage

## API Endpoints

### GET /api/files
Fetches all saved files (no authentication required)

### POST /api/files
Saves or updates a file (requires `ACCESS_CODE`)
```json
{
  "filename": "lesson1.txt",
  "content": "Your text content here...",
  "accessCode": "your-access-code"
}
```

### DELETE /api/files?filename=lesson1.txt
Deletes a file (requires `ACCESS_CODE` in request body)
```json
{
  "accessCode": "your-access-code"
}
```

### POST /api/auth
Validates access code
```json
{
  "accessCode": "your-access-code"
}
```

## Security Notes

- On localhost, authentication is bypassed automatically
- On production, you must enter the `ACCESS_CODE` to save/delete files
- Reading files does not require authentication
- Access code should be kept secure and not shared publicly
