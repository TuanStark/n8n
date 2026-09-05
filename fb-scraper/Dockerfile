FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy application source and assets
COPY *.js ./
COPY assets/ ./assets/

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
