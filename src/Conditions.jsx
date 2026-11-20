import { useApi } from './api.js'
import { Card } from './ui.jsx'

// Right-now weather and air quality at the place of your last GPS run (rounded to 0.1°, ~11 km): server-side Google Weather + Air Quality.
export default function Conditions() {
  const C = useApi('/api/env/conditions')
  if (!C.data || C.data.available === false) return null // no key or no GPS run yet: say nothing rather than show an empty box
  const w = C.data.weather, a = C.data.air
  return <Card title="Conditions now" right={<span className="muted">{C.data.cell}</span>} className="tight">
    {w && <div className="pills">
      <div className="pillc"><small>Temp</small><b>{w.temp_c != null ? `${w.temp_c}°C` : '—'}</b><em>{w.feels_c != null ? `feels ${w.feels_c}°C` : ''}{w.text ? ` · ${w.text}` : ''}</em></div>
      <div className="pillc"><small>Humidity</small><b>{w.rh != null ? `${w.rh}%` : '—'}</b><em>{w.wbgt_shade != null ? `WBGT ≥ ${w.wbgt_shade}°C (shade)` : ''}</em></div>
      <div className="pillc"><small>Sun / rain</small><b>UV {w.uv ?? '—'}</b><em>{w.rain_pct != null ? `rain ${w.rain_pct}%` : ''}{w.wind_kmh != null ? ` · wind ${w.wind_kmh} km/h` : ''}</em></div>
    </div>}
    {a && <p className="muted" style={{ margin: '8px 0 0' }}>
      Air: {a.local ? <b>{a.local.name} {a.local.aqi} · {a.local.category}</b> : a.universal ? <b>AQI {a.universal.aqi} · {a.universal.category}</b> : '—'}
      {a.pm25 != null ? ` · PM2.5 ${a.pm25} µg/m³` : ''}
    </p>}
    <p className="src-note">Source: Google Weather and Air Quality, current values at this 0.1° cell. WBGT is the shade estimate and a lower bound in the sun. Not medical advice.</p>
  </Card>
}
