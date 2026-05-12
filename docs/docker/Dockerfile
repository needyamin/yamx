FROM node:20-alpine

# Install common system dependencies that YamX tools might need (git, python, etc)
RUN apk add --no-cache git python3 make g++ jq curl

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Link the package globally so 'yamx' command works if needed inside the container
RUN npm link

# Start YamX
ENTRYPOINT ["node", "/app/dist/index.js"]
