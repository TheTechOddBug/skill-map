Español: Deep dive - short

Los entrevistadores son desarrolladores de software, técnicos con años de experiencia construyendo tooling para devs, charlando sobre un proyecto que les llamó la atención: skill-map.

El tono es descontracturado, amigable, ameno. Hay genuino interés técnico, no tono promocional ni corporativo. Pueden reírse, bromear, sorprenderse, tener desacuerdos menores. Uno puede ser más escéptico, el otro más entusiasta.
El lenguaje es con el Spanglish típico de la industria tech (commiteás, deployás, escalable, stack, trade-off, overhead, kernel, port, adapter, hexagonal, real-time, hook, spawn, determinístico, no traducir términos técnicos, usarlos como se usan de verdad)

Enfoque del análisis: hablan de lo novedoso del proyecto. No es "otra herramienta más", es un enfoque distinto. Los puntos a discutir (saltá entre ellos, no los recorras en orden):

- Primero el problema: el caos de archivos markdown por todos lados (skills, agents, commands, notas), repetidos, en colisión, huérfanos, que nadie sabe qué referencia a qué, y con el costo en tokens invisible hasta que lo medís. Y que no es de un solo vendor: Claude Code, Codex, Antigravity, Copilot, OpenCode, todos comparten el mismo quilombo.
- El feature estrella: el real-time. Ver, literalmente, qué está ejecutando el agente en el momento en que lo invoca (el skill que cargó, el agente al que delegó, el markdown que leyó), todo prendiéndose en el grafo en vivo, local, sin telemetría. Y más fuerte todavía: cuando un agente spawnea a otro, ver la flecha dibujarse con el contador de intercambios y poder abrir esa conversación entre agentes (el prompt que mandó el padre, el reporte que devolvió el hijo, la cadena anidada), todo en la misma tool sin tailear una terminal. El momento "ah, pará, esto es otra cosa".
- Que NO es un proyecto vibecodeado: un solo mantenedor senior, más de 4000 tests, dos meses y medio de laburo enfocado. Debate honesto: arquitectura hexagonal, spec separado, sidecars, persistencia en SQLite, ¿en un proyecto de este tamaño es over-engineering o realmente paga cuando lo apuntás a un monorepo hecho bolsa y tiene que seguir rápido y determinístico?
- El kernel deliberadamente ignorante: no sabe qué es un skill de Claude ni cómo se invoca un command. Todo ese conocimiento vive afuera, en seis kinds de extensión (provider, extractor, analyzer, action, formatter, hook) que dropeás en una carpeta y el kernel descubre solo. Sistema de plugins centrado, aprende una plataforma nueva sin tocar el core.
- Separar el spec de la implementación desde el día cero. Cuánta disciplina extra (JSON Schemas, conformance suite, package aparte) y a cambio de qué: que cualquiera pueda hacer otra UI, o una implementación entera en otro lenguaje, contra el spec solo.
- El modelo dual de ejecución: determinístico por default (rápido, gratis, offline, CI-safe, corre en el scan) vs probabilístico (LLM opt-in, como job que encolás, nunca corriendo por atrás). Por qué esa separación importa.

Evita:
- Leer el documento como si fuera un comunicado de prensa.
- Tono de marketing.
- Frases tipo "este proyecto revolucionario".
- Explicar todo linealmente, saltá entre temas como lo haría una charla real.

Premiá:
- Debate honesto sobre trade-offs (sobre todo el de over-engineering vs escala real).
- Momentos donde uno de los dos diga "ah, eso está bueno" o "mira, eso no lo tenía claro" (el real-time y ver la conversación entre agentes es el candidato obvio).
- Conexiones con cosas que ya conocen.
- Especulación sobre cómo lo usarían en su trabajo.

Spoiler:
- dejar entrever, sin ser explícito, que hoy es beta y que lo que se viene es la capa de LLM: no solo detectar duplicados semánticos, agrupar triggers por significado y trazar el blast radius, sino proponer y aplicar la corrección (mergear el par redundante, renombrar el trigger que colisiona, recortar tokens) como una Action que toca disco. Ahí es donde esto pasa de visor a algo que de verdad ordena tus agentes.

Duración esperada: no más de 6 minutos, charla amena, densa técnicamente pero que fluya. Si hay silencios o pausas, que sean naturales, no forzadas.
