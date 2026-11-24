FROM node:20-alpine AS builder
RUN apk add --no-cache openssl git
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx prisma generate

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl git
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["node", "index.js"]
