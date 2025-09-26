// Vercel Serverless Function: /api/directions
// Calls Google Directions API with server-side key (GOOGLE_API_KEY)

module.exports = async (req, res) => {
  try {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: GOOGLE_API_KEY not set' });
    }

    const { origin, destination, waypoint } = req.query || {};
    if (!origin || !destination) {
      return res.status(400).json({ error: 'Missing origin or destination parameter' });
    }

    const params = new URLSearchParams();
    params.set('origin', origin);
    params.set('destination', destination);
    if (waypoint) params.set('waypoints', `place_id:${waypoint}`);
    params.set('key', GOOGLE_API_KEY);

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status && data.status !== 'OK') {
      return res.status(502).json({ error: 'Google Directions API error', google: data });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch from Google Directions API' });
  }
};
