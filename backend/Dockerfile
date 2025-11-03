FROM node:18-slim
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# copy source
COPY . .

# generate prisma client if prisma files exist
RUN npx prisma generate || true

EXPOSE 4000
CMD ["npm", "run", "start"]
