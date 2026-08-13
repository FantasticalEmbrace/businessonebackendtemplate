'use strict';

const STATE_NAME_TO_CODE = Object.freeze({
    Alabama: 'AL',
    Alaska: 'AK',
    Arizona: 'AZ',
    Arkansas: 'AR',
    California: 'CA',
    Colorado: 'CO',
    Connecticut: 'CT',
    Delaware: 'DE',
    'District of Columbia': 'DC',
    Florida: 'FL',
    Georgia: 'GA',
    Hawaii: 'HI',
    Idaho: 'ID',
    Illinois: 'IL',
    Indiana: 'IN',
    Iowa: 'IA',
    Kansas: 'KS',
    Kentucky: 'KY',
    Louisiana: 'LA',
    Maine: 'ME',
    Maryland: 'MD',
    Massachusetts: 'MA',
    Michigan: 'MI',
    Minnesota: 'MN',
    Mississippi: 'MS',
    Missouri: 'MO',
    Montana: 'MT',
    Nebraska: 'NE',
    Nevada: 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    Ohio: 'OH',
    Oklahoma: 'OK',
    Oregon: 'OR',
    Pennsylvania: 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    Tennessee: 'TN',
    Texas: 'TX',
    Utah: 'UT',
    Vermont: 'VT',
    Virginia: 'VA',
    Washington: 'WA',
    'West Virginia': 'WV',
    Wisconsin: 'WI',
    Wyoming: 'WY',
});

const STATE_CODE_TO_NAME = Object.freeze(
    Object.fromEntries(Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name]))
);

function normalizeStateCode(rawState, isoRegion) {
    const fromIso = String(isoRegion || '')
        .replace(/^US-/i, '')
        .trim()
        .toUpperCase();
    if (/^[A-Z]{2}$/.test(fromIso)) return fromIso;

    const state = String(rawState || '').trim();
    if (/^[A-Za-z]{2}$/.test(state)) return state.toUpperCase();
    return STATE_NAME_TO_CODE[state] || state.slice(0, 2).toUpperCase();
}

function suggestionKey(item) {
    return [item.line1, item.city, item.state, item.postalCode].join('|').toLowerCase();
}

function dedupeSuggestions(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = suggestionKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function buildQueryVariants(query, stateHint) {
    const q = String(query || '').trim();
    const state = normalizeStateCode(stateHint || '');
    const variants = [q];
    if (state && !new RegExp(`\\b${state}\\b`, 'i').test(q)) {
        variants.push(`${q}, ${state}`);
        const stateName = STATE_CODE_TO_NAME[state];
        if (stateName) variants.push(`${q}, ${stateName}`);
    }
    return [...new Set(variants.map((v) => v.trim()).filter((v) => v.length >= 3))];
}

function parseNominatimItem(item) {
    const a = item.address || {};
    const house = a.house_number ? String(a.house_number).trim() : '';
    const road = a.road || a.street || a.pedestrian || a.footway || a.path || '';
    let line1 = [house, road].filter(Boolean).join(' ').trim();
    if (!line1 && item.display_name) {
        line1 = String(item.display_name).split(',')[0].trim();
    }

    const city =
        a.city ||
        a.town ||
        a.village ||
        a.hamlet ||
        a.municipality ||
        a.county ||
        '';
    const state = normalizeStateCode(a.state, a['ISO3166-2-lvl4']);
    const postalCode = String(a.postcode || '')
        .trim()
        .split('-')[0]
        .slice(0, 10);
    const line2 = a.unit || a.apartment || a.suite || '';

    return {
        line1,
        line2,
        city: String(city).trim(),
        state,
        postalCode,
        label: String(item.display_name || line1).trim(),
    };
}

function parseCensusMatch(match) {
    const parts = match.addressComponents || {};
    const line1 = [parts.fromAddress || parts.preQualifier || '', parts.streetName || '', parts.suffixType || '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    const city = String(parts.city || parts.placeName || '').trim();
    const state = normalizeStateCode(parts.state || '');
    const postalCode = String(parts.zip || parts.ZIP || '')
        .trim()
        .split('-')[0]
        .slice(0, 10);

    return {
        line1: line1 || String(match.matchedAddress || '').split(',')[0].trim(),
        line2: '',
        city,
        state,
        postalCode,
        label: String(match.matchedAddress || line1).trim(),
    };
}

async function searchNominatim(query) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('countrycodes', 'us');
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '8');

    const response = await fetch(url.toString(), {
        headers: {
            'User-Agent': 'HMHerbsStorefront/1.0 (address-autocomplete)',
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Nominatim lookup failed (${response.status})`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
        .map(parseNominatimItem)
        .filter((item) => item.line1 && item.city && item.state);
}

async function searchCensus(query) {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    url.searchParams.set('address', query);
    url.searchParams.set('benchmark', 'Public_AR_Current');
    url.searchParams.set('format', 'json');

    const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`Census lookup failed (${response.status})`);
    }

    const data = await response.json();
    const matches = data?.result?.addressMatches;
    if (!Array.isArray(matches)) return [];

    return matches
        .map(parseCensusMatch)
        .filter((item) => item.line1 && item.city && item.state);
}

async function searchAddressSuggestions(query, options = {}) {
    const q = String(query || '').trim();
    if (q.length < 3) return [];

    const stateHint = options.state || options.stateHint || '';
    const queries = buildQueryVariants(q, stateHint);
    const collected = [];

    for (const variant of queries) {
        const [nominatimResults, censusResults] = await Promise.allSettled([
            searchNominatim(variant),
            searchCensus(variant),
        ]);

        if (nominatimResults.status === 'fulfilled') {
            collected.push(...nominatimResults.value);
        }
        if (censusResults.status === 'fulfilled') {
            collected.push(...censusResults.value);
        }

        if (collected.length >= 8) break;
    }

    const stateCode = normalizeStateCode(stateHint);
    const ranked = dedupeSuggestions(collected);
    if (stateCode) {
        ranked.sort((a, b) => {
            const aMatch = a.state === stateCode ? 0 : 1;
            const bMatch = b.state === stateCode ? 0 : 1;
            return aMatch - bMatch;
        });
    }

    return ranked.slice(0, 8);
}

module.exports = {
    searchAddressSuggestions,
    parseNominatimItem,
    parseCensusMatch,
};
