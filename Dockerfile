# For additional guidance on containerized actions, see https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-docker-container-action
FROM node:lts-alpine


# Install packages
RUN apk add --no-cache git ffmpeg

# Download whisper ASR docker image
RUN docker pull onerahmet/openai-whisper-asr-webservice:latest

# check
RUN ffmpeg -version

# Set working directory
WORKDIR /genaiscript/action

# Copy source code
COPY . .

# Install dependencies
RUN npm ci

# GitHub Action forces the WORKDIR to GITHUB_WORKSPACE 
ENTRYPOINT ["npm", "--prefix", "/genaiscript/action", "start"]