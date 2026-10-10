# One container: builds the website, then the Node server serves it together with the game (Socket.IO).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "start"]
