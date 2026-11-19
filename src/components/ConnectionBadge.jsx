const LABELS = {
  conectando: 'Conectando…',
  conectado: 'En vivo',
  reconectando: 'Reconectando…',
  'sin-red': 'Sin conexión a internet',
}

export function ConnectionBadge({ connection }) {
  return (
    <span className={`conn conn--${connection}`} role="status">
      <span className="conn__dot" aria-hidden="true" />
      {LABELS[connection] ?? connection}
    </span>
  )
}
