// Carga única de la API oficial del reproductor de YouTube (IFrame Player API).

let loading = null

export function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      loading = null
      reject(new Error('No se pudo cargar el reproductor de YouTube. Revisa la conexión a internet.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export const YT_ERRORS = {
  2: 'Identificador de video no válido.',
  5: 'El navegador no pudo reproducir el video.',
  100: 'El video ya no existe o es privado.',
  101: 'El dueño del video no permite reproducirlo fuera de YouTube.',
  150: 'El dueño del video no permite reproducirlo fuera de YouTube.',
  153: 'YouTube rechazó la reproducción embebida desde este sitio.',
}
