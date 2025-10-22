# Use the official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Service account credentials will be injected at runtime via Cloud Run

# Copy start script
COPY start-server.sh /app/start-server.sh
RUN chmod +x /app/start-server.sh

# Build the application - updated with fixes
RUN npm run build

# Expose port
EXPOSE 8080

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV GOOGLE_CLOUD_PROJECT_ID=durable-ring-475417-g0

# Start the application based on RUN_WORKER env var
CMD ["/bin/sh", "-c", "if [ \"$RUN_WORKER\" = \"true\" ]; then npm run worker; else npm start; fi"]