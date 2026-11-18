// Basemap tile URL. With a CARTO Basemaps API key (entered in Profile or on the map, kept in the synced store on your server, never in the
// repository) the keyed Voyager raster tiles are used. CARTO's key-less tiles now answer "API KEY REQUIRED", so without a key the standard
// OpenStreetMap tiles are used (light use, attribution shown, Referer = site origin as the OSM tile policy asks).
export const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/
export function tileSpec(key, dark) {
  const k = String(key || '').trim()
  if (KEY_RE.test(k)) return { url: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(k)}`, subdomains: '', keyed: true, filter: !!dark, brand: 'CARTO' } // one style: dark mode dims it with a CSS filter
  return { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', subdomains: '', keyed: false, filter: !!dark, brand: 'OpenStreetMap' }
}
