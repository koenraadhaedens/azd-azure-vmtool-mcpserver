FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js azure.js ./

# Non-root user for least-privilege execution
USER node

EXPOSE 3000

CMD ["node", "index.js"]
