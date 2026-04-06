# ─── Dockerfile ──────────────────────────────────────────────────────────────
# A Dockerfile is a recipe for building a Docker image.
# Each line is a "layer" — Docker caches layers, so unchanged layers don't rebuild.
#
# BEST PRACTICE: Copy package.json FIRST, then run npm install, then copy source.
# WHY? npm install only re-runs when package.json changes (rare).
#      Source code changes (frequent) don't trigger a slow npm install.
# ─────────────────────────────────────────────────────────────────────────────

# Start from the official Node.js 20 image (Alpine = 50MB vs 900MB for full image)
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy dependency manifests first (for layer caching)
COPY package*.json ./

# Install dependencies
# --omit=dev: skip devDependencies (nodemon etc.) in production
RUN npm install --omit=dev

# Copy the rest of the source code
COPY . .

# Expose the port our app runs on (documentation — doesn't actually open the port)
EXPOSE 3000

# The default command to run when the container starts
CMD ["node", "src/app.js"]
