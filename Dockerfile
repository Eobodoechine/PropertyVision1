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

# Build the application
RUN npm run build

# Expose port
EXPOSE 8080

# Set environment variable for production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]