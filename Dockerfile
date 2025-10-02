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

# Copy service account JSON
COPY agile-device-472202-i8-319f002d9438.json /app/agile-device-472202-i8-319f002d9438.json

# Copy start script
COPY start-server.sh /app/start-server.sh
RUN chmod +x /app/start-server.sh

# Build the application
RUN npm run build

# Expose port
EXPOSE 8080

# Set environment variables for production
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV GOOGLE_APPLICATION_CREDENTIALS=/app/agile-device-472202-i8-319f002d9438.json
ENV GOOGLE_CLOUD_PROJECT_ID=agile-device-472202-i8

# Start the Next.js application
CMD ["npm", "start"]