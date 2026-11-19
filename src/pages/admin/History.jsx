import { useEffect, useState } from 'react'
import { api } from '../../client/api.js'
import { formatDateTime, RESOLUTION_LABELS, SOURCE_LABELS, fallbackLabel } from '../../client/format.js'
import { Badge, Loading, PageHeader, useAdmin } from './ui.jsx'

const PLAY_STATUS = { completa: ['ok', 'Completa'], saltada: ['warn', 'Saltada'], error: ['bad', 'Error'], reproduciendo: ['info', 'Sonando'], 'sin-confirmar': ['warn', 'Sin confirmar'] }

export function History() {
  const { config, state } = useAdmin()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('rondas')
  const tz = config.campus.timezone

  // Se recarga cuando cambia lo que suena o se cierra una ronda.
  const key = `${state?.nowPlaying?.playId}-${state?.round?.status}`
  useEffect(() => {
    api('/admin/history?limit=100').then(setData).catch((e) => setError(e.message))
  }, [key])

  if (!data) return <Loading error={error} />

  return (
    <>
      <PageHeader title="Historial" description="Rondas, votos, reproducciones y acciones de la administración." />
      <div className="segmented" role="tablist">
        {[
          ['rondas', 'Rondas y votos'],
          ['reproducciones', 'Reproducciones'],
          ['bitacora', 'Bitácora'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'rondas' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Apertura</th>
                <th>Opciones (votos)</th>
                <th>Ganadora</th>
                <th>Resolución</th>
              </tr>
            </thead>
            <tbody>
              {data.rounds.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td className="nowrap">{formatDateTime(r.openedAt, tz)}</td>
                  <td className="small">
                    {r.options.map((o, i) => (
                      <div key={i}>
                        {i === 0 ? 'A' : 'B'}. {o} {r.counts && <strong>({r.counts[i]})</strong>}
                      </div>
                    ))}
                    {r.trace?.fallback && <div className="muted">Respaldo: {fallbackLabel(r.trace.fallback)}</div>}
                  </td>
                  <td className="small">{r.winner ?? '—'}</td>
                  <td>
                    {r.resolution ? <Badge tone={r.resolution === 'votos' ? 'ok' : 'warn'}>{RESOLUTION_LABELS[r.resolution]}</Badge> : <Badge tone="info">Abierta</Badge>}
                    {r.strategy && <div className="small muted">Regla: {r.strategy}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reproducciones' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Inicio</th>
                <th>Elemento</th>
                <th>Origen</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.plays.map((p) => {
                const [tone, label] = PLAY_STATUS[p.status] ?? ['neutral', p.status]
                return (
                  <tr key={p.id}>
                    <td className="nowrap">{formatDateTime(p.startedAt, tz)}</td>
                    <td>
                      {p.kind === 'announcement' && <Badge tone="info">Anuncio</Badge>} {p.title}
                    </td>
                    <td className="small">{SOURCE_LABELS[p.source] ?? p.source}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                      {p.detail && <div className="small muted">{p.detail}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bitacora' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{formatDateTime(a.at, tz)}</td>
                  <td>{a.action}</td>
                  <td className="small">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
