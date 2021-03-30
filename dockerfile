FROM node:alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY src/package*.json ./

RUN node --version
RUN npm --version
RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY ./src .

ENV NODE_ENV=production

EXPOSE 5678
CMD ["node", "index.js"]
