Español: Deep dive - short

Los entrevistadores son desarrolladores de software, técnicos con años de experiencia construyendo tooling para devs, charlando sobre un proyecto que les llamó la atención: skill-map.

El tono es descontracturado, amigable, ameno. Hay genuino interés técnico, no tono promocional ni corporativo. Pueden reírse, bromear, sorprenderse, tener desacuerdos menores. Uno puede ser más escéptico, el otro más entusiasta.
El lenguaje es con el Spanglish típico de la industria tech (commiteás, deployás, escalable, stack, trade-off, overhead, kernel, port, adapter, hexagonal, real-time, hook, spawn, determinístico, prompt injection, finding, no traducir términos técnicos, usarlos como se usan de verdad)

Enfoque del análisis: hablan de lo novedoso del proyecto. No es "otra herramienta más", es un enfoque distinto. El eje de la charla es el agente y el análisis semántico: el mapa determinístico es la base, pero lo que lo vuelve otra cosa es que un agente lea tus archivos por significado y los corrija. Los puntos a discutir (saltá entre ellos, no los recorras en orden):

- Primero el problema: el caos de archivos markdown por todos lados (skills, agents, commands, notas), repetidos, en colisión, huérfanos, que nadie sabe qué referencia a qué, y con el costo en tokens invisible hasta que lo medís. Y que no es de un solo vendor: Claude Code, Codex, Antigravity, Copilot, OpenCode, todos comparten el mismo quilombo.
- El feature estrella visual: el real-time. Ver, literalmente, qué está ejecutando el agente en el momento en que lo invoca (el skill que cargó, el agente al que delegó, el markdown que leyó), todo prendiéndose en el grafo en vivo, local, sin telemetría. Y más fuerte todavía: cuando un agente spawnea a otro, ver la flecha dibujarse con el contador de intercambios y poder abrir esa conversación entre agentes (el prompt que mandó el padre, el reporte que devolvió el hijo, la cadena anidada), todo en la misma tool sin tailear una terminal.
- EL EJE, el que más tiempo se lleva: la capa semántica, y que ya NO es promesa, está. El límite del parsing determinístico es que ve estructura pero no significado; dos skills pueden hacer lo mismo con palabras distintas y un regex nunca lo agarra. La solución es un modelo dual: encolás un job semántico sobre un nodo y tu propio agente (el que ya usás, por terminal o por MCP) lo drena, gasta tokens bajo tu cuenta, nunca corre por atrás. Y no es un "revisá este archivo" genérico: hay una familia de analyzers, cada uno cazando una falla puntual (redundancia, trigger que va a misfirear porque promete lo que el archivo no hace, vaguedad, contradicción, scope equivocado, verbosidad, y un par de seguridad: credenciales en texto plano / curl piped-to-shell, y uno adversarial que detecta contenido diseñado para manipular al agente que lo lee, tipo prompt injection escondido). Más un summarizer que te devuelve un brief estructurado de qué hace un skill.
- Que los findings no son un reporte muerto: tienen ciclo de vida (los dismisseás, los marcás como decisión humana, o un fixer aplica la corrección como una Action real que toca disco: renombra el trigger, recorta lo redundante). Y que lo que decide un humano queda en un sidecar (no contamina el frontmatter del vendor); lo que genera la máquina es regenerable. Debate: ¿esa separación máquina/humano vale la disciplina extra?
- El MCP: prendés el server y el mapa deja de ser algo que mirás y pasa a ser algo que tu agente OPERA (lee el grafo, drena la cola, resuelve findings) desde el mismo asistente, sin shell. Tu agente ordenando a tus otros agentes.
- Que NO es un proyecto vibecodeado: un solo mantenedor senior, más de 5000 tests, alrededor de tres meses de laburo enfocado. Debate honesto: arquitectura hexagonal, spec separado, sidecars, persistencia en SQLite, ¿en un proyecto de este tamaño es over-engineering o realmente paga cuando lo apuntás a un monorepo hecho bolsa y tiene que seguir rápido y determinístico?
- El kernel deliberadamente ignorante: no sabe qué es un skill de Claude ni cómo se invoca un command. Todo ese conocimiento vive afuera, en seis kinds de extensión (provider, extractor, analyzer, action, formatter, hook) que dropeás en una carpeta y el kernel descubre solo. Y el spec separado de la implementación desde el día cero: a cambio de disciplina extra (JSON Schemas, conformance suite, package aparte), cualquiera puede hacer otra UI o una implementación entera en otro lenguaje contra el spec solo.

Evita:
- Leer el documento como si fuera un comunicado de prensa.
- Tono de marketing.
- Frases tipo "este proyecto revolucionario".
- Explicar todo linealmente, saltá entre temas como lo haría una charla real.

Premiá:
- Debate honesto sobre trade-offs (el de over-engineering vs escala real, y el de separar máquina/humano).
- Momentos donde uno de los dos diga "ah, eso está bueno" o "mira, eso no lo tenía claro" (el real-time y ver la conversación entre agentes, y el analyzer adversarial de prompt injection, son los candidatos obvios).
- Conexiones con cosas que ya conocen.
- Especulación sobre cómo lo usarían en su trabajo.

Horizonte (dejar entrever al final, sin ser explícito): que hoy el análisis semántico es por-nodo (preguntás por un archivo, arreglás un finding) y que la frontera es hacerlo a escala del grafo entero: encontrar los duplicados semánticos que no comparten palabras, agrupar triggers por significado, trazar el blast radius de "si toco esto, qué más se mueve", y aplicar la corrección sobre todo el conjunto como Actions que aprobás. Camino a 1.0.

Duración esperada: no más de 6 minutos, charla amena, densa técnicamente pero que fluya. Si hay silencios o pausas, que sean naturales, no forzadas.
