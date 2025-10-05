FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including tsx for runtime)
RUN npm ci

# Copy source code
COPY . .

# Expose port
EXPOSE 8080

# Start the server using tsx directly
CMD ["npx", "tsx", "src/index.ts"]
