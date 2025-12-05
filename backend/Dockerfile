FROM node:18-slim
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# copy source
COPY . .

# generate drizzle types / client if needed (no-op if not configured)
RUN npx drizzle-kit generate || true

EXPOSE 4000
CMD ["npm", "run", "start"]
