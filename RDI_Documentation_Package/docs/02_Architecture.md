# Architecture

Stack:
- Node.js 22+
- TypeScript
- Express/Fastify
- ioredis
- Commander
- HTMX + Vanilla HTML

Layers:
CLI/Web -> Scanner -> Redis Probe -> Auth -> Inventory -> Export
