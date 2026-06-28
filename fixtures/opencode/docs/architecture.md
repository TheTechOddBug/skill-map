# Architecture

A small web service: an HTTP layer over a Postgres database, deployed as a
container. Schema changes ship through the `run-migrations` skill before any
deploy. The builder agent owns this document.
