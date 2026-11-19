import { useEffect, useState } from 'react'
import { api } from '../../client/api.js'
import { Field, Loading, PageHeader } from './ui.jsx'

export function Stats() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setData(null)
    api(`/admin/stats?days=${days}`).then(setData).catch((e) => setError(e.message))
  }, [days])

  return (
    <>
      <PageHeader title="Estadísticas de participación">
        <Field label="Periodo">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Último día</option>
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={365}>Último año</option>
          </select>
        </Field>
      </PageHeader>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <div className="stat-row">
            <Stat hero label="Votos" value={data.votes} />
            <Stat label="Personas distintas" value={data.voters} hint="Dispositivos únicos" />
            <Stat label="Rondas cerradas" value={data.rounds} />
            <Stat label="Votos por ronda" value={data.avgVotes} hint="Promedio" />
            <Stat label="Rondas sin votos" value={data.emptyRounds} />
            <Stat label="Empates" value={data.ties} />
          </div>

          <div className="chart-grid">
            <ColumnChart
              title="Votos por hora del día"
              subtitle="Hora del campus"
              data={data.byHour.map((value, hour) => ({ label: `${hour}:00`, short: hour % 3 === 0 ? String(hour) : '', value }))}
            />
            <ColumnChart
              title="Participación por ronda"
              subtitle="Últimas 30 rondas cerradas, votos en cada una"
              data={data.perRound.map((r, i) => ({ label: `Ronda #${r.id}`, short: i % 5 === 0 ? `#${r.id}` : '', value: r.votes }))}
            />
            <BarList title="Canciones que más ganan" subtitle="Rondas ganadas por votación" rows={data.topWinners} unit="victorias" />
            <BarList title="Canciones más reproducidas" subtitle="Reproducciones completas o saltadas" rows={data.topPlayed} unit="reproducciones" />
          </div>
        </>
      )}
    </>
  )
}

function Stat({ label, value, hint, hero }) {
  return (
    <div className={`stat ${hero ? 'stat--hero' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{Number(value).toLocaleString('es-MX')}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  )
}

/** Columnas de una sola serie: sin leyenda (el título dice qué es), valor al pasar el cursor, tabla accesible. */
function ColumnChart({ title, subtitle, data }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const step = niceStep(max)
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step)
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0)

  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </figcaption>
      {data.length === 0 || max === 0 ? (
        <p className="muted small">Aún no hay datos en este periodo.</p>
      ) : (
        <div className="columns" role="img" aria-label={`${title}. Máximo: ${data[peak].value} en ${data[peak].label}.`}>
          <div className="columns__axis">
            {ticks.map((t) => (
              <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
                {t}
              </span>
            ))}
          </div>
          <div className="columns__plot">
            {ticks.map((t) => (
              <i key={t} className="columns__grid" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
            {data.map((d, i) => (
              <div key={i} className="columns__slot" tabIndex={0} aria-label={`${d.label}: ${d.value}`}>
                <span className="columns__bar" style={{ height: `${(d.value / top) * 100}%` }}>
                  {i === peak && d.value > 0 && <b className="columns__peak">{d.value}</b>}
                </span>
                <span className="columns__tip" role="tooltip">
                  {d.label}
                  <strong>{d.value}</strong>
                </span>
                <span className="columns__label">{d.short}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="chart__table">
        <summary>Ver como tabla</summary>
        <table className="table table--compact">
          <tbody>
            {data.map((d, i) => (
              <tr key={i}>
                <th scope="row">{d.label}</th>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

function BarList({ title, subtitle, rows, unit }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </figcaption>
      {rows.length === 0 ? (
        <p className="muted small">Aún no hay datos en este periodo.</p>
      ) : (
        <ol className="hbars">
          {rows.map((r, i) => (
            <li key={i} title={`${r.title}: ${r.count} ${unit}`}>
              <span className="hbars__label">
                {r.title} <span className="muted">— {r.artist}</span>
              </span>
              <span className="hbars__track">
                <span className="hbars__bar" style={{ width: `${(r.count / max) * 100}%` }} />
                <span className="hbars__value">{r.count}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </figure>
  )
}

function niceStep(max) {
  const raw = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)))
  const normalized = raw / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return Math.max(1, nice * magnitude)
}
