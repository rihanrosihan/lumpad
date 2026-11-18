// Basemap tile URL. With a CARTO Basemaps API key (entered in Profile, kept in the synced store on your server, never in the repository)
// the keyed Voyager raster tiles are used; without one the free key-less CARTO tiles are used.
export const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/
export function tileSpec(key, dark) {
  const k = String(key || '').trim()
  if (KEY_RE.test(k)) return { url: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(k)}`, subdomains: '', keyed: true, filter: !!dark } // one style: dark mode dims it with a CSS filter
  return { url: `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, subdomains: 'abcd', keyed: false, filter: false }
}
