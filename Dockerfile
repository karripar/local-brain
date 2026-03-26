# syntax=docker/dockerfile:1.4

FROM node:24-alpine AS builder

WORKDIR /app

# Install deps needed for build
RUN apk add --no-cache git

# Copy only package files first (cache optimization)
COPY package*.json ./

RUN npm install

# Copy source
COPY . .

# Build the app (TypeScript → dist)
RUN npm run build


# ---- Production image ----
FROM node:24-alpine

WORKDIR /app

# Copy only necessary files (not everything)
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Set production mode
ENV NODE_ENV=production

EXPOSE 3006

CMD ["node", "dist/index.js"]
