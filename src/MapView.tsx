import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { Deal } from './types';

// Fix default marker icons once at module level
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const userIcon = new L.Icon({
  iconUrl:     'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl:   'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

const dealIcon = new L.Icon({
  iconUrl:     'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl:   'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize:    [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

interface GroceryStore {
  id: number;
  name: string;
  lat: number;
  lon: number;
  website?: string;
}

interface Props {
  location: string;
  radius: number;
  coords?: [number, number];
  deals?: Deal[];
}

type Status = 'loading' | 'ready' | 'error';

export default function MapView({ location, radius, coords, deals = [] }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [stores, setStores] = useState<GroceryStore[]>([]);

  // ── Step 1: resolve coordinates + fetch nearby stores ──────────────────
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setStores([]);
    setCenter(null);

    async function fetchStores(lat: number, lon: number) {
      const radiusM = radius * 1000;
      // Supermarkets and grocery stores only — excludes convenience/gas station shops
      // Use nwr (node/way/relation) so building-footprint stores are included.
      // "out center" gives a lat/lon centroid for ways/relations.
      const query =
        `[out:json][timeout:20];` +
        `(nwr["shop"~"supermarket|grocery"](around:${radiusM},${lat},${lon}););` +
        `out center 100;`;

      // Try mirrors in order; first JSON response wins
      const mirrors = [
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
        'https://overpass-api.de/api/interpreter',
      ];

      for (const url of mirrors) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          const res = await fetch(url, { method: 'POST', body: query, signal: controller.signal });
          clearTimeout(timer);
          const ct = res.headers.get('content-type') ?? '';
          if (!res.ok || !ct.includes('json')) continue;
          const data = await res.json();
          console.log(`[MapView] Overpass (${url}) returned ${data.elements?.length} elements`);
          return (data.elements ?? [])
            .filter((el: any) => {
              // nodes have lat/lon directly; ways/relations have a center object
              const lat = el.lat ?? el.center?.lat;
              const lon = el.lon ?? el.center?.lon;
              return el.tags?.name && lat && lon;
            })
            .map((el: any) => ({
              id: el.id,
              name: el.tags.name,
              lat: Number(el.lat ?? el.center?.lat),
              lon: Number(el.lon ?? el.center?.lon),
              website: el.tags?.website || el.tags?.['contact:website'] || undefined,
            }));
        } catch (e) {
          console.warn(`[MapView] ${url} failed:`, e);
        }
      }
      return [];
    }

    async function load() {
      try {
        let lat: number, lon: number;

        if (coords) {
          [lat, lon] = coords;
        } else {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`,
            { headers: { Accept: 'application/json', 'Accept-Language': 'en-US,en' } }
          );
          const ct = res.headers.get('content-type') ?? '';
          if (!ct.includes('json')) throw new Error('Geocoder unavailable — try again shortly');
          const data = await res.json();
          if (!data?.length) throw new Error(`Location not found: "${location}"`);
          lat = parseFloat(data[0].lat);
          lon = parseFloat(data[0].lon);
          if (isNaN(lat) || isNaN(lon)) throw new Error('Invalid coordinates');
        }

        if (cancelled) return;
        const storeList = await fetchStores(lat, lon);
        if (cancelled) return;

        setCenter([lat, lon]);
        setStores(storeList);
        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [location, radius, coords]);

  // ── Step 2: initialise / update the Leaflet map ─────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !center || !mapDivRef.current) return;

    const zoom = radius <= 10 ? 13 : radius <= 25 ? 12 : radius <= 50 ? 11 : 10;

    // Destroy previous instance before creating a new one
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapDivRef.current).setView(center, zoom);
    mapInstanceRef.current = map;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    L.circle(center, {
      radius: radius * 1000,
      color: '#c62828',
      fillColor: '#c62828',
      fillOpacity: 0.05,
      weight: 1.5,
    }).addTo(map);

    L.marker(center, { icon: userIcon })
      .addTo(map)
      .bindPopup(`<strong>📍 ${location}</strong>`);

    // Build deal lookup for fuzzy name matching

    stores.forEach((store) => {
      const storeDeals = deals.filter((d) =>
        d.store.toLowerCase().includes(store.name.toLowerCase()) ||
        store.name.toLowerCase().includes(d.store.toLowerCase())
      );
      if (storeDeals.length === 0) return;
      const dealList =
        `<hr style="margin:6px 0"/><strong style="color:#2e7d32">🏷️ ${storeDeals.length} deal${storeDeals.length > 1 ? 's' : ''} found</strong><br/>` +
        storeDeals.map((d) => `• ${d.cut} — $${d.price ?? '?'}/${d.unit}`).join('<br/>');
      const websiteLink = store.website
        ? `<br/><a href="${store.website}" target="_blank" rel="noopener noreferrer" style="color:#c62828;font-size:12px">Visit website →</a>`
        : '';
      const popup = `<div style="min-width:160px"><strong>${store.name}</strong>${websiteLink}${dealList}</div>`;
      L.marker([store.lat, store.lon], { icon: dealIcon })
        .addTo(map)
        .bindPopup(popup);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [status, center, stores, radius, location]);

  if (status === 'loading') {
    return (
      <div className="map-placeholder">
        <div className="map-loading-spinner" />
        <span>Loading map…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="map-placeholder">
        <span>🗺️ Map unavailable — {errorMsg}</span>
      </div>
    );
  }

  return (
    <div className="map-wrapper">
      <div className="map-header">
        <span className="map-title">🗺️ Stores near {location}</span>
        <span className="map-store-count">{stores.length} store{stores.length !== 1 ? 's' : ''} with deals mapped</span>
      </div>
      <div ref={mapDivRef} style={{ height: 380, width: '100%', borderRadius: '0 0 12px 12px' }} />
    </div>
  );
}
