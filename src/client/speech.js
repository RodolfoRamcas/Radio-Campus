// Voz del navegador: respaldo cuando no hay audio generado con Gemini.

function spanishVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  return voices.find((v) => v.lang === 'es-MX') ?? voices.find((v) => v.lang?.startsWith('es')) ?? null
}

export const browserSpeechAvailable = () => 'speechSynthesis' in window

/** Lee el texto en voz alta. Devuelve una función para detenerlo. */
export function speak(text, { onStart, onEnd, onError } = {}) {
  if (!browserSpeechAvailable()) {
    onError?.(new Error('Este navegador no tiene síntesis de voz.'))
    return () => {}
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'es-MX'
  utterance.rate = 1
  const voice = spanishVoice()
  if (voice) utterance.voice = voice
  utterance.onstart = () => onStart?.()
  utterance.onend = () => onEnd?.()
  utterance.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? null : onError?.(new Error(e.error)))
  synth.speak(utterance)
  return () => synth.cancel()
}
