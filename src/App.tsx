import { useState, useCallback } from 'react';
import { Deal, SearchResults, MEAT_TYPES, MeatType } from './types';
import MapView from './MapView';
import ErrorBoundary from './ErrorBoundary';

const RADIUS_OPTIONS = [5, 10, 25, 50, 100];

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
    { headers: { 'Accept-Language': 'en-US,en' } }
  );
  const data = await res.json();
  const { city, town, village, suburb, county, state, country } = data.address ?? {};
  const place = city || town || village || suburb || county;
  return [place, state, country].filter(Boolean).join(', ');
}

function DealCard({ deal }: { deal: Deal }) {
  const meatInfo = MEAT_TYPES.find((m) => m.type === deal.meatType);
  const hasSavings = deal.originalPrice && deal.price && deal.originalPrice > deal.price;

  return (
    <div className="deal-card">
      <div className="deal-card-header">
        <span className="deal-emoji">{meatInfo?.emoji ?? '🍖'}</span>
        <div className="deal-store">{deal.store}</div>
        {hasSavings && (
          <div className="savings-badge">
            {deal.savings ?? `${Math.round(((deal.originalPrice! - deal.price!) / deal.originalPrice!) * 100)}% off`}
          </div>
        )}
      </div>

      <div className="deal-cut">{deal.cut}</div>
      {deal.description && deal.description !== deal.cut && (
        <div className="deal-description">{deal.description}</div>
      )}

      <div className="deal-price-row">
        {deal.price !== null ? (
          <>
            <span className="deal-price">
              ${deal.price.toFixed(2)}
              <span className="deal-unit">/{deal.unit}</span>
            </span>
            {hasSavings && (
              <span className="deal-original-price">
                ${deal.originalPrice!.toFixed(2)}/{deal.unit}
              </span>
            )}
          </>
        ) : (
          <span className="deal-price deal-price-unknown">Price in store</span>
        )}
      </div>

      <div className="deal-footer">
        {deal.validUntil && (
          <span className="deal-valid">Until {deal.validUntil}</span>
        )}
        {deal.conditions && (
          <span className="deal-conditions">{deal.conditions}</span>
        )}
        {deal.url && (
          <a
            href={deal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="view-deal-btn"
            onClick={(e) => e.stopPropagation()}
          >
            View Deal →
          </a>
        )}
      </div>
    </div>
  );
}

function sortDeals(deals: Deal[]): Deal[] {
  return [...deals].sort((a, b) => {
    if (a.price !== null && b.price !== null) return a.price - b.price;
    if (a.price !== null) return -1;
    if (b.price !== null) return 1;
    return 0;
  });
}

export default function App() {
  const [location, setLocation] = useState('');
  const [radius, setRadius] = useState(25);
  const [geoCoords, setGeoCoords] = useState<[number, number] | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isGeolocating, setIsGeolocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [activeFilter, setActiveFilter] = useState<MeatType | 'all'>('all');

  const handleGeolocate = useCallback(async () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setIsGeolocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          setGeoCoords([latitude, longitude]);
          const name = await reverseGeocode(latitude, longitude);
          setLocation(name);
        } catch {
          setError('Could not determine your city name. Please type your location.');
        } finally {
          setIsGeolocating(false);
        }
      },
      () => {
        setError('Location access denied. Please type your location manually.');
        setIsGeolocating(false);
      }
    );
  }, []);

  const handleSearch = useCallback(async () => {
    if (!location.trim()) {
      setError('Please enter a location.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setResults(null);
    setActiveFilter('all');

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: location.trim(), radius }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Search failed');
      setResults(data as SearchResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [location, radius]);

  const filteredDeals =
    results?.deals.filter((d) => activeFilter === 'all' || d.meatType === activeFilter) ?? [];

  const sortedDeals = sortDeals(filteredDeals);

  const countByType = (type: MeatType | 'all') =>
    type === 'all'
      ? (results?.deals.length ?? 0)
      : (results?.deals.filter((d) => d.meatType === type).length ?? 0);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <img src="/meat-deals-logo.png" alt="Meat Deals Finder" className="header-logo" />
        </div>
      </header>

      <main className="app-main">
        <div className="search-card">
          <div className="search-row">
            <div className="location-group">
              <label className="field-label">Your Location</label>
              <div className="location-input-wrap">
                <input
                  className="location-input"
                  type="text"
                  value={location}
                  onChange={(e) => { setLocation(e.target.value); setGeoCoords(undefined); }}
                  placeholder="e.g. Toronto, ON or Chicago, IL"
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  disabled={isLoading}
                />
                <button
                  className="geo-btn"
                  onClick={handleGeolocate}
                  disabled={isGeolocating || isLoading}
                  title="Use my location"
                >
                  {isGeolocating ? '⏳' : '📍'}
                </button>
              </div>
            </div>

            <div className="radius-group">
              <label className="field-label">Radius</label>
              <select
                className="radius-select"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                disabled={isLoading}
              >
                {RADIUS_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </select>
            </div>

            <button
              className="search-btn"
              onClick={handleSearch}
              disabled={isLoading || !location.trim()}
            >
              {isLoading ? 'Searching...' : 'Find Deals'}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-banner">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {isLoading && (
          <div className="loading-state">
            <div className="spinner" />
            <p className="loading-title">Searching for meat deals near {location}…</p>
            <p className="loading-sub">
              Scanning grocery flyers and weekly ads. This may take up to a minute.
            </p>
          </div>
        )}

        {results && !isLoading && (
          <div className="results-section">
            <div className="results-header">
              <div>
                <h2>Deals near {results.searchedArea}</h2>
                <p className="results-subtitle">
                  {results.deals.length} deal{results.deals.length !== 1 ? 's' : ''} found
                  {radius && ` within ${radius} km`}
                </p>
              </div>
              <p className="results-note">
                Results sourced from web search · Prices may vary
              </p>
            </div>

            <ErrorBoundary>
              <MapView location={results.searchedArea} radius={radius} coords={geoCoords} deals={results.deals} />
            </ErrorBoundary>

            {results.deals.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <h3>No deals found</h3>
                <p>
                  No meat deals were found for this area right now. Try a different location or
                  increase the radius.
                </p>
              </div>
            ) : (
              <>
                <div className="filter-bar">
                  {MEAT_TYPES.map(({ type, label, emoji }) => {
                    const count = countByType(type);
                    if (type !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={type}
                        className={`filter-chip ${activeFilter === type ? 'active' : ''}`}
                        onClick={() => setActiveFilter(type)}
                      >
                        {emoji} {label}
                        <span className="chip-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {sortedDeals.length === 0 ? (
                  <div className="empty-state">
                    <p>No {activeFilter} deals found. Try a different category.</p>
                  </div>
                ) : (
                  <div className="deals-grid">
                    {sortedDeals.map((deal, i) => (
                      <DealCard key={i} deal={deal} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!isLoading && !results && !error && (
          <div className="welcome-state">
            <div className="welcome-icons">🥩 🍗 🥓 🐟</div>
            <h2>Find the best meat prices near you</h2>
            <p>
              Enter your location above and click <strong>Find Deals</strong> to search current
              weekly grocery flyers for meat deals in your area.
            </p>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Powered by Claude AI · Prices from web search · Always verify at the store</p>
      </footer>
    </div>
  );
}
