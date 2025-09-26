// Vercel Serverless Function: /api/places
// Calls Google Places Nearby Search with server-side key (GOOGLE_API_KEY)

module.exports = async (req, res) => {
  try {
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: GOOGLE_API_KEY not set' });
    }

    const {
      lat,
      lng,
      radius,
      rankby,
      type: typeQuery,
      keyword: keywordQuery,
      minprice,
      maxprice,
      pagetoken
    } = req.query || {};

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Missing lat or lng parameter' });
    }

    const DEFAULT_RADIUS_METERS = 5000;
    const MAX_RADIUS_METERS = 8000;
    const MIN_RADIUS_METERS = 500;
    const useRankByDistance = (rankby || '').toLowerCase() === 'distance';

    let normalizedRadius = DEFAULT_RADIUS_METERS;
    if (radius) {
      const parsed = parseInt(radius, 10);
      if (!Number.isNaN(parsed)) {
        normalizedRadius = Math.max(MIN_RADIUS_METERS, Math.min(MAX_RADIUS_METERS, parsed));
      }
    }

    const params = new URLSearchParams();
    params.set('location', `${lat},${lng}`);
    params.set('key', GOOGLE_API_KEY);

    const effectiveType = typeQuery || 'restaurant';
    if (effectiveType) params.set('type', effectiveType);
    if (keywordQuery) params.set('keyword', keywordQuery);

    const minP = Number.isFinite(Number(minprice)) ? Math.max(0, Math.min(4, Number(minprice))) : undefined;
    const maxP = Number.isFinite(Number(maxprice)) ? Math.max(0, Math.min(4, Number(maxprice))) : undefined;
    if (minP !== undefined) params.set('minprice', String(minP));
    if (maxP !== undefined) params.set('maxprice', String(maxP));

    if (useRankByDistance) {
      params.set('rankby', 'distance');
    } else {
      params.set('radius', String(normalizedRadius));
    }

    if (pagetoken) params.set('pagetoken', pagetoken);

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status && data.status !== 'OK') {
      return res.status(502).json({ error: 'Google Places API error', google: data });
    }

    return res.status(200).json({
      results: data.results || [],
      next_page_token: data.next_page_token || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch from Google Places API' });
  }
};
