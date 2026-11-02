// @ts-check
// The About page's text (about.html), in each language of the site. Plain
// HTML written here (no user input): headings, paragraphs, lists, links.

/** @type {Record<string, { title: string, lead: string, body: string }>} */
export const ABOUT = {
  fr: {
    title: 'À propos',
    lead: 'Un carnet de voyage qui se feuillette, se parcourt sur une carte et se lit comme un récit — tenu à la main, hébergé à la maison.',
    body: `
<h2>L’idée</h2>
<p>Photo Book est né d’une envie simple : retrouver le plaisir de l’album photo qu’on feuillette sur la table du salon, sans l’abandonner aux réseaux sociaux. Ici, pas de fil infini ni d’algorithme : des albums, rangés par voyage ou par moment de vie, et le temps de les regarder.</p>
<p>Chaque photo garde sa mémoire — la date, le lieu, l’appareil — et c’est elle qui dessine le reste : la carte des endroits traversés, le tracé du voyage, la Terre vue de l’espace avec, posées dessus, toutes ces images.</p>

<h2>Ce que vous trouverez ici</h2>
<ul>
  <li><strong>Des albums</strong>, à parcourir photo par photo, en diaporama ou en plein écran, dans l’ordre du voyage.</li>
  <li><strong>Des panoramas à 360°</strong>, pour se retrouver au milieu du paysage et tourner la tête.</li>
  <li><strong>Une carte</strong> de tous les lieux photographiés, avec le chemin parcouru d’une étape à l’autre.</li>
  <li><strong>Un globe en 3D</strong> : la Terre telle qu’elle est en ce moment, le jour et la nuit, la Lune et les planètes, et nos photos à la surface.</li>
  <li><strong>Des articles</strong>, pour raconter ce que les photos ne disent pas : la rencontre, le détour, l’orage du troisième jour.</li>
</ul>

<h2>Comment c’est fait</h2>
<p>Tout tourne sur un petit serveur, avec des logiciels libres : Node.js pour l’application, PostgreSQL pour la mémoire, Kubernetes (k3s) pour l’orchestre. Les photos ne quittent pas cette machine ; les cartes et les images de la Terre viennent de sources ouvertes, sans clé ni abonnement.</p>
<p>Le site est développé petit à petit, avec des tests automatiques à chaque modification et une version d’essai qui précède toujours la version publique. Le numéro discret en bas de page indique la version que vous regardez.</p>

<h2>Vie privée</h2>
<p>Aucune publicité, aucun traqueur, aucun service de statistiques tiers. Le site retient seulement ce dont il a besoin : votre session si vous vous connectez, et un identifiant anonyme dans votre navigateur pour compter les vues et les « j’aime » sans les compter deux fois. Certains albums sont réservés à la famille et aux amis ; leur position GPS peut être floutée ou masquée.</p>

<h2>Merci</h2>
<p>Ce site doit beaucoup à ceux qui partagent leur travail : la NASA (Blue Marble, Black Marble, la Lune), les contributeurs d’OpenStreetMap et OpenFreeMap, EOX et le programme Copernicus pour les images satellite, Natural Earth, timezone-boundary-builder, et les bibliothèques Pannellum, Three.js et MapLibre. Les titres sont composés en Fraunces.</p>
<p>Et merci à vous d’être passé. Bonne promenade.</p>`,
  },
  en: {
    title: 'About',
    lead: 'A travel journal to leaf through, follow on a map and read like a story — kept by hand, hosted at home.',
    body: `
<h2>The idea</h2>
<p>Photo Book grew out of a simple wish: to get back the pleasure of the photo album you leaf through on the living-room table, without handing it over to social networks. No endless feed here, no algorithm: albums, sorted by trip or by moment of life, and the time to look at them.</p>
<p>Every photo keeps its memory — the date, the place, the camera — and that memory draws the rest: the map of the places we went through, the route of the trip, the Earth seen from space with all these pictures resting on it.</p>

<h2>What you will find here</h2>
<ul>
  <li><strong>Albums</strong>, to browse photo by photo, as a slideshow or full screen, in the order of the trip.</li>
  <li><strong>360° panoramas</strong>, to stand in the middle of the landscape and look around.</li>
  <li><strong>A map</strong> of every place photographed, with the route from one stop to the next.</li>
  <li><strong>A 3D globe</strong>: the Earth as it is right now, day and night, the Moon and the planets, and our photos on its surface.</li>
  <li><strong>Stories</strong>, to tell what the photos don’t: the encounter, the detour, the storm on the third day.</li>
</ul>

<h2>How it is made</h2>
<p>Everything runs on a small server, with free software: Node.js for the application, PostgreSQL for its memory, Kubernetes (k3s) to keep it all playing. The photos never leave that machine; the maps and the pictures of the Earth come from open sources, with no key and no subscription.</p>
<p>The site grows little by little, with automatic tests on every change and a trial version that always comes before the public one. The discreet number at the bottom of the page tells which version you are looking at.</p>

<h2>Privacy</h2>
<p>No ads, no trackers, no third-party analytics. The site keeps only what it needs: your session if you sign in, and an anonymous identifier in your browser to count views and likes without counting them twice. Some albums are for family and friends only; their GPS positions can be blurred or hidden.</p>

<h2>Thanks</h2>
<p>This site owes a lot to those who share their work: NASA (Blue Marble, Black Marble, the Moon), the contributors of OpenStreetMap and OpenFreeMap, EOX and the Copernicus programme for the satellite imagery, Natural Earth, timezone-boundary-builder, and the Pannellum, Three.js and MapLibre libraries. Titles are set in Fraunces.</p>
<p>And thank you for stopping by. Enjoy the walk.</p>`,
  },
  es: {
    title: 'Acerca de',
    lead: 'Un cuaderno de viaje para hojear, recorrer en un mapa y leer como un relato — hecho a mano, alojado en casa.',
    body: `
<h2>La idea</h2>
<p>Photo Book nació de un deseo sencillo: recuperar el placer del álbum de fotos que se hojea sobre la mesa del salón, sin entregarlo a las redes sociales. Aquí no hay un muro infinito ni algoritmos: álbumes, ordenados por viaje o por momento de la vida, y el tiempo para mirarlos.</p>
<p>Cada foto guarda su memoria — la fecha, el lugar, la cámara — y es ella la que dibuja el resto: el mapa de los lugares recorridos, el trazado del viaje, la Tierra vista desde el espacio con todas esas imágenes posadas encima.</p>

<h2>Lo que encontrará aquí</h2>
<ul>
  <li><strong>Álbumes</strong>, para recorrer foto a foto, en pase de diapositivas o a pantalla completa, en el orden del viaje.</li>
  <li><strong>Panorámicas de 360°</strong>, para estar en medio del paisaje y mirar alrededor.</li>
  <li><strong>Un mapa</strong> de todos los lugares fotografiados, con el camino de una etapa a otra.</li>
  <li><strong>Un globo en 3D</strong>: la Tierra tal como está ahora mismo, el día y la noche, la Luna y los planetas, y nuestras fotos en su superficie.</li>
  <li><strong>Artículos</strong>, para contar lo que las fotos no dicen: el encuentro, el desvío, la tormenta del tercer día.</li>
</ul>

<h2>Cómo está hecho</h2>
<p>Todo funciona en un pequeño servidor, con software libre: Node.js para la aplicación, PostgreSQL para la memoria, Kubernetes (k3s) para dirigir la orquesta. Las fotos no salen de esa máquina; los mapas y las imágenes de la Tierra vienen de fuentes abiertas, sin clave ni suscripción.</p>
<p>El sitio crece poco a poco, con pruebas automáticas en cada cambio y una versión de prueba que siempre precede a la pública. El discreto número al pie de la página indica la versión que está viendo.</p>

<h2>Privacidad</h2>
<p>Sin publicidad, sin rastreadores, sin estadísticas de terceros. El sitio guarda solo lo que necesita: su sesión si se conecta, y un identificador anónimo en su navegador para contar las visitas y los «me gusta» sin contarlos dos veces. Algunos álbumes están reservados a la familia y los amigos; su posición GPS puede difuminarse u ocultarse.</p>

<h2>Gracias</h2>
<p>Este sitio debe mucho a quienes comparten su trabajo: la NASA (Blue Marble, Black Marble, la Luna), los colaboradores de OpenStreetMap y OpenFreeMap, EOX y el programa Copernicus por las imágenes de satélite, Natural Earth, timezone-boundary-builder, y las bibliotecas Pannellum, Three.js y MapLibre. Los títulos están compuestos en Fraunces.</p>
<p>Y gracias por pasar. Buen paseo.</p>`,
  },
};
