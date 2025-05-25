FROM node:22.13.1-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

# Production Stage
FROM nginx:stable-alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
ARG VITE_WEBSOCKET_URL="ws://localhost:8080/ws" # Default jika tidak di-override
ARG VITE_STUN_SERVER_URL="stun:stun.l.google.com:19302"


WORKDIR /app

RUN echo "VITE_WEBSOCKET_URL=${VITE_WEBSOCKET_URL}" >> .env && \
    echo "VITE_STUN_SERVER_URL=${VITE_STUN_SERVER_URL}" >> .env

RUN cat .env

COPY package*.json ./
RUN npm install
COPY . .

RUN npm run build

# ---- Production Stage ----
FROM nginx:stable-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]