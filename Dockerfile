# Seguimiento Actividades Gestiona Forestal 2026 — imagen para Cloud Run (o cualquier host de contenedores)
FROM node:22-slim

ENV NODE_ENV=production \
    PUERTO=8080

WORKDIR /app

# Dependencias (capa cacheable): solo las de producción
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código, interfaz y semilla (la semilla solo se usa en MODO_DATOS=memoria)
COPY server ./server
COPY public ./public
COPY data/semilla.json ./data/semilla.json

# El modo memoria escribe data/demo-estado.json; el usuario sin privilegios necesita escribir ahí
RUN chown -R node:node /app/data
USER node

EXPOSE 8080
CMD ["node", "server/server.js"]
