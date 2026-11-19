export function Home() {
  const links = [
    { href: '/pantalla', title: 'Pantalla pública', text: 'Para la pantalla horizontal del campus. Reproduce el audio con un clic.' },
    { href: '/votar', title: 'Votación móvil', text: 'La página que abre el código QR.' },
    { href: '/admin', title: 'Panel de administración', text: 'Catálogo, reglas, eventos, anuncios y control en vivo. Requiere contraseña.' },
  ]
  return (
    <main className="home">
      <h1>Radio Campus</h1>
      <p>Radio inteligente e interactiva: la comunidad elige la siguiente canción desde su celular.</p>
      <ul>
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href}>
              <strong>{l.title}</strong>
              <span>{l.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
