// Resolución de una ronda: gana la opción con más votos; empates y rondas vacías siguen reglas configurables.

export const TIE_BREAKS = {
  contexto: 'La que mejor encaja con el contexto',
  'menos-reproducida': 'La menos reproducida',
  aleatorio: 'Al azar',
  primera: 'La primera opción',
}

export const NO_VOTE_RULES = {
  contexto: 'La que mejor encaja con el contexto',
  aleatorio: 'Una de las dos, al azar',
  respaldo: 'Una canción de la lista de respaldo',
}

function bestBy(indexes, value, prefer) {
  return indexes.reduce((best, i) => (prefer(value(i), value(best)) ? i : best), indexes[0])
}

/**
 * @returns {{ winner: number|null, resolution: 'votos'|'empate'|'sin-votos', strategy: string|null, total: number }}
 * winner es null solo cuando la regla de "sin votos" es usar el respaldo.
 */
export function resolveRound({ counts, config, scores = [], playCounts = [], rng = Math.random }) {
  const total = counts.reduce((a, b) => a + b, 0)
  const all = counts.map((_, i) => i)

  if (total > 0) {
    const max = Math.max(...counts)
    const leaders = all.filter((i) => counts[i] === max)
    if (leaders.length === 1) return { winner: leaders[0], resolution: 'votos', strategy: null, total }
    return { winner: breakTie(leaders, config.tieBreak), resolution: 'empate', strategy: config.tieBreak, total }
  }

  if (config.noVotes === 'respaldo') return { winner: null, resolution: 'sin-votos', strategy: 'respaldo', total }
  return { winner: breakTie(all, config.noVotes), resolution: 'sin-votos', strategy: config.noVotes, total }

  function breakTie(candidates, strategy) {
    switch (strategy) {
      case 'primera':
        return candidates[0]
      case 'aleatorio':
        return candidates[Math.floor(rng() * candidates.length)]
      case 'menos-reproducida':
        return bestBy(candidates, (i) => playCounts[i] ?? 0, (a, b) => a < b)
      case 'contexto':
      default:
        return bestBy(candidates, (i) => scores[i] ?? 0, (a, b) => a > b)
    }
  }
}

/** Cierre de la votación: deja margen para mostrar resultados antes de que termine la canción. */
export function roundClosesAt({ startedAt, endsAt, roundSeconds, resultsSeconds }) {
  const minimum = startedAt + 15_000
  const byDuration = startedAt + roundSeconds * 1000
  const byEnd = endsAt - resultsSeconds * 1000
  return Math.max(minimum, Math.min(byDuration, byEnd))
}
