// Simple authentication endpoint
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    const { accessCode } = req.body;

    // Check if request is from localhost
    const origin = req.headers.origin || req.headers.referer || '';
    const isFromLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');

    const validAccessCode = process.env.ACCESS_CODE;

    if (accessCode === validAccessCode || (accessCode === 'localhost' && isFromLocalhost)) {
      return res.status(200).json({ success: true });
    }

    return res.status(401).json({ error: 'Invalid access code' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
