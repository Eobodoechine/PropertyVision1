This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Docker Deployment to Google Cloud Platform

### Prerequisites

1. **Docker Desktop** - Installed and running
2. **Google Cloud CLI (gcloud)** - Installed via Homebrew
3. **Service Account JSON** - Located in project root as `agile-device-472202-i8-319f002d9438.json`

### Quick Setup Commands

#### 1. Install Google Cloud CLI (if not installed)
```bash
brew install --cask google-cloud-sdk
```

#### 2. Locate Required Binaries
```bash
# Docker CLI location
/Applications/Docker.app/Contents/Resources/bin/docker

# Google Cloud CLI location
/opt/homebrew/share/google-cloud-sdk/bin/gcloud
```

#### 3. Set PATH Environment (Required for credential helpers)
```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
```

#### 4. Authenticate with Google Cloud
```bash
gcloud auth activate-service-account --key-file=agile-device-472202-i8-319f002d9438.json
gcloud config set project agile-device-472202-i8
gcloud auth configure-docker gcr.io
```

#### 5. Build and Deploy Docker Image
```bash
# Build the Docker image
docker build -t propertyvision .

# Tag for Google Container Registry
docker tag propertyvision gcr.io/agile-device-472202-i8/propertyvision:latest

# Push to Google Container Registry
docker push gcr.io/agile-device-472202-i8/propertyvision:latest
```

### Complete Deployment Script

Create a `deploy.sh` file in the project root:

```bash
#!/bin/bash
set -e

echo "🚀 Starting PropertyVision Docker Deployment"

# Set PATH to include both Docker and gcloud binaries
export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/share/google-cloud-sdk/bin:$PATH"

# Verify tools are available
echo "✅ Checking Docker..."
docker --version

echo "✅ Checking gcloud..."
gcloud version

echo "✅ Authenticating with Google Cloud..."
gcloud auth activate-service-account --key-file=agile-device-472202-i8-319f002d9438.json
gcloud config set project agile-device-472202-i8
gcloud auth configure-docker gcr.io

echo "🔨 Building Docker image..."
docker build -t propertyvision .

echo "🏷️  Tagging image for GCR..."
docker tag propertyvision gcr.io/agile-device-472202-i8/propertyvision:latest

echo "📤 Pushing to Google Container Registry..."
docker push gcr.io/agile-device-472202-i8/propertyvision:latest

echo "✅ Deployment complete!"
echo "📍 Image available at: gcr.io/agile-device-472202-i8/propertyvision:latest"
```

Make it executable: `chmod +x deploy.sh`

### Troubleshooting

#### Credential Helper Issues

If you see errors like `docker-credential-desktop: executable file not found`:

1. **Issue**: Docker credential helpers not in PATH
2. **Solution**: Always set the PATH environment variable before running Docker commands:
   ```bash
   export PATH="/Applications/Docker.app/Contents/Resources/bin:/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
   ```

#### Docker Build Issues

- Ensure Docker Desktop is running
- Check that `Dockerfile` exists in project root
- Verify service account JSON file is present

### Environment Variables

The following environment variables are configured in the system:
- `RAPIDAPI_KEY`: RapidAPI key for property data
- `GOOGLE_MAPS_API_KEY`: Google Maps API key
