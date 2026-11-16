// Vercel Serverless Function for File Storage with Blob
// Environment variables (set in Vercel dashboard):
// - BLOB_READ_WRITE_TOKEN: Vercel Blob token (auto-added when you create a Blob store)
// - ACCESS_CODE: Password to unlock edit/save operations

import { put, list, del } from '@vercel/blob';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // GET - three modes:
    //   ?meta=1            -> light listing (name, size, date, title) for the library
    //   ?filename=foo.txt  -> one file's content
    //   (no query)         -> every file with its content (kept for older clients)
    if (req.method === 'GET') {
      const { meta, filename } = req.query;

      if (filename) {
        const { blobs } = await list({ prefix: `tts-docs/${filename}` });
        const blob = blobs.find((b) => b.pathname === `tts-docs/${filename}`);
        if (!blob) return res.status(404).json({ error: 'File not found' });
        const content = await (await fetch(blob.url)).text();
        return res.status(200).json({ filename, content, uploadedAt: blob.uploadedAt });
      }

      const { blobs } = await list({ prefix: 'tts-docs/' });

      if (meta) {
        // Read only the first few hundred bytes of each file to get its title line.
        const files = await Promise.all(blobs.map(async (blob) => {
          const name = blob.pathname.replace('tts-docs/', '');
          let title = '';
          try {
            const head = await fetch(blob.url, { headers: { Range: 'bytes=0-400' } });
            const chunk = await head.text();
            title = (chunk.split('\n').find((l) => l.trim()) || '').replace(/^#{1,6}\s+/, '').trim().slice(0, 110);
          } catch (err) {
            console.error(`Could not read the title of ${name}:`, err);
          }
          return {
            name,
            title: title || name.replace(/\.txt$/, '').replace(/-/g, ' '),
            size: blob.size,
            uploadedAt: blob.uploadedAt,
          };
        }));
        return res.status(200).json({ files });
      }

      // Fetch content for each blob
      const files = {};
      for (const blob of blobs) {
        try {
          const response = await fetch(blob.url);
          const content = await response.text();
          // Remove 'tts-docs/' prefix from pathname for display
          const filename2 = blob.pathname.replace('tts-docs/', '');
          files[filename2] = content;
        } catch (err) {
          console.error(`Error fetching ${blob.pathname}:`, err);
        }
      }

      return res.status(200).json({ files });
    }

    // POST - Save/update a file (requires access code)
    if (req.method === 'POST') {
      const { filename, content, accessCode } = req.body;

      // Check if request is from localhost
      const origin = req.headers.origin || req.headers.referer || '';
      const isFromLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

      // Validate access code (accept main access code, "123" for append/save, or "localhost" for local dev)
      const validAccessCode = process.env.ACCESS_CODE;
      const isValidCode = accessCode === validAccessCode || accessCode === '123' || (accessCode === 'localhost' && isFromLocalhost);
      if (!accessCode || !isValidCode) {
        return res.status(401).json({ error: 'Invalid access code' });
      }

      // Validate input
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Filename is required' });
      }

      if (content === undefined || content === null) {
        return res.status(400).json({ error: 'Content is required' });
      }

      // Save to Blob with 'tts-docs/' prefix
      const blob = await put(`tts-docs/${filename}`, content, {
        access: 'public',
        addRandomSuffix: false, // Keep exact filename
        allowOverwrite: true, // Saving the same article again replaces it
      });

      console.log(`File saved: ${filename} (${content.length} chars)`);
      return res.status(200).json({ success: true, filename, url: blob.url });
    }

    // DELETE - Remove a file (requires access code)
    if (req.method === 'DELETE') {
      const { filename } = req.query;
      const { accessCode } = req.body || {};

      // Check if request is from localhost
      const origin = req.headers.origin || req.headers.referer || '';
      const isFromLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

      // Validate access code (accept main access code, "123", or "localhost" for local dev)
      const validAccessCode = process.env.ACCESS_CODE;
      const isValidCode = accessCode === validAccessCode || accessCode === '123' || (accessCode === 'localhost' && isFromLocalhost);
      if (!accessCode || !isValidCode) {
        return res.status(401).json({ error: 'Invalid access code' });
      }

      // Validate input
      if (!filename || typeof filename !== 'string') {
        return res.status(400).json({ error: 'Filename is required' });
      }

      // Find the blob URL first
      const { blobs } = await list({ prefix: `tts-docs/${filename}` });
      const blob = blobs.find(b => b.pathname === `tts-docs/${filename}`);

      if (!blob) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Delete the blob
      await del(blob.url);

      console.log(`File deleted: ${filename}`);
      return res.status(200).json({ success: true, filename });
    }

    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Blob API error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
